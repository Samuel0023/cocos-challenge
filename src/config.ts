import { z } from 'zod';

const flag = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().default('postgres://cocos:cocos@127.0.0.1:5432/cocos'),
  /** Optional: without it the API runs with no cache and reads from PostgreSQL. */
  VALKEY_URL: z.string().optional(),
  AWS_ENABLED: flag,
  CONSUMER_ENABLED: flag,
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Config = z.infer<typeof schema>;

/** Credentials always come from environment variables (decision D-15). */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return schema.parse(env);
}
