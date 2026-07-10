import { z } from 'zod';

/**
 * Central, validated view of process.env. Import `env` anywhere; never read
 * process.env directly elsewhere. Fails fast at boot on invalid config.
 */
const schema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  ALLOWED_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((s) =>
      s
        .split(',')
        .map((o) => o.trim().replace(/\/$/, ''))
        .filter(Boolean),
    ),

  JWT_SECRET: z.string().min(1).default('dev-insecure-secret-change-me'),
  OPERATOR_PASSWORD_HASH: z.string().optional(),
  OPERATOR_PASSWORD: z.string().optional(),
  OPERATOR_JWT_TTL: z.string().default('12h'),

  FIREBASE_SERVICE_ACCOUNT_B64: z.string().optional(),

  REDIS_URL: z.string().optional(),
  SNAPSHOT_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
