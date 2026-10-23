CREATE TYPE "public"."run_status" AS ENUM('DRAFT', 'CALCULATED', 'FINALISED');--> statement-breakpoint
CREATE TABLE "payroll_input" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"lop_days" numeric(5, 1) DEFAULT '0' NOT NULL,
	"bonus" numeric(14, 2) DEFAULT '0' NOT NULL,
	"other_earnings" numeric(14, 2) DEFAULT '0' NOT NULL,
	"other_deductions" numeric(14, 2) DEFAULT '0' NOT NULL,
	"hold" boolean DEFAULT false NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"month" text NOT NULL,
	"type" text DEFAULT 'regular' NOT NULL,
	"status" "run_status" DEFAULT 'DRAFT' NOT NULL,
	"totals" jsonb,
	"calculated_at" timestamp with time zone,
	"calculated_by" uuid,
	"finalised_at" timestamp with time zone,
	"finalised_by" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payslip" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"month" text NOT NULL,
	"structure_id" uuid,
	"payable_days" numeric(5, 1) NOT NULL,
	"lop_days" numeric(5, 1) NOT NULL,
	"gross" numeric(14, 2) NOT NULL,
	"total_deductions" numeric(14, 2) NOT NULL,
	"net" numeric(14, 2) NOT NULL,
	"employer_cost" numeric(14, 2) NOT NULL,
	"tds" numeric(14, 2) NOT NULL,
	"taxable_gross" numeric(14, 2) NOT NULL,
	"pf" numeric(14, 2) NOT NULL,
	"pt" numeric(14, 2) NOT NULL,
	"hold" boolean DEFAULT false NOT NULL,
	"detail" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payroll_input" ADD CONSTRAINT "payroll_input_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_input" ADD CONSTRAINT "payroll_input_run_id_payroll_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_input" ADD CONSTRAINT "payroll_input_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run" ADD CONSTRAINT "payroll_run_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslip" ADD CONSTRAINT "payslip_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslip" ADD CONSTRAINT "payslip_run_id_payroll_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslip" ADD CONSTRAINT "payslip_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_input_run_id_employee_id_index" ON "payroll_input" USING btree ("run_id","employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_run_company_id_month_type_index" ON "payroll_run" USING btree ("company_id","month","type");--> statement-breakpoint
CREATE UNIQUE INDEX "payslip_run_id_employee_id_index" ON "payslip" USING btree ("run_id","employee_id");--> statement-breakpoint
CREATE INDEX "payslip_company_id_employee_id_month_index" ON "payslip" USING btree ("company_id","employee_id","month");