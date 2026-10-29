import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticator } from 'otplib';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, schema, updateReturning } from '../db';
import { isProd } from '../env';
import { audit } from '../lib/audit';
import { ACCESS_TTL_SEC, hashPassword, requireAuth, signAccess, signChallenge, verifyChallenge, verifyPassword } from '../lib/auth';
import { decrypt, encrypt, randomToken, sha256 } from '../lib/crypto';
import { ApiError, h, parse } from '../lib/http';

export const authRouter = Router();
const U = schema.users, RT = schema.refreshTokens;

const MAX_FAILS = 5, LOCK_MIN = 15, REFRESH_DAYS = 7;
const COOKIE = 'pp_rt';
const cookieOpts = { httpOnly: true, secure: isProd, sameSite: 'strict' as const, path: '/api/v1/auth' };
// Burns the same time as a real verify when the email is unknown, so response time does not reveal accounts.
const DUMMY_HASH = await hashPassword(randomToken());

const limit = (windowMin: number, max: number, key?: (req: Request) => string) => rateLimit({
  windowMs: windowMin * 60_000, limit: max, standardHeaders: 'draft-7', legacyHeaders: false,
  ...(key ? { keyGenerator: key } : {}),
  message: { code: 'rate_limited', message: 'Too many attempts. Try again later.', details: [] },
});
// Per account+IP (brute force on one login), per IP (credential stuffing; generous for office NAT), refresh separately.
authRouter.use(['/login', '/otp/verify'], limit(15, 10, (req) => `${req.ip}|${String(req.body?.email ?? req.body?.challenge ?? '').toLowerCase().slice(0, 200)}`));
authRouter.use(['/login', '/otp/verify'], limit(15, 200));
authRouter.use('/refresh', limit(15, 300));

/** State-changing cookie endpoints require a custom header: browsers can't send it cross-site without a CORS preflight. */
const csrfGuard = (req: Request) => {
  if (req.get('X-Requested-With') !== 'payrollpro') throw new ApiError(403, 'csrf', 'Missing request header');
};

async function issueSession(req: Request, res: Response, user: typeof U.$inferSelect, family: string = randomUUID()) {
  const token = randomToken();
  await db.insert(RT).values({ userId: user.id, tokenHash: sha256(token), family, expiresAt: new Date(Date.now() + REFRESH_DAYS * 864e5), ip: req.ip, userAgent: req.get('user-agent')?.slice(0, 200) });
  res.cookie(COOKIE, token, { ...cookieOpts, maxAge: REFRESH_DAYS * 864e5 });
  const accessToken = signAccess({ sub: user.id, cid: user.companyId, roles: user.roles, eid: user.employeeId, ver: user.tokenVersion });
  return { accessToken, expiresIn: ACCESS_TTL_SEC, user: { id: user.id, email: user.email, roles: user.roles, employeeId: user.employeeId, totpEnabled: user.totpEnabled } };
}

authRouter.post('/login', h(async (req, res) => {
  const { email, password } = parse(z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) }), req.body);
  const [user] = await db.select().from(U).where(eq(U.email, email.toLowerCase()));
  const fail = () => new ApiError(401, 'invalid_credentials', 'Invalid email or password');
  if (!user) { await verifyPassword(DUMMY_HASH, password); await audit(req, 'login_failed', 'user', null, undefined, { email }); throw fail(); }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
    throw new ApiError(423, 'locked', `Account locked after too many attempts. Try again in ${mins} min.`);
  }
  if (!user.active || !(await verifyPassword(user.passwordHash, password))) {
    const fails = user.failedLogins + 1;
    const lock = fails >= MAX_FAILS;
    await db.update(U).set({ failedLogins: lock ? 0 : fails, lockedUntil: lock ? new Date(Date.now() + LOCK_MIN * 60000) : null }).where(eq(U.id, user.id));
    await audit(req, lock ? 'account_locked' : 'login_failed', 'user', user.id, undefined, { fails }, user.companyId, user.id);
    throw fail();
  }
  await db.update(U).set({ failedLogins: 0, lockedUntil: null }).where(eq(U.id, user.id));
  if (user.totpEnabled) return res.json({ otpRequired: true, challenge: signChallenge(user.id) });
  await db.update(U).set({ lastLoginAt: new Date() }).where(eq(U.id, user.id));
  await audit(req, 'login', 'user', user.id, undefined, undefined, user.companyId, user.id);
  res.json(await issueSession(req, res, user));
}));

authRouter.post('/otp/verify', h(async (req, res) => {
  const { challenge, code } = parse(z.object({ challenge: z.string().max(1000), code: z.string().regex(/^\d{6}$/) }), req.body);
  const userId = verifyChallenge(challenge);
  const [user] = await db.select().from(U).where(eq(U.id, userId));
  if (!user?.totpSecretEnc || !user.active) throw new ApiError(401, 'invalid_code', 'Invalid code');
  if (!authenticator.check(code, decrypt(user.totpSecretEnc))) {
    await audit(req, 'otp_failed', 'user', user.id, undefined, undefined, user.companyId, user.id);
    throw new ApiError(401, 'invalid_code', 'Invalid code');
  }
  await db.update(U).set({ lastLoginAt: new Date() }).where(eq(U.id, user.id));
  await audit(req, 'login', 'user', user.id, undefined, { otp: true }, user.companyId, user.id);
  res.json(await issueSession(req, res, user));
}));

