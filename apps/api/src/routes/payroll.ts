import { computePayslip, daysInMonth, fyMonth, taxYearOf, type Payslip } from '@payrollpro/engines';
import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { db, insertReturning, schema, updateReturning } from '../db';
import { audit } from '../lib/audit';
import { hasRole, requireRole } from '../lib/auth';
import { decryptJson } from '../lib/crypto';
import { buildSalaryWorkbook } from '../lib/excel';
import { ApiError, forbidden, h, notFound, parse } from '../lib/http';
import { loadRules } from '../lib/rules';

export const payrollRouter = Router();
const R = schema.payrollRuns, I = schema.payrollInputs, P = schema.payslips, E = schema.employees, S = schema.salaryStructures;
const ADMIN = ['COMPANY_ADMIN', 'PAYROLL_MANAGER'] as const;

const monthBounds = (month: string) => ({ first: `${month}-01`, last: `${month}-${String(daysInMonth(month)).padStart(2, '0')}` });
const prevMonth = (month: string) => { const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 2, 1)); return d.toISOString().slice(0, 7); };
const fyStart = (month: string) => `${taxYearOf(month).slice(0, 4)}-04`;
const monthLabel = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

async function loadRun(req: Request) {
  const [run] = await db.select().from(R).where(and(eq(R.companyId, req.user!.cid), eq(R.id, req.params.id)));
  if (!run) throw notFound('Payroll run');
  return run;
}

/** Employees on the rolls in the month with a salary structure in effect (spec §10.1). */
async function eligible(cid: string, month: string) {
  const { first, last } = monthBounds(month);
  const emps = await db.select().from(E).where(and(
    eq(E.companyId, cid), lte(E.doj, last), inArray(E.status, ['ACTIVE', 'NOTICE', 'EXITED']),
    or(isNull(E.lastWorkingDay), gte(E.lastWorkingDay, first)),
  ));
  const structs = await db.select().from(S).where(and(eq(S.companyId, cid), lte(S.effectiveFrom, last), or(isNull(S.effectiveTo), gte(S.effectiveTo, first))))
    .orderBy(desc(S.effectiveFrom));
  // ponytail: one structure per month (the one in force at month end); split-by-days for mid-month revisions comes with arrears (phase 4b).
  const byEmp = new Map<string, typeof structs[number]>();
  for (const s of structs) if (!byEmp.has(s.employeeId)) byEmp.set(s.employeeId, s);
  return { withSalary: emps.filter((e) => byEmp.has(e.id)).map((e) => ({ e, s: byEmp.get(e.id)! })), withoutSalary: emps.filter((e) => !byEmp.has(e.id)) };
}

/** Unpaid leave approved in the month becomes default LOP. */
async function unpaidLeaveDays(cid: string, month: string) {
  const { first, last } = monthBounds(month);
  // ponytail: counts a request in the month it starts; requests spanning two months need attendance close (phase 3) to split.
  const rows = await db.select({ emp: schema.leaveRequests.employeeId, days: sql<number>`sum(${schema.leaveRequests.daysCounted})`.mapWith(Number) })
    .from(schema.leaveRequests).innerJoin(schema.leaveTypes, eq(schema.leaveTypes.id, schema.leaveRequests.leaveTypeId))
    .where(and(eq(schema.leaveRequests.companyId, cid), eq(schema.leaveRequests.status, 'APPROVED'), eq(schema.leaveTypes.paid, false), gte(schema.leaveRequests.fromDate, first), lte(schema.leaveRequests.fromDate, last)))
    .groupBy(schema.leaveRequests.employeeId);
  return new Map(rows.map((r) => [r.emp, r.days]));
}

/** Manager-entered monthly attendance; when present it is the source of LOP. */
async function attendanceFor(cid: string, month: string) {
  const rows = await db.select().from(schema.attendanceMonths).where(and(eq(schema.attendanceMonths.companyId, cid), eq(schema.attendanceMonths.month, month)));
  return new Map(rows.map((r) => [r.employeeId, r]));
}

