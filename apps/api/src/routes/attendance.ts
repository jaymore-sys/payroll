import { daysInMonth, periodDays, workingDaysInMonth } from '@payrollpro/engines';
import ExcelJS from 'exceljs';
import { and, asc, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { db, schema } from '../db';
import { audit } from '../lib/audit';
import { teamIds } from '../lib/access';
import { hasRole } from '../lib/auth';
import { ApiError, forbidden, h, parse } from '../lib/http';

/**
 * Monthly attendance, entered by reporting managers (their team) or HR (everyone). Leave is applied in another
 * system, so the manager records the month's outcome: present, paid leave and loss-of-pay days. Payroll uses LOP.
 */
export const attendanceRouter = Router();
const A = schema.attendanceMonths, E = schema.employees;
const MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');
const half = z.number().min(0).max(31).multipleOf(0.5);

/** Employees this user may record attendance for in the month, plus whether they can edit. */
async function scope(req: Request, month: string) {
  const u = req.user!;
  const first = `${month}-01`, last = `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;
  const onRolls = and(eq(E.companyId, u.cid), lte(E.doj, last), inArray(E.status, ['ACTIVE', 'NOTICE', 'EXITED']), or(isNull(E.lastWorkingDay), gte(E.lastWorkingDay, first)));
  const admin = hasRole(u, 'COMPANY_ADMIN', 'PAYROLL_MANAGER');
  let ids: string[] | null = null; // null = everyone
  if (!admin) {
    const team = u.eid && hasRole(u, 'REPORTING_MANAGER') ? await teamIds(u.cid, u.eid) : [];
    ids = [...team, ...(u.eid ? [u.eid] : [])];
  }
  const emps = await db.select({ e: E, state: schema.branches.state, department: schema.departments.name }).from(E)
    .leftJoin(schema.branches, eq(schema.branches.id, E.branchId)).leftJoin(schema.departments, eq(schema.departments.id, E.departmentId))
    .where(ids ? and(onRolls, inArray(E.id, ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])) : onRolls).orderBy(asc(E.code));
  // Editable: HR for everyone; managers for their team but not themselves.
  const canEdit = (empId: string) => admin || (empId !== u.eid && !!ids?.includes(empId));
  return { emps, canEdit, admin };
}

async function isLocked(cid: string, month: string) {
  const [run] = await db.select({ id: schema.payrollRuns.id }).from(schema.payrollRuns)
    .where(and(eq(schema.payrollRuns.companyId, cid), eq(schema.payrollRuns.month, month), eq(schema.payrollRuns.status, 'FINALISED')));
  return !!run;
}

async function withWorkingDays(cid: string, month: string, emps: Awaited<ReturnType<typeof scope>>['emps']) {
  const [company] = await db.select({ wp: schema.companies.weekPattern }).from(schema.companies).where(eq(schema.companies.id, cid));
  const hol = await db.select().from(schema.holidays).where(and(eq(schema.holidays.companyId, cid), eq(schema.holidays.restricted, false), gte(schema.holidays.date, `${month}-01`), lte(schema.holidays.date, `${month}-${String(daysInMonth(month)).padStart(2, "0")}`)));
  return emps.map((x) => {
    const holidays = hol.filter((h) => !h.state || h.state === x.state).map((h) => h.date);
    return { ...x, workingDays: workingDaysInMonth(month, company.wp, holidays, x.e.doj, x.e.lastWorkingDay), periodDays: periodDays(month, x.e.doj, x.e.lastWorkingDay) };
  });
}

attendanceRouter.get('/attendance', h(async (req, res) => {
  const month = parse(MONTH, req.query.month);
  const { emps, canEdit, admin } = await scope(req, month);
  const rows = await withWorkingDays(req.user!.cid, month, emps);
  const recs = rows.length ? await db.select().from(A).where(and(eq(A.companyId, req.user!.cid), eq(A.month, month), inArray(A.employeeId, rows.map((r) => r.e.id)))) : [];
  const byEmp = new Map(recs.map((r) => [r.employeeId, r]));
  const locked = await isLocked(req.user!.cid, month);
  res.json({
    month, daysInMonth: daysInMonth(month), locked, canManageAll: admin,
    items: rows.map(({ e, department, workingDays, periodDays: pd }) => {
      const r = byEmp.get(e.id);
      return {
        employeeId: e.id, code: e.code, name: `${e.firstName} ${e.lastName}`, department, workingDays, periodDays: pd, editable: !locked && canEdit(e.id),
        record: r ? { presentDays: Number(r.presentDays), paidLeaveDays: Number(r.paidLeaveDays), lopDays: Number(r.lopDays), overtimeHours: Number(r.overtimeHours), note: r.note, updatedAt: r.updatedAt } : null,
      };
    }),
  });
}));

const item = z.object({ employeeId: z.string().uuid(), presentDays: half, paidLeaveDays: half, lopDays: half, overtimeHours: z.number().min(0).max(300).default(0), note: z.string().max(200).nullish() });

async function save(req: Request, month: string, items: z.infer<typeof item>[]) {
  if (await isLocked(req.user!.cid, month)) throw new ApiError(409, 'locked', 'Payroll for this month is finalised; attendance is locked');
  const { emps, canEdit } = await scope(req, month);
  const rows = new Map((await withWorkingDays(req.user!.cid, month, emps)).map((r) => [r.e.id, r]));
  const errors: { employeeId: string; message: string }[] = [];
  for (const it of items) {
    const r = rows.get(it.employeeId);
    if (!r || !canEdit(it.employeeId)) { errors.push({ employeeId: it.employeeId, message: 'You cannot record attendance for this employee' }); continue; }
    if (it.presentDays + it.paidLeaveDays > r.workingDays) errors.push({ employeeId: it.employeeId, message: `${r.e.code}: present + paid leave (${it.presentDays + it.paidLeaveDays}) is more than ${r.workingDays} working days` });
    if (it.lopDays > r.periodDays) errors.push({ employeeId: it.employeeId, message: `${r.e.code}: LOP cannot exceed ${r.periodDays} days on the rolls` });
  }
  if (errors.length) throw new ApiError(422, 'attendance_invalid', errors[0].message, errors.map((e) => ({ path: e.employeeId, message: e.message })));
  await db.transaction(async (tx) => {
    for (const it of items) {
      const v = { workingDays: String(rows.get(it.employeeId)!.workingDays), presentDays: String(it.presentDays), paidLeaveDays: String(it.paidLeaveDays), lopDays: String(it.lopDays), overtimeHours: String(it.overtimeHours), note: it.note ?? null, enteredBy: req.user!.sub };
      await tx.insert(A).values({ companyId: req.user!.cid, employeeId: it.employeeId, month, ...v })
        .onConflictDoUpdate({ target: [A.companyId, A.employeeId, A.month], set: v });
    }
  });
  await audit(req, 'attendance_saved', 'attendance', month, undefined, { month, count: items.length });
}

attendanceRouter.put('/attendance', h(async (req, res) => {
  const { month, items } = parse(z.object({ month: MONTH, items: z.array(item).min(1).max(5000) }), req.body);
  await save(req, month, items);
  res.json({ ok: true, saved: items.length });
}));

/** CSV import from the leave/attendance software: code, presentDays, paidLeaveDays, lopDays[, overtimeHours]. */
/** Rows from an uploaded .xlsx (first sheet, first row = headers) — the exported sheet can be filled in and uploaded back. */
async function rowsFromXlsx(b64: string) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(b64, 'base64') as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new ApiError(422, 'empty', 'The workbook has no sheets');
  const head = (ws.getRow(1).values as unknown[]).map((v) => String(v ?? '').trim());
  const out: Record<string, unknown>[] = [];
  ws.eachRow((row, i) => {
    if (i === 1) return;
    const vals = row.values as unknown[];
    const rec: Record<string, unknown> = {};
    head.forEach((h, c) => { if (h) { const v = vals[c]; rec[h] = v && typeof v === 'object' && 'result' in (v as object) ? (v as { result: unknown }).result : v; } });
    if (rec.code) out.push(rec);
  });
  return out;
}

attendanceRouter.post('/attendance/import', h(async (req, res) => {
  const body = parse(z.object({ month: MONTH, rows: z.array(z.record(z.unknown())).max(5000).optional(), fileBase64: z.string().max(3_000_000).optional(), dryRun: z.boolean().default(true) })
    .refine((b) => b.rows?.length || b.fileBase64, 'Upload a file'), req.body);
  const { month, dryRun } = body;
  const rows = body.fileBase64 ? await rowsFromXlsx(body.fileBase64) : body.rows!;
  if (!rows.length) throw new ApiError(422, 'empty', 'No rows found — keep the header row and fill one row per employee');
  const { emps, canEdit } = await scope(req, month);
  const byCode = new Map(emps.map((x) => [x.e.code.toUpperCase(), x.e.id]));
  const num = (v: unknown) => (v === '' || v === undefined || v === null ? 0 : Number(v));
  const report: { row: number; errors: string[] }[] = [];
  const items: z.infer<typeof item>[] = [];
  rows.forEach((raw, i) => {
    const code = String(raw.code ?? raw.employeeCode ?? '').trim().toUpperCase();
    const id = byCode.get(code);
    const parsed = item.safeParse({ employeeId: id ?? '00000000-0000-0000-0000-000000000000', presentDays: num(raw.presentDays), paidLeaveDays: num(raw.paidLeaveDays), lopDays: num(raw.lopDays), overtimeHours: num(raw.overtimeHours), note: raw.note ? String(raw.note) : null });
    const errs = [...(!id ? [`code "${code}" not found or not in your team`] : id && !canEdit(id) ? [`${code}: not editable by you`] : []), ...(parsed.success ? [] : parsed.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`))];
    if (errs.length) report.push({ row: i + 1, errors: errs }); else items.push(parsed.data!);
  });
  if (dryRun || report.length) return res.json({ dryRun, total: rows.length, valid: items.length, errorCount: report.length, report });
  await save(req, month, items);
  res.json({ dryRun: false, total: rows.length, saved: items.length, errorCount: 0, report: [] });
}));

