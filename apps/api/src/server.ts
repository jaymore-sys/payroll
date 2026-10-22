import 'dotenv/config';
const { env } = await import('./env');
const { embedded, migrateDb } = await import('./db');
const { app } = await import('./app');

// Embedded mode is zero-setup: apply migrations and seed demo data on first start.
if (embedded) {
  await migrateDb();
  const { ensureSeeded } = await import('./db/seed');
  const password = process.env.SEED_PASSWORD ?? 'Demo@Pass123';
  if (await ensureSeeded(password)) console.log(`Demo data created. Sign in as admin@demo.test with password ${password}`);
}
app.listen(env.PORT, () => console.log(`PayrollPro API on http://localhost:${env.PORT} (${embedded ? 'embedded database in apps/api/.data' : 'PostgreSQL'})`));
