import { sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { closeDb, db, embedded, migrateDb } from '../src/db';
import { seedCompany, seedRules } from '../src/db/seed';

const PW = 'Test@Pass123';
let A: Awaited<ReturnType<typeof seedCompany>>;
const tokens: Record<string, string> = {};
const login = async (email: string, password = PW) => request(app).post('/api/v1/auth/login').send({ email, password });
const as = (who: string) => ({
  get: (u: string) => request(app).get(`/api/v1${u}`).set('Authorization', `Bearer ${tokens[who]}`),
  post: (u: string, b?: object) => request(app).post(`/api/v1${u}`).set('Authorization', `Bearer ${tokens[who]}`).send(b),
  put: (u: string, b?: object) => request(app).put(`/api/v1${u}`).set('Authorization', `Bearer ${tokens[who]}`).send(b),
});

beforeAll(async () => {
  if (!embedded) {
    await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
    await db.execute(sql`CREATE SCHEMA public`);
    await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  }
  await migrateDb();
  await seedRules();
  A = await seedCompany('Alpha', 'alpha.test', PW, 12);
  await seedCompany('Beta', 'beta.test', PW, 12);
  for (const [k, e] of [['admin', 'admin@alpha.test'], ['payroll', 'payroll@alpha.test'], ['manager', 'manager@alpha.test'], ['employee', 'employee@alpha.test'], ['betaAdmin', 'admin@beta.test']]) {
    const r = await login(e);
    expect(r.status).toBe(200);
    tokens[k] = r.body.accessToken;
  }
});
afterAll(() => closeDb());

describe('authentication', () => {
  it('rejects bad passwords with a generic message and locks after 5 attempts', async () => {
    for (let i = 0; i < 5; i++) {
      const r = await login('payroll@beta.test', 'wrong-password');
      expect(r.status).toBe(401);
      expect(r.body.message).toBe('Invalid email or password');
    }
    const locked = await login('payroll@beta.test');
    expect(locked.status).toBe(423);
  });
  it('unknown email gets the same response as a wrong password', async () => {
    const r = await login('nobody@alpha.test');
    expect(r.status).toBe(401);
    expect(r.body.message).toBe('Invalid email or password');
  });
  it('rejects missing, forged and tampered tokens', async () => {
    expect((await request(app).get('/api/v1/employees')).status).toBe(401);
    const forged = tokens.employee.slice(0, -4) + 'abcd';
    expect((await request(app).get('/api/v1/employees').set('Authorization', `Bearer ${forged}`)).status).toBe(401);
  });
  it('rotates refresh tokens and revokes the family on reuse', async () => {
    const r = await login('employee@alpha.test');
    const cookie = r.headers['set-cookie'][0].split(';')[0];
    expect(r.headers['set-cookie'][0]).toMatch(/HttpOnly/);
    expect(r.headers['set-cookie'][0]).toMatch(/SameSite=Strict/);
    // CSRF header is mandatory
    expect((await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie)).status).toBe(403);
    const r1 = await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie).set('X-Requested-With', 'payrollpro');
    expect(r1.status).toBe(200);
    const cookie2 = r1.headers['set-cookie'][0].split(';')[0];
    // replay the old token → whole family revoked, including the new one
    expect((await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie).set('X-Requested-With', 'payrollpro')).status).toBe(401);
    expect((await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie2).set('X-Requested-With', 'payrollpro')).status).toBe(401);
  });
});

