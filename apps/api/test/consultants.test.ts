import ExcelJS from 'exceljs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { closeDb, migrateDb } from '../src/db';
import { seedCompany, seedRules } from '../src/db/seed';

const PW = 'Test@Pass123';
const tok: Record<string, string> = {};
const as = (who: string) => ({
  get: (u: string) => request(app).get(`/api/v1${u}`).set('Authorization', `Bearer ${tok[who]}`),
  post: (u: string, b?: object) => request(app).post(`/api/v1${u}`).set('Authorization', `Bearer ${tok[who]}`).send(b),
});
const month = '2026-09';

beforeAll(async () => {
  await migrateDb(); await seedRules();
  await seedCompany('Kappa', 'kappa.test', PW, 12);
  await seedCompany('Lambda', 'lambda.test', PW, 12);
  for (const [k, e] of [['admin', 'admin@kappa.test'], ['payroll', 'payroll@kappa.test'], ['employee', 'employee@kappa.test'], ['other', 'admin@lambda.test']]) {
    tok[k] = (await request(app).post('/api/v1/auth/login').send({ email: e, password: PW })).body.accessToken;
  }
});
afterAll(() => closeDb());

describe('consultants', () => {
  let a = '', b = '';
  it('adds consultants with masked PAN and bank', async () => {
    const r = await as('payroll').post('/consultants', { name: 'Neha Consultant', pan: 'abcpn1234k', bank: { account: '001234567890', ifsc: 'hdfc0001234' }, monthlyFee: 60000, startDate: '2026-04-01' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ panLast4: '234K', bankLast4: '7890', tdsRate: 0.1 });
    expect(JSON.stringify(r.body)).not.toMatch(/ABCPN1234K|001234567890/);
    a = r.body.id;
    b = (await as('payroll').post('/consultants', { name: 'Small Fee', monthlyFee: 3000, startDate: '2026-04-01' })).body.id; // no PAN, under ₹50k a year
    expect((await as('employee').get('/consultants')).status).toBe(403);
    expect((await as('other').get('/consultants')).body).toHaveLength(0);
  });
  it('reads LOP from the attendance sheet by name', async () => {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Employees');
    ws.addRow([new Date('2026-09-01T00:00:00Z')]); ws.addRow(['Date', 'Neha Consultant']);
    ws.addRow(['Total working Days', 27]); ws.addRow(['No. of Leaves', 3]);
    const r = await as('payroll').post(`/consultant-runs/${month}/import`, { fileBase64: Buffer.from(await wb.xlsx.writeBuffer()).toString('base64') });
    expect(r.body.found).toEqual([{ consultantId: a, name: 'Neha Consultant', lopDays: 3 }]);
    expect(r.body.notInSheet).toEqual(['Small Fee']);
  });
  it('fee cut for LOP; 10% TDS; no TDS under ₹50,000 a year', async () => {
    const r = await as('payroll').post(`/consultant-runs/${month}/calculate`, { items: [{ consultantId: a, lopDays: 3, adjustment: 0 }, { consultantId: b, lopDays: 0, adjustment: 0 }] });
    expect(r.status).toBe(200);
    const d = await as('payroll').get(`/consultant-runs/${month}`);
    const neha = d.body.items.find((i: { id: string }) => i.id === a), small = d.body.items.find((i: { id: string }) => i.id === b);
    expect(neha).toMatchObject({ amount: 54000, tds: 5400, net: 48600 }); // 60,000 × 27/30
    expect(small).toMatchObject({ amount: 3000, tds: 0, net: 3000 });
  });
  it('only a Company Admin approves; the sheet comes after approval', async () => {
    expect((await as('payroll').get(`/consultant-runs/${month}/export.xlsx`)).status).toBe(409);
    expect((await as('payroll').post(`/consultant-runs/${month}/approve`)).status).toBe(403);
    expect((await as('admin').post(`/consultant-runs/${month}/approve`)).status).toBe(200);
    expect((await as('payroll').post(`/consultant-runs/${month}/calculate`, { items: [] })).status).toBe(409);
    const x = await as('payroll').get(`/consultant-runs/${month}/export.xlsx`).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(x.status).toBe(200);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(x.body);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Consultant payments', 'Bank transfer', 'TDS']);
    expect(String(wb.getWorksheet('Bank transfer')!.getCell('C4').value)).toBe('001234567890');
  });
});
