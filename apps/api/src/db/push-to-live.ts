/**
 * Copy this computer's PayrollPro database to the hosted site, replacing everything there.
 *   npm run push-to-live -- --url https://your-site --token <RESTORE_TOKEN set on the site>
 * Sign-in sessions are not copied (everyone signs in again). Both sides must use the same FIELD_ENCRYPTION_KEY,
 * or saved PAN and bank numbers cannot be read on the site.
 */
import 'dotenv/config'; // DATABASE_URL from apps/api/.env
import { sql } from 'drizzle-orm';
import { parseArgs } from 'node:util';
import { closeDb, db } from './index';

const { values: a } = parseArgs({ options: { url: { type: 'string' }, token: { type: 'string' } } });
if (!a.url || !a.token) { console.error('Usage: npm run push-to-live -- --url https://your-site --token <RESTORE_TOKEN>'); process.exit(1); }
const rows = async <T>(q: ReturnType<typeof sql>) => ((await db.execute(q)) as unknown as { rows: T[] }).rows;
const tables: Record<string, unknown[]> = {};
for (const { t } of await rows<{ t: string }>(sql`select tablename t from pg_tables where schemaname = 'public' order by 1`)) {
  if (t === 'refresh_token') continue;
  const [r] = await rows<{ j: unknown }>(sql`select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) j from ${sql.identifier(t)} x`);
  tables[t] = (typeof r.j === 'string' ? JSON.parse(r.j) : r.j) as unknown[];
}
await closeDb();
const res = await fetch(new URL('/api/restore', a.url), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Restore-Token': a.token }, body: JSON.stringify({ tables }) });
const body = await res.text();
if (!res.ok) { console.error(`Failed (${res.status}): ${body}`); process.exit(1); }
console.log(`Copied to ${a.url}:`, JSON.parse(body).counts);