attendanceRouter.get('/attendance/export.xlsx', h(async (req, res) => {
  const month = parse(MONTH, req.query.month);
  if (!hasRole(req.user, 'COMPANY_ADMIN', 'PAYROLL_MANAGER', 'REPORTING_MANAGER')) throw forbidden();
  const { emps } = await scope(req, month);
  const rows = await withWorkingDays(req.user!.cid, month, emps);
  const recs = new Map((await db.select().from(A).where(and(eq(A.companyId, req.user!.cid), eq(A.month, month)))).map((r) => [r.employeeId, r]));
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Attendance', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'code', key: 'code', width: 11 }, { header: 'name', key: 'name', width: 24 }, { header: 'department', key: 'dept', width: 16 },
    { header: 'workingDays', key: 'wd', width: 12 }, { header: 'presentDays', key: 'p', width: 12 }, { header: 'paidLeaveDays', key: 'pl', width: 13 },
    { header: 'lopDays', key: 'lop', width: 9 }, { header: 'overtimeHours', key: 'ot', width: 13 }, { header: 'note', key: 'note', width: 30 },
  ];
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } }; });
  for (const r of rows) {
    const a = recs.get(r.e.id);
    ws.addRow({ code: r.e.code, name: `${r.e.firstName} ${r.e.lastName}`, dept: r.department ?? '', wd: r.workingDays, p: a ? Number(a.presentDays) : null, pl: a ? Number(a.paidLeaveDays) : null, lop: a ? Number(a.lopDays) : null, ot: a ? Number(a.overtimeHours) : null, note: a?.note ?? '' });
  }
  await audit(req, 'export_attendance', 'attendance', month, undefined, { month, rows: rows.length });
  res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="attendance-${month}.xlsx"`, 'Cache-Control': 'no-store' });
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
}));
