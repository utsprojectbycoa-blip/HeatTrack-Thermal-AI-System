-- ============================================
-- HeatTrack: edit a device's API key and Device ID from the Device Registry
-- Run once in Supabase -> SQL Editor.
--
-- API key: stored hashed in devices.device_api, using the same
-- hash_device_api() the rest of the database uses, so device_check and
-- claim_device accept the new key at sign-up. The old key stops working.
-- Allowed for every device. On a linked device it does not affect the owner
-- or logging; it is the key needed if the device is ever claimed again.
--
-- Device ID: only while the device is Available. A linked device's ID is in
-- use by its owner and by the mini PC (HEATTRACK_DEVICE_ID in its .env).
-- ============================================

-- Returns 'ok' | 'not_found' | 'invalid'
create or replace function public.admin_update_device_key(p_device_code text, p_api_key text)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.is_admin() then
        raise exception 'Only admins can change device API keys';
    end if;

    -- Same rule as the Register form: 8-64 letters, numbers, - and _
    if p_api_key is null or p_api_key !~ '^[A-Za-z0-9_-]{8,64}$' then
        return 'invalid';
    end if;

    update public.devices
    set device_api = public.hash_device_api(p_api_key)
    where device_code = p_device_code;
    return case when found then 'ok' else 'not_found' end;
end;
$$;


-- Returns 'ok' | 'not_found' | 'linked' | 'invalid' | 'exists' | 'in_trash'
create or replace function public.admin_update_device_code(p_device_code text, p_new_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    v_owner uuid;
    v_new   text := upper(trim(p_new_code));
begin
    if not public.is_admin() then
        raise exception 'Only admins can change Device IDs';
    end if;

    if v_new !~ '^HT-PDCK-[0-9]{3}$' or v_new = 'HT-PDCK-000' then
        return 'invalid';
    end if;

    select owner_id into v_owner from public.devices where device_code = p_device_code for update;
    if not found then
        return 'not_found';
    end if;
    if v_owner is not null then
        return 'linked';
    end if;
    if v_new = p_device_code then
        return 'ok';
    end if;

    if exists (select 1 from public.devices where device_code = v_new) then
        return 'exists';
    end if;
    -- devices_trash comes from device_trash.sql; skip the check if it is not installed
    if to_regclass('public.devices_trash') is not null then
        if exists (select 1 from public.devices_trash where device_code = v_new) then
            return 'in_trash';
        end if;
    end if;

    update public.devices set device_code = v_new where device_code = p_device_code;
    return 'ok';
end;
$$;


revoke all on function public.admin_update_device_key(text, text)  from public, anon;
revoke all on function public.admin_update_device_code(text, text) from public, anon;
grant execute on function public.admin_update_device_key(text, text)  to authenticated;
grant execute on function public.admin_update_device_code(text, text) to authenticated;
