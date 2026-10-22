/** Seeds statutory/tax rules and a demo company. Usage: npm run db:seed  (SEED_PASSWORD overrides the demo password). */
import 'dotenv/config';
import { STATUTORY_RULES, TAX_RULES } from '@payrollpro/engines';
import { eq } from 'drizzle-orm';
import { hashPassword } from '../lib/auth';
import { encrypt, encryptJson } from '../lib/crypto';
import { createRevision, creditJoinerLeave } from '../routes/employees';
import { closeDb, db, schema } from './index';

/** Migrate, then seed rules and (if the database is empty) the demo company. Used by `npm run dev` on first start. */
export async function ensureSeeded(password: string) {
  await seedRules();
  const [existing] = await db.select({ id: schema.companies.id }).from(schema.companies).limit(1);
  if (existing) return false;
  await seedCompany('Valencia Nutrition (Demo)', 'demo.test', password);
  return true;
}

export async function seedRules() {
  for (const r of STATUTORY_RULES) {
    await db.insert(schema.statutoryRules).values({ ruleKey: r.id, ruleType: r.ruleType, state: r.state, effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo, params: r.params, sourceNote: r.sourceNote }).onConflictDoNothing();
  }
  for (const t of TAX_RULES) await db.insert(schema.taxRules).values({ taxYear: t.taxYear, regime: t.regime, ageBand: t.ageBand, data: t }).onConflictDoNothing();
}

