import { timingSafeEqual } from 'node:crypto';
import { sql } from 'drizzle-orm';
import express, { Router } from 'express';
import { db } from '../db';
import { ApiError, h } from './http';

/**
 * Copy a whole database into this server (e.g. the laptop's PostgreSQL → the hosted site). Off unless RESTORE_TOKEN
 * (32+ characters) is set on the server; the caller sends it as X-Restore-Token. Replaces ALL data. Remove the token after use.
 * The dump is { table: rows-as-JSON }; Postgres converts the JSON back to each column's type (jsonb_populate_recordset).
 */
export const restoreRouter = Router();
restoreRouter.post('/api/restore', express.json({ limit: '50mb' }), h(async (req, res) => {
  const token = process.env.RESTORE_TOKEN ?? '', given = String(req.headers['x-restore-token'] ?? '');
  const ok = token.length >= 32 && given.length === token.length && timingSafeEqual(Buffer.from(given), Buffer.from(token));
  if (!ok) throw new ApiError(404, 'not_found', 'Route not found');
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
