import { compareRegimes } from '@payrollpro/engines';
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { db, insertReturning, schema } from '../db';
import { audit } from '../lib/audit';
import { teamIds } from '../lib/access';
import { hashPassword, hasRole, requireRole } from '../lib/auth';
import { randomToken } from '../lib/crypto';
import { ApiError, h, notFound, page, parse } from '../lib/http';
import { loadRules } from '../lib/rules';

export const miscRouter = Router();
const E = schema.employees, S = schema.salaryStructures, LR = schema.leaveRequests, U = schema.users;
const today = () => new Date().toISOString().slice(0, 10);

/* ---------- tax calculator (stateless) ---------- */
const amt = z.number().min(0).max(1e10);
miscRouter.post('/tax/calculate', h(async (req, res) => {
  const d = parse(z.object({
    taxYear: z.string().regex(/^\d{4}-\d{2}$/).default('2026-27'), ageBand: z.enum(['below60', '60to79', '80plus']).default('below60'),
    annualSalary: amt, basicDaAnnual: amt.default(0), hraReceived: amt.default(0), rentPaid: amt.default(0), metro: z.boolean().default(false),
    professionalTax: amt.default(0), employerNps: amt.default(0), otherIncome: amt.default(0),
    deductions: z.object({ '80C': amt, '80D': amt, '80DParents': amt, parentsSenior: z.boolean(), '80CCD1B': amt, homeLoanInterest: amt }).partial().default({}),
  }), req.body);
  const { tax } = await loadRules();
  try { res.json(compareRegimes(tax, d)); } catch (e) { throw new ApiError(422, 'no_rule', (e as Error).message); }
}));

miscRouter.get('/rules/statutory', h(async (_req, res) => res.json((await loadRules()).stat)));
miscRouter.get('/rules/tax', h(async (_req, res) => res.json((await loadRules()).tax)));

/* ---------- dashboard ---------- */
function nextDate(day: number, from = new Date()) {
  const d = new Date(Date.UTC(from.getFullYear(), from.getMonth(), Math.min(day, 28)));
  if (d.toISOString().slice(0, 10) < from.toISOString().slice(0, 10)) d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
}

