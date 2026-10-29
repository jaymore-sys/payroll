/**
 * PayrollPro data model (spec §16), MySQL / MariaDB. Every tenant table carries company_id; money is decimal(14,2).
 * Sensitive columns (*_enc) hold AES-256-GCM ciphertext — see src/lib/crypto.ts.
 * Ids are UUID strings made by the app; short text is varchar so it can be indexed, long text is text.
 */
import { randomUUID } from 'node:crypto';
import {
  bigint, boolean, date as dateCol, decimal, index, int, json, mysqlEnum, mysqlTable as pgTable, text, timestamp as ts, uniqueIndex, varchar,
} from 'drizzle-orm/mysql-core';

const uuid = (name: string) => varchar(name, { length: 36 });
const str = (name: string, length = 255) => varchar(name, { length });
const date = (name: string) => dateCol(name, { mode: 'string' });
const timestamp = (name: string, _o?: unknown) => ts(name, { mode: 'date', fsp: 3 });
const jsonb = json;
const integer = int;
const numeric = (name: string, o: { precision: number; scale: number }) => decimal(name, o);
const id = () => uuid('id').primaryKey().$defaultFn(() => randomUUID());
const companyId = () => uuid('company_id').notNull().references(() => companies.id);
const stamps = {
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow().$onUpdate(() => new Date()),
};
const money = (name: string) => numeric(name, { precision: 14, scale: 2 });
const days = (name: string) => numeric(name, { precision: 6, scale: 1 });

export const ROLES = ['SUPER_ADMIN', 'COMPANY_ADMIN', 'PAYROLL_MANAGER', 'REPORTING_MANAGER', 'EMPLOYEE'] as const;
export type Role = (typeof ROLES)[number];
const EMP_STATUS = ['DRAFT', 'ONBOARDING', 'ACTIVE', 'NOTICE', 'EXITED', 'SETTLED'] as const;
const LEAVE_STATUS = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
const RUN_STATUS = ['DRAFT', 'CALCULATED', 'FINALISED'] as const;
const empStatusEnum = (name: string) => mysqlEnum(name, EMP_STATUS);
const leaveStatusEnum = (name: string) => mysqlEnum(name, LEAVE_STATUS);
const runStatusEnum = (name: string) => mysqlEnum(name, RUN_STATUS);

export const companies = pgTable('company', {
  id: id(),
  name: str('name').notNull(),
  legalName: str('legal_name'), pan: str('pan'), tan: str('tan'), cin: str('cin'), gstin: str('gstin'), address: text('address'),
  fyStartMonth: integer('fy_start_month').notNull().default(4),
  payDay: integer('pay_day').notNull().default(1),
  cutoffDay: integer('cutoff_day').notNull().default(25),
  payableDaysMethod: str('payable_days_method').notNull().default('calendar'),
  pfCapMode: str('pf_cap_mode').notNull().default('capped'),
  labourCodeMode: boolean('labour_code_mode').notNull().default(true),
  twoPersonRule: boolean('two_person_rule').notNull().default(false),
  /** Off when the company is not registered under ESI (RazorpayX: ESIC "Company Disabled"). */
  esiEnabled: boolean('esi_enabled').notNull().default(true),
  employeeCodePrefix: str('employee_code_prefix').notNull().default('EMP'),
  nextEmployeeSeq: integer('next_employee_seq').notNull().default(1),
  /** Weekly-off pattern for leave counting: 0 = Sunday; offSaturdaysOfMonth e.g. [2, 4]. */
  weekPattern: jsonb('week_pattern').$type<{ weeklyOffs: number[]; offSaturdaysOfMonth?: number[] }>().notNull().$defaultFn(() => ({ weeklyOffs: [0], offSaturdaysOfMonth: [2, 4] })),
  ...stamps,
});

export const entities = pgTable('legal_entity', {
  id: id(), companyId: companyId(), name: str('name').notNull(),
  pan: str('pan'), tan: str('tan'), pfCode: str('pf_code'), esiCode: str('esi_code'), ...stamps,
}, (t) => [index('legal_entity_company_id_idx').on(t.companyId)]);

