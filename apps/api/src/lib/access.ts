import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Request } from 'express';
import { db, rawRows, schema } from '../db';
import { hasRole } from './auth';
import { forbidden, notFound } from './http';

/** Direct and indirect reports of an employee (recursive). */
export async function teamIds(companyId: string, managerEmpId: string): Promise<string[]> {
  const r = await rawRows<{ id: string }>(sql`
    WITH RECURSIVE t AS (
      SELECT id FROM employee WHERE company_id = ${companyId} AND manager_id = ${managerEmpId}
      UNION SELECT e.id FROM employee e JOIN t ON e.manager_id = t.id WHERE e.company_id = ${companyId}
    ) SELECT id FROM t`);
  return r.map((x) => x.id);
}

export type Access = 'admin' | 'self' | 'manager';
/** Who may see an employee: admins, the employee, or anyone above them in the reporting line. */
export async function employeeAccess(req: Request, employeeId: string): Promise<Access> {
  const u = req.user!;
  const [e] = await db.select({ id: schema.employees.id }).from(schema.employees)
    .where(and(eq(schema.employees.companyId, u.cid), eq(schema.employees.id, employeeId)));
  if (!e) throw notFound('Employee');
  if (hasRole(u, 'COMPANY_ADMIN', 'PAYROLL_MANAGER')) return 'admin';
  if (u.eid === employeeId) return 'self';
  if (u.eid && hasRole(u, 'REPORTING_MANAGER') && (await teamIds(u.cid, u.eid)).includes(employeeId)) return 'manager';
  throw forbidden();
}

export async function notifyUsersOfEmployees(companyId: string, employeeIds: string[], title: string, body?: string, link?: string) {
  if (!employeeIds.length) return;
  const us = await db.select({ id: schema.users.id }).from(schema.users)
    .where(and(eq(schema.users.companyId, companyId), inArray(schema.users.employeeId, employeeIds)));
  if (us.length) await db.insert(schema.notifications).values(us.map((x) => ({ companyId, userId: x.id, title, body, link })));
}
