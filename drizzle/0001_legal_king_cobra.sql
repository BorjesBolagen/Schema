CREATE TABLE "transpa_tenant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transpa_tenant_tenant_id_unique" UNIQUE("tenant_id")
);
--> statement-breakpoint
ALTER TABLE "employee" DROP CONSTRAINT "employee_employee_number_unique";--> statement-breakpoint
ALTER TABLE "employee" ADD COLUMN "transpa_tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "employee" ADD CONSTRAINT "employee_transpa_tenant_id_transpa_tenant_id_fk" FOREIGN KEY ("transpa_tenant_id") REFERENCES "public"."transpa_tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employee_tenant_idx" ON "employee" USING btree ("transpa_tenant_id");--> statement-breakpoint
ALTER TABLE "employee" ADD CONSTRAINT "employee_number_uq" UNIQUE("transpa_tenant_id","employee_number");