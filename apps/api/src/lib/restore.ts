import { sql } from 'drizzle-orm';
import express, { Router } from 'express';
import { db } from '../db';
import { requireAuth, requireRole } from './auth';
import { encrypt } from './crypto';
import { ApiError, h } from './http';

/**
 * First load of a new server: copy a whole database into it (e.g. the laptop's PostgreSQL → the hosted site).
 * Company Admin only, and only while this server has no employees yet, so it can never wipe live payroll data.
 * The dump is { table: rows-as-JSON }; Postgres converts the JSON back to each column's type (jsonb_populate_recordset).
 * Encrypted columns (*_enc) arrive decrypted over HTTPS and are encrypted here with this server's own key.
 */
export const restoreRouter = Router();
restoreRouter.post('/api/v1/restore', express.json({ limit: '50mb' }), requireAuth, requireRole('COMPANY_ADMIN'), h(async (req, res) => {
  const [{ n }] = ((await db.execute(sql`select count(*)::int n from employee`)) as unknown as { rows: { n: number }[] }).rows;
  if (n > 0) throw new ApiError(409, 'not_empty', 'This server already has employees; copying is only for setting up an empty server');
  const dump = req.body?.tables as Record<string, unknown[]> | undefined;
  if (!dump || typeof dump !== 'object') throw new ApiError(422, 'invalid', 'Expected { tables: { name: rows[] } }');
  const rows = async <T>(q: ReturnType<typeof sql>) => ((await db.execute(q)) as unknown as { rows: T[] }).rows;
  const here = (await rows<{ t: string }>(sql`select tablename t from pg_tables where schemaname = 'public'`)).map((r) => r.t);
  const unknown = Object.keys(dump).filter((t) => !here.includes(t));
  if (unknown.length) throw new ApiError(422, 'schema_mismatch', `Unknown tables: ${unknown.join(', ')} (update this server first)`);
  const counts: Record<string, number> = {};
  await db.transaction(async (tx) => {
    await tx.execute(sql`set local session_replication_role = replica`); // no FK order or trigger checks while copying
    await tx.execute(sql.raw(`truncate ${here.map((t) => `"${t}"`).join(', ')} cascade`));
    for (const [t, data] of Object.entries(dump)) {
      if (!Array.isArray(data) || !data.length) { counts[t] = 0; continue; }
      for (const r of data as Record<string, unknown>[]) for (const k of Object.keys(r)) if (k.endsWith('_enc') && typeof r[k] === 'string') r[k] = encrypt(r[k] as string);
      await tx.execute(sql`insert into ${sql.identifier(t)} select * from jsonb_populate_recordset(null::${sql.identifier(t)}, ${JSON.stringify(data)}::jsonb)`);
      counts[t] = data.length;
    }
    // Auto-numbered ids continue after the copied rows.
    const seqs = ((await tx.execute(sql`select table_name t, column_name c, pg_get_serial_sequence(format('%I', table_name), column_name) s
      from information_schema.columns where table_schema = 'public'`)) as unknown as { rows: { t: string; c: string; s: string | null }[] }).rows.filter((r) => r.s);
    for (const { t, c, s } of seqs) await tx.execute(sql.raw(`select setval('${s}', coalesce((select max("${c}") from "${t}"), 0) + 1, false)`));
  });
  console.log('Database restored from upload:', JSON.stringify(counts));
  res.json({ ok: true, counts });
}));
