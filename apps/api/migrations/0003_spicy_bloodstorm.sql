CREATE TABLE "folders" (
	"id" uuid NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "folders_owner_id_pk" PRIMARY KEY("owner","id")
);
--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "folder_id" uuid;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_owner_user_id_fk" FOREIGN KEY ("owner") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "folders_owner_name" ON "folders" USING btree ("owner",lower("name"));--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_owner_folder_id_folders_owner_id_fk" FOREIGN KEY ("owner","folder_id") REFERENCES "public"."folders"("owner","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notes_owner_folder" ON "notes" USING btree ("owner","folder_id");