/**
 * Start over from RazorpayX exports: DELETES ALL company data (rules stay), then creates the company, one Company Admin
 * and every Active employee from the Master CTC Report, with details from the HR Register and a login for each.
 * Every login gets the same default password and must set its own at first sign-in.
 *   npm run import:razorpay -- --ctc "Master CTC Report.xlsx" --register "HR Register.csv" --admin you@co.com --password "..." --yes
 * --salaries-only: keep everything (logins, passwords, runs) and only rebuild each employee's salary from the Master CTC Report.
 * Salaries copy RazorpayX's components exactly (Basic, HRA, Special, LTA, travel allowance, stipend …); CTC = their total.
 * Stop `npm run dev` first when using the built-in database.
 */
import 'dotenv/config'; // DATABASE_URL from apps/api/.env
import ExcelJS from 'exceljs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import request from 'supertest';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { app } from '../app';
import { hashPassword, signAccess } from '../lib/auth';
import { closeDb, db, migrateDb, schema } from './index';
import { createCompany, seedRules } from './seed';

const { values: a } = parseArgs({ options: {
  ctc: { type: 'string' }, register: { type: 'string' }, admin: { type: 'string' }, password: { type: 'string' },
  company: { type: 'string', default: 'Valencia Nutrition Limited' }, managers: { type: 'string', default: '' }, yes: { type: 'boolean' },
  'salaries-only': { type: 'boolean' },
} });
const salariesOnly = !!a['salaries-only'];
if (!a.ctc || !a.register || !a.admin || (!salariesOnly && (!a.password || !a.yes))) {
  console.error('Usage: npm run import:razorpay -- --ctc <Master CTC Report.xlsx> --register <HR Register.csv> --admin <email> --password <default> [--managers a@x.com,b@y.com] --yes\n--yes confirms that ALL existing company data is deleted.');
  process.exit(1);
}
const file = (p: string) => resolve(process.env.INIT_CWD ?? process.cwd(), p);

/* ---------- read the two exports ---------- */
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(file(a.ctc));
const ws = wb.worksheets[0];
const head = Array.from(ws.getRow(1).values as unknown[], (v) => String(v ?? '').trim()); // exceljs rows are sparse, 1-based
const ctcRows: Record<string, unknown>[] = [];
const cellValue = (v: unknown): unknown => (v && typeof v === 'object' && !(v instanceof Date) ? ((v as any).text ?? (v as any).result ?? (v as any).richText?.map((t: any) => t.text).join('')) : v);
ws.eachRow((r, i) => { if (i > 1) ctcRows.push(Object.fromEntries(head.map((h, c) => [h, cellValue((r.values as unknown[])[c])]))); });
const active = ctcRows.filter((r) => r['Status'] === 'Active' && r['Email ID']);

