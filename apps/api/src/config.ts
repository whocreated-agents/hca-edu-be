import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().default(3001),
  DATABASE_URL: z.string().min(1),
  WEB_ORIGIN: z.url().default('http://localhost:3000'),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  /** Mixed into refresh/reset/verify token hashes so a database leak alone cannot validate a token. */
  TOKEN_PEPPER: z.string().min(32, 'TOKEN_PEPPER must be at least 32 characters'),
  COOKIE_SECURE: bool.default(true),
  TRUST_PROXY: bool.default(true),
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().default(1025),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  SMTP_FROM: z.string().default('HCA <no-reply@hca.edu.in>'),
  /** Test-only switches. */
  RATE_LIMIT_ENABLED: bool.default(true),
  ARGON2_FAST: bool.default(false),
  MAIL_TRANSPORT: z.enum(['smtp', 'memory']).default('smtp'),
  /** 32 raw bytes, base64-encoded. AES-256-GCM key for StudentSensitive fields; see field-cipher.service.ts. */
  FIELD_ENCRYPTION_KEY: z
    .string()
    .min(1)
    .refine((v) => {
      try {
        return Buffer.from(v, 'base64').length === 32;
      } catch {
        return false;
      }
    }, 'FIELD_ENCRYPTION_KEY must be 32 bytes, base64-encoded'),
  /** Root directory for the local-volume storage backend (ADR-001: swappable for S3 later). */
  FILE_STORAGE_ROOT: z.string().min(1).default('./var/storage'),
  /** HMAC key for signed file URLs (storage.service.ts). Reuses TOKEN_PEPPER's entropy bar. */
  FILE_SIGNING_SECRET: z.string().min(32, 'FILE_SIGNING_SECRET must be at least 32 characters'),
});
export type Config = z.infer<typeof Env>;

export const CONFIG = Symbol('CONFIG');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment:\n${lines}`);
  }
  const c = parsed.data;
  if (c.NODE_ENV === 'production') {
    if (!c.COOKIE_SECURE) throw new Error('COOKIE_SECURE must be true in production');
    if (c.ARGON2_FAST || !c.RATE_LIMIT_ENABLED) throw new Error('Test-only switches are set in production');
  }
  return c;
}
