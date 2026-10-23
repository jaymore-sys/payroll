CREATE TABLE "attendance_month" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"month" text NOT NULL,
	"working_days" numeric(5, 1) NOT NULL,
	"present_days" numeric(5, 1) NOT NULL,
	"paid_leave_days" numeric(5, 1) DEFAULT '0' NOT NULL,
	"lop_days" numeric(5, 1) DEFAULT '0' NOT NULL,
	"overtime_hours" numeric(6, 1) DEFAULT '0' NOT NULL,
	"note" text,
	"entered_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attendance_month" ADD CONSTRAINT "attendance_month_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_month" ADD CONSTRAINT "attendance_month_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_month_company_id_employee_id_month_index" ON "attendance_month" USING btree ("company_id","employee_id","month");--> statement-breakpoint
CREATE INDEX "attendance_month_company_id_month_index" ON "attendance_month" USING btree ("company_id","month");