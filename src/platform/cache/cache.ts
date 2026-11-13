/**
 * Best-effort cache. Implementations must never throw: a failed read is a miss
 * and a failed write is ignored, so callers always fall back to PostgreSQL.
 */
export interface Cache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}
