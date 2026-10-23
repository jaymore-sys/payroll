/**
 * Start clean: delete the embedded database (all demo or test data), re-create it, and add one company with one
 * Company Admin login. Stop `npm run dev` first.
 *   npm run fresh -- --email you@company.com --company "Your Company Ltd" [--password "..."]
 * Without --password a random temporary password is printed once; change it under My profile after signing in.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { DATA_DIR } from '../env';

const { values } = parseArgs({ options: { email: { type: 'string' }, company: { type: 'string' }, password: { type: 'string' } } });
const email = values.email?.trim().toLowerCase();
const company = values.company?.trim();
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !company) {
  console.error('Usage: npm run fresh -- --email you@company.com --company "Your Company Ltd"');
  process.exit(1);
}
if (process.env.DATABASE_URL) {
  console.error('DATABASE_URL is set: this script only resets the embedded database. Reset PostgreSQL yourself.');
  process.exit(1);
}
const password = values.password ?? `Pp-${randomBytes(9).toString('base64url')}9a`;

const dbDir = process.env.PGLITE_DIR ?? `${DATA_DIR}/db`;
if (existsSync(dbDir)) rmSync(dbDir, { recursive: true, force: true }); // must happen before the db module opens it

const { closeDb, db, migrateDb, schema } = await import('./index');
const { seedRules } = await import('./seed');
const { hashPassword } = await import('../lib/auth');

await migrateDb();
await seedRules();
const [c] = await db.insert(schema.companies).values({ name: company, legalName: company }).returning();
await db.insert(schema.users).values({ companyId: c.id, email, passwordHash: await hashPassword(password), roles: ['COMPANY_ADMIN'] });
await closeDb();
console.log(`\nAll previous data deleted. Fresh company "${company}" created.\nSign in as ${email}\nPassword: ${password}\n(Change it under My profile.)\n`);
