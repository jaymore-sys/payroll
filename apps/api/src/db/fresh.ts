/**
 * Start clean: delete ALL data in the database in DATABASE_URL and add one company with one Company Admin login.
 *   npm run fresh -- --email you@company.com --company "Your Company Ltd" [--password "..."]
 * Without --password a random temporary password is printed once; change it under My profile after signing in.
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { email: { type: 'string' }, company: { type: 'string' }, password: { type: 'string' } } });
const email = values.email?.trim().toLowerCase();
const company = values.company?.trim();
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !company) {
  console.error('Usage: npm run fresh -- --email you@company.com --company "Your Company Ltd"');
  process.exit(1);
}
const password = values.password ?? `Pp-${randomBytes(9).toString('base64url')}9a`;
const { closeDb, migrateDb, wipeAll } = await import('./index');
const { seedRules, createCompany } = await import('./seed');
await migrateDb();
await wipeAll();
await seedRules();
await createCompany(company, email, password);
await closeDb();
console.log(`\nAll previous data deleted. Fresh company "${company}" created.\nSign in as ${email}\nPassword: ${password}\n(Change it under My profile.)\n`);
