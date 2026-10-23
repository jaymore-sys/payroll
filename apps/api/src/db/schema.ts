/**
 * PayrollPro data model (spec §16). Every tenant table carries company_id; money is numeric(14,2).
 * Sensitive columns (*_enc) hold AES-256-GCM ciphertext — see src/lib/crypto.ts.
 */
import { sql } from 'drizzle-orm';
import {
  bigserial, boolean, date, index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().defaultRandom();
const companyId = () => uuid('company_id').notNull().references(() => companies.id);
const stamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
};
const money = (name: string) => numeric(name, { precision: 14, scale: 2 });
const days = (name: string) => numeric(name, { precision: 6, scale: 1 });

export const roleEnum = pgEnum('role', ['SUPER_ADMIN', 'COMPANY_ADMIN', 'PAYROLL_MANAGER', 'REPORTING_MANAGER', 'EMPLOYEE']);
export const empStatusEnum = pgEnum('employee_status', ['DRAFT', 'ONBOARDING', 'ACTIVE', 'NOTICE', 'EXITED', 'SETTLED']);
export const leaveStatusEnum = pgEnum('leave_status', ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']);
export type Role = (typeof roleEnum.enumValues)[number];

export const companies = pgTable('company', {
  id: id(),
  name: text('name').notNull(),
  legalName: text('legal_name'), pan: text('pan'), tan: text('tan'), cin: text('cin'), gstin: text('gstin'), address: text('address'),
  fyStartMonth: integer('fy_start_month').notNull().default(4),
  payDay: integer('pay_day').notNull().default(1),
  cutoffDay: integer('cutoff_day').notNull().default(25),
  payableDaysMethod: text('payable_days_method').notNull().default('calendar'),
  pfCapMode: text('pf_cap_mode').notNull().default('capped'),
  labourCodeMode: boolean('labour_code_mode').notNull().default(true),
  twoPersonRule: boolean('two_person_rule').notNull().default(false),
  employeeCodePrefix: text('employee_code_prefix').notNull().default('EMP'),
  nextEmployeeSeq: integer('next_employee_seq').notNull().default(1),
  /** Weekly-off pattern for leave counting: 0 = Sunday; offSaturdaysOfMonth e.g. [2, 4]. */
  weekPattern: jsonb('week_pattern').$type<{ weeklyOffs: number[]; offSaturdaysOfMonth?: number[] }>().notNull().default({ weeklyOffs: [0], offSaturdaysOfMonth: [2, 4] }),
  ...stamps,
});

export const entities = pgTable('legal_entity', {
  id: id(), companyId: companyId(), name: text('name').notNull(),
  pan: text('pan'), tan: text('tan'), pfCode: text('pf_code'), esiCode: text('esi_code'), ...stamps,
}, (t) => [index().on(t.companyId)]);

export const branches = pgTable('branch', {
  id: id(), companyId: companyId(), entityId: uuid('entity_id').references(() => entities.id),
  name: text('name').notNull(), state: text('state').notNull(), city: text('city'),
  metro: boolean('metro').notNull().default(false), ptRegNo: text('pt_reg_no'), lwfRegNo: text('lwf_reg_no'), ...stamps,
}, (t) => [index().on(t.companyId)]);

export const departments = pgTable('department', { id: id(), companyId: companyId(), name: text('name').notNull(), ...stamps },
  (t) => [uniqueIndex().on(t.companyId, t.name)]);
export const designations = pgTable('designation', { id: id(), companyId: companyId(), name: text('name').notNull(), ...stamps },
  (t) => [uniqueIndex().on(t.companyId, t.name)]);

export const holidays = pgTable('holiday', {
  id: id(), companyId: companyId(), state: text('state'), date: date('date').notNull(), name: text('name').notNull(),
  restricted: boolean('restricted').notNull().default(false), ...stamps,
}, (t) => [index().on(t.companyId, t.date)]);

export const employees = pgTable('employee', {
  id: id(), companyId: companyId(),
  code: text('code').notNull(),
  firstName: text('first_name').notNull(), middleName: text('middle_name'), lastName: text('last_name').notNull(),
  dob: date('dob'), gender: text('gender').notNull(), maritalStatus: text('marital_status'),
  workEmail: text('work_email').notNull(), personalEmail: text('personal_email'), mobile: text('mobile'),
  branchId: uuid('branch_id').references(() => branches.id),
  departmentId: uuid('department_id').references(() => departments.id),
  designationId: uuid('designation_id').references(() => designations.id),
  managerId: uuid('manager_id'),
  doj: date('doj').notNull(),
  employmentType: text('employment_type').notNull().default('permanent'),
  status: empStatusEnum('status').notNull().default('ACTIVE'),
  probationEnd: date('probation_end'), noticeDays: integer('notice_days').notNull().default(30),
  panEnc: text('pan_enc'), panLast4: text('pan_last4'),
  bankEnc: text('bank_enc'), bankLast4: text('bank_last4'),
  aadhaarLast4: text('aadhaar_last4'), uan: text('uan'), esiIp: text('esi_ip'),
  pfOptOut: boolean('pf_opt_out').notNull().default(false),
  international: boolean('international').notNull().default(false),
  taxRegime: text('tax_regime').notNull().default('new'),
  metro: boolean('metro').notNull().default(false),
  lastWorkingDay: date('last_working_day'), exitReason: text('exit_reason'),
  createdBy: uuid('created_by'), ...stamps,
}, (t) => [uniqueIndex().on(t.companyId, t.code), uniqueIndex().on(t.companyId, t.workEmail), index().on(t.companyId, t.status)]);

export const users = pgTable('app_user', {
  id: id(), companyId: companyId(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  roles: roleEnum('roles').array().notNull().default(sql`'{EMPLOYEE}'`),
  employeeId: uuid('employee_id').unique().references(() => employees.id),
  active: boolean('active').notNull().default(true),
  failedLogins: integer('failed_logins').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  tokenVersion: integer('token_version').notNull().default(0),
  totpSecretEnc: text('totp_secret_enc'),
  totpEnabled: boolean('totp_enabled').notNull().default(false),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  ...stamps,
}, (t) => [index().on(t.companyId)]);

export const refreshTokens = pgTable('refresh_token', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  family: uuid('family').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  ip: text('ip'), userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index().on(t.family)]);

export const salaryStructures = pgTable('salary_structure', {
  id: id(), companyId: companyId(),
  employeeId: uuid('employee_id').notNull().references(() => employees.id),
  annualCtc: money('annual_ctc').notNull(),
  annualVariable: money('annual_variable').notNull().default('0'),
  monthlyGross: money('monthly_gross').notNull(),
  employerCost: money('employer_cost').notNull(),
  deemedWages: money('deemed_wages').notNull().default('0'),
  pfCapMode: text('pf_cap_mode').notNull(),
  effectiveFrom: date('effective_from').notNull(),
  effectiveTo: date('effective_to'),
  breakup: jsonb('breakup').notNull(), // ponytail: JSON breakup instead of structure_line rows; split out when reports need SQL over components
  createdBy: uuid('created_by'), ...stamps,
}, (t) => [index().on(t.companyId, t.employeeId, t.effectiveFrom)]);

export const leaveTypes = pgTable('leave_type', {
  id: id(), companyId: companyId(),
  code: text('code').notNull(), name: text('name').notNull(),
  paid: boolean('paid').notNull().default(true),
  quota: days('quota').notNull(),
  accrual: text('accrual').notNull().default('upfront'),
  proration: text('proration').notNull().default('months'),
  carryCap: days('carry_cap').notNull().default('0'),
  encashCap: days('encash_cap').notNull().default('0'),
  encashDivisor: integer('encash_divisor').notNull().default(26),
  sandwich: boolean('sandwich').notNull().default(false),
  allowNegative: days('allow_negative').notNull().default('0'),
  minNoticeDays: integer('min_notice_days').notNull().default(0),
  maxPerRequest: days('max_per_request').notNull().default('10'),
  halfDay: boolean('half_day').notNull().default(true),
  docAfterDays: integer('doc_after_days'),
  gender: text('gender'),
  active: boolean('active').notNull().default(true),
  ...stamps,
}, (t) => [uniqueIndex().on(t.companyId, t.code)]);

export const leaveLedger = pgTable('leave_ledger', {
  id: id(), companyId: companyId(),
  employeeId: uuid('employee_id').notNull().references(() => employees.id),
  leaveTypeId: uuid('leave_type_id').notNull().references(() => leaveTypes.id),
  date: date('date').notNull(),
  kind: text('kind').notNull(),
  days: days('days').notNull(),
  refType: text('ref_type'), refId: text('ref_id'), note: text('note'),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index().on(t.companyId, t.employeeId, t.leaveTypeId)]);

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
}, (t) => [index().on(t.companyId, t.employeeId, t.status)]);

