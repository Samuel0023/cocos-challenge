import { z } from 'zod';

const flag = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const schema = z
  .object({
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.string().default('postgres://cocos:cocos@127.0.0.1:5432/cocos'),
    /** Optional: without it the API runs with no cache and reads from PostgreSQL. */
    VALKEY_URL: z.string().optional(),
    AWS_ENABLED: flag,
    CONSUMER_ENABLED: flag,
    /** Only for a local emulator; unset on AWS. */
    AWS_ENDPOINT_URL: z.url().optional(),
    AWS_REGION: z.string().min(1).default('us-east-1'),
    ORDER_EVENTS_TOPIC_ARN: z.string().min(1).optional(),
    ORDER_EVENTS_QUEUE_URL: z.string().min(1).optional(),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
  })
  .superRefine((config, ctx) => {
    if (!config.AWS_ENABLED) return;
    for (const key of ['ORDER_EVENTS_TOPIC_ARN', 'ORDER_EVENTS_QUEUE_URL'] as const) {
      if (!config[key]) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} is required when AWS_ENABLED=true`,
        });
      }
    }
  });

export type Config = z.infer<typeof schema>;

/**
 * Credentials always come from environment variables (decision D-15); AWS credentials are
 * read by the SDK's default chain (environment or shared files), never from Secrets Manager.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return schema.parse(env);
}