miscRouter.get('/dashboard', h(async (req, res) => {
  const u = req.user!, cid = u.cid, t = today();
  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, cid));
  const holidays = await db.select({ date: schema.holidays.date, name: schema.holidays.name }).from(schema.holidays).where(and(eq(schema.holidays.companyId, cid), gte(schema.holidays.date, t))).orderBy(asc(schema.holidays.date)).limit(5);
  const onLeaveToday = (ids?: string[]) => db.select({ name: sql<string>`concat(${E.firstName}, ' ', ${E.lastName})`, type: schema.leaveTypes.code })
    .from(LR).innerJoin(E, eq(E.id, LR.employeeId)).innerJoin(schema.leaveTypes, eq(schema.leaveTypes.id, LR.leaveTypeId))
    .where(and(eq(LR.companyId, cid), eq(LR.status, 'APPROVED'), lte(LR.fromDate, t), gte(LR.toDate, t), ...(ids ? [inArray(LR.employeeId, ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])] : [])));
  const out: Record<string, unknown> = {
    company: { name: company.name }, nextPayDate: nextDate(company.payDay), cutoffDate: nextDate(company.cutoffDay), holidays,
    dueDates: [
      { label: 'TDS deposit', date: nextDate(7) }, { label: 'PF ECR & payment', date: nextDate(15) }, { label: 'ESI contribution', date: nextDate(15) },
    ].sort((a, b) => a.date.localeCompare(b.date)),
  };

  if (hasRole(u, 'COMPANY_ADMIN', 'PAYROLL_MANAGER')) {
    const active = and(eq(E.companyId, cid), inArray(E.status, ['ACTIVE', 'NOTICE']));
    const [hc] = await db.select({ total: sql<number>`count(*)`.mapWith(Number), notice: sql<number>`sum(case when ${E.status} = 'NOTICE' then 1 else 0 end)`.mapWith(Number), joiners: sql<number>`sum(case when ${E.doj} >= ${t.slice(0, 8) + '01'} then 1 else 0 end)`.mapWith(Number) }).from(E).where(active);
    const current = and(eq(S.companyId, cid), lte(S.effectiveFrom, t), or(isNull(S.effectiveTo), gte(S.effectiveTo, t)));
    const [cost] = await db.select({ gross: sql<number>`coalesce(sum(${S.monthlyGross}),0)`.mapWith(Number), employer: sql<number>`coalesce(sum(${S.employerCost}),0)`.mapWith(Number), ctc: sql<number>`coalesce(sum(${S.annualCtc}),0)`.mapWith(Number) }).from(S).innerJoin(E, eq(E.id, S.employeeId)).where(and(current, inArray(E.status, ['ACTIVE', 'NOTICE'])));
    const byDept = await db.select({ name: sql<string>`coalesce(${schema.departments.name}, 'Unassigned')`, headcount: sql<number>`count(distinct ${E.id})`.mapWith(Number), cost: sql<number>`coalesce(sum(${S.monthlyGross} + ${S.employerCost}),0)`.mapWith(Number) })
      .from(E).leftJoin(schema.departments, eq(schema.departments.id, E.departmentId)).leftJoin(S, and(eq(S.employeeId, E.id), lte(S.effectiveFrom, t), or(isNull(S.effectiveTo), gte(S.effectiveTo, t))))
      .where(active).groupBy(schema.departments.name).orderBy(desc(sql`count(distinct ${E.id})`));
    // Last 12 months: joiners, exits and headcount (counted here; a few hundred rows at most).
    const people = await db.select({ doj: E.doj, lwd: E.lastWorkingDay }).from(E).where(eq(E.companyId, cid));
    const trend = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(Date.UTC(Number(t.slice(0, 4)), Number(t.slice(5, 7)) - 12 + i, 1));
      const m = d.toISOString().slice(0, 7), next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
      return {
        month: d.toLocaleString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' }),
        joiners: people.filter((p) => p.doj.startsWith(m)).length, exits: people.filter((p) => p.lwd?.startsWith(m)).length,
        headcount: people.filter((p) => p.doj < next && (!p.lwd || p.lwd >= `${m}-01`)).length,
      };
    });
    const [ex] = await db.select({
      noPan: sql<number>`sum(case when ${E.panEnc} is null then 1 else 0 end)`.mapWith(Number), noBank: sql<number>`sum(case when ${E.bankEnc} is null then 1 else 0 end)`.mapWith(Number),
      noSalary: sql<number>`sum(case when not exists (select 1 from salary_structure s where s.employee_id = ${E.id}) then 1 else 0 end)`.mapWith(Number),
    }).from(E).where(active);
    const month = t.slice(0, 7);
    const [att] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(schema.attendanceMonths).where(and(eq(schema.attendanceMonths.companyId, cid), eq(schema.attendanceMonths.month, month)));
    const [run] = await db.select({ status: schema.payrollRuns.status, id: schema.payrollRuns.id }).from(schema.payrollRuns).where(and(eq(schema.payrollRuns.companyId, cid), eq(schema.payrollRuns.month, month)));
    const [cr] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(schema.changeRequests).where(and(eq(schema.changeRequests.companyId, cid), eq(schema.changeRequests.status, 'PENDING')));
    const gender = await db.select({ g: E.gender, n: sql<number>`count(*)`.mapWith(Number) }).from(E).where(active).groupBy(E.gender);
    const activity = await db.select({ action: schema.auditLog.action, entity: schema.auditLog.entity, at: schema.auditLog.at, email: U.email })
      .from(schema.auditLog).leftJoin(U, eq(U.id, schema.auditLog.userId)).where(eq(schema.auditLog.companyId, cid)).orderBy(desc(schema.auditLog.at)).limit(8);
    Object.assign(out, {
      admin: { headcount: hc, cost, byDept, trend, exceptions: ex, attendanceEntered: att.n, payrollRun: run ?? null, pendingChanges: cr.n, gender, activity, onLeaveToday: await onLeaveToday() },
    });
  }
  if (u.eid && hasRole(u, 'REPORTING_MANAGER')) {
    const ids = await teamIds(cid, u.eid);
    const [p] = ids.length ? await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(schema.attendanceMonths).where(and(eq(schema.attendanceMonths.companyId, cid), eq(schema.attendanceMonths.month, t.slice(0, 7)), inArray(schema.attendanceMonths.employeeId, ids))) : [{ n: 0 }];
    out.team = { size: ids.length, attendanceEntered: p.n };
  }
  if (u.eid) {
    const [s] = await db.select().from(S).where(and(eq(S.companyId, cid), eq(S.employeeId, u.eid), lte(S.effectiveFrom, t))).orderBy(desc(S.effectiveFrom)).limit(1);
    const [me] = await db.select({ firstName: E.firstName, lastName: E.lastName, code: E.code, doj: E.doj, taxRegime: E.taxRegime }).from(E).where(eq(E.id, u.eid));
    const [slip] = await db.select({ id: schema.payslips.id, month: schema.payslips.month, gross: schema.payslips.gross, net: schema.payslips.net, tds: schema.payslips.tds, deductions: schema.payslips.totalDeductions })
      .from(schema.payslips).innerJoin(schema.payrollRuns, eq(schema.payrollRuns.id, schema.payslips.runId))
      .where(and(eq(schema.payslips.employeeId, u.eid), eq(schema.payrollRuns.status, 'FINALISED'))).orderBy(desc(schema.payslips.month)).limit(1);
    out.me = { ...me, salary: s ? { annualCtc: Number(s.annualCtc), breakup: s.breakup, effectiveFrom: s.effectiveFrom } : null, latestPayslip: slip ?? null };
  }
  res.json(out);
}));

