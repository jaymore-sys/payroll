# PayrollPro

Indian payroll, tax and leave software — everything RazorpayX Payroll does except move money. Built from the *PayrollPro — Software Specification (Payroll, Tax & Leave)* document.

```
packages/engines   Pure TypeScript calculators (tax, PF/ESI/PT/LWF, gratuity, bonus, CTC split, leave) — decimal.js, no DB
apps/api           Express + Drizzle ORM + MySQL / MariaDB — auth, roles, company setup, employees, salary, leave, audit
apps/web           React + Vite + Tailwind + Framer Motion — animated, responsive admin console and employee portal
```

## Database: MySQL / MariaDB

PayrollPro stores everything in MySQL (Hostinger's database works as is). Set `DATABASE_URL` in `apps/api/.env`:

```
DATABASE_URL=mysql://USER:PASSWORD@HOST:3306/DATABASE     # special characters in the password URL-encoded (@ → %40)
```

The API creates and updates the tables itself on every start (`npm run db:migrate` does the same by hand).
`docker compose up -d` gives you a local MariaDB for development (`mysql://payroll:payroll@127.0.0.1:3306/payrollpro`).

```bash
npm install
npm run dev        # API on :4000, web on :5173; outside production an empty database gets the demo company
npm test           # engine tests + API tests; API tests need TEST_DATABASE_URL=mysql://…/payrollpro_test (it is emptied)
npm run typecheck
```

Demo logins (password `Demo@Pass123`): admin@demo.test, payroll@demo.test, manager@demo.test, employee@demo.test.

Keep `apps/api/.data/dev-secrets.json` (or set `FIELD_ENCRYPTION_KEY`): it holds the key that unlocks saved PAN and bank numbers.

## Online (Hostinger Node.js web app + Hostinger MySQL)

One process serves both the API and the web app.

| hPanel setting | Value |
|---|---|
| Framework | Express (or Other) |
| Node version | 22 |
| Build command | `npm run build` |
| Entry file | `server.js` |
| Environment variables | `DATABASE_URL=mysql://u…_payrollpro:PASSWORD@127.0.0.1:3306/u…_payrollpro`; on first start only: `COMPANY_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` |

On Hostinger the app reaches its MySQL at `127.0.0.1`. The encryption key is generated on first start in `~/payrollpro-data`; back that folder up with the database (hPanel → Databases → phpMyAdmin → Export).

**Copy existing data to an empty site:** `npm run push-to-live -- --url https://your-site --email <site admin> --password <password> [--from postgres://…]` reads the old PostgreSQL database, sends it over HTTPS, and the site re-encrypts PAN/bank with its own key. It only works while the site has no employees.

Other commands: `npm run import:razorpay` (RazorpayX Master CTC Report + HR Register), `npm run reset-password`, `npm run fresh` (delete everything, one admin).

## What's built (phases 1, 2 and the UI shell of 3 & 5)

| Area | Status |
|---|---|
| **Engines** | Tax both regimes (87A + marginal relief, surcharge + marginal relief, cess, ₹10 rounding, monthly TDS, no-PAN), PF/EPS/EDLI/admin, ESI with contribution periods, state PT (MH, KA seeded), LWF, gratuity, statutory bonus, CTC split with iterative gross solve and 50% wage rule, leave proration/accrual/sandwich/half-day/year-end/encashment |
| **Rules** | Dated `statutory_rule` and `tax_rule` tables, refreshed from the engine on every start — a law change is a new row. PF wage ceiling ₹25,000 (max ₹3,000) from October 2026 wages (S.O. 5109(E), 17 Sep 2026) |
| **Auth & security** | See below |
| **Company setup** | Company, pay settings, legal entities, branches (state → PT/LWF), departments, designations, holidays |
| **Employees** | List/search/filter, 3-step add wizard, CSV bulk import with dry-run validation report, profile, masked PII with audited reveal, edit (Payroll Manager limited to pay fields), exit, change requests (employee → HR approval), audit history |
| **Salary** | CTC builder, live preview, revisions with effective dates and history |
| **Attendance** | Leave is applied in your separate leave software. Managers record each team member's month (present, paid leave, LOP, overtime) or HR uploads the month's sheet (.xlsx round-trip). Working days exclude weekly offs and holidays. Locked once payroll is finalised. Payroll takes LOP from here |
| **Payroll run** | Monthly run per spec §10: everyone with a salary structure, editable LOP / bonus / other earnings / deductions / hold, LOP from manager-entered attendance, joiner/leaver proration, PF/ESI/PT/LWF, TDS with full-year projection and YTD (one-time bonus taxed in the month), net-pay floor, variance vs last month, checklist; payslips visible to employees as soon as salaries are calculated |
| **Salary Excel** | `Download Excel` on a run: Summary, Salary register (every component, deduction and employer cost), Bank transfer (full account numbers for net-banking upload, held salaries excluded), Statutory dues (PF A/c 1/2/10/21, ESI, PT by state, LWF, TDS). Audited on every download |
| **Tax** | Regime comparison calculator with line-by-line worksheet |
| **Dashboard** | Role-aware: KPIs, headcount trend, cost by department, reminders (attendance pending, payroll status, missing PAN/bank), statutory due dates, holidays, recent activity; manager view with team attendance progress; employee view with salary and latest payslip |
| **Employee portal** | Like RazorpayX: Dashboard, Pay slips by financial year with PDF download, Tax deductions (both regimes, prefilled from own salary), profile change requests |
| **Users** | Invite with one-time temp password, roles, deactivate, reset password, 2FA status, lockout status |

**Next phases (spec §19):** attendance & shifts (3), payroll run engine with arrears/variance/finalise (4), declarations & proofs (5), ECR/ESI/PT/bank/journal files, Form 130/138, reports (6), reimbursements, loans, F&F, off-cycle, email notifications, letters (7). The API and data model are laid out so each phase adds modules without reworking these.

## Security

Payroll holds PAN, bank accounts and salaries, so security is enforced on the server — the UI only hides what the API already refuses.

- **Passwords:** Argon2id (OWASP parameters); 10+ chars with mixed case and a digit. Unknown emails take the same time and message as a wrong password.
- **Brute force:** account locks for 15 minutes after 5 failures; rate limits per account+IP, per IP, and on refresh.
- **Sessions:** 15-minute JWT access token held only in memory (never localStorage); 7-day refresh token in an `httpOnly`, `SameSite=Strict`, `Secure` (prod) cookie scoped to `/api/v1/auth`, stored hashed, **rotated on every use with reuse detection** (replaying an old token revokes the whole session family). Refresh/logout require a custom header (CSRF). Password change, role change or deactivation bumps a token version and kills sessions immediately. Web app signs out after 15 minutes idle.
- **2FA:** optional TOTP (authenticator app), secret encrypted at rest.
- **Authorisation:** role checks per route plus row checks per record (admins / self / reporting line via recursive query). `companyId` always comes from the token — a `companyId` in a request body is ignored. Tests prove another company gets 404 and a manager can't see PAN, bank or salary.
- **Encryption:** PAN, bank details and TOTP secrets are AES-256-GCM encrypted per field (versioned format for key rotation). Only last-4 digits are stored in clear for masked display. Full Aadhaar is never stored.
- **Reveal on demand:** full PAN/bank only via a dedicated endpoint, `Cache-Control: no-store`, logged every time, auto-hidden after 30 s in the UI.
- **Audit log:** every create/update/delete, approval, login, failed login, lockout, role change and sensitive view, with before/after and IP; secrets scrubbed. **Append-only enforced by a database trigger** where the host allows triggers (UPDATE/DELETE raise).
- **Input validation:** Zod on every body (PAN, TAN, GSTIN, IFSC, UAN formats), 2 MB body limit, parameterised SQL only (Drizzle).
- **Headers:** Helmet with a deny-all CSP on the API, `no-store` on all API responses, strict CORS with credentials only from `CORS_ORIGIN`, `noindex` and `no-referrer` on the web app.

**Before production:** serve over HTTPS behind a reverse proxy (set `NODE_ENV=production`), keep `FIELD_ENCRYPTION_KEY` and `JWT_SECRET` in a secrets manager, keep daily database backups (Hostinger backups or phpMyAdmin exports), malware-scan uploads when document storage lands, and get a penetration test before go-live. Verify every seeded statutory and tax rate against the current notification (spec §1).

## Performance & devices

Routes are code-split (charts, motion and vendor in separate chunks); the dashboard is one API call. Layout is fluid from 320 px phones (drawer + bottom tab bar, tables become cards) through tablets to wide desktops (collapsible sidebar). All animation respects the OS *reduce motion* setting. Light and dark themes follow the system and can be toggled.

## Simplifications to revisit

- Salary structure lines are stored as JSON on `salary_structure` (not a `structure_line` table) — split out when reports need SQL over components.
- Earned Leave is credited upfront in the demo seed; switch to *days worked* once the monthly accrual job lands with attendance (phase 3).
- CSV import uses a small built-in parser; swap for papaparse if HR files get messy. Excel (.xlsx) import comes with phase 6.
- Rate limits are in-memory (single instance); move to Redis when running more than one API instance.
- 2FA setup shows the secret key and an `otpauth://` link; add a QR code if users ask.