export async function seedCompany(name: string, emailDomain: string, password: string, size = 24) {
  if (size < 12) throw new Error('seedCompany needs at least 12 employees');
  const [c] = await db.insert(schema.companies).values({ name, legalName: `${name} Private Limited`, pan: 'AABCV1234F', tan: 'MUMV12345A', address: 'Andheri East, Mumbai 400069', payDay: 1, cutoffDay: 25 }).returning();
  const cid = c.id;
  const [ent] = await db.insert(schema.entities).values({ companyId: cid, name: `${name} Pvt Ltd`, pan: 'AABCV1234F', tan: 'MUMV12345A', pfCode: 'MHBAN0012345000', esiCode: '31000123450000999' }).returning();
  const brs = await db.insert(schema.branches).values([
    { companyId: cid, entityId: ent.id, name: 'Mumbai HQ', state: 'MH', city: 'Mumbai', metro: true },
    { companyId: cid, entityId: ent.id, name: 'Pune Plant', state: 'MH', city: 'Pune', metro: false },
    { companyId: cid, entityId: ent.id, name: 'Bengaluru', state: 'KA', city: 'Bengaluru', metro: false },
  ]).returning();
  const deps = await db.insert(schema.departments).values(['Engineering', 'Sales', 'Finance', 'Human Resources', 'Operations', 'Marketing'].map((n) => ({ companyId: cid, name: n }))).returning();
  const des = await db.insert(schema.designations).values(['Founder & CEO', 'Engineering Manager', 'Senior Developer', 'Developer', 'Sales Executive', 'Accountant', 'HR Executive', 'Operations Associate', 'Marketing Lead'].map((n) => ({ companyId: cid, name: n }))).returning();
  await db.insert(schema.holidays).values([
    ['2026-01-26', 'Republic Day'], ['2026-03-04', 'Holi'], ['2026-05-01', 'Maharashtra Day'], ['2026-08-15', 'Independence Day'], ['2026-09-14', 'Ganesh Chaturthi'],
    ['2026-10-02', 'Gandhi Jayanti'], ['2026-10-20', 'Dussehra'], ['2026-11-09', 'Diwali (Laxmi Puja)'], ['2026-11-10', 'Diwali (Balipratipada)'], ['2026-12-25', 'Christmas'], ['2027-01-26', 'Republic Day'],
  ].map(([date, n]) => ({ companyId: cid, date, name: n, state: n.startsWith('Maharashtra') ? 'MH' : null })));
  await db.insert(schema.leaveTypes).values([
    { companyId: cid, code: 'CL', name: 'Casual Leave', quota: '8', minNoticeDays: 1, maxPerRequest: '3' },
    { companyId: cid, code: 'SL', name: 'Sick Leave', quota: '8', docAfterDays: 2, maxPerRequest: '8' },
    // ponytail: EL credited upfront in the demo; switch to days_worked once the monthly accrual job lands (phase 3).
    { companyId: cid, code: 'EL', name: 'Earned Leave', quota: '18', carryCap: '30', encashCap: '10', minNoticeDays: 3, maxPerRequest: '10' },
    { companyId: cid, code: 'ML', name: 'Maternity Leave', quota: '182', gender: 'F', proration: 'none', maxPerRequest: '182', halfDay: false },
    { companyId: cid, code: 'PL', name: 'Paternity Leave', quota: '5', gender: 'M', proration: 'none', maxPerRequest: '5' },
    { companyId: cid, code: 'LWP', name: 'Leave Without Pay', paid: false, quota: '0', maxPerRequest: '30' },
  ]);

  const people: [string, string, 'M' | 'F', number, number, number][] = [
    // first, last, gender, dept, designation, CTC (₹ lakh)
    ['Aarav', 'Mehta', 'M', 0, 0, 36], ['Priya', 'Sharma', 'F', 0, 1, 28], ['Rohan', 'Patil', 'M', 0, 2, 18], ['Sneha', 'Kulkarni', 'F', 0, 3, 9.5],
    ['Vikram', 'Iyer', 'M', 0, 3, 8], ['Ananya', 'Rao', 'F', 0, 2, 16], ['Kabir', 'Singh', 'M', 1, 4, 6.5], ['Isha', 'Desai', 'F', 1, 4, 5.2],
    ['Arjun', 'Nair', 'M', 1, 4, 4.8], ['Meera', 'Joshi', 'F', 2, 5, 7.2], ['Siddharth', 'Gupta', 'M', 2, 5, 11], ['Neha', 'Pawar', 'F', 3, 6, 6],
    ['Rahul', 'Shinde', 'M', 4, 7, 2.4], ['Pooja', 'More', 'F', 4, 7, 2.6], ['Aditya', 'Kale', 'M', 4, 7, 3.1], ['Kavya', 'Reddy', 'F', 5, 8, 14],
    ['Yash', 'Bhosale', 'M', 0, 3, 7.5], ['Tanvi', 'Gaikwad', 'F', 0, 3, 8.8], ['Omkar', 'Jadhav', 'M', 4, 7, 2.2], ['Riya', 'Chavan', 'F', 1, 4, 5.9],
    ['Harsh', 'Thakur', 'M', 2, 5, 6.4], ['Divya', 'Menon', 'F', 5, 8, 9.1], ['Nikhil', 'Sawant', 'M', 0, 2, 21], ['Sanya', 'Kapoor', 'F', 3, 6, 5.5],
  ];
  const fakeReq = { user: { cid, sub: null as unknown as string }, ip: 'seed' };
  const ids: string[] = [];
  const now = new Date();
  for (let i = 0; i < Math.min(size, people.length); i++) {
    const [first, last, g, d, ds, lakh] = people[i];
    const doj = new Date(Date.UTC(now.getUTCFullYear() - 2, now.getUTCMonth(), 1) + i * 29 * 864e5).toISOString().slice(0, 10);
    const pan = `ABCP${String.fromCharCode(65 + (i % 26))}${String(1000 + i * 37).slice(-4)}${String.fromCharCode(70 + (i % 10))}`;
    const [e] = await db.insert(schema.employees).values({
      companyId: cid, code: `EMP${String(i + 1).padStart(4, '0')}`, firstName: first, lastName: last, gender: g,
      dob: `${1985 + (i % 15)}-0${1 + (i % 9)}-1${i % 9}`, workEmail: `${first.toLowerCase()}.${last.toLowerCase()}@${emailDomain}`, mobile: `98200${String(10000 + i * 311).slice(-5)}`,
      branchId: brs[i % 5 === 4 ? 2 : d === 4 ? 1 : 0].id, departmentId: deps[d].id, designationId: des[ds].id,
      managerId: i === 0 ? null : d === 0 && ds > 1 ? ids[1] ?? ids[0] : ids[0], doj, metro: d !== 4,
      panEnc: encrypt(pan), panLast4: pan.slice(-4), bankEnc: encryptJson({ holder: `${first} ${last}`, account: `5010${String(1234567 + i * 7919)}`, ifsc: 'HDFC0001234', bankName: 'HDFC Bank' }), bankLast4: String(1234567 + i * 7919).slice(-4),
      aadhaarLast4: String(4000 + i * 13).slice(-4), uan: `1010${String(12345678 + i)}`, taxRegime: i % 4 === 0 ? 'old' : 'new',
      status: i === 23 ? 'NOTICE' : 'ACTIVE', lastWorkingDay: i === 23 ? new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10) : null,
    }).returning();
    ids.push(e.id);
    await creditJoinerLeave(cid, e.id, `${now.getUTCFullYear()}-01-01`, g);
    await createRevision(fakeReq, e.id, lakh * 100000, 0, doj);
  }
  // Recent joiners for the trend chart and a pending revision history entry.
  if (ids[2]) await createRevision(fakeReq, ids[2], 21 * 100000, 0, `${now.getUTCFullYear()}-04-01`);

  const pw = await hashPassword(password);
  await db.insert(schema.users).values([
    { companyId: cid, email: `admin@${emailDomain}`, passwordHash: pw, roles: ['COMPANY_ADMIN', 'REPORTING_MANAGER', 'EMPLOYEE'], employeeId: ids[0] },
    { companyId: cid, email: `payroll@${emailDomain}`, passwordHash: pw, roles: ['PAYROLL_MANAGER', 'EMPLOYEE'], employeeId: ids[10] },
    { companyId: cid, email: `manager@${emailDomain}`, passwordHash: pw, roles: ['REPORTING_MANAGER', 'EMPLOYEE'], employeeId: ids[1] },
    { companyId: cid, email: `employee@${emailDomain}`, passwordHash: pw, roles: ['EMPLOYEE'], employeeId: ids[3] },
  ]);

  // A few leave requests so approvals and "on leave today" have data.
  const types = await db.select().from(schema.leaveTypes).where(eq(schema.leaveTypes.companyId, cid));
  const t = (code: string) => types.find((x) => x.code === code)!.id;
  const day = (o: number) => new Date(Date.now() + o * 864e5).toISOString().slice(0, 10);
  await db.insert(schema.leaveRequests).values([
    { companyId: cid, employeeId: ids[3], leaveTypeId: t('EL'), fromDate: day(12), toDate: day(14), daysCounted: '3', reason: 'Family function' },
    { companyId: cid, employeeId: ids[4], leaveTypeId: t('CL'), fromDate: day(5), toDate: day(5), daysCounted: '1', reason: 'Personal work' },
    { companyId: cid, employeeId: ids[7], leaveTypeId: t('SL'), fromDate: day(0), toDate: day(1), daysCounted: '2', status: 'APPROVED', reason: 'Fever' },
  ]);
  const [ap] = await db.select().from(schema.leaveRequests).where(eq(schema.leaveRequests.employeeId, ids[7]));
  await db.insert(schema.leaveLedger).values({ companyId: cid, employeeId: ids[7], leaveTypeId: t('SL'), date: day(0), kind: 'debit', days: '2', refType: 'leave_request', refId: ap.id });
  return { companyId: cid, employeeIds: ids };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const password = process.env.SEED_PASSWORD ?? 'Demo@Pass123';
  await seedRules();
  const [existing] = await db.select().from(schema.companies).limit(1);
  if (existing) console.log('Company already exists — rules refreshed, demo data skipped.');
  else {
    await seedCompany('Valencia Nutrition (Demo)', 'demo.test', password);
    console.log(`Seeded. Sign in as admin@demo.test / payroll@demo.test / manager@demo.test / employee@demo.test with password: ${password}`);
  }
  await closeDb();
}
