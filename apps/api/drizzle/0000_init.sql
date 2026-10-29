CREATE TABLE `attendance_month` (
	`id` varchar(36) NOT NULL,
	`company_id` varchar(36) NOT NULL,
	`employee_id` varchar(36) NOT NULL,
	`month` varchar(255) NOT NULL,
	`working_days` decimal(5,1) NOT NULL,
	`present_days` decimal(5,1) NOT NULL,
	`paid_leave_days` decimal(5,1) NOT NULL DEFAULT '0',
	`lop_days` decimal(5,1) NOT NULL DEFAULT '0',
	`overtime_hours` decimal(6,1) NOT NULL DEFAULT '0',
	`note` text,
	`entered_by` varchar(36),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `attendance_month_id` PRIMARY KEY(`id`),
	CONSTRAINT `attendance_month_company_id_employee_id_month_uq` UNIQUE(`company_id`,`employee_id`,`month`)
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`company_id` varchar(36),
	`user_id` varchar(36),
	`action` varchar(255) NOT NULL,
	`entity` varchar(255) NOT NULL,
	`entity_id` varchar(255),
	`before` json,
	`after` json,
	`ip` varchar(255),
	`at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `branch` (
	`id` varchar(36) NOT NULL,
	`company_id` varchar(36) NOT NULL,
	`entity_id` varchar(36),
	`name` varchar(255) NOT NULL,
	`state` varchar(255) NOT NULL,
	`city` varchar(255),
	`metro` boolean NOT NULL DEFAULT false,
	`pt_reg_no` varchar(255),
	`lwf_reg_no` varchar(255),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `branch_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `change_request` (
	`id` varchar(36) NOT NULL,
	`company_id` varchar(36) NOT NULL,
	`employee_id` varchar(36) NOT NULL,
	`field` varchar(255) NOT NULL,
	`value_enc` text NOT NULL,
	`status` varchar(255) NOT NULL DEFAULT 'PENDING',
	`reviewed_by` varchar(36),
	`reviewed_at` timestamp(3),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `change_request_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `company` (
	`id` varchar(36) NOT NULL,
	`name` varchar(255) NOT NULL,
	`legal_name` varchar(255),
	`pan` varchar(255),
	`tan` varchar(255),
	`cin` varchar(255),
	`gstin` varchar(255),
	`address` text,
	`fy_start_month` int NOT NULL DEFAULT 4,
	`pay_day` int NOT NULL DEFAULT 1,
	`cutoff_day` int NOT NULL DEFAULT 25,
	`payable_days_method` varchar(255) NOT NULL DEFAULT 'calendar',
	`pf_cap_mode` varchar(255) NOT NULL DEFAULT 'capped',
	`labour_code_mode` boolean NOT NULL DEFAULT true,
	`two_person_rule` boolean NOT NULL DEFAULT false,
	`esi_enabled` boolean NOT NULL DEFAULT true,
	`employee_code_prefix` varchar(255) NOT NULL DEFAULT 'EMP',
	`next_employee_seq` int NOT NULL DEFAULT 1,
	`week_pattern` json NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `company_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `consultant_payment` (
	`id` varchar(36) NOT NULL,
	`company_id` varchar(36) NOT NULL,
	`run_id` varchar(36) NOT NULL,
	`consultant_id` varchar(36) NOT NULL,
	`fee` decimal(14,2) NOT NULL,
	`days_in_month` int NOT NULL,
	`lop_days` decimal(5,1) NOT NULL DEFAULT '0',
	`adjustment` decimal(14,2) NOT NULL DEFAULT '0',
	`amount` decimal(14,2),
	`tds` decimal(14,2),
	`net` decimal(14,2),
	`note` text,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `consultant_payment_id` PRIMARY KEY(`id`),
	CONSTRAINT `consultant_payment_run_id_consultant_id_uq` UNIQUE(`run_id`,`consultant_id`)
);
--> statement-breakpoint
CREATE TABLE `consultant_run` (
	`id` varchar(36) NOT NULL,
	`company_id` varchar(36) NOT NULL,
	`month` varchar(255) NOT NULL,
	`status` enum('DRAFT','CALCULATED','FINALISED') NOT NULL DEFAULT 'DRAFT',
	`totals` json,
	`calculated_at` timestamp(3),
	`approved_at` timestamp(3),
	`approved_by` varchar(36),
	`created_by` varchar(36),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `consultant_run_id` PRIMARY KEY(`id`),
	CONSTRAINT `consultant_run_company_id_month_uq` UNIQUE(`company_id`,`month`)
);
--> statement-breakpoint
CREATE TABLE `consultant` (
	`id` varchar(36) NOT NULL,
	`company_id` varchar(36) NOT NULL,
	`code` varchar(255),
	`name` varchar(255) NOT NULL,
	`email` varchar(255),
	`pan_enc` text,
	`pan_last4` varchar(255),
	`bank_enc` text,
	`bank_last4` varchar(255),
	`monthly_fee` decimal(14,2) NOT NULL,
	`tds_rate` decimal(5,4) NOT NULL DEFAULT '0.1',
	`start_date` date NOT NULL,
	`end_date` date,
	`active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `consultant_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `department` (
	`id` varchar(36) NOT NULL,
	`company_id` varchar(36) NOT NULL,
	`name` varchar(255) NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `department_id` PRIMARY KEY(`id`),
	CONSTRAINT `department_company_id_name_uq` UNIQUE(`company_id`,`name`)
);
--> statement-breakpoint
CREATE TABLE `designation` (
	`id` varchar(36) NOT NULL,
	`company_id` varchar(36) NOT NULL,
	`name` varchar(255) NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `designation_id` PRIMARY KEY(`id`),
	CONSTRAINT `designation_company_id_name_uq` UNIQUE(`company_id`,`name`)
);
--> statement-breakpoint
CREATE TABLE `employee` (
	`id` varchar(36) NOT NULL,
	`company_id` varchar(36) NOT NULL,
	`code` varchar(255) NOT NULL,
	`first_name` varchar(255) NOT NULL,
	`middle_name` varchar(255),
	`last_name` varchar(255) NOT NULL,
	`dob` date,
	`gender` varchar(255) NOT NULL,
	`marital_status` varchar(255),
	`work_email` varchar(255) NOT NULL,
	`personal_email` varchar(255),
	`mobile` varchar(255),
	`branch_id` varchar(36),
	`department_id` varchar(36),
	`designation_id` varchar(36),
	`manager_id` varchar(36),
	`doj` date NOT NULL,
	`employment_type` varchar(255) NOT NULL DEFAULT 'permanent',
	`status` enum('DRAFT','ONBOARDING','ACTIVE','NOTICE','EXITED','SETTLED') NOT NULL DEFAULT 'ACTIVE',
	`probation_end` date,
	`notice_days` int NOT NULL DEFAULT 30,
	`pan_enc` text,
	`pan_last4` varchar(255),
	`bank_enc` text,
	`bank_last4` varchar(255),
	`aadhaar_last4` varchar(255),
	`uan` varchar(255),
	`esi_ip` varchar(255),
	`pf_opt_out` boolean NOT NULL DEFAULT false,
	`international` boolean NOT NULL DEFAULT false,
	`tax_regime` varchar(255) NOT NULL DEFAULT 'new',
	`metro` boolean NOT NULL DEFAULT false,
	`last_working_day` date,
	`exit_reason` text,
	`created_by` varchar(36),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `employee_id` PRIMARY KEY(`id`),
	CONSTRAINT `employee_company_id_code_uq` UNIQUE(`company_id`,`code`),
	CONSTRAINT `employee_company_id_work_email_uq` UNIQUE(`company_id`,`work_email`)
);
--> statement-breakpoint
CREATE TABLE `legal_entity` (
	`id` varchar(36) NOT NULL,
	`company_id` varchar(36) NOT NULL,
	`name` varchar(255) NOT NULL,
	`pan` varchar(255),
	`tan` varchar(255),
	`pf_code` varchar(255),
	`esi_code` varchar(255),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `legal_entity_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `holiday` (
	`id` varchar(36) NOT NULL,
	`company_id` varchar(36) NOT NULL,
	`state` varchar(255),
	`date` date NOT NULL,
	`name` varchar(255) NOT NULL,
	`restricted` boolean NOT NULL DEFAULT false,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `holiday_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `leave_ledger` (
	`id` varchar(36) NOT NULL,
	`company_id` varchar(36) NOT NULL,
	`employee_id` varchar(36) NOT NULL,
	`leave_type_id` varchar(36) NOT NULL,
	`date` date NOT NULL,
	`kind` varchar(255) NOT NULL,
	`days` decimal(6,1) NOT NULL,
	`ref_type` varchar(255),
	`ref_id` varchar(255),
	`note` text,
	`created_by` varchar(36),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `leave_ledger_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `leave_request` (
	`id` varchar(36) NOT NULL,
	`company_id` varchar(36) NOT NULL,
	`employee_id` varchar(36) NOT NULL,
	`leave_type_id` varchar(36) NOT NULL,
	`from_date` date NOT NULL,
	`to_date` date NOT NULL,
	`half_day_from` boolean NOT NULL DEFAULT false,
	`half_day_to` boolean NOT NULL DEFAULT false,
	`days_counted` decimal(6,1) NOT NULL,
	`status` enum('PENDING','APPROVED','REJECTED','CANCELLED') NOT NULL DEFAULT 'PENDING',
	`reason` text,
	`approver_id` varchar(36),
	`decision_note` text,
	`decided_at` timestamp(3),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `leave_request_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `leave_type` (
	`id` varchar(36) NOT NULL,
	`company_id` varchar(36) NOT NULL,
	`code` varchar(255) NOT NULL,
	`name` varchar(255) NOT NULL,
	`paid` boolean NOT NULL DEFAULT true,
	`quota` decimal(6,1) NOT NULL,
	`accrual` varchar(255) NOT NULL DEFAULT 'upfront',
	`proration` varchar(255) NOT NULL DEFAULT 'months',
	`carry_cap` decimal(6,1) NOT NULL DEFAULT '0',
	`encash_cap` decimal(6,1) NOT NULL DEFAULT '0',
	`encash_divisor` int NOT NULL DEFAULT 26,
	`sandwich` boolean NOT NULL DEFAULT false,
	`allow_negative` decimal(6,1) NOT NULL DEFAULT '0',
	`min_notice_days` int NOT NULL DEFAULT 0,
	`max_per_request` decimal(6,1) NOT NULL DEFAULT '10',
	`half_day` boolean NOT NULL DEFAULT true,
	`doc_after_days` int,
	`gender` varchar(255),
	`active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `leave_type_id` PRIMARY KEY(`id`),
	CONSTRAINT `leave_type_company_id_code_uq` UNIQUE(`company_id`,`code`)
);
--> statement-breakpoint
CREATE TABLE `notification` (
	`id` varchar(36) NOT NULL,
	`company_id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`link` text,
	`read_at` timestamp(3),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `notification_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `payroll_input` (
	`id` varchar(36) NOT NULL,
	`company_id` varchar(36) NOT NULL,
	`run_id` varchar(36) NOT NULL,
	`employee_id` varchar(36) NOT NULL,
	`lop_days` decimal(5,1) NOT NULL DEFAULT '0',
	`bonus` decimal(14,2) NOT NULL DEFAULT '0',
	`other_earnings` decimal(14,2) NOT NULL DEFAULT '0',
	`other_deductions` decimal(14,2) NOT NULL DEFAULT '0',
	`hold` boolean NOT NULL DEFAULT false,
	`note` text,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `payroll_input_id` PRIMARY KEY(`id`),
	CONSTRAINT `payroll_input_run_id_employee_id_uq` UNIQUE(`run_id`,`employee_id`)
);
--> statement-breakpoint
CREATE TABLE `payroll_run` (
	`id` varchar(36) NOT NULL,
	`company_id` varchar(36) NOT NULL,
	`month` varchar(255) NOT NULL,
	`type` varchar(255) NOT NULL DEFAULT 'regular',
	`status` enum('DRAFT','CALCULATED','FINALISED') NOT NULL DEFAULT 'DRAFT',
	`totals` json,
	`calculated_at` timestamp(3),
	`calculated_by` varchar(36),
	`finalised_at` timestamp(3),
	`finalised_by` varchar(36),
	`created_by` varchar(36),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `payroll_run_id` PRIMARY KEY(`id`),
	CONSTRAINT `payroll_run_company_id_month_type_uq` UNIQUE(`company_id`,`month`,`type`)
);
--> statement-breakpoint
CREATE TABLE `payslip` (
	`id` varchar(36) NOT NULL,
	`company_id` varchar(36) NOT NULL,
	`run_id` varchar(36) NOT NULL,
	`employee_id` varchar(36) NOT NULL,
	`month` varchar(255) NOT NULL,
	`structure_id` varchar(36),
	`payable_days` decimal(5,1) NOT NULL,
	`lop_days` decimal(5,1) NOT NULL,
	`gross` decimal(14,2) NOT NULL,
	`total_deductions` decimal(14,2) NOT NULL,
	`net` decimal(14,2) NOT NULL,
	`employer_cost` decimal(14,2) NOT NULL,
	`tds` decimal(14,2) NOT NULL,
	`taxable_gross` decimal(14,2) NOT NULL,
	`pf` decimal(14,2) NOT NULL,
	`pt` decimal(14,2) NOT NULL,
	`hold` boolean NOT NULL DEFAULT false,
	`detail` json NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `payslip_id` PRIMARY KEY(`id`),
	CONSTRAINT `payslip_run_id_employee_id_uq` UNIQUE(`run_id`,`employee_id`)
);
--> statement-breakpoint
CREATE TABLE `refresh_token` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`token_hash` varchar(255) NOT NULL,
	`family` varchar(36) NOT NULL,
	`expires_at` timestamp(3) NOT NULL,
	`revoked_at` timestamp(3),
	`ip` varchar(255),
	`user_agent` text,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `refresh_token_id` PRIMARY KEY(`id`),
	CONSTRAINT `refresh_token_token_hash_unique` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `salary_structure` (
	`id` varchar(36) NOT NULL,
	`company_id` varchar(36) NOT NULL,
	`employee_id` varchar(36) NOT NULL,
	`annual_ctc` decimal(14,2) NOT NULL,
	`annual_variable` decimal(14,2) NOT NULL DEFAULT '0',
	`monthly_gross` decimal(14,2) NOT NULL,
	`employer_cost` decimal(14,2) NOT NULL,
	`deemed_wages` decimal(14,2) NOT NULL DEFAULT '0',
	`pf_cap_mode` varchar(255) NOT NULL,
	`effective_from` date NOT NULL,
	`effective_to` date,
	`breakup` json NOT NULL,
	`created_by` varchar(36),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `salary_structure_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `statutory_rule` (
	`id` varchar(36) NOT NULL,
	`rule_key` varchar(255) NOT NULL,
	`rule_type` varchar(255) NOT NULL,
	`state` varchar(255),
	`effective_from` date NOT NULL,
	`effective_to` date,
	`params` json NOT NULL,
	`source_note` text NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `statutory_rule_id` PRIMARY KEY(`id`),
	CONSTRAINT `statutory_rule_rule_key_unique` UNIQUE(`rule_key`)
);
--> statement-breakpoint
CREATE TABLE `tax_rule` (
	`id` varchar(36) NOT NULL,
	`tax_year` varchar(255) NOT NULL,
	`regime` varchar(255) NOT NULL,
	`age_band` varchar(255) NOT NULL,
	`data` json NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `tax_rule_id` PRIMARY KEY(`id`),
	CONSTRAINT `tax_rule_tax_year_regime_age_band_uq` UNIQUE(`tax_year`,`regime`,`age_band`)
);
--> statement-breakpoint
CREATE TABLE `app_user` (
	`id` varchar(36) NOT NULL,
	`company_id` varchar(36) NOT NULL,
	`email` varchar(255) NOT NULL,
	`password_hash` text NOT NULL,
	`roles` json NOT NULL,
	`employee_id` varchar(36),
	`active` boolean NOT NULL DEFAULT true,
	`failed_logins` int NOT NULL DEFAULT 0,
	`locked_until` timestamp(3),
	`token_version` int NOT NULL DEFAULT 0,
	`totp_secret_enc` text,
	`totp_enabled` boolean NOT NULL DEFAULT false,
	`last_login_at` timestamp(3),
	`must_change_password` boolean NOT NULL DEFAULT false,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `app_user_id` PRIMARY KEY(`id`),
	CONSTRAINT `app_user_email_unique` UNIQUE(`email`),
	CONSTRAINT `app_user_employee_id_unique` UNIQUE(`employee_id`)
);
--> statement-breakpoint
ALTER TABLE `attendance_month` ADD CONSTRAINT `attendance_month_company_id_company_id_fk` FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `attendance_month` ADD CONSTRAINT `attendance_month_employee_id_employee_id_fk` FOREIGN KEY (`employee_id`) REFERENCES `employee`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `branch` ADD CONSTRAINT `branch_company_id_company_id_fk` FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `branch` ADD CONSTRAINT `branch_entity_id_legal_entity_id_fk` FOREIGN KEY (`entity_id`) REFERENCES `legal_entity`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `change_request` ADD CONSTRAINT `change_request_company_id_company_id_fk` FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `change_request` ADD CONSTRAINT `change_request_employee_id_employee_id_fk` FOREIGN KEY (`employee_id`) REFERENCES `employee`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `consultant_payment` ADD CONSTRAINT `consultant_payment_company_id_company_id_fk` FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `consultant_payment` ADD CONSTRAINT `consultant_payment_run_id_consultant_run_id_fk` FOREIGN KEY (`run_id`) REFERENCES `consultant_run`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `consultant_payment` ADD CONSTRAINT `consultant_payment_consultant_id_consultant_id_fk` FOREIGN KEY (`consultant_id`) REFERENCES `consultant`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `consultant_run` ADD CONSTRAINT `consultant_run_company_id_company_id_fk` FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `consultant` ADD CONSTRAINT `consultant_company_id_company_id_fk` FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `department` ADD CONSTRAINT `department_company_id_company_id_fk` FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `designation` ADD CONSTRAINT `designation_company_id_company_id_fk` FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employee` ADD CONSTRAINT `employee_company_id_company_id_fk` FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employee` ADD CONSTRAINT `employee_branch_id_branch_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branch`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employee` ADD CONSTRAINT `employee_department_id_department_id_fk` FOREIGN KEY (`department_id`) REFERENCES `department`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employee` ADD CONSTRAINT `employee_designation_id_designation_id_fk` FOREIGN KEY (`designation_id`) REFERENCES `designation`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `legal_entity` ADD CONSTRAINT `legal_entity_company_id_company_id_fk` FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `holiday` ADD CONSTRAINT `holiday_company_id_company_id_fk` FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `leave_ledger` ADD CONSTRAINT `leave_ledger_company_id_company_id_fk` FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `leave_ledger` ADD CONSTRAINT `leave_ledger_employee_id_employee_id_fk` FOREIGN KEY (`employee_id`) REFERENCES `employee`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `leave_ledger` ADD CONSTRAINT `leave_ledger_leave_type_id_leave_type_id_fk` FOREIGN KEY (`leave_type_id`) REFERENCES `leave_type`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `leave_request` ADD CONSTRAINT `leave_request_company_id_company_id_fk` FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `leave_request` ADD CONSTRAINT `leave_request_employee_id_employee_id_fk` FOREIGN KEY (`employee_id`) REFERENCES `employee`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `leave_request` ADD CONSTRAINT `leave_request_leave_type_id_leave_type_id_fk` FOREIGN KEY (`leave_type_id`) REFERENCES `leave_type`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `leave_type` ADD CONSTRAINT `leave_type_company_id_company_id_fk` FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notification` ADD CONSTRAINT `notification_company_id_company_id_fk` FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notification` ADD CONSTRAINT `notification_user_id_app_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `app_user`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payroll_input` ADD CONSTRAINT `payroll_input_company_id_company_id_fk` FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payroll_input` ADD CONSTRAINT `payroll_input_run_id_payroll_run_id_fk` FOREIGN KEY (`run_id`) REFERENCES `payroll_run`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payroll_input` ADD CONSTRAINT `payroll_input_employee_id_employee_id_fk` FOREIGN KEY (`employee_id`) REFERENCES `employee`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payroll_run` ADD CONSTRAINT `payroll_run_company_id_company_id_fk` FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payslip` ADD CONSTRAINT `payslip_company_id_company_id_fk` FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payslip` ADD CONSTRAINT `payslip_run_id_payroll_run_id_fk` FOREIGN KEY (`run_id`) REFERENCES `payroll_run`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payslip` ADD CONSTRAINT `payslip_employee_id_employee_id_fk` FOREIGN KEY (`employee_id`) REFERENCES `employee`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `refresh_token` ADD CONSTRAINT `refresh_token_user_id_app_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `app_user`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `salary_structure` ADD CONSTRAINT `salary_structure_company_id_company_id_fk` FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `salary_structure` ADD CONSTRAINT `salary_structure_employee_id_employee_id_fk` FOREIGN KEY (`employee_id`) REFERENCES `employee`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `app_user` ADD CONSTRAINT `app_user_company_id_company_id_fk` FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `app_user` ADD CONSTRAINT `app_user_employee_id_employee_id_fk` FOREIGN KEY (`employee_id`) REFERENCES `employee`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `attendance_month_company_id_month_idx` ON `attendance_month` (`company_id`,`month`);--> statement-breakpoint
CREATE INDEX `audit_log_company_id_at_idx` ON `audit_log` (`company_id`,`at`);--> statement-breakpoint
CREATE INDEX `audit_log_entity_entity_id_idx` ON `audit_log` (`entity`,`entity_id`);--> statement-breakpoint
CREATE INDEX `branch_company_id_idx` ON `branch` (`company_id`);--> statement-breakpoint
CREATE INDEX `change_request_company_id_status_idx` ON `change_request` (`company_id`,`status`);--> statement-breakpoint
CREATE INDEX `consultant_company_id_idx` ON `consultant` (`company_id`);--> statement-breakpoint
CREATE INDEX `employee_company_id_status_idx` ON `employee` (`company_id`,`status`);--> statement-breakpoint
CREATE INDEX `legal_entity_company_id_idx` ON `legal_entity` (`company_id`);--> statement-breakpoint
CREATE INDEX `holiday_company_id_date_idx` ON `holiday` (`company_id`,`date`);--> statement-breakpoint
CREATE INDEX `leave_ledger_company_id_employee_id_leave_type_id_idx` ON `leave_ledger` (`company_id`,`employee_id`,`leave_type_id`);--> statement-breakpoint
CREATE INDEX `leave_request_company_id_employee_id_status_idx` ON `leave_request` (`company_id`,`employee_id`,`status`);--> statement-breakpoint
CREATE INDEX `notification_user_id_read_at_idx` ON `notification` (`user_id`,`read_at`);--> statement-breakpoint
CREATE INDEX `payslip_company_id_employee_id_month_idx` ON `payslip` (`company_id`,`employee_id`,`month`);--> statement-breakpoint
CREATE INDEX `refresh_token_family_idx` ON `refresh_token` (`family`);--> statement-breakpoint
CREATE INDEX `salary_structure_company_id_employee_id_effective_from_idx` ON `salary_structure` (`company_id`,`employee_id`,`effective_from`);--> statement-breakpoint
CREATE INDEX `app_user_company_id_idx` ON `app_user` (`company_id`);