export const changeRequests = pgTable('change_request', {
  id: id(), companyId: companyId(),
  employeeId: uuid('employee_id').notNull().references(() => employees.id),
  field: text('field').notNull(),
  valueEnc: text('value_enc').notNull(),
  status: text('status').notNull().default('PENDING'),
  reviewedBy: uuid('reviewed_by'), reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index().on(t.companyId, t.status)]);

export const statutoryRules = pgTable('statutory_rule', {
  id: id(), ruleKey: text('rule_key').notNull().unique(), ruleType: text('rule_type').notNull(), state: text('state'),
  effectiveFrom: date('effective_from').notNull(), effectiveTo: date('effective_to'),
  params: jsonb('params').notNull(), sourceNote: text('source_note').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const taxRules = pgTable('tax_rule', {
  id: id(), taxYear: text('tax_year').notNull(), regime: text('regime').notNull(), ageBand: text('age_band').notNull(),
  data: jsonb('data').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex().on(t.taxYear, t.regime, t.ageBand)]);

/** Append-only: a trigger in migration 0001 blocks UPDATE/DELETE. */
export const auditLog = pgTable('audit_log', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  companyId: uuid('company_id'), userId: uuid('user_id'),
  action: text('action').notNull(), entity: text('entity').notNull(), entityId: text('entity_id'),
  before: jsonb('before'), after: jsonb('after'), ip: text('ip'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index().on(t.companyId, t.at), index().on(t.entity, t.entityId)]);

export const notifications = pgTable('notification', {
  id: id(), companyId: companyId(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(), body: text('body'), link: text('link'),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index().on(t.userId, t.readAt)]);

/* ---------- Payroll runs (spec §10) ---------- */
export const runStatusEnum = pgEnum('run_status', ['DRAFT', 'CALCULATED', 'FINALISED']);

export const payrollRuns = pgTable('payroll_run', {
  id: id(), companyId: companyId(),
  month: text('month').notNull(), // YYYY-MM
  type: text('type').notNull().default('regular'),
  status: runStatusEnum('status').notNull().default('DRAFT'),
  totals: jsonb('totals'),
  calculatedAt: timestamp('calculated_at', { withTimezone: true }), calculatedBy: uuid('calculated_by'),
  finalisedAt: timestamp('finalised_at', { withTimezone: true }), finalisedBy: uuid('finalised_by'),
  createdBy: uuid('created_by'), ...stamps,
}, (t) => [uniqueIndex().on(t.companyId, t.month, t.type)]);

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
}, (t) => [uniqueIndex().on(t.runId, t.employeeId)]);

export const payslips = pgTable('payslip', {
  id: id(), companyId: companyId(),
  runId: uuid('run_id').notNull().references(() => payrollRuns.id, { onDelete: 'cascade' }),
  employeeId: uuid('employee_id').notNull().references(() => employees.id),
  month: text('month').notNull(),
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
}, (t) => [uniqueIndex().on(t.runId, t.employeeId), index().on(t.companyId, t.employeeId, t.month)]);

/* ---------- Monthly attendance entered by managers (leave itself is applied in another system) ---------- */
export const attendanceMonths = pgTable('attendance_month', {
  id: id(), companyId: companyId(),
  employeeId: uuid('employee_id').notNull().references(() => employees.id),
  month: text('month').notNull(), // YYYY-MM
  workingDays: numeric('working_days', { precision: 5, scale: 1 }).notNull(),
  presentDays: numeric('present_days', { precision: 5, scale: 1 }).notNull(),
  paidLeaveDays: numeric('paid_leave_days', { precision: 5, scale: 1 }).notNull().default('0'),
  lopDays: numeric('lop_days', { precision: 5, scale: 1 }).notNull().default('0'),
  overtimeHours: numeric('overtime_hours', { precision: 6, scale: 1 }).notNull().default('0'),
  note: text('note'),
  enteredBy: uuid('entered_by'),
  ...stamps,
}, (t) => [uniqueIndex().on(t.companyId, t.employeeId, t.month), index().on(t.companyId, t.month)]);
