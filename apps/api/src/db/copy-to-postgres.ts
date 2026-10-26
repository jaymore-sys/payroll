/**
 * Move everything from the built-in database (apps/api/.data/db) into the PostgreSQL in DATABASE_URL.
 * Stop `npm run dev` first. Creates the tables, then copies every row. Refuses if PostgreSQL already has a company.
 *   npm run db:copy-to-postgres
 * The built-in database is left untouched, so you can go back by removing DATABASE_URL from apps/api/.env.
 */
import 'dotenv/config';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { DATA_DIR } from '../env';

const url = process.env.DATABASE_URL;
if (!url) { console.error('Set DATABASE_URL in apps/api/.env first.'); process.exit(1); }

const src = new PGlite(process.env.PGLITE_DIR ?? `${DATA_DIR}/db`);
const dst = new pg.Client({ connectionString: url });
await dst.connect();
await migrate(drizzle(dst), { migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)) });

if ((await dst.query('select 1 from company limit 1')).rowCount) {
  console.error('PostgreSQL already has data, nothing copied. Empty the payrollpro database first if you want to copy again.');
  process.exit(1);
}

const cols = (await src.query<{ t: string; c: string; type: string }>(`
  select table_name t, column_name c, data_type type from information_schema.columns
  where table_schema = 'public' order by table_name, ordinal_position`)).rows;
const tables = new Map<string, { c: string; type: string }[]>();
for (const r of cols) tables.set(r.t, [...(tables.get(r.t) ?? []), r]);

await dst.query('begin');
await dst.query('set local session_replication_role = replica'); // skip FK order checks and triggers while copying (needs the postgres superuser)
for (const [t, cs] of tables) {
  const names = cs.map((c) => `"${c.c}"`).join(', ');
  const rows = (await src.query<Record<string, unknown>>(`select ${names} from "${t}"`)).rows;
  for (const r of rows) {
    const vals = cs.map((c) => (c.type === 'jsonb' || c.type === 'json') && r[c.c] != null ? JSON.stringify(r[c.c]) : r[c.c]);
    await dst.query(`insert into "${t}" (${names}) values (${cs.map((_, i) => `$${i + 1}`).join(', ')})`, vals);
  }
  console.log(`${t.padEnd(28)} ${rows.length} rows`);
}
// Counters (auto-numbered ids) continue after the copied rows.
const seqs = (await dst.query<{ t: string; c: string; s: string }>(`
  select table_name t, column_name c, pg_get_serial_sequence(format('%I', table_name), column_name) s
  from information_schema.columns where table_schema = 'public'`)).rows.filter((r) => r.s);
for (const { t, c, s } of seqs) await dst.query(`select setval('${s}', coalesce((select max("${c}") from "${t}"), 0) + 1, false)`);
await dst.query('commit');
await dst.end();
await src.close();
console.log('\nDone. Start the app with `npm run dev`: it now uses PostgreSQL.');
