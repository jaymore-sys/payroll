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

const { closeDb, migrateDb } = await import('./index');
const { seedRules, createCompany } = await import('./seed');

await migrateDb();
await seedRules();
await createCompany(company, email, password);
await closeDb();
console.log(`\nAll previous data deleted. Fresh company "${company}" created.\nSign in as ${email}\nPassword: ${password}\n(Change it under My profile.)\n`);
