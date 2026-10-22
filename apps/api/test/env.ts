import { config } from 'dotenv';
config();
// Tests run against an in-memory embedded database unless TEST_DATABASE_URL points at a real PostgreSQL test database.
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
else { delete process.env.DATABASE_URL; process.env.PGLITE_DIR = 'memory://'; }
process.env.NODE_ENV = 'test';