authRouter.post('/refresh', h(async (req, res) => {
  csrfGuard(req);
  const token = req.cookies?.[COOKIE];
  if (!token) throw new ApiError(401, 'no_session', 'Please sign in');
  const [row] = await db.select().from(RT).where(eq(RT.tokenHash, sha256(token)));
  if (!row) { res.clearCookie(COOKIE, cookieOpts); throw new ApiError(401, 'no_session', 'Please sign in'); }
  if (row.revokedAt) {
    // A rotated token was presented again: likely stolen. Kill the whole family.
    await db.update(RT).set({ revokedAt: new Date() }).where(and(eq(RT.family, row.family), isNull(RT.revokedAt)));
    await audit(req, 'refresh_reuse_detected', 'user', row.userId);
    res.clearCookie(COOKIE, cookieOpts);
    throw new ApiError(401, 'session_revoked', 'Please sign in again');
  }
  if (row.expiresAt < new Date()) throw new ApiError(401, 'no_session', 'Please sign in');
  const [user] = await db.select().from(U).where(eq(U.id, row.userId));
  if (!user?.active) throw new ApiError(401, 'no_session', 'Please sign in');
  await db.update(RT).set({ revokedAt: new Date() }).where(eq(RT.id, row.id));
  res.json(await issueSession(req, res, user, row.family));
}));

authRouter.post('/logout', h(async (req, res) => {
  csrfGuard(req);
  const token = req.cookies?.[COOKIE];
  if (token) {
    const [row] = await db.select().from(RT).where(eq(RT.tokenHash, sha256(token)));
    if (row) await db.update(RT).set({ revokedAt: new Date() }).where(and(eq(RT.family, row.family), isNull(RT.revokedAt)));
  }
  res.clearCookie(COOKIE, cookieOpts);
  res.status(204).end();
}));

authRouter.get('/me', requireAuth, h(async (req, res) => {
  const [u] = await db.select({ id: U.id, email: U.email, roles: U.roles, employeeId: U.employeeId, totpEnabled: U.totpEnabled, lastLoginAt: U.lastLoginAt, mustChangePassword: U.mustChangePassword }).from(U).where(eq(U.id, req.user!.sub));
  const [company] = await db.select({ id: schema.companies.id, name: schema.companies.name }).from(schema.companies).where(eq(schema.companies.id, req.user!.cid));
  const emp = u.employeeId
    ? (await db.select({ firstName: schema.employees.firstName, lastName: schema.employees.lastName, code: schema.employees.code }).from(schema.employees).where(eq(schema.employees.id, u.employeeId)))[0]
    : null;
  res.json({ ...u, company, employee: emp });
}));

const passwordSchema = z.string().min(10, 'Use at least 10 characters').max(200)
  .refine((p) => /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p), 'Use upper and lower case letters and a number');

authRouter.post('/change-password', requireAuth, h(async (req, res) => {
  const { current, next } = parse(z.object({ current: z.string().max(200), next: passwordSchema }), req.body);
  const [u] = await db.select().from(U).where(eq(U.id, req.user!.sub));
  if (!(await verifyPassword(u.passwordHash, current))) throw new ApiError(400, 'invalid_password', 'Current password is wrong');
  if (next === current) throw new ApiError(400, 'same_password', 'Choose a password different from the current one');
  await db.update(U).set({ passwordHash: await hashPassword(next), mustChangePassword: false, tokenVersion: sql`${U.tokenVersion} + 1` }).where(eq(U.id, u.id));
  await db.update(RT).set({ revokedAt: new Date() }).where(and(eq(RT.userId, u.id), isNull(RT.revokedAt), gt(RT.expiresAt, new Date())));
  await audit(req, 'password_changed', 'user', u.id);
  res.clearCookie(COOKIE, cookieOpts);
  res.status(204).end();
}));

authRouter.post('/2fa/setup', requireAuth, h(async (req, res) => {
  const secret = authenticator.generateSecret();
  const [u] = await updateReturning(U, { totpSecretEnc: encrypt(secret), totpEnabled: false }, eq(U.id, req.user!.sub));
  res.json({ secret, otpauthUrl: authenticator.keyuri(u.email, 'PayrollPro', secret) });
}));

authRouter.post('/2fa/enable', requireAuth, h(async (req, res) => {
  const { code } = parse(z.object({ code: z.string().regex(/^\d{6}$/) }), req.body);
  const [u] = await db.select().from(U).where(eq(U.id, req.user!.sub));
  if (!u.totpSecretEnc || !authenticator.check(code, decrypt(u.totpSecretEnc))) throw new ApiError(400, 'invalid_code', 'Invalid code');
  await db.update(U).set({ totpEnabled: true }).where(eq(U.id, u.id));
  await audit(req, '2fa_enabled', 'user', u.id);
  res.status(204).end();
}));

authRouter.post('/2fa/disable', requireAuth, h(async (req, res) => {
  const { password } = parse(z.object({ password: z.string().max(200) }), req.body);
  const [u] = await db.select().from(U).where(eq(U.id, req.user!.sub));
  if (!(await verifyPassword(u.passwordHash, password))) throw new ApiError(400, 'invalid_password', 'Password is wrong');
  await db.update(U).set({ totpEnabled: false, totpSecretEnc: null }).where(eq(U.id, u.id));
  await audit(req, '2fa_disabled', 'user', u.id);
  res.status(204).end();
}));

export { passwordSchema };
