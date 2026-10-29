import { leaveDays } from '@payrollpro/engines';
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { db, insertReturning, schema, updateReturning } from '../db';
import { audit } from '../lib/audit';
import { employeeAccess, notifyUsersOfEmployees, teamIds } from '../lib/access';
import { hasRole, requireRole } from '../lib/auth';
import { ApiError, forbidden, h, notFound, parse } from '../lib/http';

export const leaveRouter = Router();
const LT = schema.leaveTypes, LL = schema.leaveLedger, LR = schema.leaveRequests, E = schema.employees;

/* ---------- leave types (policy builder) ---------- */
const typeSchema = z.object({
  code: z.string().regex(/^[A-Z]{1,6}$/), name: z.string().min(2).max(60), paid: z.boolean(), quota: z.number().min(0).max(366),
  accrual: z.enum(['upfront', 'monthly', 'days_worked']), proration: z.enum(['months', 'days', 'none']),
  carryCap: z.number().min(0), encashCap: z.number().min(0), encashDivisor: z.union([z.literal(26), z.literal(30)]),
  sandwich: z.boolean(), allowNegative: z.number().min(0), minNoticeDays: z.number().int().min(0), maxPerRequest: z.number().min(0.5),
  halfDay: z.boolean(), docAfterDays: z.number().int().nullish(), gender: z.enum(['M', 'F']).nullish(), active: z.boolean(),
}).partial({ accrual: true, proration: true, carryCap: true, encashCap: true, encashDivisor: true, sandwich: true, allowNegative: true, minNoticeDays: true, maxPerRequest: true, halfDay: true, active: true });
const toDb = (d: Partial<z.infer<typeof typeSchema>>) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, typeof v === 'number' && k !== 'encashDivisor' && k !== 'minNoticeDays' && k !== 'docAfterDays' ? String(v) : v]));

leaveRouter.get('/leave-types', h(async (req, res) => res.json(await db.select().from(LT).where(eq(LT.companyId, req.user!.cid)).orderBy(asc(LT.code)))));
leaveRouter.post('/leave-types', requireRole('COMPANY_ADMIN'), h(async (req, res) => {
  const [row] = await insertReturning(LT, { ...toDb(parse(typeSchema, req.body)), companyId: req.user!.cid } as any);
  await audit(req, 'create', 'leave_type', row.id, undefined, row);
  res.status(201).json(row);
}));
leaveRouter.put('/leave-types/:id', requireRole('COMPANY_ADMIN'), h(async (req, res) => {
  const [before] = await db.select().from(LT).where(and(eq(LT.companyId, req.user!.cid), eq(LT.id, req.params.id)));
  if (!before) throw notFound('Leave type');
  const [row] = await updateReturning(LT, toDb(parse(typeSchema.partial(), req.body)) as any, eq(LT.id, before.id));
  await audit(req, 'update', 'leave_type', row.id, before, row);
  res.json(row);
}));

/* ---------- balances & ledger ---------- */
const signed = sql<number>`coalesce(sum(case when ${LL.kind} in ('credit','carry','adjust') then ${LL.days} else -${LL.days} end),0)`.mapWith(Number);

async function balances(cid: string, employeeId: string) {
  const [emp] = await db.select({ gender: E.gender }).from(E).where(eq(E.id, employeeId));
  const types = (await db.select().from(LT).where(and(eq(LT.companyId, cid), eq(LT.active, true))).orderBy(asc(LT.code))).filter((t) => !t.gender || t.gender === emp?.gender);
  const bal = await db.select({ t: LL.leaveTypeId, b: signed }).from(LL).where(and(eq(LL.companyId, cid), eq(LL.employeeId, employeeId))).groupBy(LL.leaveTypeId);
  const pend = await db.select({ t: LR.leaveTypeId, d: sql<number>`coalesce(sum(${LR.daysCounted}),0)`.mapWith(Number) }).from(LR).where(and(eq(LR.companyId, cid), eq(LR.employeeId, employeeId), eq(LR.status, 'PENDING'))).groupBy(LR.leaveTypeId);
  const used = await db.select({ t: LL.leaveTypeId, d: sql<number>`coalesce(sum(${LL.days}),0)`.mapWith(Number) }).from(LL).where(and(eq(LL.companyId, cid), eq(LL.employeeId, employeeId), eq(LL.kind, 'debit'))).groupBy(LL.leaveTypeId);
  return types.map((t) => ({
    leaveTypeId: t.id, code: t.code, name: t.name, paid: t.paid, quota: Number(t.quota), halfDay: t.halfDay,
    balance: bal.find((b) => b.t === t.id)?.b ?? 0, pending: pend.find((p) => p.t === t.id)?.d ?? 0, used: used.find((u) => u.t === t.id)?.d ?? 0,
  }));
}