async function syncInputs(cid: string, runId: string, month: string) {
  const { withSalary } = await eligible(cid, month);
  const att = await attendanceFor(cid, month);
  const lwp = await unpaidLeaveDays(cid, month);
  const existing = new Set((await db.select({ e: I.employeeId }).from(I).where(eq(I.runId, runId))).map((x) => x.e));
  // Drop people no longer on this month's payroll (joining date or salary changed since the run was created).
  const keep = new Set(withSalary.map(({ e }) => e.id));
  const stale = [...existing].filter((id) => !keep.has(id));
  if (stale.length) await db.delete(I).where(and(eq(I.runId, runId), inArray(I.employeeId, stale)));
  const add = withSalary.filter(({ e }) => !existing.has(e.id)).map(({ e }) => ({ companyId: cid, runId, employeeId: e.id, lopDays: String(att.get(e.id)?.lopDays ?? lwp.get(e.id) ?? 0) }));
  if (add.length) await db.insert(I).values(add);
  return add.length;
}

/* ---------- list / create ---------- */
payrollRouter.get('/payroll-runs', requireRole(...ADMIN), h(async (req, res) => {
  res.json(await db.select().from(R).where(eq(R.companyId, req.user!.cid)).orderBy(desc(R.month)));
}));

payrollRouter.post('/payroll-runs', requireRole(...ADMIN), h(async (req, res) => {
  const { month } = parse(z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM') }), req.body);
  const next = new Date(); next.setUTCMonth(next.getUTCMonth() + 1);
  if (month > next.toISOString().slice(0, 7)) throw new ApiError(422, 'future_month', 'You can only run payroll up to next month');
  const [run] = await insertReturning(R, { companyId: req.user!.cid, month, createdBy: req.user!.sub });
  const added = await syncInputs(req.user!.cid, run.id, month);
  await audit(req, 'create', 'payroll_run', run.id, undefined, { month, employees: added });
  res.status(201).json(run);
}));

payrollRouter.delete('/payroll-runs/:id', requireRole('COMPANY_ADMIN'), h(async (req, res) => {
  const run = await loadRun(req);
  if (run.status === 'FINALISED') throw new ApiError(409, 'finalised', 'An approved run cannot be deleted; reopen it first');
  await db.delete(R).where(eq(R.id, run.id));
  await audit(req, 'delete', 'payroll_run', run.id, { month: run.month, status: run.status });
  res.status(204).end();
}));

/* ---------- detail with checklist and variance ---------- */
payrollRouter.get('/payroll-runs/:id', requireRole(...ADMIN), h(async (req, res) => {
  const run = await loadRun(req);
  const cid = req.user!.cid;
  const rows = await db.select({
    input: I, employeeId: E.id, code: E.code, name: sql<string>`concat(${E.firstName}, ' ', ${E.lastName})`, department: schema.departments.name,
    hasPan: sql<boolean>`${E.panEnc} is not null`.mapWith(Boolean), hasBank: sql<boolean>`${E.bankEnc} is not null`.mapWith(Boolean), status: E.status, doj: E.doj, lastWorkingDay: E.lastWorkingDay,
    slip: { id: P.id, gross: P.gross, net: P.net, tds: P.tds, totalDeductions: P.totalDeductions, employerCost: P.employerCost, payableDays: P.payableDays, detail: P.detail },
  }).from(I).innerJoin(E, eq(E.id, I.employeeId)).leftJoin(schema.departments, eq(schema.departments.id, E.departmentId))
    .leftJoin(P, and(eq(P.runId, I.runId), eq(P.employeeId, I.employeeId)))
    .where(eq(I.runId, run.id)).orderBy(asc(E.code));

  const prev = await db.select({ emp: P.employeeId, net: P.net }).from(P).innerJoin(R, eq(R.id, P.runId))
    .where(and(eq(P.companyId, cid), eq(P.month, prevMonth(run.month)), eq(R.status, 'FINALISED')));
  const prevNet = new Map(prev.map((p) => [p.emp, Number(p.net)]));
  const { withoutSalary } = await eligible(cid, run.month);
  const { first, last } = monthBounds(run.month);

  const att = await attendanceFor(cid, run.month);
  const items = rows.map((r) => {
    const d = r.slip?.detail as Payslip | undefined;
    const a = att.get(r.employeeId);
    const pn = prevNet.get(r.employeeId);
    const variance = r.slip?.net != null && pn ? ((Number(r.slip.net) - pn) / pn) * 100 : null;
    return {
      employeeId: r.employeeId, code: r.code, name: r.name, department: r.department, status: r.status, hasPan: r.hasPan, hasBank: r.hasBank,
      joinedThisMonth: r.doj >= first, leavingThisMonth: !!r.lastWorkingDay && r.lastWorkingDay <= last,
      attendance: a ? { workingDays: Number(a.workingDays), presentDays: Number(a.presentDays), paidLeaveDays: Number(a.paidLeaveDays), lopDays: Number(a.lopDays) } : null,
      inputs: { lopDays: a ? Number(a.lopDays) : Number(r.input.lopDays), bonus: Number(r.input.bonus), otherEarnings: Number(r.input.otherEarnings), otherDeductions: Number(r.input.otherDeductions), hold: r.input.hold, note: r.input.note },
      payslip: r.slip?.id ? { id: r.slip.id, gross: Number(r.slip.gross), net: Number(r.slip.net), tds: Number(r.slip.tds), deductions: Number(r.slip.totalDeductions), employerCost: Number(r.slip.employerCost), payableDays: Number(r.slip.payableDays), deductionSplit: d?.deductions, notes: d?.notes ?? [] } : null,
      variance: variance === null ? null : Math.round(variance * 10) / 10,
    };
  });
  const notJoined = await db.select({ f: E.firstName, l: E.lastName, doj: E.doj }).from(E).where(and(eq(E.companyId, cid), gt(E.doj, last), inArray(E.status, ['ACTIVE', 'NOTICE'])));
  const checklist = [
    { key: 'doj', label: 'Joining date after this month (excluded): fix the date under People', count: notJoined.length, names: notJoined.slice(0, 5).map((e) => `${e.f} ${e.l} (${e.doj})`), level: notJoined.length ? 'amber' : 'green' },
    { key: 'salary', label: 'Employees without a salary structure (excluded)', count: withoutSalary.length, names: withoutSalary.slice(0, 5).map((e) => `${e.firstName} ${e.lastName}`), level: withoutSalary.length ? 'amber' : 'green' },
    { key: 'pan', label: 'Missing PAN (TDS at 20% when income is taxable)', count: items.filter((i) => !i.hasPan).length, level: items.some((i) => !i.hasPan) ? 'amber' : 'green' },
    { key: 'bank', label: 'Missing bank details (put on hold)', count: items.filter((i) => !i.hasBank && !i.inputs.hold).length, level: items.some((i) => !i.hasBank && !i.inputs.hold) ? 'red' : 'green' },
    { key: 'attendance', label: 'Attendance not entered by managers (LOP = 0)', count: items.filter((i) => !i.attendance).length, level: items.some((i) => !i.attendance) ? 'amber' : 'green' },
    { key: 'joiners', label: 'Joiners / leavers this month (prorated)', count: items.filter((i) => i.joinedThisMonth || i.leavingThisMonth).length, level: 'green' },
  ];
  res.json({ run: { ...run, label: monthLabel(run.month) }, items, checklist });
}));

/* ---------- inputs ---------- */
payrollRouter.put('/payroll-runs/:id/inputs', requireRole(...ADMIN), h(async (req, res) => {
  const run = await loadRun(req);
  if (run.status === 'FINALISED') throw new ApiError(409, 'finalised', 'This run is approved; reopen it to make changes');
  const dim = daysInMonth(run.month);
  const money = z.number().min(0).max(1e8);
  const { items } = parse(z.object({ items: z.array(z.object({
    employeeId: z.string().uuid(), lopDays: z.number().min(0).max(dim).multipleOf(0.1), bonus: money, otherEarnings: money, otherDeductions: money, hold: z.boolean(), note: z.string().max(200).nullish(),
  })).min(1).max(5000) }), req.body);
  await db.transaction(async (tx) => {
    for (const it of items) {
      await tx.update(I).set({ lopDays: String(it.lopDays), bonus: String(it.bonus), otherEarnings: String(it.otherEarnings), otherDeductions: String(it.otherDeductions), hold: it.hold, note: it.note ?? null })
        .where(and(eq(I.runId, run.id), eq(I.employeeId, it.employeeId), eq(I.companyId, req.user!.cid)));
    }
    await tx.update(R).set({ status: 'DRAFT' }).where(eq(R.id, run.id)); // inputs changed → must recalculate
  });
  await audit(req, 'update_inputs', 'payroll_run', run.id, undefined, { count: items.length });
  res.json({ ok: true });
}));

/* ---------- calculate ---------- */
payrollRouter.post('/payroll-runs/:id/calculate', requireRole(...ADMIN), h(async (req, res) => {
  const run = await loadRun(req);
  if (run.status === 'FINALISED') throw new ApiError(409, 'finalised', 'This run is approved; reopen it to make changes');
  const cid = req.user!.cid;
  await syncInputs(cid, run.id, run.month); // picks up joiners added after the run was created
  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, cid));
  const { stat, tax } = await loadRules();
  const { withSalary } = await eligible(cid, run.month);
  const byEmp = new Map(withSalary.map((x) => [x.e.id, x]));
  const inputs = await db.select().from(I).where(eq(I.runId, run.id));
  const att = await attendanceFor(cid, run.month);
  const branches = new Map((await db.select().from(schema.branches).where(eq(schema.branches.companyId, cid))).map((b) => [b.id, b]));

  // Year-to-date from finalised payslips earlier in this financial year (spec §7.3 step 1).
  const ytdRows = await db.select({ emp: P.employeeId, taxable: sql<number>`sum(${P.taxableGross})`.mapWith(Number), tds: sql<number>`sum(${P.tds})`.mapWith(Number), pf: sql<number>`sum(${P.pf})`.mapWith(Number), pt: sql<number>`sum(${P.pt})`.mapWith(Number), months: sql<number>`count(*)`.mapWith(Number) })
    .from(P).innerJoin(R, eq(R.id, P.runId))
    .where(and(eq(P.companyId, cid), eq(R.status, 'FINALISED'), gte(P.month, fyStart(run.month)), lt(P.month, run.month))).groupBy(P.employeeId);
  const ytd = new Map(ytdRows.map((r) => [r.emp, r]));

  const slips: (typeof P.$inferInsert)[] = [];
  const errors: { employeeId: string; message: string }[] = [];
  for (const inp of inputs) {
    const x = byEmp.get(inp.employeeId);
    if (!x) { errors.push({ employeeId: inp.employeeId, message: 'No salary structure in force this month' }); continue; }
    const { e, s } = x;
    const br = e.branchId ? branches.get(e.branchId) : undefined;
    const age = e.dob ? Number(run.month.slice(0, 4)) - Number(e.dob.slice(0, 4)) : 30;
    const breakup = s.breakup as { components: { code: string; name: string; monthly: number; isWage: boolean }[] };
    try {
      const p = computePayslip({
        month: run.month, components: breakup.components, deemedWages: Number(s.deemedWages),
        employee: {
          gender: e.gender === 'F' ? 'F' : 'M', state: br?.state ?? 'MH', age, doj: e.doj, lastWorkingDay: e.lastWorkingDay, pfCapMode: s.pfCapMode as 'capped' | 'actual',
          pfOptOut: e.pfOptOut, internationalWorker: e.international, esiExempt: !company.esiEnabled, regime: e.taxRegime as 'new' | 'old', ageBand: age >= 80 ? '80plus' : age >= 60 ? '60to79' : 'below60',
          metro: e.metro || !!br?.metro, hasPan: !!e.panEnc,
        },
        payableDaysMethod: company.payableDaysMethod as 'calendar' | 'fixed30' | 'working',
        lopDays: Number(att.get(e.id)?.lopDays ?? inp.lopDays), bonus: Number(inp.bonus), otherEarnings: Number(inp.otherEarnings), otherDeductions: Number(inp.otherDeductions),
        ytd: ytd.get(e.id) ?? undefined,
      }, stat, tax);
      slips.push({
        companyId: cid, runId: run.id, employeeId: e.id, month: run.month, structureId: s.id, payableDays: String(p.payableDays), lopDays: String(p.lopDays),
        gross: String(p.gross), totalDeductions: String(p.deductions.total), net: String(p.net), employerCost: String(p.employer.total), tds: String(p.deductions.tds),
        taxableGross: String(p.taxableGross), pf: String(p.deductions.pf), pt: String(p.deductions.pt), hold: inp.hold, detail: p,
      });
    } catch (err) {
      errors.push({ employeeId: e.id, message: (err as Error).message });
    }
  }
  const sum = (k: 'gross' | 'net' | 'totalDeductions' | 'employerCost' | 'tds') => slips.reduce((a, s) => a + Number(s[k]), 0);
  const totals = { employees: slips.length, onHold: slips.filter((s) => s.hold).length, gross: sum('gross'), deductions: sum('totalDeductions'), net: sum('net'), employerCost: sum('employerCost'), tds: sum('tds'), errors: errors.length };
  await db.transaction(async (tx) => {
    await tx.delete(P).where(eq(P.runId, run.id));
    if (slips.length) await tx.insert(P).values(slips);
    await tx.update(R).set({ status: 'CALCULATED', totals, calculatedAt: new Date(), calculatedBy: req.user!.sub }).where(eq(R.id, run.id));
  });
  await audit(req, 'calculate', 'payroll_run', run.id, undefined, totals);
  res.json({ totals, errors });
}));

