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
import { needsRecalc } from '../lib/runs';

/**
 * Monthly attendance, entered by reporting managers (their team) or HR (everyone). Leave is applied in another
 * system, so the manager records the month's outcome: present, paid leave and loss-of-pay days. Payroll uses LOP.
 */
export const attendanceRouter = Router();
const A = schema.attendanceMonths, E = schema.employees;
const MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');
const half = z.number().min(0).max(31).multipleOf(0.1); // 0.1 day: hour-based sheets give fractional days

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

const item = z.object({ employeeId: z.string().uuid(), workingDays: half.optional(), presentDays: half, paidLeaveDays: half, lopDays: half, overtimeHours: z.number().min(0).max(300).default(0), note: z.string().max(200).nullish() });

type Row = Awaited<ReturnType<typeof withWorkingDays>>[number];
/** Problems with one employee's month. Working days come from the uploaded sheet when it has them, else from the weekly-off calendar. */
function problems(it: z.infer<typeof item>, r: Row) {
  const wd = it.workingDays ?? r.workingDays, out: string[] = [];
  if (it.presentDays + it.paidLeaveDays > wd) out.push(`${r.e.code}: present + paid leave (${it.presentDays + it.paidLeaveDays}) is more than ${wd} working days`);
  if (it.lopDays > r.periodDays) out.push(`${r.e.code}: LOP cannot exceed ${r.periodDays} days on the rolls`);
  return out;
}

async function save(req: Request, month: string, items: z.infer<typeof item>[]) {
  if (await isLocked(req.user!.cid, month)) throw new ApiError(409, 'locked', 'Payroll for this month is approved; attendance is locked');
  const { emps, canEdit } = await scope(req, month);
  const rows = new Map((await withWorkingDays(req.user!.cid, month, emps)).map((r) => [r.e.id, r]));
  const errors: { employeeId: string; message: string }[] = [];
  for (const it of items) {
    const r = rows.get(it.employeeId);
    if (!r || !canEdit(it.employeeId)) { errors.push({ employeeId: it.employeeId, message: 'You cannot record attendance for this employee' }); continue; }
    for (const message of problems(it, r)) errors.push({ employeeId: it.employeeId, message });
  }
  if (errors.length) throw new ApiError(422, 'attendance_invalid', errors[0].message, errors.map((e) => ({ path: e.employeeId, message: e.message })));
  await db.transaction(async (tx) => {
    for (const it of items) {
      const v = { workingDays: String(it.workingDays ?? rows.get(it.employeeId)!.workingDays), presentDays: String(it.presentDays), paidLeaveDays: String(it.paidLeaveDays), lopDays: String(it.lopDays), overtimeHours: String(it.overtimeHours), note: it.note ?? null, enteredBy: req.user!.sub };
      await tx.insert(A).values({ companyId: req.user!.cid, employeeId: it.employeeId, month, ...v })
        .onConflictDoUpdate({ target: [A.companyId, A.employeeId, A.month], set: v });
    }
  });
  await needsRecalc(req.user!.cid, month);
  await audit(req, 'attendance_saved', 'attendance', month, undefined, { month, count: items.length });
}

attendanceRouter.put('/attendance', h(async (req, res) => {
  const { month, items } = parse(z.object({ month: MONTH, items: z.array(item).min(1).max(5000) }), req.body);
  await save(req, month, items);
  res.json({ ok: true, saved: items.length });
}));

