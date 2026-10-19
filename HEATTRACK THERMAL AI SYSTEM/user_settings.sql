-- ============================================
-- HeatTrack: account-wide Settings (Camera Streams)
-- Run once in Supabase -> SQL Editor (safe to re-run).
--
-- One row per account. When any device signed in to the account turns
-- Camera Streams on or off, every other device signed in to the same account
-- follows. A missing row means Camera Streams is on.
-- Alert Notifications is not stored here: each browser keeps its own choice.
-- ============================================

create table if not exists public.user_settings (
    user_id             uuid primary key references auth.users (id) on delete cascade,
    camera_streams      boolean not null default true,
    updated_at          timestamptz not null default now()
);

-- Removed settings: AI Detection Model, and Alert Notifications (now per browser)
alter table public.user_settings
    drop column if exists ai_detection;
alter table public.user_settings
    drop column if exists alert_notifications;

alter table public.user_settings enable row level security;

-- Each user reads and writes only their own row
drop policy if exists "user_settings_select_own" on public.user_settings;
create policy "user_settings_select_own" on public.user_settings
    for select using (auth.uid() = user_id);

drop policy if exists "user_settings_insert_own" on public.user_settings;
create policy "user_settings_insert_own" on public.user_settings
    for insert with check (auth.uid() = user_id);

drop policy if exists "user_settings_update_own" on public.user_settings;
create policy "user_settings_update_own" on public.user_settings
    for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Realtime: other devices on the account see a change instantly
-- (without this they still pick it up within a minute from the website's polling)
do $$
begin
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_settings'
    ) then
        alter publication supabase_realtime add table public.user_settings;
    end if;
end $$;
