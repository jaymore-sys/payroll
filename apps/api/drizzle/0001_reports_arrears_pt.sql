ALTER TABLE `consultant_payment` ADD `amount_override` decimal(14,2);--> statement-breakpoint
ALTER TABLE `consultant_payment` ADD `tds_override` decimal(14,2);--> statement-breakpoint
ALTER TABLE `employee` ADD `pt_exempt` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `payroll_input` ADD `arrears` decimal(14,2) DEFAULT '0' NOT NULL;--> statement-breakpoint
UPDATE `salary_structure` SET `employer_cost` = `employer_cost` - COALESCE(JSON_EXTRACT(`breakup`, '$.employer.gratuity'), 0), `breakup` = JSON_SET(JSON_REMOVE(`breakup`, '$.employer.gratuity'), '$.employer.monthlyTotal', JSON_EXTRACT(`breakup`, '$.employer.monthlyTotal') - COALESCE(JSON_EXTRACT(`breakup`, '$.employer.gratuity'), 0)) WHERE JSON_EXTRACT(`breakup`, '$.employer.gratuity') IS NOT NULL;
