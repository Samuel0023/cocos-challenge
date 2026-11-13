import path from 'node:path';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';

const root = path.resolve(import.meta.dirname, '../..');

/** Starts one throwaway PostgreSQL loaded with the challenge seed and our migration. */
export default async function setup(project: TestProject) {
  const container = await new PostgreSqlContainer('postgres:17-alpine')
    .withDatabase('cocos')
    .withUsername('cocos')
    .withPassword('cocos')
    .withCopyFilesToContainer([
      {
        source: path.join(root, 'db/database.sql'),
        target: '/docker-entrypoint-initdb.d/01-database.sql',
      },
      {
        source: path.join(root, 'db/migrations/001_constraints_and_analytics.sql'),
        target: '/docker-entrypoint-initdb.d/02-migration.sql',
      },
    ])
    .start();

  project.provide(
    'adminDatabaseUrl',
    container.getConnectionUri().replace(/\/cocos$/, '/postgres'),
  );

  return async () => {
    await container.stop();
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    adminDatabaseUrl: string;
  }
}
