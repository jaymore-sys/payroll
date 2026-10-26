// Hosting entry file (Hostinger "Express" app): runs the TypeScript API, which also serves the built web app.
// Hostinger loads this file with require(), so no top-level await here.
import { register } from 'tsx/esm/api';
process.env.NODE_ENV ||= 'production';
register();
import('./apps/api/src/server.ts').catch((e) => { console.error(e); process.exit(1); });
