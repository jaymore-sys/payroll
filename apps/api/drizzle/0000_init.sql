CREATE TYPE "public"."employee_status" AS ENUM('DRAFT', 'ONBOARDING', 'ACTIVE', 'NOTICE', 'EXITED', 'SETTLED');--> statement-breakpoint
CREATE TYPE "public"."leave_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('SUPER_ADMIN', 'COMPANY_ADMIN', 'PAYROLL_MANAGER', 'REPORTING_MANAGER', 'EMPLOYEE');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_id" uuid,
	"user_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"before" jsonb,
	"after" jsonb,
	"ip" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"entity_id" uuid,
	"name" text NOT NULL,
	"state" text NOT NULL,
	"city" text,
	"metro" boolean DEFAULT false NOT NULL,
	"pt_reg_no" text,
	"lwf_reg_no" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "change_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"field" text NOT NULL,
	"value_enc" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"pan" text,
	"tan" text,
	"cin" text,
	"gstin" text,
	"address" text,
	"fy_start_month" integer DEFAULT 4 NOT NULL,
	"pay_day" integer DEFAULT 1 NOT NULL,
	"cutoff_day" integer DEFAULT 25 NOT NULL,
	"payable_days_method" text DEFAULT 'calendar' NOT NULL,
	"pf_cap_mode" text DEFAULT 'capped' NOT NULL,
	"labour_code_mode" boolean DEFAULT true NOT NULL,
	"two_person_rule" boolean DEFAULT false NOT NULL,
	"employee_code_prefix" text DEFAULT 'EMP' NOT NULL,
	"next_employee_seq" integer DEFAULT 1 NOT NULL,
	"week_pattern" jsonb DEFAULT '{"weeklyOffs":[0],"offSaturdaysOfMonth":[2,4]}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "department" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "designation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"first_name" text NOT NULL,
	"middle_name" text,
	"last_name" text NOT NULL,
	"dob" date,
	"gender" text NOT NULL,
	"marital_status" text,
	"work_email" text NOT NULL,
	"personal_email" text,
	"mobile" text,
	"branch_id" uuid,
	"department_id" uuid,
	"designation_id" uuid,
	"manager_id" uuid,
	"doj" date NOT NULL,
	"employment_type" text DEFAULT 'permanent' NOT NULL,
	"status" "employee_status" DEFAULT 'ACTIVE' NOT NULL,
	"probation_end" date,
	"notice_days" integer DEFAULT 30 NOT NULL,
	"pan_enc" text,
	"pan_last4" text,
	"bank_enc" text,
	"bank_last4" text,
	"aadhaar_last4" text,
	"uan" text,
	"esi_ip" text,
	"pf_opt_out" boolean DEFAULT false NOT NULL,
	"international" boolean DEFAULT false NOT NULL,
	"tax_regime" text DEFAULT 'new' NOT NULL,
	"metro" boolean DEFAULT false NOT NULL,
	"last_working_day" date,
	"exit_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal_entity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"pan" text,
	"tan" text,
	"pf_code" text,
	"esi_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holiday" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"state" text,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"restricted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"date" date NOT NULL,
	"kind" text NOT NULL,
	"days" numeric(6, 1) NOT NULL,
	"ref_type" text,
	"ref_id" text,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"half_day_from" boolean DEFAULT false NOT NULL,
	"half_day_to" boolean DEFAULT false NOT NULL,
	"days_counted" numeric(6, 1) NOT NULL,
	"status" "leave_status" DEFAULT 'PENDING' NOT NULL,
	"reason" text,
	"approver_id" uuid,
	"decision_note" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_type" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"paid" boolean DEFAULT true NOT NULL,
	"quota" numeric(6, 1) NOT NULL,
	"accrual" text DEFAULT 'upfront' NOT NULL,
	"proration" text DEFAULT 'months' NOT NULL,
	"carry_cap" numeric(6, 1) DEFAULT '0' NOT NULL,
	"encash_cap" numeric(6, 1) DEFAULT '0' NOT NULL,
	"encash_divisor" integer DEFAULT 26 NOT NULL,
	"sandwich" boolean DEFAULT false NOT NULL,
	"allow_negative" numeric(6, 1) DEFAULT '0' NOT NULL,
	"min_notice_days" integer DEFAULT 0 NOT NULL,
	"max_per_request" numeric(6, 1) DEFAULT '10' NOT NULL,
	"half_day" boolean DEFAULT true NOT NULL,
	"doc_after_days" integer,
	"gender" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refresh_token" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"family" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_token_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "salary_structure" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"annual_ctc" numeric(14, 2) NOT NULL,
	"annual_variable" numeric(14, 2) DEFAULT '0' NOT NULL,
	"monthly_gross" numeric(14, 2) NOT NULL,
	"employer_cost" numeric(14, 2) NOT NULL,
	"deemed_wages" numeric(14, 2) DEFAULT '0' NOT NULL,
	"pf_cap_mode" text NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"breakup" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "statutory_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_key" text NOT NULL,
	"rule_type" text NOT NULL,
	"state" text,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"params" jsonb NOT NULL,
	"source_note" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "statutory_rule_rule_key_unique" UNIQUE("rule_key")
);
--> statement-breakpoint
CREATE TABLE "tax_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tax_year" text NOT NULL,
	"regime" text NOT NULL,
	"age_band" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"roles" "role"[] DEFAULT '{EMPLOYEE}' NOT NULL,
	"employee_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"failed_logins" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"token_version" integer DEFAULT 0 NOT NULL,
	"totp_secret_enc" text,
	"totp_enabled" boolean DEFAULT false NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_user_email_unique" UNIQUE("email"),
	CONSTRAINT "app_user_employee_id_unique" UNIQUE("employee_id")
);
--> statement-breakpoint
ALTER TABLE "branch" ADD CONSTRAINT "branch_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch" ADD CONSTRAINT "branch_entity_id_legal_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_request" ADD CONSTRAINT "change_request_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_request" ADD CONSTRAINT "change_request_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department" ADD CONSTRAINT "department_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "designation" ADD CONSTRAINT "designation_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee" ADD CONSTRAINT "employee_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee" ADD CONSTRAINT "employee_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee" ADD CONSTRAINT "employee_department_id_department_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."department"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee" ADD CONSTRAINT "employee_designation_id_designation_id_fk" FOREIGN KEY ("designation_id") REFERENCES "public"."designation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_entity" ADD CONSTRAINT "legal_entity_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday" ADD CONSTRAINT "holiday_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_ledger" ADD CONSTRAINT "leave_ledger_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_ledger" ADD CONSTRAINT "leave_ledger_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_ledger" ADD CONSTRAINT "leave_ledger_leave_type_id_leave_type_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_leave_type_id_leave_type_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_type" ADD CONSTRAINT "leave_type_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_token" ADD CONSTRAINT "refresh_token_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_structure" ADD CONSTRAINT "salary_structure_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_structure" ADD CONSTRAINT "salary_structure_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_company_id_at_index" ON "audit_log" USING btree ("company_id","at");--> statement-breakpoint
CREATE INDEX "audit_log_entity_entity_id_index" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "branch_company_id_index" ON "branch" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "change_request_company_id_status_index" ON "change_request" USING btree ("company_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "department_company_id_name_index" ON "department" USING btree ("company_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "designation_company_id_name_index" ON "designation" USING btree ("company_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_company_id_code_index" ON "employee" USING btree ("company_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_company_id_work_email_index" ON "employee" USING btree ("company_id","work_email");--> statement-breakpoint
CREATE INDEX "employee_company_id_status_index" ON "employee" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "legal_entity_company_id_index" ON "legal_entity" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "holiday_company_id_date_index" ON "holiday" USING btree ("company_id","date");--> statement-breakpoint
CREATE INDEX "leave_ledger_company_id_employee_id_leave_type_id_index" ON "leave_ledger" USING btree ("company_id","employee_id","leave_type_id");--> statement-breakpoint
CREATE INDEX "leave_request_company_id_employee_id_status_index" ON "leave_request" USING btree ("company_id","employee_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_type_company_id_code_index" ON "leave_type" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "notification_user_id_read_at_index" ON "notification" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE INDEX "refresh_token_family_index" ON "refresh_token" USING btree ("family");--> statement-breakpoint
CREATE INDEX "salary_structure_company_id_employee_id_effective_from_index" ON "salary_structure" USING btree ("company_id","employee_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_rule_tax_year_regime_age_band_index" ON "tax_rule" USING btree ("tax_year","regime","age_band");--> statement-breakpoint
CREATE INDEX "app_user_company_id_index" ON "app_user" USING btree ("company_id");