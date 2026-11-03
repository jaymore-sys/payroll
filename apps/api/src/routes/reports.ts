import { taxYearOf, type Payslip } from '@payrollpro/engines';
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { Router } from 'express';
import { z } from 'zod';
import { db, schema } from '../db';
import { audit } from '../lib/audit';
import { requireRole } from '../lib/auth';
import { decrypt, decryptJson } from '../lib/crypto';
import { ApiError, h, parse } from '../lib/http';

/** Reports (modelled on RazorpayX Payroll → Reports). Every report is { columns, rows }; the page shows it and downloads Excel or CSV. */
export const reportsRouter = Router();
const E = schema.employees, P = schema.payslips, R = schema.payrollRuns, S = schema.salaryStructures;
const MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');

type Col = { key: string; label: string; money?: boolean };
type Report = { title: string; sub?: string; columns: Col[]; rows: Record<string, unknown>[] };
type Ctx = { cid: string; month: string; showSkipped: boolean };

const label = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const fyMonths = (month: string) => {
  const y = Number(taxYearOf(month).slice(0, 4));
  return { from: `${y}-04`, to: `${y + 1}-03`, label: `FY ${taxYearOf(month)}` };
};
const pan = (enc: string | null) => (enc ? decrypt(enc) : '');
const name = (e: { firstName: string; lastName: string }) => `${e.firstName} ${e.lastName}`;
const c = (key: string, label: string, money = false): Col => ({ key, label, money });

/** Payslips of a month (or a range) with the employee and their masters. */
async function slips(cid: string, from: string, to = from, finalisedOnly = false) {
  return db.select({ slip: P, status: R.status, e: E, department: schema.departments.name, designation: schema.designations.name, state: schema.branches.state, branch: schema.branches.name })
    .from(P).innerJoin(R, eq(R.id, P.runId)).innerJoin(E, eq(E.id, P.employeeId))
    .leftJoin(schema.departments, eq(schema.departments.id, E.departmentId)).leftJoin(schema.designations, eq(schema.designations.id, E.designationId)).leftJoin(schema.branches, eq(schema.branches.id, E.branchId))
    .where(and(eq(P.companyId, cid), gte(P.month, from), lte(P.month, to), ...(finalisedOnly ? [eq(R.status, 'FINALISED')] : []))).orderBy(asc(E.code), asc(P.month));
}
const runNote = async (cid: string, month: string) => {
  const [r] = await db.select({ status: R.status }).from(R).where(and(eq(R.companyId, cid), eq(R.month, month)));
  return !r ? 'No payroll run for this month yet' : r.status === 'FINALISED' ? 'Approved payroll' : `Payroll not approved yet (${r.status.toLowerCase()})`;
};
async function employeesWithMasters(cid: string) {
  return db.select({ e: E, department: schema.departments.name, designation: schema.designations.name, branch: schema.branches.name, state: schema.branches.state })
    .from(E).leftJoin(schema.departments, eq(schema.departments.id, E.departmentId)).leftJoin(schema.designations, eq(schema.designations.id, E.designationId)).leftJoin(schema.branches, eq(schema.branches.id, E.branchId))
    .where(eq(E.companyId, cid)).orderBy(asc(E.code));
}

