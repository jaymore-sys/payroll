import { config } from 'dotenv';
config();
// Tests need a MySQL / MariaDB test database (it is emptied): TEST_DATABASE_URL=mysql://user:pass@127.0.0.1:3306/payrollpro_test
if (!process.env.TEST_DATABASE_URL) throw new Error('Set TEST_DATABASE_URL to a MySQL test database (its data is deleted)');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.NODE_ENV = 'test';
