/**
 * Forgotten password: set a temporary one that must be changed at the next sign-in. Also unlocks the account and signs
 * out every session.   npm run reset-password -- --email you@company.com --password "temporary"
 */
import 'dotenv/config'; // DATABASE_URL from apps/api/.env
import { eq, sql } from 'drizzle-orm';
import { parseArgs } from 'node:util';
import { hashPassword } from '../lib/auth';
import { closeDb, db, schema, updateReturning } from './index';

const { values: a } = parseArgs({ options: { email: { type: 'string' }, password: { type: 'string' } } });
if (!a.email || !a.password) { console.error('Usage: npm run reset-password -- --email <login> --password <temporary>'); process.exit(1); }
const U = schema.users;
const [u] = await updateReturning(U, { passwordHash: await hashPassword(a.password), mustChangePassword: true, failedLogins: 0, lockedUntil: null, active: true, tokenVersion: sql`${U.tokenVersion} + 1` }, eq(U.email, a.email.trim().toLowerCase()));
if (!u) { console.error(`No login ${a.email}`); process.exit(1); }
await db.delete(schema.refreshTokens).where(eq(schema.refreshTokens.userId, u.id));
console.log(`Password for ${a.email} reset. Sign in with the temporary password; you will be asked to choose a new one.`);
await closeDb();