const empParam = (req: Request) => (req.query.employee as string) || req.user!.eid;
leaveRouter.get('/leave/balances', h(async (req, res) => {
  const id = empParam(req); if (!id) throw forbidden();
  await employeeAccess(req, id);
  res.json(await balances(req.user!.cid, id));
}));
leaveRouter.get('/leave/ledger', h(async (req, res) => {
  const id = empParam(req); if (!id) throw forbidden();
  await employeeAccess(req, id);
  const where: SQL[] = [eq(LL.companyId, req.user!.cid), eq(LL.employeeId, id)];
  if (req.query.type) where.push(eq(LL.leaveTypeId, String(req.query.type)));
  res.json(await db.select({ id: LL.id, date: LL.date, kind: LL.kind, days: LL.days, note: LL.note, refType: LL.refType, type: LT.code })
    .from(LL).innerJoin(LT, eq(LT.id, LL.leaveTypeId)).where(and(...where)).orderBy(desc(LL.date), desc(LL.createdAt)).limit(300));
}));
leaveRouter.post('/leave/adjust', requireRole('COMPANY_ADMIN'), h(async (req, res) => {
  const d = parse(z.object({ employeeId: z.string().uuid(), leaveTypeId: z.string().uuid(), days: z.number().min(-366).max(366).refine((x) => x !== 0), note: z.string().min(2).max(200) }), req.body);
  await employeeAccess(req, d.employeeId);
  const [row] = await insertReturning(LL, { companyId: req.user!.cid, employeeId: d.employeeId, leaveTypeId: d.leaveTypeId, date: new Date().toISOString().slice(0, 10), kind: d.days > 0 ? 'adjust' : 'debit', days: String(Math.abs(d.days)), refType: 'manual', note: d.note, createdBy: req.user!.sub });
  await audit(req, 'leave_adjust', 'employee', d.employeeId, undefined, d);
  res.status(201).json(row);
}));

/* ---------- calculator & requests ---------- */
const reqSchema = z.object({
  leaveTypeId: z.string().uuid(), from: z.string().date(), to: z.string().date(),
  halfDayFrom: z.boolean().default(false), halfDayTo: z.boolean().default(false), reason: z.string().max(500).optional(), employeeId: z.string().uuid().optional(),
}).refine((d) => d.to >= d.from, { message: 'End date must be on or after start date', path: ['to'] });

