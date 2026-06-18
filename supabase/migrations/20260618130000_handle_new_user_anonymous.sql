-- Make handle_new_user() tolerate anonymous users (deferred-registration flow).
--
-- The trigger fires on every auth.users INSERT and mirrors the row into
-- public.users, whose `email` column is NOT NULL. Anonymous sign-ins create an
-- auth.users row with a NULL email, so the insert failed with
-- "Database error creating anonymous user". COALESCE the email to '' so the
-- mirror row is created; the real email is written by the app when the
-- anonymous user upgrades to a permanent account (updateUser + service-role
-- upsert on public.users). Behavior for normal signups is unchanged (their
-- email is always present).

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  begin
    insert into public.users (id, email, first_name, last_name, phone)
    values (
      new.id,
      coalesce(new.email, ''),
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
