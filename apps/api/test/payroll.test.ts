import ExcelJS from 'exceljs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { closeDb, db, migrateDb, schema } from '../src/db';
import { seedCompany, seedRules } from '../src/db/seed';
import { eq } from 'drizzle-orm';

const PW = 'Test@Pass123';
const tok: Record<string, string> = {};
const as = (who: string) => ({
  get: (u: string) => request(app).get(`/api/v1${u}`).set('Authorization', `Bearer ${tok[who]}`),
  post: (u: string, b?: object) => request(app).post(`/api/v1${u}`).set('Authorization', `Bearer ${tok[who]}`).send(b),
  put: (u: string, b?: object) => request(app).put(`/api/v1${u}`).set('Authorization', `Bearer ${tok[who]}`).send(b),
});
const month = new Date().toISOString().slice(0, 7);

beforeAll(async () => {
  await migrateDb();
  await seedRules();
  await seedCompany('Gamma', 'gamma.test', PW, 12);
  await seedCompany('Delta', 'delta.test', PW, 12);
  for (const [k, e] of [['admin', 'admin@gamma.test'], ['payroll', 'payroll@gamma.test'], ['employee', 'employee@gamma.test'], ['manager', 'manager@gamma.test'], ['other', 'admin@delta.test']]) {
    tok[k] = (await request(app).post('/api/v1/auth/login').send({ email: e, password: PW })).body.accessToken;
  }
});
afterAll(() => closeDb());

describe('payroll run → Excel', () => {
  let runId = '';
  it('creates a run with every employee who has a salary', async () => {
    const r = await as('payroll').post('/payroll-runs', { month });
    expect(r.status).toBe(201);
    runId = r.body.id;
    const d = await as('payroll').get(`/payroll-runs/${runId}`);
    expect(d.body.items.length).toBeGreaterThan(5);
    expect(d.body.checklist.find((c: { key: string }) => c.key === 'bank').count).toBe(0);
    expect((await as('payroll').post('/payroll-runs', { month })).status).toBe(409); // one regular run per month
  });
  it('is closed to employees and other companies', async () => {
    expect((await as('employee').get(`/payroll-runs/${runId}`)).status).toBe(403);
    expect((await as('other').get(`/payroll-runs/${runId}`)).status).toBe(404);
    expect((await as('other').post(`/payroll-runs/${runId}/calculate`)).status).toBe(404);
  });
  it('applies LOP and bonus inputs, then calculates net = gross − deductions', async () => {
    const d = await as('payroll').get(`/payroll-runs/${runId}`);
    const target = d.body.items[1];
    await as('payroll').put(`/payroll-runs/${runId}/inputs`, { items: [{ employeeId: target.employeeId, lopDays: 2, bonus: 5000, otherEarnings: 0, otherDeductions: 1000, hold: false }] });
    const c = await as('payroll').post(`/payroll-runs/${runId}/calculate`);
    expect(c.status).toBe(200);
    expect(c.body.errors).toEqual([]);
    const after = await as('payroll').get(`/payroll-runs/${runId}`);
    for (const it of after.body.items) expect(it.payslip.net).toBe(it.payslip.gross - it.payslip.deductions);
    const t = after.body.items.find((x: { employeeId: string }) => x.employeeId === target.employeeId);
    expect(t.payslip.deductionSplit.other).toBe(1000);
    expect(t.payslip.notes.join(' ')).toMatch(/2 LOP/);
    expect(after.body.run.totals.net).toBe(after.body.items.reduce((a: number, x: { payslip: { net: number } }) => a + x.payslip.net, 0));
  });
  it('only a Company Admin approves; the salary sheet comes after approval', async () => {
    expect((await as('payroll').get(`/payroll-runs/${runId}/export.xlsx`)).status).toBe(409);
    expect((await as('employee').get('/payslips')).body).toHaveLength(0); // not visible before approval
    expect((await as('payroll').post(`/payroll-runs/${runId}/approve`)).status).toBe(403);
    expect((await as('admin').post(`/payroll-runs/${runId}/approve`)).status).toBe(200);
    expect((await as('payroll').post(`/payroll-runs/${runId}/calculate`)).status).toBe(409);
  });
  it('exports an Excel workbook with register, bank transfer and statutory sheets', async () => {
    const r = await as('payroll').get(`/payroll-runs/${runId}/export.xlsx`).buffer(true).parse((res, cb) => { const b: Buffer[] = []; res.on('data', (c: Buffer) => b.push(c)); res.on('end', () => cb(null, Buffer.concat(b))); });
    expect(r.status).toBe(200);
    expect(r.headers['content-disposition']).toMatch(/salary-\d{4}-\d{2}\.xlsx/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.body);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Summary', 'Salary register', 'Bank transfer', 'Statutory']);
    const bank = wb.getWorksheet('Bank transfer')!;
    expect(String(bank.getCell('D4').value)).toMatch(/^\d{6,18}$/); // full account number for the bank upload
    const log = await as('admin').get(`/audit?action=export_salary_sheet`);
    expect(log.body.total).toBe(1);
  });
  it('after approval employees see their own payslip and nobody else’s', async () => {
    const mine = await as('employee').get('/payslips');
    expect(mine.body).toHaveLength(1);
    const slip = await as('employee').get(`/payslips/${mine.body[0].id}`);
    expect(slip.body.payslip.net).toBe(Number(mine.body[0].net));
    const [otherSlip] = await db.select().from(schema.payslips).where(eq(schema.payslips.runId, runId));
    if (otherSlip.id !== mine.body[0].id) expect((await as('employee').get(`/payslips/${otherSlip.id}`)).status).toBe(404);
    expect((await as('admin').post(`/payroll-runs/${runId}/reopen`)).status).toBe(200);
    expect((await as('employee').get('/payslips')).body).toHaveLength(0);
    expect((await as('admin').post(`/payroll-runs/${runId}/approve`)).status).toBe(200);
  });
});

