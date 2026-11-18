CREATE INDEX "notes_owner_updated" ON "notes" USING btree ("owner","updated_at","id");--> statement-breakpoint
CREATE INDEX "notes_owner_title" ON "notes" USING btree ("owner","title","id");--> statement-breakpoint
CREATE INDEX "notes_search" ON "notes" USING gin (to_tsvector('simple', "title" || ' ' || "search_text"));