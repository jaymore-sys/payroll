import 'dotenv/config';
const { env, isProd } = await import('./env');
const { migrateDb } = await import('./db');
const { app } = await import('./app');

// Creates or updates the tables on every start, then makes sure there is a company to sign in to.
await migrateDb();
const seed = await import('./db/seed');
if (isProd) {
  // Live server: never demo data. First start creates your company from ADMIN_EMAIL / ADMIN_PASSWORD / COMPANY_NAME.
  await seed.seedRules();
  const { db, schema } = await import('./db');
  const [any] = await db.select({ id: schema.companies.id }).from(schema.companies).limit(1);
  const { ADMIN_EMAIL: email, ADMIN_PASSWORD: pw, COMPANY_NAME: name } = process.env;
  if (!any && email && pw && name) { await seed.createCompany(name, email, pw); console.log(`Company "${name}" created. Sign in as ${email}.`); }
  else if (!any) console.warn('Empty database: set ADMIN_EMAIL, ADMIN_PASSWORD and COMPANY_NAME, then restart.');
} else {
  const password = process.env.SEED_PASSWORD ?? 'Demo@Pass123';
  if (await seed.ensureSeeded(password)) console.log(`Demo data created. Sign in as admin@demo.test with password ${password}`);
}
app.listen(env.PORT, () => console.log(`Valencia Payroll API on http://localhost:${env.PORT} (MySQL)`));

// Logins that have not set their own password yet use the current default password (runs in the background).
(async () => {
  const { db, schema } = await import('./db');
  const { DEFAULT_PASSWORD, hashPassword, verifyPassword } = await import('./lib/auth');
  const { eq } = await import('drizzle-orm');
  const pending = await db.select({ id: schema.users.id, hash: schema.users.passwordHash }).from(schema.users).where(eq(schema.users.mustChangePassword, true));
  let n = 0;
  for (const u of pending) if (!(await verifyPassword(u.hash, DEFAULT_PASSWORD))) { await db.update(schema.users).set({ passwordHash: await hashPassword(DEFAULT_PASSWORD) }).where(eq(schema.users.id, u.id)); n++; }
  if (n) console.log(`${n} first-time login(s) set to the default password`);
  // Every working employee gets a login (work email + default password) if they do not have one yet.
  const { ensureLogin } = await import('./lib/auth');
  const { and, inArray } = await import('drizzle-orm');
  const emps = await db.select({ id: schema.employees.id, cid: schema.employees.companyId, email: schema.employees.workEmail }).from(schema.employees)
    .where(and(inArray(schema.employees.status, ['ACTIVE', 'NOTICE', 'ONBOARDING'])));
  let made = 0;
  for (const e of emps) if (e.email && (await ensureLogin(e.cid, e.id, e.email, false)) === 'created') made++;
  if (made) console.log(`${made} employee login(s) created with the default password`);

  // One-off, asked for on 5 Nov 2026: Jay More's salary = ₹30,000 with HRA ₹5,000, so PF is ₹3,000 and PT ₹200.
  // From his latest salary if it starts in October 2026 or later (corrects it), else from 1 Oct 2026. Runs once (audit marker).
  const { createRevision } = await import('./routes/employees');
  const { desc, sql: q } = await import('drizzle-orm');
  const jays = await db.select().from(schema.employees).where(and(q`lower(${schema.employees.firstName}) = 'jay'`, q`lower(${schema.employees.lastName}) = 'more'`, inArray(schema.employees.status, ['ACTIVE', 'NOTICE'])));
  for (const j of jays) {
    const [done] = await db.select({ id: schema.auditLog.id }).from(schema.auditLog).where(and(eq(schema.auditLog.action, 'data_fix_salary_30k'), eq(schema.auditLog.entityId, j.id)));
    if (done) continue;
    const [admin] = await db.select().from(schema.users).where(and(eq(schema.users.companyId, j.companyId), q`json_contains(${schema.users.roles}, '"COMPANY_ADMIN"')`)).limit(1);
    const [cur] = await db.select().from(schema.salaryStructures).where(eq(schema.salaryStructures.employeeId, j.id)).orderBy(desc(schema.salaryStructures.effectiveFrom)).limit(1);
    const from = cur && cur.effectiveFrom >= '2026-10-01' ? cur.effectiveFrom : '2026-10-01';
    const req = { user: { cid: j.companyId, sub: admin?.id ?? null }, ip: null };
    await createRevision(req, j.id, { components: [
      { code: 'BASIC', name: 'Basic', monthly: 15000, isWage: true }, { code: 'HRA', name: 'House Rent Allowance', monthly: 5000, isWage: false },
      { code: 'LTA', name: 'Leave & Travel Allowance', monthly: 3000, isWage: true }, { code: 'SPECIAL', name: 'Special Allowance', monthly: 7000, isWage: true },
    ] }, 0, from);
    await db.update(schema.employees).set({ pfOptOut: false, ptExempt: false }).where(eq(schema.employees.id, j.id));
    await db.insert(schema.auditLog).values({ companyId: j.companyId, userId: admin?.id ?? null, action: 'data_fix_salary_30k', entity: 'employee', entityId: j.id, after: { monthlyGross: 30000, hra: 5000, effectiveFrom: from } });
    console.log(`Salary set for ${j.firstName} ${j.lastName}: 30,000 from ${from}`);
  }
})().catch((e) => console.warn('Default password update skipped:', (e as Error).message));
