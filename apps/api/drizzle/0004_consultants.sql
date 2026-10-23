CREATE TABLE "consultant_payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"consultant_id" uuid NOT NULL,
	"fee" numeric(14, 2) NOT NULL,
	"days_in_month" integer NOT NULL,
	"lop_days" numeric(5, 1) DEFAULT '0' NOT NULL,
	"adjustment" numeric(14, 2) DEFAULT '0' NOT NULL,
	"amount" numeric(14, 2),
	"tds" numeric(14, 2),
	"net" numeric(14, 2),
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consultant_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"month" text NOT NULL,
	"status" "run_status" DEFAULT 'DRAFT' NOT NULL,
	"totals" jsonb,
	"calculated_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consultant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"email" text,
	"pan_enc" text,
	"pan_last4" text,
	"bank_enc" text,
	"bank_last4" text,
	"monthly_fee" numeric(14, 2) NOT NULL,
	"tds_rate" numeric(5, 4) DEFAULT '0.1' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "consultant_payment" ADD CONSTRAINT "consultant_payment_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultant_payment" ADD CONSTRAINT "consultant_payment_run_id_consultant_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."consultant_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultant_payment" ADD CONSTRAINT "consultant_payment_consultant_id_consultant_id_fk" FOREIGN KEY ("consultant_id") REFERENCES "public"."consultant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultant_run" ADD CONSTRAINT "consultant_run_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultant" ADD CONSTRAINT "consultant_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "consultant_payment_run_id_consultant_id_index" ON "consultant_payment" USING btree ("run_id","consultant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "consultant_run_company_id_month_index" ON "consultant_run" USING btree ("company_id","month");--> statement-breakpoint
CREATE INDEX "consultant_company_id_index" ON "consultant" USING btree ("company_id");