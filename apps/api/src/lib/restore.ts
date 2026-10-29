import { getTableColumns, sql } from 'drizzle-orm';
import express, { Router } from 'express';
import { db, rawRows, tablesByName } from '../db';
import { requireAuth, requireRole } from './auth';
import { encrypt } from './crypto';
import { ApiError, h } from './http';

/**
 * First load of a new server: copy a whole database into it (e.g. the laptop's database → the hosted site).
 * Company Admin only, and only while this server has no employees yet, so it can never wipe live payroll data.
 * The dump is { table: rows }, rows keyed by SQL column name (as Postgres to_jsonb gives them). Encrypted columns (*_enc)
 * arrive decrypted over HTTPS and are encrypted here with this server's own key.
 */
export const restoreRouter = Router();
restoreRouter.post('/api/v1/restore', express.json({ limit: '50mb' }), requireAuth, requireRole('COMPANY_ADMIN'), h(async (req, res) => {
  const [{ n }] = await rawRows<{ n: number }>(sql`select count(*) as n from employee`);
  if (Number(n) > 0) throw new ApiError(409, 'not_empty', 'This server already has employees; copying is only for setting up an empty server');
  const dump = req.body?.tables as Record<string, Record<string, unknown>[]> | undefined;
  if (!dump || typeof dump !== 'object') throw new ApiError(422, 'invalid', 'Expected { tables: { name: rows[] } }');
  const tables = tablesByName();
  const unknown = Object.keys(dump).filter((t) => !tables.has(t));
  if (unknown.length) throw new ApiError(422, 'schema_mismatch', `Unknown tables: ${unknown.join(', ')} (update this server first)`);

  // One SQL row → the values drizzle expects for that table (dates as Date, decimals as strings).
  const convert = (t: string, r: Record<string, unknown>) => {
    const out: Record<string, unknown> = {};
    for (const [key, col] of Object.entries(getTableColumns(tables.get(t)!))) {
      let v = r[col.name];
      if (v === undefined) continue;
      if (v !== null) {
        if (col.name.endsWith('_enc') && typeof v === 'string') v = encrypt(v);
        else if (col.columnType === 'MySqlTimestamp') v = new Date(v as string);
        else if (col.columnType === 'MySqlDecimal') v = String(v);
        else if (col.columnType === 'MySqlDate') v = String(v).slice(0, 10);
      }
      out[key] = v;
    }
    return out;
  };
  const counts: Record<string, number> = {};
  await db.transaction(async (tx) => {
    await tx.execute(sql`SET FOREIGN_KEY_CHECKS = 0`); // tables arrive in name order, not dependency order
    for (const t of tables.keys()) await tx.execute(sql.raw(`TRUNCATE TABLE \`${t}\``));
    for (const [t, rows] of Object.entries(dump)) {
      const values = (rows ?? []).map((r) => convert(t, r));
      for (let i = 0; i < values.length; i += 200) await tx.insert(tables.get(t)!).values(values.slice(i, i + 200) as any);
      counts[t] = values.length;
    }
    await tx.execute(sql`SET FOREIGN_KEY_CHECKS = 1`);
  });
  console.log('Database restored from upload:', JSON.stringify(counts));
  res.json({ ok: true, counts });
}));
