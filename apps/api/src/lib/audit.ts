import type { Request } from 'express';
import { db, schema } from '../db';

/** Strip secrets before they reach the audit log. */
const scrub = (v: unknown): unknown => {
  if (!v || typeof v !== 'object') return v;
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) =>
    [k, /hash|enc$|Enc$|secret|password|token/i.test(k) ? '[redacted]' : x]));
};

export async function audit(req: Request | null, action: string, entity: string, entityId?: string | null, before?: unknown, after?: unknown, companyId?: string | null, userId?: string | null) {
  await db.insert(schema.auditLog).values({
    companyId: companyId ?? req?.user?.cid ?? null,
    userId: userId ?? req?.user?.sub ?? null,
    action, entity, entityId: entityId ?? null,
    before: before === undefined ? null : scrub(before), after: after === undefined ? null : scrub(after),
    ip: req?.ip ?? null,
  });
}
