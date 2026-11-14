import { badRequest } from '../errors.ts';

const POSITIVE_INTEGER = /^[1-9]\d*$/;
/** Largest value of an `integer` (int4) id column. */
const MAX_INT4 = 2_147_483_647;

/**
 * Reads a numeric id from the path. Not a positive integer (letters, `0`, a sign, a fraction or
 * leading zeros): 400. Above the `integer` column range: `null`, because no row can have that id
 * (PostgreSQL would reject the parameter), so the caller answers 404 as for any unknown id.
 */
export function parsePathId(raw: string, name: string): number | null {
  if (!POSITIVE_INTEGER.test(raw)) throw badRequest(`${name} must be a positive integer`);
  const id = Number(raw);
  return id > MAX_INT4 ? null : id;
}
