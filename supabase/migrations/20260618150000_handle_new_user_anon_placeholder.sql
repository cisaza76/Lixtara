-- Final fix for anonymous users in handle_new_user().
--
-- properties.owner_id (and other tables) FK to public.users(id), so an
-- anonymous user MUST have a public.users row to create a draft. But
-- public.users.email is NOT NULL and UNIQUE, so we can't use '' (collides) or
-- NULL (rejected). Use a per-uid placeholder email that is unique and clearly
-- non-deliverable; the app overwrites it with the real email when the seller
-- registers at the signing gate (registerAccount → service-role upsert).

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  begin
    insert into public.users (id, email, first_name, last_name, phone)
    values (
      new.id,
      -- Real email for normal signups; a unique, non-deliverable placeholder
      -- for anonymous users (replaced on registration).
      coalesce(
        nullif(new.email, ''),
        'anon-' || new.id::text || '@anonymous.lixtara.local'
      ),
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