const REPORTS: Record<string, { title: string; group: string; desc: string; period: 'month' | 'fy' | 'none'; build: (x: Ctx) => Promise<Report> }> = {
  'salary-register': {
    title: 'Salary Register', group: 'Payroll', period: 'month', desc: 'Every employee’s earnings, deductions and net pay for the month',
    async build({ cid, month, showSkipped }) {
      const all = await slips(cid, month);
      const rows = all.filter((r) => showSkipped || !r.slip.hold);
      const comps: string[] = [];
      for (const r of rows) for (const e of (r.slip.detail as Payslip).earnings) if (!comps.includes(e.name)) comps.push(e.name);
      const key = (n: string) => `c_${n}`;
      return {
        title: `Salary Register — ${label(month)}`, sub: `${await runNote(cid, month)}${!showSkipped && all.length > rows.length ? ` · ${all.length - rows.length} skipped (on hold) not shown` : ''}`,
        columns: [c('ptLocation', 'PT Location'), c('pan', 'PAN'), c('code', 'Emp Id'), c('name', 'Name'), c('days', 'Working Days'), ...comps.map((n) => c(key(n), n, true)),
          c('bonus', 'Bonus', true), c('arrears', 'Arrears', true), c('other', 'Other earnings', true), c('gross', 'Gross', true), c('pf', 'PF (EE)', true), c('esi', 'ESI (EE)', true), c('pt', 'PT', true), c('tds', 'TDS', true), c('otherDed', 'Other deductions', true), c('net', 'Net Pay', true), ...(showSkipped ? [c('skipped', 'Skipped')] : [])],
        rows: rows.map(({ slip, e, state }) => {
          const p = slip.detail as Payslip;
          return { ptLocation: state ?? '', pan: pan(e.panEnc), code: e.code, name: name(e), days: Number(slip.payableDays), ...Object.fromEntries(comps.map((n) => [key(n), p.earnings.find((x) => x.name === n)?.amount ?? 0])),
            bonus: p.adjustments?.bonus ?? 0, arrears: p.adjustments?.arrears ?? 0, other: p.adjustments?.other ?? 0, gross: p.gross, pf: p.deductions.pf, esi: p.deductions.esi, pt: p.deductions.pt, tds: p.deductions.tds, otherDed: p.deductions.other, net: p.net, skipped: slip.hold ? 'Yes' : '' };
        }),
      };
    },
  },
  'skipped-summary': {
    title: 'Skipped Summary Report', group: 'Payroll', period: 'month', desc: 'Employees whose salary was put on hold this month',
    async build({ cid, month }) {
      const rows = (await slips(cid, month)).filter((r) => r.slip.hold);
      const notes = new Map((await db.select().from(schema.payrollInputs).innerJoin(R, eq(R.id, schema.payrollInputs.runId)).where(and(eq(R.companyId, cid), eq(R.month, month)))).map((x) => [x.payroll_input.employeeId, x.payroll_input.note]));
      return { title: `Skipped Summary — ${label(month)}`, columns: [c('code', 'Emp Id'), c('name', 'Name'), c('department', 'Department'), c('gross', 'Gross', true), c('net', 'Net pay held', true), c('note', 'Note')],
        rows: rows.map(({ slip, e, department }) => ({ code: e.code, name: name(e), department: department ?? '', gross: Number(slip.gross), net: Number(slip.net), note: notes.get(e.id) ?? '' })) };
    },
  },
  'finalization': {
    title: 'Finalization Report', group: 'Payroll', period: 'fy', desc: 'Month-by-month payroll totals and approval for the financial year',
    async build({ cid, month }) {
      const fy = fyMonths(month);
      const runs = await db.select().from(R).where(and(eq(R.companyId, cid), gte(R.month, fy.from), lte(R.month, fy.to))).orderBy(asc(R.month));
      return { title: `Finalization Report — ${fy.label}`, columns: [c('month', 'Month'), c('status', 'Status'), c('employees', 'Employees'), c('onHold', 'Skipped'), c('gross', 'Gross', true), c('deductions', 'Deductions', true), c('tds', 'TDS', true), c('net', 'Net pay', true), c('employerCost', 'Employer contributions', true), c('approvedOn', 'Approved on')],
        rows: runs.map((r) => { const t = (r.totals ?? {}) as Record<string, number>; return { month: label(r.month), status: r.status === 'FINALISED' ? 'Approved' : r.status.toLowerCase(), employees: t.employees ?? 0, onHold: t.onHold ?? 0, gross: t.gross ?? 0, deductions: t.deductions ?? 0, tds: t.tds ?? 0, net: t.net ?? 0, employerCost: t.employerCost ?? 0, approvedOn: r.finalisedAt ? new Date(r.finalisedAt).toLocaleDateString('en-IN') : '' }; }) };
    },
  },
  'consolidated-ytd': {
    title: 'Salary Register YTD', group: 'Payroll', period: 'fy', desc: 'Each employee’s approved pay added up for the financial year so far',
    async build({ cid, month }) {
      const fy = fyMonths(month);
      const by = new Map<string, Record<string, any>>();
      for (const { slip, e } of (await slips(cid, fy.from, month, true)).filter((x) => !x.slip.hold)) {
        const p = slip.detail as Payslip;
        const t = by.get(e.id) ?? { pan: pan(e.panEnc), code: e.code, name: name(e), months: 0, gross: 0, pf: 0, esi: 0, pt: 0, tds: 0, other: 0, net: 0 };
        t.months++; t.gross += p.gross; t.pf += p.deductions.pf; t.esi += p.deductions.esi; t.pt += p.deductions.pt; t.tds += p.deductions.tds; t.other += p.deductions.other; t.net += p.net;
        by.set(e.id, t);
      }
      return { title: `Consolidated Salary Register — ${fy.label} up to ${label(month)}`, sub: 'Approved months only; skipped (on hold) salaries left out',
        columns: [c('pan', 'PAN'), c('code', 'Emp Id'), c('name', 'Name'), c('months', 'Months paid'), c('gross', 'Gross', true), c('pf', 'PF (EE)', true), c('esi', 'ESI (EE)', true), c('pt', 'PT', true), c('tds', 'TDS', true), c('other', 'Other deductions', true), c('net', 'Net pay', true)], rows: [...by.values()] };
    },
  },
  'master-ctc': {
    title: 'Master CTC Report', group: 'Payroll', period: 'none', desc: 'Current salary structure of every active employee',
    async build({ cid }) {
      const rows = await db.select({ s: S, e: E, department: schema.departments.name }).from(S).innerJoin(E, eq(E.id, S.employeeId)).leftJoin(schema.departments, eq(schema.departments.id, E.departmentId))
        .where(and(eq(S.companyId, cid), isNull(S.effectiveTo), inArray(E.status, ['ACTIVE', 'NOTICE', 'ONBOARDING']))).orderBy(asc(E.code));
      const comps: string[] = [];
      const compsOf = (r: (typeof rows)[number]) => (r.e.employmentType === 'intern' ? [{ name: 'Stipend', monthly: Number(r.s.monthlyGross) }] : ((r.s.breakup as any).components as { name: string; monthly: number }[]));
      for (const r of rows) for (const x of compsOf(r)) if (!comps.includes(x.name)) comps.push(x.name);
      return { title: 'Master CTC Report', sub: 'Monthly amounts of the salary in force today',
        columns: [c('code', 'Emp Id'), c('name', 'Name'), c('type', 'Type'), c('department', 'Department'), c('from', 'Effective from'), ...comps.map((n) => c(`c_${n}`, n, true)), c('gross', 'Monthly gross', true), c('erPf', 'Employer PF', true), c('ctc', 'Annual CTC', true)],
        rows: rows.map((r) => { const b = r.s.breakup as any; return { code: r.e.code, name: name(r.e), type: r.e.employmentType, department: r.department ?? '', from: r.s.effectiveFrom, ...Object.fromEntries(compsOf(r).map((x) => [`c_${x.name}`, x.monthly])), gross: Number(r.s.monthlyGross), erPf: r.e.employmentType === 'intern' ? 0 : b.employer?.pf ?? 0, ctc: Number(r.s.annualCtc) }; }) };
    },
  },
  'hr-register': {
    title: 'HR Register', group: 'People', period: 'none', desc: 'Employee master: personal, job, statutory and bank details',
    async build({ cid }) {
      return { title: 'HR Register', columns: [c('code', 'Emp Id'), c('name', 'Name'), c('gender', 'Gender'), c('dob', 'Date of birth'), c('doj', 'Date of joining'), c('type', 'Type'), c('status', 'Status'), c('department', 'Department'), c('designation', 'Designation'), c('branch', 'Location'), c('email', 'Work email'), c('mobile', 'Mobile'), c('pan', 'PAN'), c('uan', 'UAN'), c('pf', 'PF'), c('pt', 'PT'), c('account', 'Bank account'), c('ifsc', 'IFSC'), c('lwd', 'Last working day')],
        rows: (await employeesWithMasters(cid)).map(({ e, department, designation, branch }) => {
          const b = e.bankEnc ? decryptJson<{ account: string; ifsc: string }>(e.bankEnc) : null;
          const intern = e.employmentType === 'intern';
          return { code: e.code, name: name(e), gender: e.gender, dob: e.dob ?? '', doj: e.doj, type: e.employmentType, status: e.status, department: department ?? '', designation: designation ?? '', branch: branch ?? '', email: e.workEmail, mobile: e.mobile ?? '', pan: pan(e.panEnc), uan: e.uan ?? '', pf: intern || e.pfOptOut ? 'No' : 'Yes', pt: intern || e.ptExempt ? 'No' : 'Yes', account: b?.account ?? '', ifsc: b?.ifsc ?? '', lwd: e.lastWorkingDay ?? '' };
        }) };
    },
  },
  'missing-information': {
    title: 'Missing Information', group: 'People', period: 'none', desc: 'Active employees with PAN, bank, UAN, date of birth or salary missing',
    async build({ cid }) {
      const withSalary = new Set((await db.select({ id: S.employeeId }).from(S).where(eq(S.companyId, cid))).map((r) => r.id));
      const rows = (await employeesWithMasters(cid)).filter(({ e }) => ['ACTIVE', 'NOTICE', 'ONBOARDING'].includes(e.status)).map(({ e, department }) => {
        const intern = e.employmentType === 'intern';
        const miss = [!e.panEnc && 'PAN', !e.bankEnc && 'Bank account', !intern && !e.pfOptOut && !e.uan && 'UAN', !e.dob && 'Date of birth', !withSalary.has(e.id) && 'Salary'].filter(Boolean) as string[];
        return { code: e.code, name: name(e), department: department ?? '', missing: miss.join(', '), count: miss.length };
      }).filter((r) => r.count);
      return { title: 'Missing Information', columns: [c('code', 'Emp Id'), c('name', 'Name'), c('department', 'Department'), c('missing', 'Missing'), c('count', 'Items')], rows };
    },
  },
  'attendance': {
    title: 'Attendance', group: 'People', period: 'month', desc: 'Working days, present, paid leave and LOP from the attendance sheet',
    async build({ cid, month }) {
      const A = schema.attendanceMonths;
      const rows = await db.select({ a: A, e: E }).from(A).innerJoin(E, eq(E.id, A.employeeId)).where(and(eq(A.companyId, cid), eq(A.month, month))).orderBy(asc(E.code));
      return { title: `Attendance — ${label(month)}`, columns: [c('code', 'Emp Id'), c('name', 'Name'), c('working', 'Working days'), c('present', 'Present'), c('paidLeave', 'Paid leave'), c('lop', 'LOP'), c('ot', 'Overtime hrs'), c('note', 'Note')],
        rows: rows.map(({ a, e }) => ({ code: e.code, name: name(e), working: Number(a.workingDays), present: Number(a.presentDays), paidLeave: Number(a.paidLeaveDays), lop: Number(a.lopDays), ot: Number(a.overtimeHours), note: a.note ?? '' })) };
    },
  },
  'provident-fund': {
    title: 'Provident Fund', group: 'Statutory', period: 'month', desc: 'PF contributions per employee (ECR format: UAN, wages, EE, EPS, ER)',
    async build({ cid, month }) {
      const rows = (await slips(cid, month)).filter(({ slip }) => !slip.hold && (slip.detail as Payslip).deductions.pf > 0);
      return { title: `Provident Fund — ${label(month)}`, sub: await runNote(cid, month),
        columns: [c('uan', 'UAN'), c('code', 'Emp Id'), c('name', 'Member name'), c('gross', 'Gross wages', true), c('epfWage', 'EPF wages', true), c('epsWage', 'EPS wages', true), c('edliWage', 'EDLI wages', true), c('ee', 'EPF contribution (EE)', true), c('eps', 'EPS contribution', true), c('er', 'EPF-EPS difference (ER)', true), c('ncp', 'NCP days'), c('edli', 'EDLI', true)],
        rows: rows.map(({ slip, e }) => { const p = slip.detail as Payslip; const epsWage = p.employer.eps ? Math.min(p.pfWage, 15000) : 0;
          return { uan: e.uan ?? '', code: e.code, name: name(e), gross: p.gross, epfWage: p.pfWage, epsWage, edliWage: Math.min(p.pfWage, 15000), ee: p.deductions.pf, eps: p.employer.eps, er: p.employer.epf, ncp: p.lopDays, edli: p.employer.edli }; }) };
    },
  },
  'esi': {
    title: 'ESI', group: 'Statutory', period: 'month', desc: 'ESI contributions of covered employees',
    async build({ cid, month }) {
      const rows = (await slips(cid, month)).filter(({ slip }) => !slip.hold && (slip.detail as Payslip).esiGross > 0);
      return { title: `ESI — ${label(month)}`, sub: rows.length ? undefined : 'No ESI this month (ESI is off for the company or no employee is covered)',
        columns: [c('ip', 'IP number'), c('code', 'Emp Id'), c('name', 'Name'), c('days', 'Days paid'), c('wages', 'ESI wages', true), c('ee', 'Employee (0.75%)', true), c('er', 'Employer (3.25%)', true)],
        rows: rows.map(({ slip, e }) => { const p = slip.detail as Payslip; return { ip: e.esiIp ?? '', code: e.code, name: name(e), days: p.payableDays, wages: p.esiGross, ee: p.deductions.esi, er: p.employer.esi }; }) };
    },
  },
  'professional-tax': {
    title: 'Professional Tax', group: 'Statutory', period: 'month', desc: 'PT deducted per employee, by state',
    async build({ cid, month }) {
      const rows = (await slips(cid, month)).filter(({ slip }) => !slip.hold && (slip.detail as Payslip).deductions.pt > 0);
      return { title: `Professional Tax — ${label(month)}`, columns: [c('state', 'PT location'), c('code', 'Emp Id'), c('name', 'Name'), c('gender', 'Gender'), c('gross', 'Gross', true), c('pt', 'PT', true)],
        rows: rows.map(({ slip, e, state }) => { const p = slip.detail as Payslip; return { state: state ?? '', code: e.code, name: name(e), gender: e.gender, gross: p.gross, pt: p.deductions.pt }; }) };
    },
  },
  'tds': {
    title: 'TDS', group: 'Tax', period: 'month', desc: 'Income tax deducted from salaries this month (section 392)',
    async build({ cid, month }) {
      const rows = (await slips(cid, month)).filter(({ slip }) => !slip.hold);
      return { title: `TDS on salary — ${label(month)}`, sub: 'Deposit by the 7th of next month',
        columns: [c('pan', 'PAN'), c('code', 'Emp Id'), c('name', 'Name'), c('regime', 'Regime'), c('gross', 'Gross', true), c('taxable', 'Taxable salary', true), c('tds', 'TDS', true)],
        rows: rows.filter(({ slip }) => Number(slip.tds) > 0).map(({ slip, e }) => { const p = slip.detail as Payslip; return { pan: pan(e.panEnc) || 'PANNOTAVBL', code: e.code, name: name(e), regime: p.tax.regime, gross: p.gross, taxable: p.taxableGross, tds: p.deductions.tds }; }) };
    },
  },
  'tax-deductions': {
    title: 'Tax Deductions', group: 'Tax', period: 'fy', desc: 'TDS deducted from each employee, month by month, for the financial year',
    async build({ cid, month }) {
      const fy = fyMonths(month);
      const months: string[] = [];
      for (let d = new Date(`${fy.from}-01T00:00:00Z`); d.toISOString().slice(0, 7) <= fy.to; d.setUTCMonth(d.getUTCMonth() + 1)) months.push(d.toISOString().slice(0, 7));
      const by = new Map<string, Record<string, any>>();
      for (const { slip, e } of (await slips(cid, fy.from, fy.to, true)).filter((x) => !x.slip.hold)) {
        const t = by.get(e.id) ?? { pan: pan(e.panEnc), code: e.code, name: name(e), total: 0 };
        t[`m_${slip.month}`] = Number(slip.tds); t.total += Number(slip.tds); by.set(e.id, t);
      }
      return { title: `Tax Deductions — ${fy.label}`, sub: 'Approved months', columns: [c('pan', 'PAN'), c('code', 'Emp Id'), c('name', 'Name'), ...months.map((m) => c(`m_${m}`, new Date(`${m}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' }), true)), c('total', 'Total', true)], rows: [...by.values()] };
    },
  },
  'tax-computation': {
    title: 'Tax Computation Report', group: 'Tax', period: 'month', desc: 'Each employee’s yearly income by component, exemptions, deductions, tax and TDS — RazorpayX columns',
    async build({ cid, month }) {
      const fy = fyMonths(month);
      const all = await slips(cid, fy.from, month);
      const by = new Map<string, typeof all>();
      for (const r of all) by.set(r.e.id, [...(by.get(r.e.id) ?? []), r]);
      const comps: string[] = [];
      const items = [...by.values()].map((list) => {
        const last = list[list.length - 1], p = last.slip.detail as Payslip, t = p.tax, e = last.e;
        const yearly = t.yearly?.length ? t.yearly : Object.entries(list.reduce((a, { slip }) => { for (const x of (slip.detail as Payslip).earnings) a[x.name] = (a[x.name] ?? 0) + x.amount; return a; }, {} as Record<string, number>))
          .map(([name, g]) => ({ name, gross: g, exempt: 0, taxable: g }));
        for (const y of yearly) if (!comps.includes(y.name)) comps.push(y.name);
        return { last, p, t, e, yearly, list };
      });
      const w = (t: Payslip['tax'], l: string) => t.worksheet.find((x) => x.label.startsWith(l))?.amount ?? 0;
      const num = (k: string, l: string) => c(k, l, true);
      return {
        title: `Tax Computation Report — ${fy.label} (up to ${label(month)})`,
        sub: 'Income = paid so far this financial year + projected for the rest of the year at the current salary',
        columns: [
          c('id', 'Employee ID'), c('name', 'Name'), c('email', 'Email'), c('pan', 'PAN'), c('doj', 'Date of Joining'), c('dol', 'Date of Leaving'), c('lastMonth', 'Last Finalized Payroll Month'), c('regime', 'Tax Regime'),
          ...comps.map((n) => num(`g_${n}`, n)),
          num('perq', 'Total Perquisites'), num('pastPrev', 'Past Taxable Income (Previous Employer)'), num('pastCur', 'Past Taxable Income (Current Employer)'), num('grossIncome', 'Gross Income'),
          ...comps.map((n) => num(`x_${n}`, `${n} Exemption`)),
          num('flex', 'Flexible Benefits Exemption (Section 10)'), num('curPastEx', 'Current Employer Past Exemption'), num('grossTaxable', 'Gross Taxable Income'),
          num('s80d', 'Section 80D Exemption'), num('s80tta', 'Section 80TTA Exemption'), num('s80ccd1b', 'Section 80CCD(1B) Exemption'), num('s80ccd2', 'Section 80CCD(2) Exemption'), num('s80c', 'Section 80C Exemption'),
          num('s80e', 'Section 80E Exemption'), num('s80g', 'Section 80G Exemption'), num('s80other', 'Other Section 80 Exemptions'), num('via', 'Total Deductions under Chapter VI-A'),
          num('s24', 'Section 24 Exemption'), num('ptEx', 'PT Exemption'), num('std', 'Standard Deduction'), num('netTaxable', 'Net Taxable Income'),
          num('slab', 'Tax on Taxable Income'), num('rebate', 'Tax Rebate u/s 87a'), num('surcharge', 'Surcharge'), num('cess', 'Education Cess'), num('netTax', 'Net Tax Payable'),
          num('prevTds', 'Previous Employer TDS'), num('curPastTds', 'Current Employer Past TDS'), num('paidPayroll', 'TDS Paid On Valencia Payroll'), num('totalTds', 'Total TDS Paid'), num('pending', 'TDS Pending'), num('excess', 'Excess TDS Paid'),
        ],
        rows: items.map(({ last, t, e, yearly, list }) => {
          const finalised = list.filter((x) => x.status === 'FINALISED');
          const paidPayroll = finalised.reduce((a, x) => a + Number(x.slip.tds), 0);
          const paidBefore = finalised.filter((x) => x.slip.month < last.slip.month).reduce((a, x) => a + Number(x.slip.tds), 0);
          const curPastTds = Math.max(0, (t.currentEmployerPastTds ?? 0) - paidBefore);
          const prevTds = t.prevEmployer?.tds ?? 0, prevInc = t.prevEmployer?.taxable ?? 0;
          const gross = yearly.reduce((a, y) => a + y.gross, 0) + prevInc, exempt = yearly.reduce((a, y) => a + y.exempt, 0);
          const via = w(t, '80C') + w(t, '80D') + w(t, '80CCD(1B)') + w(t, 'Employer NPS');
          const netTax = t.annualTax ?? 0, totalTds = prevTds + curPastTds + paidPayroll;
          return {
            id: e.code, name: name(e), email: e.workEmail, pan: pan(e.panEnc), doj: e.doj, dol: e.lastWorkingDay ?? '', lastMonth: finalised.length ? `${finalised[finalised.length - 1].slip.month}-01` : '', regime: t.regime === 'old' ? 'Old' : 'New',
            ...Object.fromEntries(yearly.map((y) => [`g_${y.name}`, y.gross])), ...Object.fromEntries(yearly.map((y) => [`x_${y.name}`, y.exempt])),
            perq: 0, pastPrev: prevInc, pastCur: 0, grossIncome: gross, flex: 0, curPastEx: 0, grossTaxable: gross - exempt,
            s80d: w(t, '80D'), s80tta: 0, s80ccd1b: w(t, '80CCD(1B)'), s80ccd2: w(t, 'Employer NPS'), s80c: w(t, '80C'), s80e: 0, s80g: 0, s80other: 0, via,
            s24: w(t, 'Home loan'), ptEx: w(t, 'Professional tax'), std: w(t, 'Standard deduction'), netTaxable: w(t, 'Taxable income'),
            slab: w(t, 'Slab tax'), rebate: -w(t, 'Rebate 87A'), surcharge: w(t, 'Surcharge'), cess: w(t, 'Health & education cess'), netTax,
            prevTds, curPastTds, paidPayroll, totalTds, pending: Math.max(0, netTax - totalTds), excess: Math.max(0, totalTds - netTax),
          };
        }),
      };
    },
  },
  'payslips': {
    title: 'Payslips', group: 'Payroll', period: 'month', desc: 'View or download the payslip of any employee or consultant for the month',
    async build({ cid, month }) {
      const emp = await slips(cid, month);
      const CP = schema.consultantPayments, CR = schema.consultantRuns, C = schema.consultants;
      const cons = await db.select({ p: CP, c: C }).from(CP).innerJoin(CR, eq(CR.id, CP.runId)).innerJoin(C, eq(C.id, CP.consultantId)).where(and(eq(CR.companyId, cid), eq(CR.month, month))).orderBy(asc(C.name));
      return {
        title: `Payslips — ${label(month)}`, sub: `${await runNote(cid, month)} · click View to open, Download to save as PDF`,
        columns: [c('code', 'Code'), c('name', 'Name'), c('_view', 'View'), c('_download', 'Download'), c('type', 'Type'), c('gross', 'Gross', true), c('net', 'Net pay', true), c('status', 'Status')],
        rows: [
          ...emp.map(({ slip, e, status }) => ({ code: e.code, name: name(e), type: e.employmentType === 'intern' ? 'Intern' : 'Employee', gross: Number(slip.gross), net: Number(slip.net), status: slip.hold ? 'On hold' : status === 'FINALISED' ? 'Approved' : 'Not approved', _slip: `/payslips/${slip.id}/print` })),
          ...cons.map(({ p, c: k }) => ({ code: k.code ?? '', name: k.name, type: 'Consultant', gross: Number(p.amount), net: Number(p.net), status: '', _slip: `/consultant-payments/${p.id}/print` })),
        ],
      };
    },
  },
  'pf-registration': {
    title: 'PF Registration Report', group: 'Statutory', period: 'month', desc: 'Employees who joined this month and need a UAN / PF registration',
    async build({ cid, month }) {
      const rows = (await employeesWithMasters(cid)).filter(({ e }) => e.doj.startsWith(month) && e.employmentType !== 'intern' && !e.pfOptOut);
      return { title: `PF Registration — joiners in ${label(month)}`, columns: [c('code', 'Emp Id'), c('name', 'Name'), c('gender', 'Gender'), c('dob', 'Date of birth'), c('doj', 'Date of joining'), c('uan', 'UAN'), c('pan', 'PAN'), c('mobile', 'Mobile'), c('status', 'Registration')],
        rows: rows.map(({ e }) => ({ code: e.code, name: name(e), gender: e.gender, dob: e.dob ?? '', doj: e.doj, uan: e.uan ?? '', pan: pan(e.panEnc), mobile: e.mobile ?? '', status: e.uan ? 'Has UAN' : 'Register for UAN' })) };
    },
  },
  'contractor-payments': {
    title: 'Contractor Payments', group: 'Payroll', period: 'month', desc: 'Consultant fees, TDS and net payable for the month',
    async build({ cid, month }) {
      const CP = schema.consultantPayments, CR = schema.consultantRuns, C = schema.consultants;
      const rows = await db.select({ p: CP, c: C, status: CR.status }).from(CP).innerJoin(CR, eq(CR.id, CP.runId)).innerJoin(C, eq(C.id, CP.consultantId)).where(and(eq(CR.companyId, cid), eq(CR.month, month))).orderBy(asc(C.name));
      return { title: `Contractor Payments — ${label(month)}`, sub: rows[0] ? (rows[0].status === 'FINALISED' ? 'Approved' : 'Not approved yet') : 'Not calculated yet',
        columns: [c('name', 'Consultant'), c('pan', 'PAN'), c('fee', 'Monthly fee', true), c('lop', 'LOP'), c('amount', 'Amount', true), c('tds', 'TDS', true), c('net', 'Net payable', true)],
        rows: rows.map(({ p, c: k }) => ({ name: k.name, pan: pan(k.panEnc), fee: Number(p.fee), lop: Number(p.lopDays), amount: Number(p.amount), tds: Number(p.tds), net: Number(p.net) })) };
    },
  },
  'audit': {
    title: 'Audit Report', group: 'People', period: 'month', desc: 'Who changed what in Valencia Payroll during the month',
    async build({ cid, month }) {
      const A = schema.auditLog, U = schema.users;
      const next = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1));
      const rows = await db.select({ a: A, email: U.email }).from(A).leftJoin(U, eq(U.id, A.userId))
        .where(and(eq(A.companyId, cid), gte(A.at, new Date(`${month}-01T00:00:00Z`)), sql`${A.at} < ${next}`)).orderBy(desc(A.at)).limit(5000);
      return { title: `Audit Report — ${label(month)}`, columns: [c('at', 'When'), c('user', 'User'), c('action', 'Action'), c('entity', 'Record'), c('ip', 'IP')],
        rows: rows.map(({ a, email }) => ({ at: new Date(a.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }), user: email ?? '', action: a.action.replace(/_/g, ' '), entity: a.entity, ip: a.ip ?? '' })) };
    },
  },
};

reportsRouter.get('/reports', requireRole('COMPANY_ADMIN', 'PAYROLL_MANAGER'), (_req, res) => {
  res.json(Object.entries(REPORTS).map(([key, r]) => ({ key, title: r.title, group: r.group, desc: r.desc, period: r.period })));
});

reportsRouter.get('/reports/:key', requireRole('COMPANY_ADMIN', 'PAYROLL_MANAGER'), h(async (req, res) => {
  const def = REPORTS[req.params.key];
  if (!def) throw new ApiError(404, 'not_found', 'Unknown report');
  const q = parse(z.object({ month: MONTH.optional(), showSkipped: z.enum(['0', '1']).optional(), format: z.enum(['json', 'xlsx']).default('json') }), req.query);
  const month = q.month ?? new Date().toISOString().slice(0, 7);
  const rep = await def.build({ cid: req.user!.cid, month, showSkipped: q.showSkipped === '1' });
  if (q.format === 'json') return res.json(rep);
  rep.columns = rep.columns.filter((x) => !x.key.startsWith('_')); // links are for the screen only

  await audit(req, 'export_report', 'report', req.params.key, undefined, { month, rows: rep.rows.length });
  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, req.user!.cid));
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(def.title.slice(0, 31), { views: [{ state: 'frozen', ySplit: 3 }] });
  ws.addRow([`${company.legalName ?? company.name} · ${rep.title}`]).font = { bold: true, size: 13 };
  ws.addRow([rep.sub ?? '']).font = { italic: true, color: { argb: 'FF6B7280' } };
  const head = ws.addRow(rep.columns.map((x) => x.label));
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.eachCell((x) => { x.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } }; });
  const INR = '[>=10000000]##\\,##\\,##\\,##0;[>=100000]##\\,##\\,##0;##,##0';
  for (const r of rep.rows) ws.addRow(rep.columns.map((x) => (r[x.key] ?? (x.money ? 0 : '')) as ExcelJS.CellValue));
  rep.columns.forEach((x, i) => { const col = ws.getColumn(i + 1); col.width = Math.max(10, Math.min(30, x.label.length + 4)); if (x.money) col.numFmt = INR; else if (['pan', 'uan', 'account', 'ip'].includes(x.key)) col.numFmt = '@'; });
  if (rep.rows.length && rep.columns.some((x) => x.money)) {
    const t = ws.addRow(rep.columns.map((x, i) => (i === 0 ? 'Total' : x.money ? { formula: `SUM(${ws.getColumn(i + 1).letter}4:${ws.getColumn(i + 1).letter}${3 + rep.rows.length})` } : null)));
    t.font = { bold: true };
  }
  res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${req.params.key}-${month}.xlsx"`, 'Cache-Control': 'no-store' });
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
}));