/* ---------- audit log ---------- */
miscRouter.get('/audit', requireRole('COMPANY_ADMIN', 'PAYROLL_MANAGER'), h(async (req, res) => {
  const q = req.query as Record<string, string>, A = schema.auditLog;
  const { limit, offset, page: p } = page(q);
  const where: SQL[] = [eq(A.companyId, req.user!.cid)];
  if (q.entity) where.push(eq(A.entity, q.entity));
  if (q.id) where.push(eq(A.entityId, q.id));
  if (q.action) where.push(eq(A.action, q.action));
  if (q.from) where.push(gte(A.at, new Date(q.from)));
  if (q.to) where.push(lte(A.at, new Date(q.to + 'T23:59:59Z')));
  const items = await db.select({ id: A.id, action: A.action, entity: A.entity, entityId: A.entityId, before: A.before, after: A.after, ip: A.ip, at: A.at, email: U.email })
    .from(A).leftJoin(U, eq(U.id, A.userId)).where(and(...where)).orderBy(desc(A.at)).limit(limit).offset(offset);
  const [{ n }] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(A).where(and(...where));
  res.json({ items, total: n, page: p, limit });
}));

/* ---------- notifications ---------- */
miscRouter.get('/notifications', h(async (req, res) => {
  const N = schema.notifications;
  res.json(await db.select().from(N).where(eq(N.userId, req.user!.sub)).orderBy(desc(N.createdAt)).limit(50));
}));
miscRouter.put('/notifications/read-all', h(async (req, res) => {
  await db.update(schema.notifications).set({ readAt: new Date() }).where(and(eq(schema.notifications.userId, req.user!.sub), isNull(schema.notifications.readAt)));
  res.status(204).end();
}));
miscRouter.put('/notifications/:id/read', h(async (req, res) => {
  await db.update(schema.notifications).set({ readAt: new Date() }).where(and(eq(schema.notifications.userId, req.user!.sub), eq(schema.notifications.id, req.params.id)));
  res.status(204).end();
}));

