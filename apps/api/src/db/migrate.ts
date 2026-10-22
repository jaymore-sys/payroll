import 'dotenv/config';
import { closeDb, embedded, migrateDb } from './index';

await migrateDb();
console.log(`Migrations applied (${embedded ? 'embedded database' : 'PostgreSQL'})`);
await closeDb();