describe('tenant isolation and roles', () => {
  it('another company cannot read, list or edit this company’s employees', async () => {
    const id = A.employeeIds[2];
    expect((await as('betaAdmin').get(`/employees/${id}`)).status).toBe(404);
    expect((await as('betaAdmin').get(`/employees/${id}/sensitive`)).status).toBe(404);
    expect((await as('betaAdmin').put(`/employees/${id}`, { firstName: 'Hacked' })).status).toBe(404);
    const list = await as('betaAdmin').get('/employees?limit=200');
    expect(list.body.items.every((e: { workEmail: string }) => e.workEmail.endsWith('beta.test'))).toBe(true);
  });
  it('companyId in the body is ignored', async () => {
    const r = await as('betaAdmin').post('/departments', { name: 'Injected', companyId: A.companyId });
    expect(r.status).toBe(201);
    const alpha = await as('admin').get('/departments');
    expect(alpha.body.some((d: { name: string }) => d.name === 'Injected')).toBe(false);
  });
  it('employee sees only themself and no admin areas', async () => {
    const list = await as('employee').get('/employees');
    expect(list.body.items).toHaveLength(1);
    expect((await as('employee').get(`/employees/${A.employeeIds[4]}`)).status).toBe(403);
    expect((await as('employee').get('/audit')).status).toBe(403);
    expect((await as('employee').post('/employees', {})).status).toBe(403);
    expect((await as('employee').get(`/employees/${A.employeeIds[3]}/salary-structures`)).status).toBe(200);
  });
  it('manager sees team without PAN, bank or salary', async () => {
    const r = await as('manager').get(`/employees/${A.employeeIds[3]}`);
    expect(r.status).toBe(200);
    expect(r.body.pan).toBeUndefined();
    expect(r.body.bank).toBeUndefined();
    expect((await as('manager').get(`/employees/${A.employeeIds[3]}/sensitive`)).status).toBe(403);
    expect((await as('manager').get(`/employees/${A.employeeIds[3]}/salary-structures`)).status).toBe(403);
  });
  it('payroll manager can edit pay fields only', async () => {
    const id = A.employeeIds[5];
    await as('payroll').put(`/employees/${id}`, { firstName: 'Changed', taxRegime: 'old' });
    const r = await as('admin').get(`/employees/${id}`);
    expect(r.body.firstName).not.toBe('Changed');
    expect(r.body.taxRegime).toBe('old');
  });
});

describe('sensitive data', () => {
  it('stores PAN encrypted, shows it masked, reveals only on audited request', async () => {
    const id = A.employeeIds[2];
    const raw = await db.execute<{ pan_enc: string }>(sql`SELECT pan_enc FROM employee WHERE id = ${id}`);
    expect(raw.rows[0].pan_enc).toMatch(/^v1\./);
    expect(raw.rows[0].pan_enc).not.toMatch(/[A-Z]{5}\d{4}[A-Z]/);
    expect((await as('admin').get(`/employees/${id}`)).body.pan).toMatch(/^••••••/);
    const s = await as('admin').get(`/employees/${id}/sensitive`);
    expect(s.body.pan).toMatch(/^[A-Z]{5}\d{4}[A-Z]$/);
    const log = await as('admin').get(`/audit?entity=employee&id=${id}&action=view_sensitive`);
    expect(log.body.total).toBeGreaterThan(0);
  });
  it('audit log is append-only at the database level', async () => {
    await expect(db.execute(sql`UPDATE audit_log SET action = 'x'`)).rejects.toThrow(/append-only/);
    await expect(db.execute(sql`DELETE FROM audit_log`)).rejects.toThrow(/append-only/);
  });
  it('validates input at the boundary', async () => {
    const r = await as('admin').post('/employees', { firstName: 'X', lastName: 'Y', workEmail: 'bad', gender: 'M', doj: '2026-01-01', pan: 'NOTAPAN' });
    expect(r.status).toBe(422);
    expect(r.body.details.map((d: { path: string }) => d.path)).toEqual(expect.arrayContaining(['workEmail', 'pan']));
  });
});

describe('leave flow', () => {
  it('apply → manager approves → ledger debit; no self-approval; cancel reverses', async () => {
    const types = (await as('employee').get('/leave/balances')).body;
    const el = types.find((t: { code: string }) => t.code === 'EL');
    const from = new Date(Date.now() + 40 * 864e5);
    while (from.getUTCDay() !== 2) from.setUTCDate(from.getUTCDate() + 1); // a Tuesday
    const f = from.toISOString().slice(0, 10);
    const to = new Date(from.getTime() + 864e5).toISOString().slice(0, 10);
    const calc = await as('employee').post('/leave/calculate', { leaveTypeId: el.leaveTypeId, from: f, to });
    expect(calc.body.counted).toBe(2);
    const reqd = await as('employee').post('/leave/requests', { leaveTypeId: el.leaveTypeId, from: f, to, reason: 'test' });
    expect(reqd.status).toBe(201);
    expect((await as('employee').put(`/leave/requests/${reqd.body.id}/decision`, { approve: true })).status).toBe(403);
    expect((await as('betaAdmin').put(`/leave/requests/${reqd.body.id}/decision`, { approve: true })).status).toBe(404);
    expect((await as('manager').put(`/leave/requests/${reqd.body.id}/decision`, { approve: true })).status).toBe(200);
    const after = (await as('employee').get('/leave/balances')).body.find((t: { code: string }) => t.code === 'EL');
    expect(after.balance).toBe(el.balance - 2);
    await as('employee').post(`/leave/requests/${reqd.body.id}/cancel`);
    const back = (await as('employee').get('/leave/balances')).body.find((t: { code: string }) => t.code === 'EL');
    expect(back.balance).toBe(el.balance);
  });
});
