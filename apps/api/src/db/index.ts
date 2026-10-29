import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getTableColumns, inArray, type SQL, type SQLWrapper } from 'drizzle-orm';
import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import type { MySqlTable } from 'drizzle-orm/mysql-core';
import mysql from 'mysql2/promise';
import { env } from '../env';
import * as schema from './schema';

/** MySQL / MariaDB (Hostinger's database). DATABASE_URL = mysql://user:password@host:3306/database */
export const pool = mysql.createPool({
  uri: env.DATABASE_URL, connectionLimit: 10, timezone: 'Z', dateStrings: ['DATE'], decimalNumbers: false, supportBigNumbers: true,
});
export const db: MySql2Database<typeof schema> = drizzle(pool, { schema, mode: 'default' });
export type Db = typeof db;
export { schema };

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));
export async function migrateDb() {
  await migrate(db, { migrationsFolder });
  // Audit log is append-only. Shared hosting may refuse triggers (needs privileges); the app never edits it either way.
  try {
    await pool.query(`CREATE TRIGGER IF NOT EXISTS audit_log_no_update BEFORE UPDATE ON audit_log FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_log is append-only'`);
    await pool.query(`CREATE TRIGGER IF NOT EXISTS audit_log_no_delete BEFORE DELETE ON audit_log FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_log is append-only'`);
  } catch (e) { if (env.NODE_ENV !== 'test') console.warn('Audit-log trigger not created (database does not allow triggers):', (e as Error).message); }
}
export const closeDb = () => pool.end();

/** Rows of a raw query. */
export async function rawRows<T>(q: SQL | SQLWrapper): Promise<T[]> {
  const [rows] = (await db.execute(q)) as unknown as [T[]];
  return rows;
}

type Tx = Pick<Db, 'insert' | 'select' | 'update' | 'delete'>;
type Row<T extends MySqlTable> = T['$inferSelect'];

/** MySQL has no RETURNING: ids are made here, then the rows are read back (in the order given). */
export async function insertReturning<T extends MySqlTable & { id: any }>(table: T, values: T['$inferInsert'] | T['$inferInsert'][], tx: Tx = db): Promise<Row<T>[]> {
  const list = (Array.isArray(values) ? values : [values]).map((v) => ({ id: randomUUID(), ...(v as object) })) as (T['$inferInsert'] & { id: string })[];
  if (!list.length) return [];
  await tx.insert(table).values(list as any);
  const rows = (await tx.select().from(table as any).where(inArray((table as any).id, list.map((v) => v.id)))) as Row<T>[];
  const byId = new Map(rows.map((r: any) => [r.id, r]));
  return list.map((v) => byId.get(v.id)!);
}

/** UPDATE … RETURNING: the rows matching `where` are updated and returned as they are afterwards. */
export async function updateReturning<T extends MySqlTable & { id: any }>(table: T, set: { [K in keyof T['$inferInsert']]?: T['$inferInsert'][K] | SQL }, where: SQL | undefined, tx: Tx = db): Promise<Row<T>[]> {
  const ids = (await tx.select({ id: (table as any).id }).from(table as any).where(where)).map((r: any) => r.id);
  if (!ids.length) return [];
  await tx.update(table).set(set as any).where(inArray((table as any).id, ids));
  return (await tx.select().from(table as any).where(inArray((table as any).id, ids))) as Row<T>[];
}

/** DELETE … RETURNING. */
export async function deleteReturning<T extends MySqlTable & { id: any }>(table: T, where: SQL | undefined, tx: Tx = db): Promise<Row<T>[]> {
  const rows = (await tx.select().from(table as any).where(where)) as Row<T>[];
  if (rows.length) await tx.delete(table).where(inArray((table as any).id, rows.map((r: any) => r.id)));
  return rows;
}

/** Every table of the schema by its SQL name (for copying whole databases). */
export const tablesByName = () => {
  const out = new Map<string, MySqlTable>();
  for (const v of Object.values(schema)) {
    const t = v as any;
    if (t && typeof t === 'object' && Symbol.for('drizzle:Name') in t && getTableColumns(t)) out.set(t[Symbol.for('drizzle:Name')], t);
  }
  return out;
};

/** Empty every table except `keep` (foreign keys off for the duration; TRUNCATE skips the audit-log trigger). */
export async function wipeAll(keep: string[] = []) {
  const c = await pool.getConnection();
  try {
    const [rows] = await c.query('SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name <> \'__drizzle_migrations\'');
    await c.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const { t } of rows as { t: string }[]) if (!keep.includes(t)) await c.query(`TRUNCATE TABLE \`${t}\``);
    await c.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally { c.release(); }
}
