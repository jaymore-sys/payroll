import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { env, isProd } from './env';
import { requireAuth } from './lib/auth';
import { ApiError, errorHandler } from './lib/http';
import { authRouter } from './routes/auth';
import { companyRouter } from './routes/company';
import { employeesRouter } from './routes/employees';
import { leaveRouter } from './routes/leave';
import { miscRouter } from './routes/misc';
import { payrollRouter } from './routes/payroll';
import { attendanceRouter } from './routes/attendance';
import { consultantsRouter } from './routes/consultants';

export const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use('/api', helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } }, crossOriginResourcePolicy: { policy: 'same-site' } }));
app.use(cors({ origin: env.CORS_ORIGIN.split(','), credentials: true, allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'] }));
app.use(express.json({ limit: '4mb' }));
app.use(cookieParser());
app.use('/api', rateLimit({ windowMs: 60_000, limit: isProd ? 300 : 3000, standardHeaders: 'draft-7', legacyHeaders: false }));
// Personal and salary data must never be cached by browsers or proxies.
app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/v1/auth', authRouter);
app.use('/api/v1', requireAuth, companyRouter, employeesRouter, leaveRouter, miscRouter, payrollRouter, attendanceRouter, consultantsRouter);
app.use('/api', (_req, _res, next) => next(new ApiError(404, 'not_found', 'Route not found')));
app.use(errorHandler);

// One-process hosting (Hostinger etc.): after `npm run build`, the API also serves the web app.
const web = fileURLToPath(new URL('../../web/dist', import.meta.url));
if (existsSync(web)) {
  app.use(helmet({ contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'", "'unsafe-inline'"], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    fontSrc: ["'self'", 'https://fonts.gstatic.com'], imgSrc: ["'self'", 'data:', 'blob:'], connectSrc: ["'self'"], frameAncestors: ["'none'"],
  } } }));
  app.use(express.static(web, { index: false, maxAge: '1h' }));
  app.get('*', (_req, res) => res.sendFile(`${web}/index.html`));
}