export const branches = pgTable('branch', {
  id: id(), companyId: companyId(), entityId: uuid('entity_id').references(() => entities.id),
  name: str('name').notNull(), state: str('state').notNull(), city: str('city'),
  metro: boolean('metro').notNull().default(false), ptRegNo: str('pt_reg_no'), lwfRegNo: str('lwf_reg_no'), ...stamps,
}, (t) => [index('branch_company_id_idx').on(t.companyId)]);

export const departments = pgTable('department', { id: id(), companyId: companyId(), name: str('name').notNull(), ...stamps },
  (t) => [uniqueIndex('department_company_id_name_uq').on(t.companyId, t.name)]);
export const designations = pgTable('designation', { id: id(), companyId: companyId(), name: str('name').notNull(), ...stamps },
  (t) => [uniqueIndex('designation_company_id_name_uq').on(t.companyId, t.name)]);

export const holidays = pgTable('holiday', {
  id: id(), companyId: companyId(), state: str('state'), date: date('date').notNull(), name: str('name').notNull(),
  restricted: boolean('restricted').notNull().default(false), ...stamps,
}, (t) => [index('holiday_company_id_date_idx').on(t.companyId, t.date)]);

export const employees = pgTable('employee', {
  id: id(), companyId: companyId(),
  code: str('code').notNull(),
  firstName: str('first_name').notNull(), middleName: str('middle_name'), lastName: str('last_name').notNull(),
  dob: date('dob'), gender: str('gender').notNull(), maritalStatus: str('marital_status'),
  workEmail: str('work_email').notNull(), personalEmail: str('personal_email'), mobile: str('mobile'),
  branchId: uuid('branch_id').references(() => branches.id),
  departmentId: uuid('department_id').references(() => departments.id),
  designationId: uuid('designation_id').references(() => designations.id),
  managerId: uuid('manager_id'),
  doj: date('doj').notNull(),
  employmentType: str('employment_type').notNull().default('permanent'),
  status: empStatusEnum('status').notNull().default('ACTIVE'),
  probationEnd: date('probation_end'), noticeDays: integer('notice_days').notNull().default(30),
  panEnc: text('pan_enc'), panLast4: str('pan_last4'),
  bankEnc: text('bank_enc'), bankLast4: str('bank_last4'),
  aadhaarLast4: str('aadhaar_last4'), uan: str('uan'), esiIp: str('esi_ip'),
  pfOptOut: boolean('pf_opt_out').notNull().default(false),
  international: boolean('international').notNull().default(false),
  taxRegime: str('tax_regime').notNull().default('new'),
  metro: boolean('metro').notNull().default(false),
  lastWorkingDay: date('last_working_day'), exitReason: text('exit_reason'),
  createdBy: uuid('created_by'), ...stamps,
}, (t) => [uniqueIndex('employee_company_id_code_uq').on(t.companyId, t.code), uniqueIndex('employee_company_id_work_email_uq').on(t.companyId, t.workEmail), index('employee_company_id_status_idx').on(t.companyId, t.status)]);

export const users = pgTable('app_user', {
  id: id(), companyId: companyId(),
  email: str('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  roles: jsonb('roles').$type<Role[]>().notNull().$defaultFn(() => ['EMPLOYEE']),
  employeeId: uuid('employee_id').unique().references(() => employees.id),
  active: boolean('active').notNull().default(true),
  failedLogins: integer('failed_logins').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  tokenVersion: integer('token_version').notNull().default(0),
  totpSecretEnc: text('totp_secret_enc'),
  totpEnabled: boolean('totp_enabled').notNull().default(false),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  /** Set for a default/temporary password: every screen is blocked until the user picks their own. */
  mustChangePassword: boolean('must_change_password').notNull().default(false),
  ...stamps,
}, (t) => [index('app_user_company_id_idx').on(t.companyId)]);

export const refreshTokens = pgTable('refresh_token', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: str('token_hash').notNull().unique(),
  family: uuid('family').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  ip: str('ip'), userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('refresh_token_family_idx').on(t.family)]);

