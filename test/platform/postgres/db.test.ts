import { describe, expect, it, vi } from 'vitest';
import { createPool } from '../../../src/platform/postgres/db.ts';
import { silentLogger } from '../../../src/platform/logger.ts';

describe('createPool', () => {
  it('logs an error of an idle connection instead of crashing the process', async () => {
    const logger = { ...silentLogger, error: vi.fn() };
    // The pool connects lazily, so no database is needed.
    const pool = createPool('postgres://unused:unused@127.0.0.1:1/unused', logger);
    const failure = new Error('terminating connection due to administrator command');

    // An 'error' event without a listener is thrown by the emitter.
    expect(() => pool.emit('error', failure)).not.toThrow();
    expect(logger.error).toHaveBeenCalledWith({ err: failure }, 'idle postgres connection failed');

    await pool.end();
  });

  it('survives the same error when no logger is given', async () => {
    const pool = createPool('postgres://unused:unused@127.0.0.1:1/unused');

    expect(() => pool.emit('error', new Error('connection lost'))).not.toThrow();

    await pool.end();
  });
});
