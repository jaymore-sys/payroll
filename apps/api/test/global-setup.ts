import { config } from 'dotenv';
import mysql from 'mysql2/promise';

/** Empty the test database once before the run (every table dropped; migrations recreate them). */
export default async function setup() {
  config();
  if (!process.env.TEST_DATABASE_URL) throw new Error('Set TEST_DATABASE_URL to a MySQL test database (its data is deleted)');
  const c = await mysql.createConnection(process.env.TEST_DATABASE_URL);
  const [rows] = await c.query('SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE()');
  await c.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const { t } of rows as { t: string }[]) await c.query(`DROP TABLE \`${t}\``);
  await c.end();
}