// Small CSV parser (quoted fields, commas inside quotes). RazorpayX prefixes numbers with ' to keep Excel from mangling them.
function parseCsv(text: string) {
  const out: string[][] = []; let row: string[] = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); out.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur || row.length) { row.push(cur); out.push(row); }
  return out;
}
const csv = parseCsv(readFileSync(file(a.register), 'utf8').replace(/^﻿/, ''));
const reg = new Map(csv.slice(1).map((r) => [String(r[csv[0].indexOf('Email')] ?? '').trim().toLowerCase(), Object.fromEntries(csv[0].map((h, i) => [h, (r[i] ?? '').replace(/^'/, '').trim()]))]));

/* ---------- RazorpayX salary components → monthly lines (CTC = their total, employer PF on top) ---------- */
const COMPONENTS: [string, string, string[], boolean][] = [ // code, name, sheet columns, PF wage (everything except HRA, as on Valencia payslips)
  ['BASIC', 'Basic', ['Basic Salary (Annual)', 'Basic (Annual)'], true],
  ['DA', 'Dearness Allowance', ['DA (Annual)', 'Dearness Allowance (Annual)'], true],
  ['HRA', 'House Rent Allowance', ['HRA (Annual)', 'House Rent Allowance (Annual)'], false],
  ['SPECIAL', 'Special Allowance', ['Special Allowance (Annual)'], true],
  ['LTA', 'Leave & Travel Allowance', ['Leave & Travel Allowance (Annual)', 'LTA (Annual)'], true],
  ['TRAVEL', 'Travel Allowance', ['Travel Allowance (Annual)'], true],
  ['STIPEND', 'Stipend', ['Stiphend (Annual)', 'Stiphend (Non-Taxable) (Annual)'], true],
];
const componentsOf = (r: Record<string, unknown>) => COMPONENTS
  .map(([code, name, cols, isWage]) => ({ code, name, isWage, monthly: Math.round((cols.reduce((t, c) => t + (Number(r[c]) || 0), 0) / 12) * 100) / 100 }))
  .filter((c) => c.monthly > 0);

/* ---------- wipe and set up the company (skipped with --salaries-only) ---------- */
await migrateDb();
if (!salariesOnly) {
  const keep = ['statutory_rule', 'tax_rule'];
  const tables = ((await db.execute(sql`select tablename from pg_tables where schemaname = 'public'`)) as unknown as { rows: { tablename: string }[] }).rows
    .map((r) => r.tablename).filter((t) => !keep.includes(t));
  await db.execute(sql.raw(`truncate ${tables.map((t) => `"${t}"`).join(', ')} cascade`));
  await seedRules();
  await createCompany(a.company!, a.admin, `Tmp-${Date.now()}aA9`);
}
const [admin] = await db.select().from(schema.users).where(eq(schema.users.email, a.admin.toLowerCase()));
if (!admin) { console.error(`No login ${a.admin}`); process.exit(1); }
const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, admin.companyId));
await db.update(schema.companies).set({ esiEnabled: false }).where(eq(schema.companies.id, company.id)); // RazorpayX: ESIC "Company Disabled"
const [branch] = salariesOnly ? await db.select().from(schema.branches).where(eq(schema.branches.companyId, company.id))
  : await db.insert(schema.branches).values({ companyId: company.id, name: 'Mumbai', state: 'MH', city: 'Mumbai', metro: true }).returning();

/* ---------- through the app's own API (same validation, salary split and audit as the UI) ---------- */
const adminWasFlagged = admin.mustChangePassword;
if (adminWasFlagged) await db.update(schema.users).set({ mustChangePassword: false }).where(eq(schema.users.id, admin.id)); // restored below
const token = signAccess({ sub: admin.id, cid: company.id, roles: admin.roles, eid: admin.employeeId, ver: admin.tokenVersion });
const api = (m: 'post' | 'get', u: string, b?: object) => request(app)[m](`/api/v1${u}`).set('Authorization', `Bearer ${token}`).send(b);

if (salariesOnly) {
  const S = schema.salaryStructures, E = schema.employees;
  const R = schema.payrollRuns;
  const runs = await db.select().from(R).where(eq(R.companyId, company.id));
  if (runs.some((r) => r.status === 'FINALISED')) {
    console.error('An approved payroll run exists: change salaries with a revision in People instead (or reopen the run first).'); process.exit(1);
  }
  // Draft payslips are only a preview: drop them now and recalculate the runs once salaries are rebuilt.
  await db.delete(schema.payslips).where(eq(schema.payslips.companyId, company.id));
  const notes: string[] = []; let done = 0;
  for (const r of active) {
    const [e] = await db.select().from(E).where(and(eq(E.companyId, company.id), eq(E.workEmail, String(r['Email ID']).trim().toLowerCase())));
    const components = componentsOf(r);
    if (!e) { notes.push(`${r['Employee Name']}: not in PayrollPro`); continue; }
    await db.delete(S).where(eq(S.employeeId, e.id));
    if (!components.length) { notes.push(`${e.code} ${r['Employee Name']}: no salary in the sheet`); continue; }
    const res = await api('post', `/employees/${e.id}/salary-revisions`, { components, effectiveFrom: e.doj });
    if (res.status !== 201) notes.push(`${e.code} ${r['Employee Name']}: ${res.body.message}`); else done++;
  }
  for (const run of runs.filter((r) => r.status !== 'DRAFT')) {
    const res = await api('post', `/payroll-runs/${run.id}/calculate`, {});
    notes.push(res.status === 200 ? `Payroll ${run.month} recalculated: net ₹${res.body.totals?.net}` : `Payroll ${run.month}: ${res.body.message} (calculate it again in the app)`);
  }
  if (adminWasFlagged) await db.update(schema.users).set({ mustChangePassword: true }).where(eq(schema.users.id, admin.id));
  console.log(`\nSalaries rebuilt from the Master CTC Report for ${done} employees. ESI turned off (company not registered).`);
  if (notes.length) console.log(`\nCheck these:\n  ${notes.join('\n  ')}`);
  await closeDb();
  process.exit(0);
}

const titles = [...new Set(active.map((r) => tidyTitle(r['Title'])).filter(Boolean))] as string[];
const desig = new Map<string, string>();
for (const t of titles) desig.set(t, (await api('post', '/designations', { name: t })).body.id);

function tidyTitle(t: unknown) { const s = String(t ?? '').trim(); return s ? s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : null; }
const titleCase = (s: string) => (s === s.toUpperCase() ? s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : s);
const dmy = (s?: string) => { const m = s?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
const iso = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10));

const used = new Set<string>(); let next = Math.max(0, ...active.map((r) => Number(r['Employee ID']) || 0)) + 1;
const codeFor = (id: unknown) => { const c = Number(id) && !used.has(`EMP${String(id).padStart(4, '0')}`) ? `EMP${String(id).padStart(4, '0')}` : `EMP${String(next++).padStart(4, '0')}`; used.add(c); return c; };

const report: string[] = []; const created: { id: string; email: string }[] = [];
for (const r of active) {
  const email = String(r['Email ID']).trim().toLowerCase();
  const g = reg.get(email) ?? {};
  const parts = titleCase(String(r['Employee Name']).trim()).split(/\s+/);
  const name = { firstName: parts[0], lastName: parts.length > 1 ? parts.at(-1)! : '.', middleName: parts.slice(1, -1).join(' ') || null };
  const title = tidyTitle(r['Title']);
  const ctc = Number(r['CTC (Annual)']) || 0;
  const pan = /^[A-Z]{5}\d{4}[A-Z]$/.test(g['PAN']?.toUpperCase() ?? '') ? g['PAN'].toUpperCase() : null;
  const acct = (g['Bank Account Number'] ?? '').replace(/\D/g, '');
  const ifsc = (g['Bank IFSC'] ?? '').toUpperCase();
  const bank = /^\d{6,18}$/.test(acct) && /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc) ? { holder: parts.join(' '), account: acct, ifsc } : null;
  const phone = (g['Phone'] ?? '').replace(/[^\d+]/g, '');
  const body = {
    code: codeFor(r['Employee ID']), ...name, workEmail: email, gender: ({ m: 'M', f: 'F' } as Record<string, 'M' | 'F'>)[g['Gender'] ?? ''] ?? 'M',
    dob: dmy(g['Date of Birth']), mobile: /^\+?\d{10,13}$/.test(phone) ? phone : null, doj: iso(r['Date of Joining']),
    employmentType: /intern/i.test(title ?? '') ? 'intern' : 'permanent', noticeDays: 30, branchId: branch.id, designationId: title ? desig.get(title) : null,
    pan, bank, aadhaar: /^\d{12}$/.test(g['Aadhaar Number'] ?? '') ? g['Aadhaar Number'] : null, uan: /^\d{12}$/.test(g['UAN'] ?? '') ? g['UAN'] : null,
    pfOptOut: g['PF Status'] !== 'Enabled', international: false, taxRegime: 'new', metro: true,
    ...(componentsOf(r).length ? { components: componentsOf(r) } : {}),
  };
  if (!body.doj) { report.push(`NOT ADDED  ${r['Employee Name']}: no joining date in the sheet`); continue; }
  const res = await api('post', '/employees', body);
  if (res.status !== 201) { report.push(`NOT ADDED  ${r['Employee Name']}: ${res.body.message} ${JSON.stringify(res.body.details ?? '')}`); continue; }
  created.push({ id: res.body.id, email });
  const notes = [
    !g['Gender'] && 'gender missing (set to Male)', ctc <= 0 && 'no salary in the sheet', !pan && 'no PAN', !bank && 'no bank details',
    String(body.code) !== `EMP${String(r['Employee ID']).padStart(4, '0')}` && `code ${body.code} (RazorpayX ID ${r['Employee ID'] ?? 'blank'} was missing or repeated)`,
    Number(r['Stiphend (Annual)']) && 'salary is a stipend: PF is deducted on it like other pay, check with RazorpayX',
  ].filter(Boolean);
  if (notes.length) report.push(`${body.code}  ${parts.join(' ')}: ${notes.join('; ')}`);
}

/* ---------- logins with the default password ---------- */
const managers = a.managers!.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
for (const c of created) {
  await db.insert(schema.users).values({ companyId: company.id, email: c.email, employeeId: c.id, passwordHash: await hashPassword(a.password!),
    roles: managers.includes(c.email) ? ['EMPLOYEE', 'PAYROLL_MANAGER'] : ['EMPLOYEE'], mustChangePassword: true });
}
await db.update(schema.users).set({ passwordHash: await hashPassword(a.password!), mustChangePassword: true, tokenVersion: sql`${schema.users.tokenVersion} + 1` })
  .where(eq(schema.users.email, a.admin.toLowerCase()));
await db.delete(schema.refreshTokens).where(inArray(schema.refreshTokens.userId, db.select({ id: schema.users.id }).from(schema.users)));

console.log(`\nDeleted old data. ${company.name}: ${created.length} of ${active.length} active employees added, each with a login.`);
console.log(`Admin login: ${a.admin}. Everyone signs in with the default password and must set their own first.`);
if (report.length) console.log(`\nCheck these:\n  ${report.join('\n  ')}`);
await closeDb();
process.exit(0);