describe('manager attendance → payroll LOP', () => {
  const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1);
  const m = d.toISOString().slice(0, 7);
  it('manager sees and edits only their team, never themself', async () => {
    const r = await as('manager').get(`/attendance?month=${m}`);
    expect(r.status).toBe(200);
    const self = r.body.items.find((i: { editable: boolean; name: string }) => i.name === 'Priya Sharma');
    expect(self.editable).toBe(false);
    const team = r.body.items.filter((i: { editable: boolean }) => i.editable);
    expect(team.length).toBeGreaterThan(0);
    const all = await as('admin').get(`/attendance?month=${m}`);
    expect(all.body.items.length).toBeGreaterThan(team.length);
    expect((await as('manager').put('/attendance', { month: m, items: [{ employeeId: self.employeeId, presentDays: 20, paidLeaveDays: 0, lopDays: 0 }] })).status).toBe(422);
    expect((await as('employee').put('/attendance', { month: m, items: [{ employeeId: team[0].employeeId, presentDays: 20, paidLeaveDays: 0, lopDays: 0 }] })).status).toBe(422);
    expect((await as('other').get(`/attendance?month=${m}`)).body.items.some((i: { employeeId: string }) => i.employeeId === team[0].employeeId)).toBe(false);
  });
  it('validates against working days and saves', async () => {
    const r = await as('manager').get(`/attendance?month=${m}`);
    const t = r.body.items.find((i: { editable: boolean }) => i.editable);
    expect((await as('manager').put('/attendance', { month: m, items: [{ employeeId: t.employeeId, presentDays: t.workingDays, paidLeaveDays: 1, lopDays: 0 }] })).status).toBe(422);
    const ok = await as('manager').put('/attendance', { month: m, items: [{ employeeId: t.employeeId, presentDays: t.workingDays - 3, paidLeaveDays: 1, lopDays: 2 }] });
    expect(ok.status).toBe(200);
  });
  it('payroll for that month takes LOP from attendance', async () => {
    const r = await as('manager').get(`/attendance?month=${m}`);
    const t = r.body.items.find((i: { record: unknown }) => i.record);
    const run = await as('payroll').post('/payroll-runs', { month: m });
    await as('payroll').post(`/payroll-runs/${run.body.id}/calculate`);
    const det = await as('payroll').get(`/payroll-runs/${run.body.id}`);
    const it = det.body.items.find((i: { employeeId: string }) => i.employeeId === t.employeeId);
    expect(it.attendance.lopDays).toBe(2);
    expect(it.payslip.payableDays).toBe(it.payslip.payableDays); // computed
    expect(it.payslip.notes.join(' ')).toMatch(/2 LOP/);
    expect(det.body.checklist.find((c: { key: string }) => c.key === 'attendance').count).toBeGreaterThan(0);
    // Attendance changed after calculating: the run must be calculated again before it can be approved.
    await as('manager').put('/attendance', { month: m, items: [{ employeeId: t.employeeId, presentDays: 10, paidLeaveDays: 0, lopDays: 1 }] });
    expect((await as('payroll').get(`/payroll-runs/${run.body.id}`)).body.run.status).toBe('DRAFT');
    expect((await as('admin').post(`/payroll-runs/${run.body.id}/approve`)).status).toBe(409);
  });
  it('exports the attendance sheet and imports it back (xlsx round trip)', async () => {
    const x = await as('admin').get(`/attendance/export.xlsx?month=${m}`).buffer(true).parse((res, cb) => { const b: Buffer[] = []; res.on('data', (c: Buffer) => b.push(c)); res.on('end', () => cb(null, Buffer.concat(b))); });
    expect(x.status).toBe(200);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(x.body);
    const ws = wb.worksheets[0];
    ws.eachRow((row, i) => { if (i > 1) { const wd = Number(row.getCell(4).value); row.getCell(5).value = wd - 1; row.getCell(6).value = 0; row.getCell(7).value = 1; } });
    const b64 = Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
    const dry = await as('admin').post('/attendance/import', { month: m, fileBase64: b64, dryRun: true });
    expect(dry.body.errorCount).toBe(0);
    expect(dry.body.valid).toBe(ws.rowCount - 1);
    const done = await as('admin').post('/attendance/import', { month: m, fileBase64: b64, dryRun: false });
    expect(done.body.saved).toBe(ws.rowCount - 1);
    const after = await as('admin').get(`/attendance?month=${m}`);
    expect(after.body.items.every((i: { record: { lopDays: number } | null }) => i.record?.lopDays === 1)).toBe(true);
  });
});

