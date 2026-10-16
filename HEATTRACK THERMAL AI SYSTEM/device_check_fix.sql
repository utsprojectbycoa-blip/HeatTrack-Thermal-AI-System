-- ============================================
-- HeatTrack: fix device sign-up
--   "Device ID or API key is incorrect."           (device_check)
--   "Could not link the device. Check the ..."     (sign-up link trigger)
-- Run once in Supabase -> SQL Editor (after admin_devices.sql). Safe to re-run.
--
-- The sign-up page sends 'HT-PDCK-###' and the key exactly as typed. Both the
-- pre-check and the link step must accept the key that admin_register_device /
-- admin_update_device_key stored with hash_device_api(). device_key_matches()
-- accepts it however it was stored:
--   * salted hash (bcrypt / crypt)  -> crypt(key, stored) = stored
--   * fixed hash (e.g. sha256 hex)  -> hash_device_api(key) = stored
--   * older plain-text keys         -> key = stored
--
-- Linking keeps the key: the mini PC logger (heatstress_logger.py) signs every
-- upload with it.
--
-- If the whole script stops with "... both creates the profile and links the
-- device", nothing was changed: send that function's definition to fix by hand.
-- ============================================

-- Fail fast instead of hanging if another connection is using auth.users or
-- devices (a "lock timeout" error just means: wait a moment and run it again)
set lock_timeout = '5s';

-- 1. Shared key comparison
create or replace function public.device_key_matches(p_stored text, p_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
    if coalesce(p_stored, '') = '' or coalesce(p_key, '') = '' then
        return false;
    end if;
    -- Only try crypt() on values that look like a crypt hash (it raises "invalid salt" otherwise)
    if p_stored ~ '^\$(2[abxy]?|1|5|6)\$' and crypt(p_key, p_stored) = p_stored then
        return true;
    end if;
    return p_stored = public.hash_device_api(p_key)::text or p_stored = p_key;
end;
$$;

revoke all on function public.device_key_matches(text, text) from public, anon, authenticated;


-- 2. Sign-up pre-check. Returns 'ok' | 'taken' | 'invalid'
drop function if exists public.device_check(text, text);

create function public.device_check(p_device_id text, p_api_key text)
returns text
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
    v_code  text := upper(trim(coalesce(p_device_id, '')));
    v_hash  text;
    v_owner uuid;
begin
    if v_code !~ '^HT-PDCK-[0-9]{3}$' then
        return 'invalid';
    end if;

    select d.device_api::text, d.owner_id into v_hash, v_owner
    from public.devices d
    where upper(d.device_code) = v_code;

    if not found then
        return 'invalid';                -- no such device (or it is in the trash)
    end if;
    if v_owner is not null then
        return 'taken';
    end if;
    return case when public.device_key_matches(v_hash, p_api_key) then 'ok' else 'invalid' end;
end;
$$;

-- The sign-up page runs before the user has an account, so anon must call it
revoke all on function public.device_check(text, text) from public;
grant execute on function public.device_check(text, text) to anon, authenticated;


-- 3. Remove the old device-link trigger(s) on auth.users that reject the key
do $$
declare
    r     record;
    v_src text;
begin
    for r in
        select t.tgname, p.oid as foid, p.proname
        from pg_trigger t
        join pg_proc p on p.oid = t.tgfoid
        where not t.tgisinternal
          and t.tgrelid = 'auth.users'::regclass
          and t.tgname <> 'zz_link_device_on_signup'
    loop
        v_src := pg_get_functiondef(r.foid);
        if v_src ~* 'devices|claim_device|device_api' then
            if v_src ~* 'profiles' then
                raise exception 'Trigger % (function %) both creates the profile and links the device. Nothing was changed.', r.tgname, r.proname;
            end if;
            execute format('drop trigger %I on auth.users', r.tgname);
            raise notice 'Removed old device trigger % (function %)', r.tgname, r.proname;
        end if;
    end loop;
end;
$$;


-- 4. New link step: runs after the account (and its profile) is created.
--    Named zz_ so it fires after the profile trigger (triggers run in name order).
create or replace function public.link_device_on_signup()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
    v_code text  := upper(trim(coalesce(v_meta->>'device_code', v_meta->>'device_id', '')));
    v_id   uuid;
    v_hash text;
    v_owner uuid;
begin
    if v_code = '' then
        return new;                      -- account made without a device (e.g. an admin)
    end if;

    select d.id, d.device_api::text, d.owner_id into v_id, v_hash, v_owner
    from public.devices d
    where upper(d.device_code) = v_code
    for update;

    if not found or v_owner is not null or not public.device_key_matches(v_hash, v_meta->>'device_api_key') then
        raise exception 'Device % could not be linked', v_code;
    end if;

    update public.devices
    set owner_id = new.id, claimed_at = now()
    where id = v_id;
    return new;
end;
$$;

drop trigger if exists zz_link_device_on_signup on auth.users;
create trigger zz_link_device_on_signup
    after insert on auth.users
    for each row execute function public.link_device_on_signup();


notify pgrst, 'reload schema';
