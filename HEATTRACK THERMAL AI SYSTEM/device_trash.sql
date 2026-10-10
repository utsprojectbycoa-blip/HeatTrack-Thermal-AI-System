-- ============================================
-- HeatTrack: Device Registry trash (30-day restore)
-- Run once in Supabase -> SQL Editor.
--
-- Deleting a device moves its whole row out of public.devices into
-- public.devices_trash. Because the row is no longer in devices, sign-up
-- (device_check), the mini PC logger and admin_register_device all stop
-- seeing it without any changes to them. Restore puts the row back exactly
-- as it was (same id, key, URL, owner). Rows older than 30 days are purged.
--
-- The device's saved readings (environment + analytics rows) move to the
-- trash with it and come back on restore, so linked devices and devices with
-- readings can be deleted too. Purging removes those readings for good.
-- ============================================

create table if not exists public.devices_trash (
    device_code text primary key,
    device_row  jsonb not null,            -- the full public.devices row
    deleted_at  timestamptz not null default now(),
    deleted_by  uuid default auth.uid()
);

-- Readings that were moved to the trash with the device (added later: safe to re-run)
alter table public.devices_trash add column if not exists environment_rows jsonb not null default '[]'::jsonb;
alter table public.devices_trash add column if not exists analytics_rows   jsonb not null default '[]'::jsonb;

-- No policies: the table is only reachable through the admin functions below
alter table public.devices_trash enable row level security;


-- Move a device (and its saved readings) to the trash.
-- Returns 'ok' | 'not_found' | 'in_trash'
create or replace function public.admin_trash_device(p_device_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    v_dev public.devices%rowtype;
begin
    if not public.is_admin() then
        raise exception 'Only admins can delete devices';
    end if;

    if exists (select 1 from public.devices_trash where device_code = p_device_code) then
        return 'in_trash';
    end if;

    select * into v_dev from public.devices where device_code = p_device_code for update;
    if not found then
        return 'not_found';
    end if;

    -- Copy the readings into the trash first, then remove them so the device
    -- row can be deleted (a foreign key would block or cascade otherwise)
    insert into public.devices_trash (device_code, device_row, environment_rows, analytics_rows)
    values (
        v_dev.device_code,
        to_jsonb(v_dev),
        coalesce((select jsonb_agg(to_jsonb(e)) from public.environment e where e.device_id = v_dev.id), '[]'::jsonb),
        coalesce((select jsonb_agg(to_jsonb(a)) from public.analytics   a where a.device_id = v_dev.id), '[]'::jsonb)
    );
    delete from public.environment where device_id = v_dev.id;
    delete from public.analytics   where device_id = v_dev.id;
    delete from public.devices     where id = v_dev.id;
    return 'ok';
end;
$$;


-- Put a trashed device (and its readings) back.
-- Returns 'ok' | 'not_found' | 'exists' (a new device with that ID was registered meanwhile)
create or replace function public.admin_restore_device(p_device_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    v_trash public.devices_trash%rowtype;
    v_row   jsonb;
    v_owner uuid;
begin
    if not public.is_admin() then
        raise exception 'Only admins can restore devices';
    end if;

    select * into v_trash from public.devices_trash where device_code = p_device_code for update;
    if not found then
        return 'not_found';
    end if;

    if exists (select 1 from public.devices where device_code = p_device_code) then
        return 'exists';
    end if;

    -- Relink the old owner only if their account still exists and has not
    -- claimed another device in the meantime; otherwise restore it as Available
    v_row := v_trash.device_row;
    v_owner := nullif(v_row->>'owner_id', '')::uuid;
    if v_owner is not null and (
        not exists (select 1 from auth.users u where u.id = v_owner)
        or exists (select 1 from public.devices d where d.owner_id = v_owner)
    ) then
        v_row := v_row || jsonb_build_object('owner_id', null, 'claimed_at', null);
        v_owner := null;
    end if;

    insert into public.devices
    select (jsonb_populate_record(null::public.devices, v_row)).*;

    -- Readings of accounts that were deleted meanwhile are dropped
    insert into public.environment overriding system value
    select r.* from jsonb_populate_recordset(null::public.environment, v_trash.environment_rows) r
    where r.userid is null or exists (select 1 from auth.users u where u.id::text = r.userid::text);

    insert into public.analytics overriding system value
    select r.* from jsonb_populate_recordset(null::public.analytics, v_trash.analytics_rows) r
    where r.userid is null or exists (select 1 from auth.users u where u.id::text = r.userid::text);

    delete from public.devices_trash where device_code = p_device_code;
    return 'ok';
end;
$$;


-- Delete a trashed device permanently (no restore after this).
create or replace function public.admin_purge_device(p_device_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.is_admin() then
        raise exception 'Only admins can delete devices';
    end if;
    delete from public.devices_trash where device_code = p_device_code;
    return case when found then 'ok' else 'not_found' end;
end;
$$;


-- List the trash for the Device Registry. Anything older than 30 days is
-- purged first, so expired devices disappear the next time an admin looks.
create or replace function public.admin_list_device_trash()
returns table (device_code text, deleted_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.is_admin() then
        raise exception 'Only admins can view the device trash';
    end if;

    delete from public.devices_trash t where t.deleted_at < now() - interval '30 days';

    return query
        select t.device_code, t.deleted_at
        from public.devices_trash t
        order by t.deleted_at desc;
end;
$$;


revoke all on function public.admin_trash_device(text)      from public, anon;
revoke all on function public.admin_restore_device(text)    from public, anon;
revoke all on function public.admin_purge_device(text)      from public, anon;
revoke all on function public.admin_list_device_trash()     from public, anon;
grant execute on function public.admin_trash_device(text)   to authenticated;
grant execute on function public.admin_restore_device(text) to authenticated;
grant execute on function public.admin_purge_device(text)   to authenticated;
grant execute on function public.admin_list_device_trash()  to authenticated;


-- Make the new functions visible to the website right away
-- (without this the site gets "Could not find the function" until PostgREST reloads)
notify pgrst, 'reload schema';


-- Optional: purge daily even when no admin opens the page.
-- Needs the pg_cron extension (Database -> Extensions -> pg_cron).
-- select cron.schedule('purge-device-trash', '0 3 * * *',
--     $$delete from public.devices_trash where deleted_at < now() - interval '30 days'$$);