async function evaluate(req: Request, d: z.infer<typeof reqSchema>) {
  const cid = req.user!.cid;
  const employeeId = d.employeeId ?? req.user!.eid;
  if (!employeeId) throw forbidden();
  const access = await employeeAccess(req, employeeId);
  if (access === 'manager') throw forbidden();
  const [t] = await db.select().from(LT).where(and(eq(LT.companyId, cid), eq(LT.id, d.leaveTypeId), eq(LT.active, true)));
  if (!t) throw notFound('Leave type');
  const [emp] = await db.select({ e: E, state: schema.branches.state }).from(E).leftJoin(schema.branches, eq(schema.branches.id, E.branchId)).where(eq(E.id, employeeId));
  const [company] = await db.select({ wp: schema.companies.weekPattern }).from(schema.companies).where(eq(schema.companies.id, cid));
  const hol = await db.select({ date: schema.holidays.date }).from(schema.holidays).where(and(eq(schema.holidays.companyId, cid), eq(schema.holidays.restricted, false), gte(schema.holidays.date, d.from), lte(schema.holidays.date, d.to), or(isNull(schema.holidays.state), eq(schema.holidays.state, emp.state ?? ''))));
  const calc = leaveDays({ from: d.from, to: d.to, halfDayFrom: t.halfDay && d.halfDayFrom, halfDayTo: t.halfDay && d.halfDayTo, pattern: company.wp, holidays: hol.map((x) => x.date), sandwich: t.sandwich });
  const bal = (await balances(cid, employeeId)).find((b) => b.leaveTypeId === t.id)!;
  const available = bal.balance - bal.pending;
  const errors: string[] = [];
  if (calc.counted <= 0) errors.push('No working days in the selected range');
  if (t.gender && t.gender !== emp.e.gender) errors.push(`${t.name} is not available for this employee`);
  if (calc.counted > Number(t.maxPerRequest)) errors.push(`Maximum ${Number(t.maxPerRequest)} days per request`);
  const noticeDays = Math.floor((Date.parse(d.from) - Date.parse(new Date().toISOString().slice(0, 10))) / 864e5);
  if (noticeDays < t.minNoticeDays && access !== 'admin') errors.push(`Apply at least ${t.minNoticeDays} day${t.minNoticeDays === 1 ? "" : "s"} in advance`);
  if (t.paid && calc.counted > available + Number(t.allowNegative)) errors.push(`Insufficient balance (${available} available)`);
  const overlap = await db.select({ id: LR.id }).from(LR).where(and(eq(LR.companyId, cid), eq(LR.employeeId, employeeId), inArray(LR.status, ['PENDING', 'APPROVED']), lte(LR.fromDate, d.to), gte(LR.toDate, d.from)));
  if (overlap.length) errors.push('Overlaps an existing leave request');
  // Team members already off in this window (shown to employee and approver).
  const teammates = emp.e.managerId ? await db.select({ name: sql<string>`concat(${E.firstName}, ' ', ${E.lastName})`, from: LR.fromDate, to: LR.toDate })
    .from(LR).innerJoin(E, eq(E.id, LR.employeeId)).where(and(eq(LR.companyId, cid), eq(E.managerId, emp.e.managerId), ne(E.id, employeeId), eq(LR.status, 'APPROVED'), lte(LR.fromDate, d.to), gte(LR.toDate, d.from))) : [];
  return { employeeId, type: t, emp: emp.e, ...calc, balance: bal.balance, available, balanceAfter: t.paid ? available - calc.counted : null, teamOff: teammates, errors };
}

leaveRouter.post('/leave/calculate', h(async (req, res) => {
  const { type: _t, emp: _e, ...r } = await evaluate(req, parse(reqSchema, req.body));
  res.json(r);
}));

leaveRouter.post('/leave/requests', h(async (req, res) => {
  const d = parse(reqSchema, req.body);
  const r = await evaluate(req, d);
  if (r.errors.length) throw new ApiError(422, 'leave_invalid', r.errors[0], r.errors.map((m) => ({ message: m })));
  const [row] = await insertReturning(LR, { companyId: req.user!.cid, employeeId: r.employeeId, leaveTypeId: d.leaveTypeId, fromDate: d.from, toDate: d.to, halfDayFrom: d.halfDayFrom, halfDayTo: d.halfDayTo, daysCounted: String(r.counted), reason: d.reason });
  await audit(req, 'leave_applied', 'leave_request', row.id, undefined, { ...d, days: r.counted });
  if (r.emp.managerId) await notifyUsersOfEmployees(req.user!.cid, [r.emp.managerId], `${r.emp.firstName} applied for ${r.type.name}`, `${d.from} → ${d.to} · ${r.counted} day(s)`, '/approvals');
  res.status(201).json(row);
}));