export const salaryStructures = pgTable('salary_structure', {
  id: id(), companyId: companyId(),
  employeeId: uuid('employee_id').notNull().references(() => employees.id),
  annualCtc: money('annual_ctc').notNull(),
  annualVariable: money('annual_variable').notNull().default('0'),
  monthlyGross: money('monthly_gross').notNull(),
  employerCost: money('employer_cost').notNull(),
  deemedWages: money('deemed_wages').notNull().default('0'),
  pfCapMode: str('pf_cap_mode').notNull(),
  effectiveFrom: date('effective_from').notNull(),
  effectiveTo: date('effective_to'),
  breakup: jsonb('breakup').notNull(), // ponytail: JSON breakup instead of structure_line rows; split out when reports need SQL over components
  createdBy: uuid('created_by'), ...stamps,
}, (t) => [index('salary_structure_company_id_employee_id_effective_from_idx').on(t.companyId, t.employeeId, t.effectiveFrom)]);

export const leaveTypes = pgTable('leave_type', {
  id: id(), companyId: companyId(),
  code: str('code').notNull(), name: str('name').notNull(),
  paid: boolean('paid').notNull().default(true),
  quota: days('quota').notNull(),
  accrual: str('accrual').notNull().default('upfront'),
  proration: str('proration').notNull().default('months'),
  carryCap: days('carry_cap').notNull().default('0'),
  encashCap: days('encash_cap').notNull().default('0'),
  encashDivisor: integer('encash_divisor').notNull().default(26),
  sandwich: boolean('sandwich').notNull().default(false),
  allowNegative: days('allow_negative').notNull().default('0'),
  minNoticeDays: integer('min_notice_days').notNull().default(0),
  maxPerRequest: days('max_per_request').notNull().default('10'),
  halfDay: boolean('half_day').notNull().default(true),
  docAfterDays: integer('doc_after_days'),
  gender: str('gender'),
  active: boolean('active').notNull().default(true),
  ...stamps,
}, (t) => [uniqueIndex('leave_type_company_id_code_uq').on(t.companyId, t.code)]);

export const leaveLedger = pgTable('leave_ledger', {
  id: id(), companyId: companyId(),
  employeeId: uuid('employee_id').notNull().references(() => employees.id),
  leaveTypeId: uuid('leave_type_id').notNull().references(() => leaveTypes.id),
  date: date('date').notNull(),
  kind: str('kind').notNull(),
  days: days('days').notNull(),
  refType: str('ref_type'), refId: str('ref_id'), note: text('note'),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('leave_ledger_company_id_employee_id_leave_type_id_idx').on(t.companyId, t.employeeId, t.leaveTypeId)]);

