# PayrollPro

Indian payroll, tax and leave software — everything RazorpayX Payroll does except move money. Built from the *PayrollPro — Software Specification (Payroll, Tax & Leave)* document.

```
packages/engines   Pure TypeScript calculators (tax, PF/ESI/PT/LWF, gratuity, bonus, CTC split, leave) — decimal.js, no DB
apps/api           Express + Drizzle ORM + PostgreSQL 16 — auth, roles, company setup, employees, salary, leave, audit
apps/web           React + Vite + Tailwind + Framer Motion — animated, responsive admin console and employee portal
```

## Run it locally — no database needed

Requirements: Node 20+. That's it.

```bash
npm install
npm run dev        # API on :4000, web on :5173
```

Open http://localhost:5173. On first start the API creates an **embedded PostgreSQL database** (PGlite — real Postgres compiled to WebAssembly, same SQL, migrations and audit trigger) in `apps/api/.data/db`, applies migrations, seeds the demo company, and generates local dev secrets in `apps/api/.data/dev-secrets.json`. Delete `apps/api/.data` to start fresh.

Demo logins (password `Demo@Pass123`, or set `SEED_PASSWORD` before first start):

| Login | Roles |
|---|---|
| admin@demo.test | Company Admin + Manager + Employee |
| payroll@demo.test | Payroll Manager |
| manager@demo.test | Reporting Manager (8 reports) |
| employee@demo.test | Employee |

```bash
npm test          # 25 engine tests + 13 API security tests (in-memory database, nothing to set up)
npm run typecheck
```

### Using a real PostgreSQL server (staging / production)

Set `DATABASE_URL` (see `apps/api/.env.example`), then `npm run db:migrate && npm run db:seed`. `docker compose up -d` gives you a local Postgres 16. With `NODE_ENV=production` the API refuses to start without `DATABASE_URL`, `JWT_SECRET` and `FIELD_ENCRYPTION_KEY` — the embedded database and generated secrets are for local use only. API tests can target Postgres with `TEST_DATABASE_URL`.

## What's built (phases 1, 2 and the UI shell of 3 & 5)

| Area | Status |
|---|---|
| **Engines** | Tax both regimes (87A + marginal relief, surcharge + marginal relief, cess, ₹10 rounding, monthly TDS, no-PAN), PF/EPS/EDLI/admin, ESI with contribution periods, state PT (MH, KA seeded), LWF, gratuity, statutory bonus, CTC split with iterative gross solve and 50% wage rule, leave proration/accrual/sandwich/half-day/year-end/encashment |
| **Rules** | Dated `statutory_rule` and `tax_rule` tables, seeded from the engine defaults — a law change is a new row |
| **Auth & security** | See below |
| **Company setup** | Company, pay settings, legal entities, branches (state → PT/LWF), departments, designations, holidays |
| **Employees** | List/search/filter, 3-step add wizard, CSV bulk import with dry-run validation report, profile, masked PII with audited reveal, edit (Payroll Manager limited to pay fields), exit, change requests (employee → HR approval), audit history |
| **Salary** | CTC builder, live preview, revisions with effective dates and history |
| **Leave** | Policy builder, balances from ledger, live leave calculator, apply / approve / reject / cancel (reversing ledger rows), team-overlap warning, standalone proration & encashment calculator |
| **Tax** | Regime comparison calculator with line-by-line worksheet |
| **Dashboard** | Role-aware: KPIs, headcount trend, cost by department, reminders/exceptions, statutory due dates, holidays, on leave today, recent activity; employee view with salary donut and leave |
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
- **Audit log:** every create/update/delete, approval, login, failed login, lockout, role change and sensitive view, with before/after and IP; secrets scrubbed. **Append-only enforced by a PostgreSQL trigger** (UPDATE/DELETE raise).
- **Input validation:** Zod on every body (PAN, TAN, GSTIN, IFSC, UAN formats), 2 MB body limit, parameterised SQL only (Drizzle).
- **Headers:** Helmet with a deny-all CSP on the API, `no-store` on all API responses, strict CORS with credentials only from `CORS_ORIGIN`, `noindex` and `no-referrer` on the web app.

**Before production:** serve over HTTPS behind a reverse proxy (set `NODE_ENV=production`), keep `FIELD_ENCRYPTION_KEY` and `JWT_SECRET` in a secrets manager, use managed Postgres in an India region with daily backups and PITR, add Postgres row-level security as defence in depth, malware-scan uploads when document storage lands, and get a penetration test before go-live. Verify every seeded statutory and tax rate against the current notification (spec §1).

## Performance & devices

Routes are code-split (charts, motion and vendor in separate chunks); the dashboard is one API call. Layout is fluid from 320 px phones (drawer + bottom tab bar, tables become cards) through tablets to wide desktops (collapsible sidebar). All animation respects the OS *reduce motion* setting. Light and dark themes follow the system and can be toggled.

## Simplifications to revisit

- Salary structure lines are stored as JSON on `salary_structure` (not a `structure_line` table) — split out when reports need SQL over components.
- Earned Leave is credited upfront in the demo seed; switch to *days worked* once the monthly accrual job lands with attendance (phase 3).
- CSV import uses a small built-in parser; swap for papaparse if HR files get messy. Excel (.xlsx) import comes with phase 6.
- Rate limits are in-memory (single instance); move to Redis when running more than one API instance.
- The embedded database is single-connection — perfect for one person trying it locally, not for a team. Use PostgreSQL for anything shared.
- 2FA setup shows the secret key and an `otpauth://` link; add a QR code if users ask.
