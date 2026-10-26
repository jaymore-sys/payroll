import { hash, verify } from '@node-rs/argon2';
import { and, eq } from 'drizzle-orm';
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { db, schema } from '../db';
import type { Role } from '../db/schema';
import { env } from '../env';
import { ApiError, h } from './http';

export interface AuthUser { sub: string; cid: string; roles: Role[]; eid: string | null; ver: number }
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express { interface Request { user?: AuthUser } }
}

const JWT_OPTS = { algorithm: 'HS256' as const, issuer: 'payrollpro', audience: 'payrollpro-api' };
export const ACCESS_TTL_SEC = 15 * 60;

export const signAccess = (u: AuthUser) => jwt.sign({ cid: u.cid, roles: u.roles, eid: u.eid, ver: u.ver }, env.JWT_SECRET, { ...JWT_OPTS, subject: u.sub, expiresIn: ACCESS_TTL_SEC });
export const signChallenge = (userId: string) => jwt.sign({ purpose: 'otp' }, env.JWT_SECRET, { ...JWT_OPTS, subject: userId, expiresIn: 300 });
export function verifyChallenge(token: string): string {
  const p = jwt.verify(token, env.JWT_SECRET, { ...JWT_OPTS, algorithms: ['HS256'] }) as jwt.JwtPayload;
  if (p.purpose !== 'otp' || !p.sub) throw new ApiError(401, 'invalid_challenge', 'Sign-in expired, please start again');
  return p.sub;
}

// Argon2id with OWASP-recommended parameters.
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 };
export const hashPassword = (p: string) => hash(p, ARGON);
export const verifyPassword = (hashed: string, p: string) => verify(hashed, p).catch(() => false);

/** Verifies the access token AND that the user is still active with the same token version (so password change / deactivation revokes at once). */
export const requireAuth = h(async (req: Request, _res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw new ApiError(401, 'unauthenticated', 'Please sign in');
  let p: jwt.JwtPayload;
  try {
    p = jwt.verify(header.slice(7), env.JWT_SECRET, { ...JWT_OPTS, algorithms: ['HS256'] }) as jwt.JwtPayload;
  } catch {
    throw new ApiError(401, 'token_expired', 'Session expired');
  }
  if (p.purpose) throw new ApiError(401, 'unauthenticated', 'Please sign in');
  const [u] = await db.select({ active: schema.users.active, ver: schema.users.tokenVersion, roles: schema.users.roles, eid: schema.users.employeeId, mcp: schema.users.mustChangePassword })
    .from(schema.users).where(and(eq(schema.users.id, p.sub!), eq(schema.users.companyId, p.cid)));
  if (!u || !u.active || u.ver !== p.ver) throw new ApiError(401, 'session_revoked', 'Please sign in again');
  // Default password: only the sign-in routes (me, change-password, logout) work until it is changed.
  if (u.mcp && !req.originalUrl.startsWith('/api/v1/auth/')) throw new ApiError(403, 'password_change_required', 'Please set your own password first');
  req.user = { sub: p.sub!, cid: p.cid, roles: u.roles, eid: u.eid, ver: u.ver };
  next();
});

export const requireRole = (...roles: Role[]) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user?.roles.some((r) => roles.includes(r) || r === 'SUPER_ADMIN')) return next(new ApiError(403, 'forbidden', 'You do not have access to this'));
  next();
};

export const hasRole = (u: AuthUser | undefined, ...roles: Role[]) => !!u?.roles.some((r) => roles.includes(r) || r === 'SUPER_ADMIN');
/** Salary, PAN, bank and tax data: Company Admin, Payroll Manager, or the employee themself (spec §2). */
export const canSeePay = (u: AuthUser | undefined, employeeId?: string) => hasRole(u, 'COMPANY_ADMIN', 'PAYROLL_MANAGER') || (!!employeeId && u?.eid === employeeId);
export const ADMIN_ROLES: Role[] = ['COMPANY_ADMIN', 'PAYROLL_MANAGER'];
