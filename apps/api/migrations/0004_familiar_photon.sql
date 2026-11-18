CREATE TABLE "signup_waitlist" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone
);

--> statement-breakpoint
CREATE FUNCTION approve_signup_waitlist() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  new_user_id text := gen_random_uuid()::text;
BEGIN
  IF NEW.approved_at IS NULL OR OLD.approved_at IS NOT NULL THEN
    RAISE EXCEPTION 'Only pending requests can be approved';
  END IF;
  IF OLD.password_hash IS NULL THEN
    RAISE EXCEPTION 'This request has no pending credentials';
  END IF;
  INSERT INTO "user" (id, name, email)
  VALUES (new_user_id, OLD.email, OLD.email);
  INSERT INTO account (id, account_id, provider_id, user_id, password)
  VALUES (gen_random_uuid()::text, new_user_id, 'credential', new_user_id, OLD.password_hash);
  NEW.password_hash := NULL;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER signup_waitlist_approve
BEFORE UPDATE OF approved_at ON signup_waitlist
FOR EACH ROW EXECUTE FUNCTION approve_signup_waitlist();
