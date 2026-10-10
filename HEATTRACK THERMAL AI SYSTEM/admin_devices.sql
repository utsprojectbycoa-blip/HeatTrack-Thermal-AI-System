-- ============================================
-- HeatTrack: Device Registry functions for the admin dashboard
-- Run once in Supabase -> SQL Editor (then also run device_trash.sql and
-- device_api_key.sql if you have not yet).
--
-- The devices table is protected by row-level security, so an admin's normal
-- query only sees their own device (usually none). These functions check
-- is_admin() and then read / write every device for the Device Registry.
-- The API key hash (device_api) is never returned to the browser.
-- ============================================

-- Every registered device (without the API key hash)
create or replace function public.admin_list_devices()
returns table (
    id             uuid,
    device_code    text,
    owner_id       uuid,
    device_name    text,
    device_url     text,
    url_updated_at timestamptz,
    claimed_at     timestamptz,
    created_at     timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.is_admin() then
        raise exception 'Only admins can list devices';
    end if;

    return query
        select d.id::uuid, d.device_code::text, d.owner_id::uuid, d.device_name::text, d.device_url::text,
               d.url_updated_at::timestamptz, d.claimed_at::timestamptz, d.created_at::timestamptz
        from public.devices d
        order by d.device_code;
end;
$$;


-- Register a new, unclaimed device.
-- Returns 'ok' | 'invalid' | 'exists' | 'in_trash'
create or replace function public.admin_register_device(p_device_code text, p_api_key text, p_device_url text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    v_code text := upper(trim(p_device_code));
    v_url  text := nullif(trim(coalesce(p_device_url, '')), '');
begin
    if not public.is_admin() then
        raise exception 'Only admins can register devices';
    end if;

    if v_code !~ '^HT-PDCK-[0-9]{3}$' or v_code = 'HT-PDCK-000' then
        return 'invalid';
    end if;
    if p_api_key is null or p_api_key !~ '^[A-Za-z0-9_-]{8,64}$' then
        return 'invalid';
    end if;
    if v_url is not null and (v_url !~* '^https?://\S+$' or length(v_url) > 255) then
        return 'invalid';
    end if;

    if exists (select 1 from public.devices where device_code = v_code) then
        return 'exists';
    end if;
    -- devices_trash comes from device_trash.sql; skip the check if it is not installed
    if to_regclass('public.devices_trash') is not null then
        if exists (select 1 from public.devices_trash where device_code = v_code) then
            return 'in_trash';
        end if;
    end if;

    insert into public.devices (device_code, device_api, device_url, url_updated_at)
    values (v_code, public.hash_device_api(p_api_key), v_url, case when v_url is null then null else now() end);
    return 'ok';
end;
$$;


-- Change (or clear) a device's live video URL from the Edit Device dialog.
-- Returns 'ok' | 'not_found' | 'invalid'
create or replace function public.admin_update_device_url(p_device_code text, p_url text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    v_url text := nullif(trim(coalesce(p_url, '')), '');
begin
    if not public.is_admin() then
        raise exception 'Only admins can change device URLs';
    end if;

    if v_url is not null and (v_url !~* '^https?://\S+$' or length(v_url) > 255) then
        return 'invalid';
    end if;

    update public.devices
    set device_url = v_url, url_updated_at = now()
    where device_code = p_device_code;
    return case when found then 'ok' else 'not_found' end;
end;
$$;


revoke all on function public.admin_list_devices()                      from public, anon;
revoke all on function public.admin_register_device(text, text, text)   from public, anon;
revoke all on function public.admin_update_device_url(text, text)       from public, anon;
grant execute on function public.admin_list_devices()                    to authenticated;
grant execute on function public.admin_register_device(text, text, text) to authenticated;
grant execute on function public.admin_update_device_url(text, text)     to authenticated;

-- Make the new functions visible to the website right away
notify pgrst, 'reload schema';