leaveRouter.get('/leave/requests', h(async (req, res) => {
  const u = req.user!, scope = String(req.query.scope ?? 'mine');
  const where: SQL[] = [eq(LR.companyId, u.cid)];
  if (scope === 'all') { if (!hasRole(u, 'COMPANY_ADMIN', 'PAYROLL_MANAGER')) throw forbidden(); }
  else if (scope === 'team') {
    const ids = hasRole(u, 'COMPANY_ADMIN') && !u.eid ? null : u.eid ? await teamIds(u.cid, u.eid) : [];
    if (ids) { if (!ids.length) return res.json([]); where.push(inArray(LR.employeeId, ids)); }
  } else { if (!u.eid) return res.json([]); where.push(eq(LR.employeeId, u.eid)); }
  if (req.query.status) where.push(eq(LR.status, String(req.query.status) as any));
  res.json(await db.select({
    id: LR.id, employeeId: LR.employeeId, from: LR.fromDate, to: LR.toDate, days: LR.daysCounted, status: LR.status, reason: LR.reason, decisionNote: LR.decisionNote,
    halfDayFrom: LR.halfDayFrom, halfDayTo: LR.halfDayTo, createdAt: LR.createdAt, type: LT.name, typeCode: LT.code, name: sql<string>`concat(${E.firstName}, ' ', ${E.lastName})`, code: E.code,
  }).from(LR).innerJoin(LT, eq(LT.id, LR.leaveTypeId)).innerJoin(E, eq(E.id, LR.employeeId)).where(and(...where)).orderBy(desc(LR.createdAt)).limit(200));
}));

async function loadForDecision(req: Request) {
  const [r] = await db.select().from(LR).where(and(eq(LR.companyId, req.user!.cid), eq(LR.id, req.params.id)));
  if (!r) throw notFound('Leave request');
  return r;
}

leaveRouter.put('/leave/requests/:id/decision', h(async (req, res) => {
  const { approve, note } = parse(z.object({ approve: z.boolean(), note: z.string().max(300).optional() }), req.body);
  const r = await loadForDecision(req);
  if (r.status !== 'PENDING') throw new ApiError(409, 'already_decided', 'This request was already decided');
  if (r.employeeId === req.user!.eid) throw new ApiError(403, 'self_approval', 'You cannot approve your own leave');
  const access = await employeeAccess(req, r.employeeId);
  if (access === 'self' || (access === 'admin' && !hasRole(req.user, 'COMPANY_ADMIN'))) throw forbidden(); // Payroll Manager: read only
  await db.transaction(async (tx) => {
    const [u] = await updateReturning(LR, { status: approve ? 'APPROVED' : 'REJECTED', approverId: req.user!.sub, decisionNote: note, decidedAt: new Date() }, and(eq(LR.id, r.id), eq(LR.status, 'PENDING')), tx);
    if (!u) throw new ApiError(409, 'already_decided', 'This request was already decided');
    if (approve) await tx.insert(LL).values({ companyId: r.companyId, employeeId: r.employeeId, leaveTypeId: r.leaveTypeId, date: r.fromDate, kind: 'debit', days: r.daysCounted, refType: 'leave_request', refId: r.id, createdBy: req.user!.sub });
  });
  await audit(req, approve ? 'leave_approved' : 'leave_rejected', 'leave_request', r.id, { status: r.status }, { note });
  await notifyUsersOfEmployees(req.user!.cid, [r.employeeId], `Leave ${approve ? 'approved' : 'rejected'}`, `${r.fromDate} → ${r.toDate}${note ? ` · ${note}` : ''}`, '/leave');
  res.json({ ok: true });
}));

leaveRouter.post('/leave/requests/:id/cancel', h(async (req, res) => {
  const r = await loadForDecision(req);
  if (r.employeeId !== req.user!.eid && !hasRole(req.user, 'COMPANY_ADMIN')) throw forbidden();
  if (!['PENDING', 'APPROVED'].includes(r.status)) throw new ApiError(409, 'not_cancellable', 'This request cannot be cancelled');
  await db.transaction(async (tx) => {
    await tx.update(LR).set({ status: 'CANCELLED' }).where(eq(LR.id, r.id));
    // Approved leave: write a reversing credit, never delete ledger rows.
    if (r.status === 'APPROVED') await tx.insert(LL).values({ companyId: r.companyId, employeeId: r.employeeId, leaveTypeId: r.leaveTypeId, date: new Date().toISOString().slice(0, 10), kind: 'credit', days: r.daysCounted, refType: 'leave_cancel', refId: r.id, note: 'Reversal of cancelled leave', createdBy: req.user!.sub });
  });
  await audit(req, 'leave_cancelled', 'leave_request', r.id, { status: r.status }, { status: 'CANCELLED' });
  res.json({ ok: true });
}));
