// Hosting entry file (Hostinger "Express" app): runs the TypeScript API, which also serves the built web app.
import { register } from 'tsx/esm/api';
process.env.NODE_ENV ||= 'production';
register();
await import('./apps/api/src/server.ts');