/* ---------- users & roles ---------- */
const roleList = z.array(z.enum(['COMPANY_ADMIN', 'PAYROLL_MANAGER', 'REPORTING_MANAGER', 'EMPLOYEE'])).min(1);
const tempPassword = () => `Pp-${randomToken(9)}1a`;
miscRouter.get('/users', requireRole('COMPANY_ADMIN'), h(async (req, res) => {
  res.json(await db.select({ id: U.id, email: U.email, roles: U.roles, active: U.active, totpEnabled: U.totpEnabled, lastLoginAt: U.lastLoginAt, lockedUntil: U.lockedUntil, employeeId: U.employeeId, name: sql<string | null>`concat(${E.firstName}, ' ', ${E.lastName})` })
    .from(U).leftJoin(E, eq(E.id, U.employeeId)).where(eq(U.companyId, req.user!.cid)).orderBy(asc(U.email)));
}));
miscRouter.post('/users', requireRole('COMPANY_ADMIN'), h(async (req, res) => {
  const d = parse(z.object({ email: z.string().email().toLowerCase(), roles: roleList, employeeId: z.string().uuid().optional() }), req.body);
  if (d.employeeId) { const [e] = await db.select({ id: E.id }).from(E).where(and(eq(E.companyId, req.user!.cid), eq(E.id, d.employeeId))); if (!e) throw notFound('Employee'); }
  const pw = tempPassword();
  const [row] = await insertReturning(U, { companyId: req.user!.cid, email: d.email, roles: d.roles, employeeId: d.employeeId, passwordHash: await hashPassword(pw) });
  await audit(req, 'create', 'user', row.id, undefined, { email: d.email, roles: d.roles });
  res.status(201).json({ id: row.id, tempPassword: pw });
}));
const scopedUser = async (cid: string, id: string) => { const [x] = await db.select().from(U).where(and(eq(U.companyId, cid), eq(U.id, id))); if (!x) throw notFound('User'); return x; };
miscRouter.put('/users/:id/roles', requireRole('COMPANY_ADMIN'), h(async (req, res) => {
  const { roles } = parse(z.object({ roles: roleList }), req.body);
  const before = await scopedUser(req.user!.cid, req.params.id);
  if (before.id === req.user!.sub && !roles.includes('COMPANY_ADMIN')) throw new ApiError(400, 'self_demote', 'You cannot remove your own admin role');
  await db.update(U).set({ roles, tokenVersion: sql`${U.tokenVersion} + 1` }).where(eq(U.id, before.id));
  await audit(req, 'role_change', 'user', before.id, { roles: before.roles }, { roles });
  res.json({ ok: true });
}));
miscRouter.put('/users/:id/active', requireRole('COMPANY_ADMIN'), h(async (req, res) => {
  const { active } = parse(z.object({ active: z.boolean() }), req.body);
  const before = await scopedUser(req.user!.cid, req.params.id);
  if (before.id === req.user!.sub) throw new ApiError(400, 'self', 'You cannot deactivate yourself');
  await db.update(U).set({ active, tokenVersion: sql`${U.tokenVersion} + 1` }).where(eq(U.id, before.id));
  await audit(req, active ? 'user_activated' : 'user_deactivated', 'user', before.id);
  res.json({ ok: true });
}));
miscRouter.post('/users/:id/reset-password', requireRole('COMPANY_ADMIN'), h(async (req, res) => {
  const before = await scopedUser(req.user!.cid, req.params.id);
  const pw = tempPassword();
  await db.update(U).set({ passwordHash: await hashPassword(pw), tokenVersion: sql`${U.tokenVersion} + 1`, failedLogins: 0, lockedUntil: null }).where(eq(U.id, before.id));
  await audit(req, 'password_reset', 'user', before.id);
  res.json({ tempPassword: pw });
}));