/** Column names people actually use in their attendance sheets, matched ignoring case, spaces and punctuation. */
const COLUMNS: Record<string, string[]> = {
  code: ['code', 'empcode', 'employeecode', 'empid', 'employeeid', 'empno', 'employeeno', 'staffid', 'ecode'],
  workingDays: ['workingdays', 'totalworkingdays', 'workdays', 'noofworkingdays', 'wd'],
  presentDays: ['presentdays', 'present', 'dayspresent', 'daysworked', 'workeddays', 'totalpresent'],
  paidLeaveDays: ['paidleavedays', 'paidleave', 'leave', 'leaves', 'leavedays', 'pl', 'approvedleave', 'paidleaves'],
  lopDays: ['lopdays', 'lop', 'absent', 'absentdays', 'lwp', 'unpaidleave', 'unpaiddays', 'lossofpay'],
  payableDays: ['payabledays', 'paiddays', 'payable', 'salarydays'],
  overtimeHours: ['overtimehours', 'overtime', 'ot', 'othours'],
  note: ['note', 'notes', 'remark', 'remarks'],
};
const norm = (h: unknown) => String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const canonical = (h: unknown) => Object.entries(COLUMNS).find(([, names]) => names.includes(norm(h)))?.[0];
const cell = (v: unknown) => (v && typeof v === 'object' && 'result' in (v as object) ? (v as { result: unknown }).result : v);

const LABELS = {
  payableDays: ['totalworkingdays', 'workingday', 'workingdays', 'payabledays', 'paiddays', 'daysworked'],
  lopDays: ['noofleaves', 'leaves', 'lop', 'lopdays', 'unpaidleaves', 'leavesdeducted'],
  late: ['late', 'lates', 'latemarks'],
  halfDay: ['halfday', 'halfdays'],
};
const r1 = (v: unknown) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? undefined : Math.round(Number(v) * 10) / 10);

/**
 * Day-by-day attendance grid (one column per employee by name, one row per date, totals at the bottom such as
 * "Total working Days" and "No. of Leaves") — every sheet in the workbook. Returns null if the workbook isn't laid out that way.
 */
function gridRows(wb: ExcelJS.Workbook) {
  const rows: Record<string, unknown>[] = [];
  let month: string | undefined, found = false;
  for (const ws of wb.worksheets) {
    let headRow = 0;
    for (let i = 1; i <= Math.min(10, ws.rowCount) && !headRow; i++) if (norm(cell(ws.getRow(i).getCell(1).value)) === 'date') headRow = i;
    if (!headRow) continue;
    const top = cell(ws.getRow(1).getCell(1).value);
    if (top instanceof Date && !month) month = top.toISOString().slice(0, 7);
    const labelRow: Partial<Record<keyof typeof LABELS, number>> = {};
    ws.eachRow((row, i) => {
      const l = norm(cell(row.getCell(1).value));
      for (const [k, names] of Object.entries(LABELS)) if (names.includes(l) && !labelRow[k as keyof typeof LABELS]) labelRow[k as keyof typeof LABELS] = i;
    });
    if (!labelRow.payableDays && !labelRow.lopDays) continue;
    found = true;
    const head = ws.getRow(headRow);
    for (let c = 2; c <= ws.columnCount; c++) {
      const name = String(cell(head.getCell(c).value) ?? '').trim();
      if (!name) continue;
      const at = (k: keyof typeof LABELS) => (labelRow[k] ? cell(ws.getRow(labelRow[k]!).getCell(c).value) : undefined);
      rows.push({ name, sheet: ws.name, payableDays: r1(at('payableDays')), lopDays: r1(at('lopDays')), late: at('late'), halfDay: at('halfDay'), rawPayable: at('payableDays'), rawLop: at('lopDays') });
    }
  }
  return found ? { rows, month } : null;
}