export const leaveRequests = pgTable('leave_request', {
  id: id(), companyId: companyId(),
  employeeId: uuid('employee_id').notNull().references(() => employees.id),
  leaveTypeId: uuid('leave_type_id').notNull().references(() => leaveTypes.id),
  fromDate: date('from_date').notNull(), toDate: date('to_date').notNull(),
  halfDayFrom: boolean('half_day_from').notNull().default(false),
  halfDayTo: boolean('half_day_to').notNull().default(false),
  daysCounted: days('days_counted').notNull(),
  status: leaveStatusEnum('status').notNull().default('PENDING'),
  reason: text('reason'),
  approverId: uuid('approver_id'), decisionNote: text('decision_note'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  ...stamps,
}, (t) => [index('leave_request_company_id_employee_id_status_idx').on(t.companyId, t.employeeId, t.status)]);

export const changeRequests = pgTable('change_request', {
  id: id(), companyId: companyId(),
  employeeId: uuid('employee_id').notNull().references(() => employees.id),
  field: str('field').notNull(),
  valueEnc: text('value_enc').notNull(),
  status: str('status').notNull().default('PENDING'),
  reviewedBy: uuid('reviewed_by'), reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('change_request_company_id_status_idx').on(t.companyId, t.status)]);

export const statutoryRules = pgTable('statutory_rule', {
  id: id(), ruleKey: str('rule_key').notNull().unique(), ruleType: str('rule_type').notNull(), state: str('state'),
  effectiveFrom: date('effective_from').notNull(), effectiveTo: date('effective_to'),
  params: jsonb('params').notNull(), sourceNote: text('source_note').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const taxRules = pgTable('tax_rule', {
  id: id(), taxYear: str('tax_year').notNull(), regime: str('regime').notNull(), ageBand: str('age_band').notNull(),
  data: jsonb('data').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('tax_rule_tax_year_regime_age_band_uq').on(t.taxYear, t.regime, t.ageBand)]);

/** Append-only: the app never updates or deletes it; a trigger blocks it where the database allows triggers (src/db/index.ts). */
export const auditLog = pgTable('audit_log', {
  id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  companyId: uuid('company_id'), userId: uuid('user_id'),
  action: str('action').notNull(), entity: str('entity').notNull(), entityId: str('entity_id'),
  before: jsonb('before'), after: jsonb('after'), ip: str('ip'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('audit_log_company_id_at_idx').on(t.companyId, t.at), index('audit_log_entity_entity_id_idx').on(t.entity, t.entityId)]);

export const notifications = pgTable('notification', {
  id: id(), companyId: companyId(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(), body: text('body'), link: text('link'),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('notification_user_id_read_at_idx').on(t.userId, t.readAt)]);

/* ---------- Payroll runs (spec §10) ---------- */

export const payrollRuns = pgTable('payroll_run', {
  id: id(), companyId: companyId(),
  month: str('month').notNull(), // YYYY-MM
  type: str('type').notNull().default('regular'),
  status: runStatusEnum('status').notNull().default('DRAFT'),
  totals: jsonb('totals'),
  calculatedAt: timestamp('calculated_at', { withTimezone: true }), calculatedBy: uuid('calculated_by'),
  finalisedAt: timestamp('finalised_at', { withTimezone: true }), finalisedBy: uuid('finalised_by'),
  createdBy: uuid('created_by'), ...stamps,
}, (t) => [uniqueIndex('payroll_run_company_id_month_type_uq').on(t.companyId, t.month, t.type)]);

/** Per-employee monthly inputs HR can edit until the run is finalised. */
export const payrollInputs = pgTable('payroll_input', {
  id: id(), companyId: companyId(),
  runId: uuid('run_id').notNull().references(() => payrollRuns.id, { onDelete: 'cascade' }),
  employeeId: uuid('employee_id').notNull().references(() => employees.id),
  lopDays: numeric('lop_days', { precision: 5, scale: 1 }).notNull().default('0'),
  bonus: money('bonus').notNull().default('0'),
  otherEarnings: money('other_earnings').notNull().default('0'),
  otherDeductions: money('other_deductions').notNull().default('0'),
  hold: boolean('hold').notNull().default(false),
  note: text('note'),
  ...stamps,
}, (t) => [uniqueIndex('payroll_input_run_id_employee_id_uq').on(t.runId, t.employeeId)]);

export const payslips = pgTable('payslip', {
  id: id(), companyId: companyId(),
  runId: uuid('run_id').notNull().references(() => payrollRuns.id, { onDelete: 'cascade' }),
  employeeId: uuid('employee_id').notNull().references(() => employees.id),
  month: str('month').notNull(),
  structureId: uuid('structure_id'),
  payableDays: numeric('payable_days', { precision: 5, scale: 1 }).notNull(),
  lopDays: numeric('lop_days', { precision: 5, scale: 1 }).notNull(),
  gross: money('gross').notNull(),
  totalDeductions: money('total_deductions').notNull(),
  net: money('net').notNull(),
  employerCost: money('employer_cost').notNull(),
  tds: money('tds').notNull(),
  taxableGross: money('taxable_gross').notNull(),
  pf: money('pf').notNull(), pt: money('pt').notNull(),
  hold: boolean('hold').notNull().default(false),
  detail: jsonb('detail').notNull(), // full engine output: lines, tax worksheet, notes
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('payslip_run_id_employee_id_uq').on(t.runId, t.employeeId), index('payslip_company_id_employee_id_month_idx').on(t.companyId, t.employeeId, t.month)]);

/* ---------- Monthly attendance entered by managers (leave itself is applied in another system) ---------- */
export const attendanceMonths = pgTable('attendance_month', {
  id: id(), companyId: companyId(),
  employeeId: uuid('employee_id').notNull().references(() => employees.id),
  month: str('month').notNull(), // YYYY-MM
  workingDays: numeric('working_days', { precision: 5, scale: 1 }).notNull(),
  presentDays: numeric('present_days', { precision: 5, scale: 1 }).notNull(),
  paidLeaveDays: numeric('paid_leave_days', { precision: 5, scale: 1 }).notNull().default('0'),
  lopDays: numeric('lop_days', { precision: 5, scale: 1 }).notNull().default('0'),
  overtimeHours: numeric('overtime_hours', { precision: 6, scale: 1 }).notNull().default('0'),
  note: text('note'),
  enteredBy: uuid('entered_by'),
  ...stamps,
}, (t) => [uniqueIndex('attendance_month_company_id_employee_id_month_uq').on(t.companyId, t.employeeId, t.month), index('attendance_month_company_id_month_idx').on(t.companyId, t.month)]);

/* ---------- Consultants: fixed monthly fee, cut for leave, TDS on professional fees (no PF/ESI/PT) ---------- */
export const consultants = pgTable('consultant', {
  id: id(), companyId: companyId(),
  code: str('code'),
  name: str('name').notNull(),
  email: str('email'),
  panEnc: text('pan_enc'), panLast4: str('pan_last4'),
  bankEnc: text('bank_enc'), bankLast4: str('bank_last4'),
  monthlyFee: money('monthly_fee').notNull(),
  tdsRate: numeric('tds_rate', { precision: 5, scale: 4 }).notNull().default('0.1'), // 10% professional fees; 2% technical services
  startDate: date('start_date').notNull(),
  endDate: date('end_date'),
  active: boolean('active').notNull().default(true),
  ...stamps,
}, (t) => [index('consultant_company_id_idx').on(t.companyId)]);

export const consultantRuns = pgTable('consultant_run', {
  id: id(), companyId: companyId(),
  month: str('month').notNull(),
  status: runStatusEnum('status').notNull().default('DRAFT'),
  totals: jsonb('totals'),
  calculatedAt: timestamp('calculated_at', { withTimezone: true }),
  approvedAt: timestamp('approved_at', { withTimezone: true }), approvedBy: uuid('approved_by'),
  createdBy: uuid('created_by'), ...stamps,
}, (t) => [uniqueIndex('consultant_run_company_id_month_uq').on(t.companyId, t.month)]);

export const consultantPayments = pgTable('consultant_payment', {
  id: id(), companyId: companyId(),
  runId: uuid('run_id').notNull().references(() => consultantRuns.id, { onDelete: 'cascade' }),
  consultantId: uuid('consultant_id').notNull().references(() => consultants.id),
  fee: money('fee').notNull(),
  daysInMonth: integer('days_in_month').notNull(),
  lopDays: numeric('lop_days', { precision: 5, scale: 1 }).notNull().default('0'),
  adjustment: money('adjustment').notNull().default('0'), // one-off additions (+) or recoveries (−)
  amount: money('amount'), tds: money('tds'), net: money('net'),
  note: text('note'),
  ...stamps,
}, (t) => [uniqueIndex('consultant_payment_run_id_consultant_id_uq').on(t.runId, t.consultantId)]);
