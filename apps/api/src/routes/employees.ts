import { splitCtc, upfrontProration } from '@payrollpro/engines';
import { aliasedTable, and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { db, schema } from '../db';
import { audit } from '../lib/audit';
import { employeeAccess, notifyUsersOfEmployees, teamIds, type Access } from '../lib/access';
import { canSeePay, hashPassword, hasRole, requireRole } from '../lib/auth';
import { decrypt, decryptJson, encrypt, encryptJson, mask, randomToken } from '../lib/crypto';
import { ApiError, forbidden, h, notFound, page, parse } from '../lib/http';
import { loadRules } from '../lib/rules';

export const employeesRouter = Router();
const E = schema.employees, S = schema.salaryStructures;

const PAN = z.string().toUpperCase().pipe(z.string().regex(/^[A-Z]{5}\d{4}[A-Z]$/, 'Invalid PAN format'));
const IFSC = z.string().toUpperCase().pipe(z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC'));
const bankSchema = z.object({ holder: z.string().min(2).max(100), account: z.string().regex(/^\d{6,18}$/, 'Account number must be 6–18 digits'), ifsc: IFSC, bankName: z.string().max(100).optional(), branch: z.string().max(100).optional() });
const optStr = (max = 200) => z.string().max(max).nullish().or(z.literal('').transform(() => null));
const optUuid = z.string().uuid().nullish().or(z.literal('').transform(() => null));

const personal = {
  firstName: z.string().min(1).max(80), middleName: optStr(80), lastName: z.string().min(1).max(80),
  dob: z.string().date().nullish(), gender: z.enum(['M', 'F', 'O']), maritalStatus: optStr(20),
  workEmail: z.string().email().max(200).toLowerCase(), personalEmail: z.string().email().max(200).nullish().or(z.literal('').transform(() => null)),
  mobile: z.string().regex(/^\+?\d{10,13}$/, 'Invalid mobile').nullish().or(z.literal('').transform(() => null)),
  branchId: optUuid, departmentId: optUuid, designationId: optUuid, managerId: optUuid,
  doj: z.string().date(), employmentType: z.enum(['permanent', 'probation', 'fixed-term', 'intern', 'contractor']),
  probationEnd: z.string().date().nullish(), noticeDays: z.number().int().min(0).max(180),
};
const payFields = {
  pan: PAN.nullish(), bank: bankSchema.nullish(),
  aadhaar: z.string().regex(/^\d{12}$/, 'Aadhaar must be 12 digits').nullish(),
  uan: z.string().regex(/^\d{12}$/, 'UAN must be 12 digits').nullish().or(z.literal('').transform(() => null)),
  esiIp: z.string().regex(/^\d{10}$/, 'ESI IP must be 10 digits').nullish().or(z.literal('').transform(() => null)),
  pfOptOut: z.boolean(), international: z.boolean(), taxRegime: z.enum(['new', 'old']), metro: z.boolean(),
};
/** Exact monthly salary components (e.g. copied from RazorpayX's Master CTC Report). */
const componentsSchema = z.array(z.object({ code: z.string().regex(/^[A-Z0-9_]{2,20}$/), name: z.string().min(1).max(60), monthly: z.number().min(0).max(1e8), isWage: z.boolean() })).min(1).max(20);
const createSchema = z.object({ ...personal, ...payFields, code: z.string().regex(/^[A-Z0-9-]{2,20}$/).optional(), createLogin: z.boolean().default(false), annualCtc: z.number().positive().max(1e9).optional(), monthlyGross: z.number().positive().max(1e8).optional(), components: componentsSchema.optional() })
  .partial({ pfOptOut: true, international: true, taxRegime: true, metro: true, noticeDays: true, employmentType: true });

/** Encrypt sensitive inputs; only last-4 is kept in clear for masked display. Full Aadhaar is never stored. */
function sensitiveColumns(d: { pan?: string | null; bank?: z.infer<typeof bankSchema> | null; aadhaar?: string | null }) {
  const out: Record<string, string | null> = {};
  if (d.pan !== undefined) { out.panEnc = d.pan ? encrypt(d.pan) : null; out.panLast4 = d.pan ? d.pan.slice(-4) : null; }
  if (d.bank !== undefined) { out.bankEnc = d.bank ? encryptJson(d.bank) : null; out.bankLast4 = d.bank ? d.bank.account.slice(-4) : null; }
  if (d.aadhaar !== undefined) out.aadhaarLast4 = d.aadhaar ? d.aadhaar.slice(-4) : null;
  return out;
}

const Mgr = aliasedTable(E, 'mgr');
const baseSelect = {
  id: E.id, code: E.code, firstName: E.firstName, middleName: E.middleName, lastName: E.lastName, gender: E.gender,
  workEmail: E.workEmail, mobile: E.mobile, doj: E.doj, status: E.status, employmentType: E.employmentType,
  branchId: E.branchId, departmentId: E.departmentId, designationId: E.designationId, managerId: E.managerId,
  department: schema.departments.name, designation: schema.designations.name, branch: schema.branches.name, state: schema.branches.state,
  managerName: sql<string | null>`${Mgr.firstName} || ' ' || ${Mgr.lastName}`,
};
const joined = () => db.select({ ...baseSelect, row: E }).from(E)
  .leftJoin(schema.departments, eq(schema.departments.id, E.departmentId))
  .leftJoin(schema.designations, eq(schema.designations.id, E.designationId))
  .leftJoin(schema.branches, eq(schema.branches.id, E.branchId))
  .leftJoin(Mgr, eq(Mgr.id, E.managerId));

/** Shape an employee for the viewer: pay/identity fields only for admins and self, always masked. */
function view(r: { row: typeof E.$inferSelect } & Record<string, unknown>, showPay: boolean) {
  const { row, ...base } = r;
  if (!showPay) return base;
  return {
    ...base, dob: row.dob, personalEmail: row.personalEmail, maritalStatus: row.maritalStatus, probationEnd: row.probationEnd, noticeDays: row.noticeDays,
    pan: mask(row.panLast4), bank: mask(row.bankLast4), aadhaar: mask(row.aadhaarLast4), uan: row.uan, esiIp: row.esiIp,
    pfOptOut: row.pfOptOut, international: row.international, taxRegime: row.taxRegime, metro: row.metro,
    lastWorkingDay: row.lastWorkingDay, exitReason: row.exitReason,
  };
}

async function assertRefs(cid: string, d: { branchId?: string | null; departmentId?: string | null; designationId?: string | null; managerId?: string | null }, selfId?: string) {
  const checks: [any, string | null | undefined, string][] = [[schema.branches, d.branchId, 'Branch'], [schema.departments, d.departmentId, 'Department'], [schema.designations, d.designationId, 'Designation'], [E, d.managerId, 'Manager']];
  for (const [t, id, label] of checks) {
    if (!id) continue;
    const [x] = await db.select({ id: t.id }).from(t).where(and(eq(t.companyId, cid), eq(t.id, id)));
    if (!x) throw new ApiError(422, 'validation_failed', `${label} not found`, [{ path: label.toLowerCase() + 'Id', message: 'Not found' }]);
  }
  if (selfId && d.managerId === selfId) throw new ApiError(422, 'validation_failed', 'An employee cannot report to themself');
}

/* ---------------- list ---------------- */
employeesRouter.get('/employees', h(async (req, res) => {
  const u = req.user!, q = req.query as Record<string, string>;
  const { limit, offset, page: p } = page(q);
  const where: SQL[] = [eq(E.companyId, u.cid)];
  const admin = hasRole(u, 'COMPANY_ADMIN', 'PAYROLL_MANAGER');
  if (!admin) {
    const ids = u.eid && hasRole(u, 'REPORTING_MANAGER') ? [u.eid, ...(await teamIds(u.cid, u.eid))] : u.eid ? [u.eid] : [];
    if (!ids.length) return res.json({ items: [], total: 0, page: p, limit });
    where.push(inArray(E.id, ids));
  }
  if (q.q) { const t = `%${q.q.slice(0, 50)}%`; where.push(or(ilike(E.firstName, t), ilike(E.lastName, t), ilike(E.code, t), ilike(E.workEmail, t))!); }
  if (q.status) where.push(eq(E.status, q.status as any));
  if (q.departmentId) where.push(eq(E.departmentId, q.departmentId));
  const rows = await joined().where(and(...where)).orderBy(q.sort === 'name' ? asc(E.firstName) : desc(E.createdAt)).limit(limit).offset(offset);
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(E).where(and(...where));
  res.json({ items: rows.map((r) => view(r, admin)), total: count, page: p, limit });
}));

employeesRouter.get('/employees/:id', h(async (req, res) => {
  const access = await employeeAccess(req, req.params.id);
  const [r] = await joined().where(and(eq(E.companyId, req.user!.cid), eq(E.id, req.params.id)));
  res.json({ ...view(r, access !== 'manager'), access });
}));

/** Reveal decrypted PAN / bank. Audited every time. */
employeesRouter.get('/employees/:id/sensitive', h(async (req, res) => {
  const access = await employeeAccess(req, req.params.id);
  if (!canSeePay(req.user, req.params.id) || access === 'manager') throw forbidden();
  const [e] = await db.select({ panEnc: E.panEnc, bankEnc: E.bankEnc }).from(E).where(and(eq(E.companyId, req.user!.cid), eq(E.id, req.params.id)));
  await audit(req, 'view_sensitive', 'employee', req.params.id);
  res.set('Cache-Control', 'no-store').json({ pan: e.panEnc ? decrypt(e.panEnc) : null, bank: e.bankEnc ? decryptJson(e.bankEnc) : null });
}));

/* ---------------- create / update ---------------- */
async function nextCode(cid: string) {
  const [c] = await db.update(schema.companies).set({ nextEmployeeSeq: sql`${schema.companies.nextEmployeeSeq} + 1` })
    .where(eq(schema.companies.id, cid)).returning({ seq: schema.companies.nextEmployeeSeq, prefix: schema.companies.employeeCodePrefix });
  return `${c.prefix}${String(c.seq - 1).padStart(4, '0')}`;
}

/** Credit prorated upfront leave for a new joiner (spec §9.2). */
export async function creditJoinerLeave(cid: string, employeeId: string, doj: string, gender: string, userId?: string) {
  const types = await db.select().from(schema.leaveTypes).where(and(eq(schema.leaveTypes.companyId, cid), eq(schema.leaveTypes.active, true), eq(schema.leaveTypes.accrual, 'upfront')));
  const rows = types.filter((t) => !t.gender || t.gender === gender).map((t) => ({
    companyId: cid, employeeId, leaveTypeId: t.id, date: doj, kind: 'credit',
    days: String(t.proration === 'none' ? Number(t.quota) : upfrontProration(Number(t.quota), doj, 1)), refType: 'joiner', note: 'Prorated joiner credit', createdBy: userId,
  }));
  if (rows.length) await db.insert(schema.leaveLedger).values(rows);
}

async function salaryFor(cid: string, empId: string) {
  const [e] = await db.select({ row: E, state: schema.branches.state, branchMetro: schema.branches.metro }).from(E).leftJoin(schema.branches, eq(schema.branches.id, E.branchId)).where(and(eq(E.companyId, cid), eq(E.id, empId)));
  const [c] = await db.select().from(schema.companies).where(eq(schema.companies.id, cid));
  return { e: e.row, state: e.state ?? 'MH', metro: e.row.metro || !!e.branchMetro, company: c };
}

type Components = { code: string; name: string; monthly: number; isWage: boolean }[];
/** pay: monthly gross (how the company sets salaries), annual CTC, or exact monthly components (e.g. from RazorpayX). */
export async function createRevision(req: any, empId: string, pay: { annualCtc?: number; monthlyGross?: number; components?: Components }, annualVariable: number, effectiveFrom: string) {
  const cid = req.user.cid;
  const { e, state, metro, company } = await salaryFor(cid, empId);
  const { stat, tax } = await loadRules();
  const age = e.dob ? new Date(effectiveFrom).getFullYear() - new Date(e.dob).getFullYear() : 30;
  const template = pay.components?.map((c) => ({ code: c.code, name: c.name, calc: 'fixed' as const, value: c.monthly, isWage: c.isWage, taxable: c.code === 'HRA' ? 'partial' as const : 'full' as const }));
  const monthlyGross = template ? pay.components!.reduce((a, c) => a + c.monthly, 0) : pay.monthlyGross;
  // PF/ESI shown with today's rules for an old joining date (payroll itself always uses the payroll month's rules).
  const asOf = [effectiveFrom.slice(0, 7), new Date().toISOString().slice(0, 7)].sort()[1];
  const preview = splitCtc({ annualCtc: pay.annualCtc ?? 0, monthlyGross, annualVariable, metro, state, pfCapMode: company.pfCapMode as 'capped' | 'actual', gender: e.gender === 'F' ? 'F' : 'M', age, doj: e.doj, asOf, labourCodeMode: company.labourCodeMode,
    template, pfOptOut: e.pfOptOut, internationalWorker: e.international, esiExempt: !company.esiEnabled }, stat, tax);
  const annualCtc = preview.checkCtc;
  return db.transaction(async (tx) => {
    const dayBefore = new Date(new Date(effectiveFrom).getTime() - 864e5).toISOString().slice(0, 10);
    const [prev] = await tx.select().from(S).where(and(eq(S.companyId, cid), eq(S.employeeId, empId), isNull(S.effectiveTo))).orderBy(desc(S.effectiveFrom)).limit(1);
    if (prev && prev.effectiveFrom >= effectiveFrom) throw new ApiError(409, 'overlap', 'A revision on or after this date already exists');
    if (prev) await tx.update(S).set({ effectiveTo: dayBefore }).where(eq(S.id, prev.id));
    const [row] = await tx.insert(S).values({
      companyId: cid, employeeId: empId, annualCtc: String(annualCtc), annualVariable: String(annualVariable), monthlyGross: String(preview.monthlyGross),
      employerCost: String(preview.employer.monthlyTotal), deemedWages: String(preview.deemedWages), pfCapMode: company.pfCapMode, effectiveFrom, breakup: preview, createdBy: req.user.sub,
    }).returning();
    return { row, prev };
  }).then(async ({ row, prev }) => {
    // Audit after commit: the embedded database is single-connection, so writing outside the tx inside it would deadlock.
    await audit(req, 'salary_revision', 'employee', empId, prev ? { annualCtc: prev.annualCtc, effectiveFrom: prev.effectiveFrom } : undefined, { annualCtc, effectiveFrom });
    return row;
  });
}

employeesRouter.post('/employees', requireRole('COMPANY_ADMIN'), h(async (req, res) => {
  const d = parse(createSchema, req.body);
  const cid = req.user!.cid;
  await assertRefs(cid, d);
  const code = d.code ?? (await nextCode(cid));
  const { pan, bank, aadhaar, createLogin, annualCtc, monthlyGross, components, code: _c, ...rest } = d;
  const [row] = await db.insert(E).values({ ...rest, code, companyId: cid, createdBy: req.user!.sub, ...sensitiveColumns({ pan, bank, aadhaar }) } as typeof E.$inferInsert).returning();
  await creditJoinerLeave(cid, row.id, row.doj, row.gender, req.user!.sub);
  let tempPassword: string | undefined;
  if (createLogin) {
    tempPassword = `Pp-${randomToken(9)}1a`;
    await db.insert(schema.users).values({ companyId: cid, email: row.workEmail, passwordHash: await hashPassword(tempPassword), roles: ['EMPLOYEE'], employeeId: row.id });
  }
  if (monthlyGross || annualCtc || components) await createRevision(req, row.id, { monthlyGross, annualCtc, components }, 0, row.doj);
  await audit(req, 'create', 'employee', row.id, undefined, { ...row, panEnc: undefined, bankEnc: undefined });
  res.status(201).json({ id: row.id, code: row.code, tempPassword });
}));

const PAY_ONLY = ['pan', 'bank', 'aadhaar', 'uan', 'esiIp', 'pfOptOut', 'international', 'taxRegime', 'metro'] as const;
employeesRouter.put('/employees/:id', requireRole('COMPANY_ADMIN', 'PAYROLL_MANAGER'), h(async (req, res) => {
  const cid = req.user!.cid;
  let d = parse(z.object({ ...personal, ...payFields, status: z.enum(['DRAFT', 'ONBOARDING', 'ACTIVE', 'NOTICE', 'EXITED', 'SETTLED']) }).partial(), req.body);
  // Payroll Manager may edit pay fields only (spec §2 matrix).
  if (!hasRole(req.user, 'COMPANY_ADMIN')) d = Object.fromEntries(Object.entries(d).filter(([k]) => (PAY_ONLY as readonly string[]).includes(k))) as typeof d;
  await assertRefs(cid, d, req.params.id);
  const [before] = await db.select().from(E).where(and(eq(E.companyId, cid), eq(E.id, req.params.id)));
  if (!before) throw notFound('Employee');
  const { pan, bank, aadhaar, ...rest } = d;
  const [after] = await db.update(E).set({ ...rest, ...sensitiveColumns({ pan, bank, aadhaar }) } as any).where(eq(E.id, before.id)).returning();
  const changed = Object.keys(d);
  await audit(req, 'update', 'employee', before.id, { fields: changed, panLast4: before.panLast4, bankLast4: before.bankLast4 }, { fields: changed, panLast4: after.panLast4, bankLast4: after.bankLast4 });
  res.json({ ok: true });
}));

employeesRouter.post('/employees/:id/exit', requireRole('COMPANY_ADMIN'), h(async (req, res) => {
  const d = parse(z.object({ lastWorkingDay: z.string().date(), reason: z.string().max(300) }), req.body);
  const status = d.lastWorkingDay <= new Date().toISOString().slice(0, 10) ? 'EXITED' : 'NOTICE';
  const [row] = await db.update(E).set({ lastWorkingDay: d.lastWorkingDay, exitReason: d.reason, status }).where(and(eq(E.companyId, req.user!.cid), eq(E.id, req.params.id))).returning({ id: E.id });
  if (!row) throw notFound('Employee');
  await audit(req, 'exit', 'employee', row.id, undefined, { ...d, status });
  res.json({ status });
}));

employeesRouter.get('/employees/:id/history', requireRole('COMPANY_ADMIN', 'PAYROLL_MANAGER'), h(async (req, res) => {
  res.json(await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.companyId, req.user!.cid), eq(schema.auditLog.entity, 'employee'), eq(schema.auditLog.entityId, req.params.id))).orderBy(desc(schema.auditLog.at)).limit(100));
}));