/* ---------- approve / reopen ---------- */
payrollRouter.post('/payroll-runs/:id/approve', requireRole('COMPANY_ADMIN'), h(async (req, res) => {
  const run = await loadRun(req);
  const [u] = await updateReturning(R, { status: 'FINALISED', finalisedAt: new Date(), finalisedBy: req.user!.sub }, and(eq(R.id, run.id), eq(R.status, 'CALCULATED')));
  if (!u) throw new ApiError(409, 'not_calculated', run.status === 'FINALISED' ? 'Already approved' : 'Calculate salaries before approving');
  await audit(req, 'approve', 'payroll_run', run.id, { status: run.status }, { status: 'FINALISED', totals: run.totals });
  res.json({ ok: true });
}));
payrollRouter.post('/payroll-runs/:id/reopen', requireRole('COMPANY_ADMIN'), h(async (req, res) => {
  const run = await loadRun(req);
  const [u] = await updateReturning(R, { status: 'CALCULATED', finalisedAt: null, finalisedBy: null }, and(eq(R.id, run.id), eq(R.status, 'FINALISED')));
  if (!u) throw new ApiError(409, 'not_approved', 'This run is not approved');
  await audit(req, 'reopen', 'payroll_run', run.id, { status: 'FINALISED' }, { status: 'CALCULATED' });
  res.json({ ok: true });
}));

