-- Correct the anonymous-user handling in handle_new_user().
--
-- The previous migration COALESCEd a NULL email to '' so anonymous sign-ins
-- wouldn't violate public.users.email NOT NULL. But public.users.email is also
-- UNIQUE (users_email_key), so a SECOND anonymous user collides on '' and fails
-- with "Database error creating anonymous user".
--
-- Fix: skip the public.users mirror entirely for users without an email
-- (anonymous sessions). The mirror row is created by the app when the seller
-- upgrades to a permanent account at the signing gate (registerAccount →
-- service-role upsert on public.users). Normal signups are unaffected.

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  begin
    -- Anonymous users have no email — they get no public.users row until they
    -- register (when the app upserts one with the real name/email).
    if new.email is null or new.email = '' then
      return new;
    end if;

    insert into public.users (id, email, first_name, last_name, phone)
    values (
      new.id,
      new.email,
      coalesce(
        new.raw_user_meta_data ->> 'first_name',
        new.raw_user_meta_data ->> 'firstName',
        ''
      ),
      coalesce(
        new.raw_user_meta_data ->> 'last_name',
        new.raw_user_meta_data ->> 'lastName',
        ''
      ),
      coalesce(new.raw_user_meta_data ->> 'phone', '')
    )
    on conflict (id) do nothing;
    return new;
  end;
  $$;
