import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export const DATA_DIR = process.env.PAYROLLPRO_DATA_DIR ?? fileURLToPath(new URL('../.data', import.meta.url));

/**
 * Zero-config local runs: outside production, missing secrets are generated once and kept in .data/dev-secrets.json
 * (git-ignored, file mode 600). Production refuses to start without real secrets.
 */
if (process.env.NODE_ENV !== 'production' && (!process.env.JWT_SECRET || !process.env.FIELD_ENCRYPTION_KEY)) {
  const file = `${DATA_DIR}/dev-secrets.json`; // fine on Windows too: Node accepts forward slashes
  mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(file)) writeFileSync(file, JSON.stringify({ JWT_SECRET: randomBytes(48).toString('base64'), FIELD_ENCRYPTION_KEY: randomBytes(32).toString('base64') }), { mode: 0o600 });
  const s = JSON.parse(readFileSync(file, 'utf8'));
  process.env.JWT_SECRET ||= s.JWT_SECRET;
  process.env.FIELD_ENCRYPTION_KEY ||= s.FIELD_ENCRYPTION_KEY;
}

const schema = z.object({
  /** Empty = embedded PostgreSQL (PGlite) stored in .data/db — no database server needed. */
  DATABASE_URL: z.string().url().optional().or(z.literal('').transform(() => undefined)),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  FIELD_ENCRYPTION_KEY: z.string().refine((v) => Buffer.from(v, 'base64').length === 32, 'FIELD_ENCRYPTION_KEY must be 32 bytes, base64'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}
export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
if (isProd && !env.DATABASE_URL) {
  console.error('DATABASE_URL is required in production (embedded database is for local use only).');
  process.exit(1);
}
