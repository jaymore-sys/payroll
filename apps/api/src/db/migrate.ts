import 'dotenv/config';
import { closeDb, migrateDb } from './index';

await migrateDb();
console.log('Migrations applied (MySQL)');
await closeDb();
