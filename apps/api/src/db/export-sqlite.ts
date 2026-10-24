/**
 * Copy every table into one SQLite file you can open in DB Browser for SQLite. Read-only for PayrollPro:
 * the app keeps using its own database; this is a snapshot. Stop `npm run dev` first (embedded database).
 *   npm run export:sqlite            → payrollpro.db in the project folder
 *   npm run export:sqlite -- out.db  → another file name
 * PAN, bank and Aadhaar stay encrypted (only the last 4 digits are readable); passwords and sign-in tokens are left out.
 */
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite'; // Node 22.5+
import { sql } from 'drizzle-orm';
import { closeDb, db } from './index';

const out = resolve(process.env.INIT_CWD ?? process.cwd(), process.argv[2] ?? 'payrollpro.db');
if (existsSync(out)) rmSync(out);
const lite = new DatabaseSync(out);

const rows = async <T>(q: ReturnType<typeof sql>) => ((await db.execute(q)) as unknown as { rows: T[] }).rows;
const cols = await rows<{ t: string; c: string; type: string }>(sql`
  select table_name t, column_name c, data_type type from information_schema.columns
  where table_schema = 'public' order by table_name, ordinal_position`);

const tables = new Map<string, { c: string; type: string }[]>();
// Sign-in secrets stay out of the file.
for (const r of cols) if (r.t !== 'refresh_token' && !/hash|secret/.test(r.c)) tables.set(r.t, [...(tables.get(r.t) ?? []), r]);

const affinity = (t: string) => (/int|numeric|double|real/.test(t) ? 'NUMERIC' : t === 'boolean' ? 'INTEGER' : 'TEXT');
const value = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString() : typeof v === 'boolean' ? Number(v) : typeof v === 'object' ? JSON.stringify(v) : (v as string | number));

for (const [t, cs] of tables) {
  lite.exec(`CREATE TABLE "${t}" (${cs.map((c) => `"${c.c}" ${affinity(c.type)}`).join(', ')})`);
  const data = await rows<Record<string, unknown>>(sql.raw(`select ${cs.map((c) => `"${c.c}"`).join(', ')} from "${t}"`));
  const ins = lite.prepare(`INSERT INTO "${t}" VALUES (${cs.map(() => '?').join(', ')})`);
  lite.exec('BEGIN');
  for (const r of data) ins.run(...cs.map((c) => value(r[c.c])));
  lite.exec('COMMIT');
  console.log(`${t.padEnd(28)} ${data.length} rows`);
}
lite.close();
await closeDb();
console.log(`\nSaved ${out}\nOpen it in DB Browser for SQLite (File → Open Database).`);
