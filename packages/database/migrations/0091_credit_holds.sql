CREATE TABLE "credit_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"amount" integer NOT NULL,
	"async_task_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "credit_holds" ADD CONSTRAINT "credit_holds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "credit_holds_user_idx" ON "credit_holds" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "credit_holds_async_task_idx" ON "credit_holds" USING btree ("async_task_id");
--> statement-breakpoint
CREATE INDEX "credit_holds_active_idx" ON "credit_holds" USING btree ("user_id","released_at");
