import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db';

/** Salary, attendance or settings changed: calculated (not yet approved) runs must be calculated again before approval. */
export async function needsRecalc(cid: string, month?: string) {
  const R = schema.payrollRuns;
  await db.update(R).set({ status: 'DRAFT' }).where(and(eq(R.companyId, cid), eq(R.status, 'CALCULATED'), ...(month ? [eq(R.month, month)] : [])));
}
