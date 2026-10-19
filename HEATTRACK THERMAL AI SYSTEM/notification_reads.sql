-- ============================================
-- HeatTrack: account-wide read state for Alerts & Notifications
-- Run once in Supabase -> SQL Editor (safe to re-run).
--
-- One row per notification an account has read. Opening a notification or
-- pressing "Read all" on any browser marks it read for the whole account, so
-- every other browser / device signed in to the same account shows it as read.
--   item_id 'alert:<detection id>'  -> user heat-stress notifications
--   item_id 'signup:<profile id>'   -> admin pending sign-up requests
-- ============================================

create table if not exists public.notification_reads (
    user_id  uuid not null references auth.users (id) on delete cascade,
    item_id  text not null,
    read_at  timestamptz not null default now(),
    primary key (user_id, item_id)
);

alter table public.notification_reads enable row level security;

-- Each user reads and writes only their own rows
drop policy if exists "notification_reads_select_own" on public.notification_reads;
create policy "notification_reads_select_own" on public.notification_reads
    for select using (auth.uid() = user_id);

drop policy if exists "notification_reads_insert_own" on public.notification_reads;
create policy "notification_reads_insert_own" on public.notification_reads
    for insert with check (auth.uid() = user_id);

drop policy if exists "notification_reads_update_own" on public.notification_reads;
create policy "notification_reads_update_own" on public.notification_reads
    for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Realtime: other browsers on the account see a read instantly
-- (without this they still pick it up within a minute from the website's polling)
do $$
begin
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notification_reads'
    ) then
        alter publication supabase_realtime add table public.notification_reads;
    end if;
end $$;
