/**
 * Copy this computer's PayrollPro data (the local PostgreSQL in apps/api/.env) to a new hosted site that has no employees yet.
 *   npm run push-to-live -- --url https://your-site --email <site admin login> --password <its password>
 * Everything on the site is replaced, including logins: afterwards everyone signs in with their passwords from this computer.
 * PAN, bank and 2FA secrets are decrypted here and re-encrypted by the site with its own key (sent over HTTPS only).
 */
import 'dotenv/config';
import { parseArgs } from 'node:util';
import pg from 'pg';

const { values: a } = parseArgs({ options: { url: { type: 'string' }, email: { type: 'string' }, password: { type: 'string' }, from: { type: 'string' } } });
const from = a.from ?? process.env.DATABASE_URL ?? '';
if (!a.url || !a.email || !a.password || !from.startsWith('postgres')) {
  console.error('Usage: npm run push-to-live -- --url https://your-site --email <admin> --password <password> [--from postgres://…]'); process.exit(1);
}
if (!a.url.startsWith('https://') && !/^http:\/\/localhost/.test(a.url)) { console.error('Use the https:// address: PAN and bank numbers are sent.'); process.exit(1); }
process.env.DATABASE_URL = 'mysql://unused@localhost/unused'; // the app's settings expect MySQL; only the encryption key is used here
const { decrypt } = await import('../lib/crypto');

const src = new pg.Client({ connectionString: from });
await src.connect();
const tables: Record<string, Record<string, unknown>[]> = {};
for (const { t } of (await src.query<{ t: string }>(`select tablename t from pg_tables where schemaname = 'public' order by 1`)).rows) {
  if (t === 'refresh_token') continue;
  const { rows: [r] } = await src.query<{ j: Record<string, unknown>[] }>(`select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) j from "${t}" x`);
  tables[t] = r.j;
  for (const row of tables[t]) for (const k of Object.keys(row)) if (k.endsWith('_enc') && typeof row[k] === 'string') row[k] = decrypt(row[k] as string);
}
await src.end();
const login = await fetch(new URL('/api/v1/auth/login', a.url), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: a.email, password: a.password }) });
const auth = await login.json() as { accessToken?: string; message?: string };
if (!auth.accessToken) { console.error(`Sign-in to the site failed: ${auth.message ?? login.status}`); process.exit(1); }
const res = await fetch(new URL('/api/v1/restore', a.url), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.accessToken}` }, body: JSON.stringify({ tables }) });
const body = await res.text();
if (!res.ok) { console.error(`Failed (${res.status}): ${body}`); process.exit(1); }
console.log(`Copied to ${a.url}:`, JSON.parse(body).counts);
