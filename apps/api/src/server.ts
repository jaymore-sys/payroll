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
})().catch((e) => console.warn('Default password update skipped:', (e as Error).message));
