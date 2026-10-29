import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { isProd } from '../env';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details: unknown[] = []) { super(message); }
}
export const notFound = (what = 'Resource') => new ApiError(404, 'not_found', `${what} not found`);
export const forbidden = () => new ApiError(403, 'forbidden', 'You do not have access to this');

/** Wrap async handlers so rejections reach the error middleware (Express 4). */
export const h = (fn: (req: Request, res: Response, next: NextFunction) => unknown): RequestHandler =>
  (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const parse = <S extends ZodTypeAny>(s: S, data: unknown): z.infer<S> => s.parse(data);

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(422).json({ code: 'validation_failed', message: 'Some fields are invalid', details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
  }
  if (err instanceof ApiError) return res.status(err.status).json({ code: err.code, message: err.message, details: err.details });
  const dbCode = (err as { code?: string })?.code ?? (err as { cause?: { code?: string } })?.cause?.code; // MySQL error code
  if (dbCode === 'ER_DUP_ENTRY') return res.status(409).json({ code: 'conflict', message: 'A record with these details already exists', details: [] });
  if (dbCode === 'ER_ROW_IS_REFERENCED_2' || dbCode === 'ER_NO_REFERENCED_ROW_2') return res.status(409).json({ code: 'in_use', message: 'Referenced record is missing or still in use', details: [] });
  if ((err as { type?: string })?.type === 'entity.too.large') return res.status(413).json({ code: 'too_large', message: 'Request too large', details: [] });
  console.error(err);
  res.status(500).json({ code: 'server_error', message: 'Something went wrong', details: isProd ? [] : [String(err)] });
}

export const page = (q: Record<string, unknown>) => {
  const limit = Math.min(Math.max(Number(q.limit) || 25, 1), 200);
  const p = Math.max(Number(q.page) || 1, 1);
  return { limit, offset: (p - 1) * limit, page: p };
};