/* ---------------- bulk import (spec §4) ---------------- */
const importRow = z.object({
  code: z.string().regex(/^[A-Z0-9-]{2,20}$/).optional().or(z.literal('').transform(() => undefined)),
  firstName: personal.firstName, lastName: personal.lastName, workEmail: personal.workEmail, gender: personal.gender, doj: personal.doj,
  mobile: personal.mobile, department: optStr(100), designation: optStr(100), branch: optStr(100), managerCode: optStr(20),
  pan: PAN.optional().or(z.literal('').transform(() => undefined)), ifsc: IFSC.optional().or(z.literal('').transform(() => undefined)),
  accountNumber: z.string().regex(/^\d{6,18}$/).optional().or(z.literal('').transform(() => undefined)),
  annualCtc: z.coerce.number().positive().optional().or(z.literal('').transform(() => undefined)),
  monthlyGross: z.coerce.number().positive().optional().or(z.literal('').transform(() => undefined)),
});
employeesRouter.post('/employees/import', requireRole('COMPANY_ADMIN'), h(async (req, res) => {
  const { rows, dryRun } = parse(z.object({ rows: z.array(z.record(z.unknown())).min(1).max(2000), dryRun: z.boolean().default(true) }), req.body);
  const cid = req.user!.cid;
  const [deps, desigs, brs, existing] = await Promise.all([
    db.select().from(schema.departments).where(eq(schema.departments.companyId, cid)),
    db.select().from(schema.designations).where(eq(schema.designations.companyId, cid)),
    db.select().from(schema.branches).where(eq(schema.branches.companyId, cid)),
    db.select({ id: E.id, code: E.code, email: E.workEmail }).from(E).where(eq(E.companyId, cid)),
  ]);
  const byName = <T extends { name: string; id: string }>(xs: T[], n?: string | null) => (n ? xs.find((x) => x.name.toLowerCase() === n.toLowerCase())?.id : undefined);
  const codes = new Set(existing.map((x) => x.code)), emails = new Set(existing.map((x) => x.email));
  const batchCodes = new Map<string, number>();
  const report: { row: number; errors: string[] }[] = [];
  const valid: { data: z.infer<typeof importRow>; row: number }[] = [];
  rows.forEach((raw, i) => {
    const r = importRow.safeParse(raw);
    const errs: string[] = r.success ? [] : r.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`);
    if (r.success) {
      const d = r.data;
      if (d.code && (codes.has(d.code) || batchCodes.has(d.code))) errs.push(`code: duplicate ${d.code}`);
      if (emails.has(d.workEmail) || valid.some((v) => v.data.workEmail === d.workEmail)) errs.push(`workEmail: duplicate ${d.workEmail}`);
      if (d.department && !byName(deps, d.department)) errs.push(`department: "${d.department}" not found`);
      if (d.designation && !byName(desigs, d.designation)) errs.push(`designation: "${d.designation}" not found`);
      if (d.branch && !byName(brs, d.branch)) errs.push(`branch: "${d.branch}" not found`);
      if (d.managerCode && !codes.has(d.managerCode) && !batchCodes.has(d.managerCode)) errs.push(`managerCode: ${d.managerCode} not found`);
      if (!!d.ifsc !== !!d.accountNumber) errs.push('bank: give both IFSC and account number');
      if (!errs.length) { valid.push({ data: d, row: i + 1 }); if (d.code) batchCodes.set(d.code, i); }
    }
    report.push({ row: i + 1, errors: errs });
  });
  const errorCount = report.filter((r) => r.errors.length).length;
  if (dryRun || errorCount) return res.json({ dryRun, total: rows.length, valid: valid.length, errorCount, report: report.filter((r) => r.errors.length) });

  const created: string[] = [];
  for (const { data: d } of valid) {
    const code = d.code ?? (await nextCode(cid));
    const [mgr] = d.managerCode ? await db.select({ id: E.id }).from(E).where(and(eq(E.companyId, cid), eq(E.code, d.managerCode))) : [];
    const [row] = await db.insert(E).values({
      companyId: cid, code, firstName: d.firstName, lastName: d.lastName, workEmail: d.workEmail, gender: d.gender, doj: d.doj, mobile: d.mobile,
      departmentId: byName(deps, d.department), designationId: byName(desigs, d.designation), branchId: byName(brs, d.branch), managerId: mgr?.id, createdBy: req.user!.sub,
      ...sensitiveColumns({ pan: d.pan, bank: d.accountNumber ? { holder: `${d.firstName} ${d.lastName}`, account: d.accountNumber, ifsc: d.ifsc! } : undefined }),
    }).returning();
    await creditJoinerLeave(cid, row.id, row.doj, row.gender, req.user!.sub);
    if (d.monthlyGross || d.annualCtc) await createRevision(req, row.id, { monthlyGross: d.monthlyGross, annualCtc: d.annualCtc }, 0, row.doj);
    created.push(row.id);
  }
  await audit(req, 'import', 'employee', null, undefined, { count: created.length });
  res.json({ dryRun: false, total: rows.length, created: created.length, errorCount: 0, report: [] });
}));

/* ---------------- salary ---------------- */
const ctcInput = z.object({ annualCtc: z.number().min(0).max(1e9).default(0), monthlyGross: z.number().positive().max(1e8).optional(), annualVariable: z.number().min(0).max(1e9).default(0), metro: z.boolean().default(true), state: z.string().regex(/^[A-Z]{2}$/).default('MH'), gender: z.enum(['M', 'F']).default('M'), age: z.number().int().min(14).max(100).default(30), pfCapMode: z.enum(['capped', 'actual']).optional() })
  .refine((d) => d.monthlyGross || d.annualCtc > 0, 'Enter the monthly gross or annual CTC');
employeesRouter.post('/ctc/preview', requireRole('COMPANY_ADMIN', 'PAYROLL_MANAGER'), h(async (req, res) => {
  const d = parse(ctcInput, req.body);
  const [c] = await db.select().from(schema.companies).where(eq(schema.companies.id, req.user!.cid));
  const { stat, tax } = await loadRules();
  try {
    res.json(splitCtc({ ...d, pfCapMode: d.pfCapMode ?? (c.pfCapMode as 'capped' | 'actual'), labourCodeMode: c.labourCodeMode, esiExempt: !c.esiEnabled, asOf: new Date().toISOString().slice(0, 7) }, stat, tax));
  } catch (e) { throw new ApiError(422, 'ctc_invalid', (e as Error).message); }
}));

employeesRouter.post('/employees/:id/salary-revisions', requireRole('COMPANY_ADMIN', 'PAYROLL_MANAGER'), h(async (req, res) => {
  await employeeAccess(req, req.params.id);
  const d = parse(z.object({ annualCtc: z.number().positive().max(1e9).optional(), monthlyGross: z.number().positive().max(1e8).optional(), components: componentsSchema.optional(), annualVariable: z.number().min(0).default(0), effectiveFrom: z.string().date() })
    .refine((x) => x.monthlyGross || x.annualCtc || x.components, 'Enter the monthly gross'), req.body);
  res.status(201).json(await createRevision(req, req.params.id, { monthlyGross: d.monthlyGross, annualCtc: d.annualCtc, components: d.components }, d.annualVariable, d.effectiveFrom));
}));

employeesRouter.get('/employees/:id/salary-structures', h(async (req, res) => {
  const access: Access = await employeeAccess(req, req.params.id);
  if (access === 'manager') throw forbidden();
  res.json(await db.select().from(S).where(and(eq(S.companyId, req.user!.cid), eq(S.employeeId, req.params.id))).orderBy(desc(S.effectiveFrom)));
}));

/* ---------------- change requests (spec §2: self-edits of bank / PAN / name need HR approval) ---------------- */
const crSchema = z.discriminatedUnion('field', [
  z.object({ field: z.literal('pan'), value: PAN }),
  z.object({ field: z.literal('bank'), value: bankSchema }),
  z.object({ field: z.literal('name'), value: z.object({ firstName: personal.firstName, lastName: personal.lastName }) }),
  z.object({ field: z.literal('mobile'), value: z.string().regex(/^\+?\d{10,13}$/) }),
]);
employeesRouter.post('/change-requests', h(async (req, res) => {
  if (!req.user!.eid) throw forbidden();
  const d = parse(crSchema, req.body);
  const [row] = await db.insert(schema.changeRequests).values({ companyId: req.user!.cid, employeeId: req.user!.eid, field: d.field, valueEnc: encryptJson(d.value) }).returning({ id: schema.changeRequests.id });
  await audit(req, 'change_request', 'employee', req.user!.eid, undefined, { field: d.field });
  res.status(201).json(row);
}));
employeesRouter.get('/change-requests', h(async (req, res) => {
  const CR = schema.changeRequests;
  const admin = hasRole(req.user, 'COMPANY_ADMIN');
  const where = admin ? eq(CR.companyId, req.user!.cid) : and(eq(CR.companyId, req.user!.cid), eq(CR.employeeId, req.user!.eid ?? '00000000-0000-0000-0000-000000000000'));
  const rows = await db.select({ id: CR.id, field: CR.field, status: CR.status, createdAt: CR.createdAt, employeeId: CR.employeeId, valueEnc: CR.valueEnc, name: sql<string>`${E.firstName} || ' ' || ${E.lastName}`, code: E.code })
    .from(CR).innerJoin(E, eq(E.id, CR.employeeId)).where(where).orderBy(desc(CR.createdAt)).limit(100);
  // Requested values are shown masked; only the approver sees them in the decision step.
  res.json(rows.map(({ valueEnc, ...r }) => {
    const v = decryptJson<any>(valueEnc);
    const preview = r.field === 'pan' ? mask(v.slice(-4)) : r.field === 'bank' ? `${v.ifsc} ${mask(v.account.slice(-4))}` : r.field === 'name' ? `${v.firstName} ${v.lastName}` : mask(String(v).slice(-4));
    return { ...r, preview };
  }));
}));
employeesRouter.put('/change-requests/:id/decision', requireRole('COMPANY_ADMIN'), h(async (req, res) => {
  const { approve } = parse(z.object({ approve: z.boolean() }), req.body);
  const CR = schema.changeRequests;
  const [cr] = await db.select().from(CR).where(and(eq(CR.companyId, req.user!.cid), eq(CR.id, req.params.id), eq(CR.status, 'PENDING')));
  if (!cr) throw notFound('Change request');
  if (cr.employeeId === req.user!.eid) throw new ApiError(403, 'self_approval', 'You cannot approve your own change');
  if (approve) {
    const v = decryptJson<any>(cr.valueEnc);
    const set = cr.field === 'pan' ? sensitiveColumns({ pan: v }) : cr.field === 'bank' ? sensitiveColumns({ bank: v }) : cr.field === 'name' ? v : { mobile: v };
    await db.update(E).set(set).where(eq(E.id, cr.employeeId));
  }
  await db.update(CR).set({ status: approve ? 'APPROVED' : 'REJECTED', reviewedBy: req.user!.sub, reviewedAt: new Date() }).where(eq(CR.id, cr.id));
  await audit(req, approve ? 'change_approved' : 'change_rejected', 'employee', cr.employeeId, undefined, { field: cr.field });
  await notifyUsersOfEmployees(req.user!.cid, [cr.employeeId], `Your ${cr.field} change was ${approve ? 'approved' : 'rejected'}`);
  res.json({ ok: true });
}));
