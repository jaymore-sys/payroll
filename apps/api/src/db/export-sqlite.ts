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
const lite = new DatabaseSync(out, { enableForeignKeyConstraints: false }); // tables are copied in name order

const rows = async <T>(q: ReturnType<typeof sql>) => ((await db.execute(q)) as unknown as { rows: T[] }).rows;
const cols = await rows<{ t: string; c: string; type: string; nullable: string }>(sql`
  select table_name t, column_name c, data_type type, is_nullable nullable from information_schema.columns
  where table_schema = 'public' order by table_name, ordinal_position`);
// Primary and foreign keys, so DB Browser shows how the tables connect.
const keys = await rows<{ t: string; c: string; kind: string; ft: string; fc: string }>(sql`
  select tc.table_name t, kcu.column_name c, tc.constraint_type kind, ccu.table_name ft, ccu.column_name fc
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
  join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
  where tc.table_schema = 'public' and tc.constraint_type in ('PRIMARY KEY', 'FOREIGN KEY')`);
const pk = (t: string) => keys.filter((k) => k.t === t && k.kind === 'PRIMARY KEY').map((k) => `"${k.c}"`);
const fks = (t: string) => keys.filter((k) => k.t === t && k.kind === 'FOREIGN KEY' && tables.has(k.ft))
  .map((k) => `FOREIGN KEY ("${k.c}") REFERENCES "${k.ft}"("${k.fc}")`);

const tables = new Map<string, { c: string; type: string; nullable: string }[]>();
// Sign-in secrets stay out of the file.
for (const r of cols) if (r.t !== 'refresh_token' && !/hash|secret/.test(r.c)) tables.set(r.t, [...(tables.get(r.t) ?? []), r]);

const affinity = (t: string) => (/int|numeric|double|real/.test(t) ? 'NUMERIC' : t === 'boolean' ? 'INTEGER' : 'TEXT');
const value = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString() : typeof v === 'boolean' ? Number(v) : typeof v === 'object' ? JSON.stringify(v) : (v as string | number));

for (const [t, cs] of tables) {
  const defs = [...cs.map((c) => `"${c.c}" ${affinity(c.type)}${c.nullable === 'NO' ? ' NOT NULL' : ''}`), ...(pk(t).length ? [`PRIMARY KEY (${pk(t).join(', ')})`] : []), ...fks(t)];
  lite.exec(`CREATE TABLE "${t}" (\n  ${defs.join(',\n  ')}\n)`);
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