/* ---------- Excel salary sheet ---------- */
payrollRouter.get('/payroll-runs/:id/export.xlsx', requireRole(...ADMIN), h(async (req, res) => {
  const run = await loadRun(req);
  if (run.status !== 'FINALISED') throw new ApiError(409, 'not_approved', 'Approve the salaries first; the salary sheet is generated from the approved run');
  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, req.user!.cid));
  const rows = await db.select({
    slip: P, code: E.code, firstName: E.firstName, lastName: E.lastName, panLast4: E.panLast4, uan: E.uan, bankEnc: E.bankEnc,
    department: schema.departments.name, designation: schema.designations.name, state: schema.branches.state,
  }).from(P).innerJoin(E, eq(E.id, P.employeeId)).leftJoin(schema.departments, eq(schema.departments.id, E.departmentId))
    .leftJoin(schema.designations, eq(schema.designations.id, E.designationId)).leftJoin(schema.branches, eq(schema.branches.id, E.branchId))
    .where(eq(P.runId, run.id)).orderBy(asc(E.code));
  const att = await attendanceFor(req.user!.cid, run.month);
  const wb = await buildSalaryWorkbook({
    company: company.legalName ?? company.name, month: run.month, label: monthLabel(run.month), status: run.status,
    rows: rows.map((r) => ({
      code: r.code, name: `${r.firstName} ${r.lastName}`, department: r.department ?? '', designation: r.designation ?? '', state: r.state ?? '',
      panLast4: r.panLast4, uan: r.uan, hold: r.slip.hold, payslip: r.slip.detail as Payslip,
      attendance: (() => { const a = att.get(r.slip.employeeId); return a ? { working: Number(a.workingDays), present: Number(a.presentDays), paidLeave: Number(a.paidLeaveDays), overtime: Number(a.overtimeHours) } : null; })(),
      bank: r.bankEnc ? decryptJson<{ holder: string; account: string; ifsc: string; bankName?: string }>(r.bankEnc) : null,
    })),
  });
  await audit(req, 'export_salary_sheet', 'payroll_run', run.id, undefined, { month: run.month, rows: rows.length });
  res.set({
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="salary-${run.month}.xlsx"`,
    'Cache-Control': 'no-store',
  });
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
}));

/* ---------- payslips for employees ---------- */
payrollRouter.get('/payslips', h(async (req, res) => {
  const eid = (req.query.employee as string) || req.user!.eid;
  if (!eid) return res.json([]);
  if (eid !== req.user!.eid && !hasRole(req.user, ...ADMIN)) throw forbidden();
  const rows = await db.select({ id: P.id, month: P.month, gross: P.gross, net: P.net, tds: P.tds, deductions: P.totalDeductions, payableDays: P.payableDays })
    .from(P).innerJoin(R, eq(R.id, P.runId))
    .where(and(eq(P.companyId, req.user!.cid), eq(P.employeeId, eid), eq(R.status, 'FINALISED'))).orderBy(desc(P.month));
  res.json(rows.map((r) => ({ ...r, label: monthLabel(r.month), fyMonth: fyMonth(r.month) })));
}));
payrollRouter.get('/payslips/:id', h(async (req, res) => {
  const [p] = await db.select({ slip: P, status: R.status }).from(P).innerJoin(R, eq(R.id, P.runId)).where(and(eq(P.companyId, req.user!.cid), eq(P.id, req.params.id)));
  if (!p) throw notFound('Payslip');
  const admin = hasRole(req.user, ...ADMIN);
  if (!admin && (p.slip.employeeId !== req.user!.eid || p.status !== 'FINALISED')) throw notFound('Payslip');
  const [{ bankEnc, ...e }] = await db.select({ code: E.code, firstName: E.firstName, lastName: E.lastName, panLast4: E.panLast4, uan: E.uan, bankLast4: E.bankLast4, bankEnc: E.bankEnc, doj: E.doj, dob: E.dob, taxRegime: E.taxRegime, designation: schema.designations.name, department: schema.departments.name })
    .from(E).leftJoin(schema.designations, eq(schema.designations.id, E.designationId)).leftJoin(schema.departments, eq(schema.departments.id, E.departmentId)).where(eq(E.id, p.slip.employeeId));
  const [c] = await db.select({ name: schema.companies.legalName, display: schema.companies.name, address: schema.companies.address }).from(schema.companies).where(eq(schema.companies.id, req.user!.cid));
  const ifsc = bankEnc ? decryptJson<{ ifsc: string }>(bankEnc).ifsc : null; // IFSC only; account and PAN stay masked
  res.json({ id: p.slip.id, month: p.slip.month, label: monthLabel(p.slip.month), status: p.status, employee: { ...e, ifsc }, company: { name: c.name ?? c.display, address: c.address }, payslip: p.slip.detail });
}));