/** Rows from an uploaded .xlsx: first sheet; the header row is the first of the top 10 rows with an employee-code column. */
export async function rowsFromXlsx(b64: string) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(b64, 'base64') as unknown as ArrayBuffer);
  const grid = gridRows(wb);
  if (grid) return { rows: grid.rows, columns: { name: 'Employee name (column header)', payableDays: 'Total working Days', lopDays: 'No. of Leaves' } as Record<string, string>, sheetMonth: grid.month };
  const ws = wb.worksheets[0];
  if (!ws) throw new ApiError(422, 'empty', 'The workbook has no sheets');
  let headRow = 0, head: unknown[] = [];
  for (let i = 1; i <= Math.min(10, ws.rowCount) && !headRow; i++) {
    const vals = ws.getRow(i).values as unknown[];
    if (vals.some((v) => canonical(cell(v)) === 'code')) { headRow = i; head = vals.map(cell); }
  }
  if (!headRow) throw new ApiError(422, 'no_code_column', 'Could not find an employee code column (e.g. "Emp Code") or a day-by-day sheet with a "Date" column');
  const columns: Record<string, string> = {};
  head.forEach((h) => { const c = canonical(h); if (c && !columns[c]) columns[c] = String(h).trim(); });
  const rows: Record<string, unknown>[] = [];
  ws.eachRow((row, i) => {
    if (i <= headRow) return;
    const vals = row.values as unknown[], rec: Record<string, unknown> = {};
    head.forEach((h, c) => { const k = canonical(h); if (k && rec[k] === undefined) rec[k] = cell(vals[c]); });
    if (rec.code && !/^total/i.test(String(rec.code))) rows.push(rec);
  });
  return { rows, columns, sheetMonth: undefined as string | undefined };
}

