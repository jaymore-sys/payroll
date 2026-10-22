import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { DATA_DIR, env } from '../env';
import * as schema from './schema';

/**
 * DATABASE_URL set → real PostgreSQL. Unset → embedded PostgreSQL (PGlite, same SQL and migrations) in .data/db,
 * or in memory when PGLITE_DIR=memory://. Same query API either way.
 */
export const embedded = !env.DATABASE_URL;
const pool = embedded ? null : new pg.Pool({ connectionString: env.DATABASE_URL, max: 10 });
const lite = embedded ? new PGlite(process.env.PGLITE_DIR ?? `${DATA_DIR}/db`) : null;

// ponytail: typed as the node-postgres flavour; PGlite's drizzle exposes the same builder API.
export const db = (embedded ? drizzlePglite(lite!, { schema }) : drizzlePg(pool!, { schema })) as NodePgDatabase<typeof schema>;
export type Db = typeof db;
export { schema };

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));
export const migrateDb = () => (embedded ? migratePglite(db as any, { migrationsFolder }) : migratePg(db, { migrationsFolder }));
export const closeDb = () => (embedded ? lite!.close() : pool!.end());