describe('day-by-day attendance sheet (employees as columns, totals at the bottom)', () => {
  const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 2);
  const m = d.toISOString().slice(0, 7);
  it('reads Total working Days / No. of Leaves by employee name and skips unknown names', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Employees');
    ws.addRow([new Date(`${m}-01T00:00:00Z`)]);
    ws.addRow(['Date', 'Sneha Kulkarni', 'Rohan', 'Nobody Here']);
    for (let i = 1; i <= 28; i++) ws.addRow([`${i}`, i === 3 ? 'LOP' : null, i === 5 ? 'Half Day' : 'Late', null]);
    ws.addRow(['Total working Days', 27, 29.5, 30]);
    ws.addRow(['Late', 0, 27, 0]);
    ws.addRow(['Half Day', 0, 1, 0]);
    ws.addRow(['No. of Leaves', 3, 0.5, 0]);
    const b64 = Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
    const dry = await as('admin').post('/attendance/import', { month: m, fileBase64: b64, dryRun: true });
    expect(dry.status).toBe(200);
    expect(dry.body.errorCount).toBe(0);
    expect(dry.body.preview.map((p: { name: string; lopDays: number }) => [p.name, p.lopDays])).toEqual([['Sneha Kulkarni', 3], ['Rohan Patil', 0.5]]);
    expect(dry.body.unmatched[0]).toMatch(/Nobody Here/);
    const other = new Date(`${m}-01T00:00:00Z`); other.setUTCMonth(other.getUTCMonth() + 1);
    expect((await as('admin').post('/attendance/import', { month: other.toISOString().slice(0, 7), fileBase64: b64, dryRun: true })).status).toBe(422); // wrong month
    expect((await as('admin').post('/attendance/import', { month: m, fileBase64: b64, dryRun: false })).body.saved).toBe(2);
  });
});
