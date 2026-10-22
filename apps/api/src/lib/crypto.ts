import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '../env';

/**
 * Field-level encryption for PAN, bank, TOTP secrets (spec §18): AES-256-GCM.
 * Format: v1.<iv>.<tag>.<ciphertext> (base64url). The version prefix allows key rotation.
 */
const KEY = Buffer.from(env.FIELD_ENCRYPTION_KEY, 'base64');

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

export function decrypt(blob: string): string {
  const [v, iv, tag, ct] = blob.split('.');
  if (v !== 'v1') throw new Error('Unknown ciphertext version');
  const d = createDecipheriv('aes-256-gcm', KEY, Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}

export const encryptJson = (v: unknown) => encrypt(JSON.stringify(v));
export const decryptJson = <T>(blob: string) => JSON.parse(decrypt(blob)) as T;
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 48) => randomBytes(bytes).toString('base64url');
export const mask = (last4?: string | null) => (last4 ? `••••••${last4}` : null);