attendanceRouter.post('/attendance/import', h(async (req, res) => {
  const body = parse(z.object({ month: MONTH, rows: z.array(z.record(z.unknown())).max(5000).optional(), fileBase64: z.string().max(3_000_000).optional(), dryRun: z.boolean().default(true) })
    .refine((b) => b.rows?.length || b.fileBase64, 'Upload a file'), req.body);
  const { month, dryRun } = body;
  const { rows, columns, sheetMonth } = body.fileBase64 ? await rowsFromXlsx(body.fileBase64) : { rows: body.rows!, columns: {} as Record<string, string>, sheetMonth: undefined };
  if (sheetMonth && sheetMonth !== month) throw new ApiError(422, 'wrong_month', `This sheet is for ${sheetMonth}, but you are working on ${month}`);
  if (!rows.length) throw new ApiError(422, 'empty', 'No employee rows found under the header row');
  const { emps, canEdit } = await scope(req, month);
  const byId = new Map((await withWorkingDays(req.user!.cid, month, emps)).map((r) => [r.e.id, r]));
  const byCode = new Map(emps.map((x) => [x.e.code.toUpperCase(), x.e.id]));
  // Name matching for sheets without codes: full name, else a unique first-name / prefix match.
  const nm = (v: unknown) => String(v ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  const byName = (raw: string): string | undefined | 'ambiguous' => {
    const n = nm(raw), full = emps.filter((x) => nm(`${x.e.firstName} ${x.e.lastName}`) === n);
    if (full.length === 1) return full[0].e.id;
    const part = emps.filter((x) => nm(x.e.firstName) === n || nm(`${x.e.firstName} ${x.e.lastName}`).startsWith(`${n} `));
    if (part.length) return part.length === 1 ? part[0].e.id : 'ambiguous';
    // Surname spelt differently in the sheet ("Kikawat" / "Kikavat"): fall back to a first name only one employee has.
    const first = emps.filter((x) => nm(x.e.firstName) === n.split(' ')[0]);
    return first.length === 1 ? first[0].e.id : first.length > 1 ? 'ambiguous' : undefined;
  };
  const unmatched: string[] = [];
  const has = (v: unknown) => v !== '' && v !== undefined && v !== null;
  const num = (v: unknown) => (has(v) ? Number(v) : 0);
  const report: { row: number; errors: string[] }[] = [];
  const items: z.infer<typeof item>[] = [];
  const preview: Record<string, unknown>[] = [];
  rows.forEach((raw, i) => {
    if (raw.name !== undefined) { // day-by-day grid: matched by name, totals already worked out in the sheet
      const id = byName(String(raw.name)), r = id && id !== 'ambiguous' ? byId.get(id) : undefined;
      if (!r) { unmatched.push(`${String(raw.name).trim()}${id === 'ambiguous' ? ' (more than one employee has this name)' : ''} — ${raw.sheet}`); return; }
      const dim = r.periodDays;
      const lop = raw.lopDays !== undefined ? Number(raw.lopDays) : raw.payableDays !== undefined ? Math.max(0, Math.round((dim - Number(raw.payableDays)) * 10) / 10) : undefined;
      if (lop === undefined) { report.push({ row: i + 1, errors: [`${raw.name}: "Total working Days" / "No. of Leaves" is not a number (${String(raw.rawPayable ?? raw.rawLop)})`] }); return; }
      const payable = raw.payableDays !== undefined ? Number(raw.payableDays) : Math.max(0, dim - lop);
      const note = [raw.late !== undefined && raw.late !== null && `Late ${raw.late}`, raw.halfDay !== undefined && raw.halfDay !== null && `Half day ${raw.halfDay}`].filter(Boolean).join(', ') || null;
      const parsed = item.safeParse({ employeeId: r.e.id, workingDays: Math.round((payable + lop) * 10) / 10, presentDays: payable, paidLeaveDays: 0, lopDays: lop, overtimeHours: 0, note });
      const errs = [...(!canEdit(r.e.id) ? [`${r.e.code}: not editable by you`] : []), ...(parsed.success ? problems(parsed.data, r) : parsed.error.issues.map((x) => `${raw.name} ${x.path.join('.')}: ${x.message}`))];
      if (errs.length) report.push({ row: i + 1, errors: errs });
      else { items.push(parsed.data!); preview.push({ code: r.e.code, name: `${r.e.firstName} ${r.e.lastName}`, sheetName: String(raw.name).trim(), workingDays: payable + lop, presentDays: payable, paidLeaveDays: 0, lopDays: lop, note }); }
      return;
    }
    const code = String(raw.code ?? raw.employeeCode ?? '').trim().toUpperCase();
    const id = byCode.get(code), r = id ? byId.get(id) : undefined;
    const wd = has(raw.workingDays) ? num(raw.workingDays) : undefined;
    const paid = num(raw.paidLeaveDays);
    // LOP straight from the sheet; otherwise from payable days, or working days − present − paid leave.
    const lop = has(raw.lopDays) ? num(raw.lopDays)
      : has(raw.payableDays) && r ? Math.max(0, r.periodDays - num(raw.payableDays))
      : wd !== undefined && has(raw.presentDays) ? Math.max(0, wd - num(raw.presentDays) - paid) : 0;
    const present = has(raw.presentDays) ? num(raw.presentDays) : Math.max(0, (wd ?? r?.workingDays ?? 0) - paid - lop);
    const parsed = item.safeParse({ employeeId: id ?? '00000000-0000-0000-0000-000000000000', workingDays: wd, presentDays: present, paidLeaveDays: paid, lopDays: lop, overtimeHours: num(raw.overtimeHours), note: raw.note ? String(raw.note) : null });
    const errs = [
      ...(!id ? [`code "${code}" not found or not in your team`] : !canEdit(id) ? [`${code}: not editable by you`] : []),
      ...(parsed.success ? (r ? problems(parsed.data, r) : []) : parsed.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`)),
    ];
    if (errs.length) report.push({ row: i + 1, errors: errs });
    else { items.push(parsed.data!); preview.push({ code, name: `${r!.e.firstName} ${r!.e.lastName}`, workingDays: wd ?? r!.workingDays, presentDays: present, paidLeaveDays: paid, lopDays: lop }); }
  });
  const inSheet = new Set(items.map((x) => x.employeeId));
  const missing = [...byId.values()].filter((r) => canEdit(r.e.id) && !inSheet.has(r.e.id)).map((r) => `${r.e.code} ${r.e.firstName} ${r.e.lastName}`);
  if (dryRun || report.length) return res.json({ dryRun, total: rows.length, valid: items.length, errorCount: report.length, report, columns, preview, missing, unmatched });
  await save(req, month, items);
  res.json({ dryRun: false, total: rows.length, saved: items.length, errorCount: 0, report: [], columns, preview, missing, unmatched });
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
