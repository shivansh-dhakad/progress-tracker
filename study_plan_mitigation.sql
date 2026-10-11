-- Run ONCE in Supabase > SQL Editor on an EXISTING database. Safe to run again (idempotent).
-- Also replaces the older add_archived_at and goal_and_independent_timer migrations.
-- Covers: study plans, missed/skip/move shifts, pause, timer-to-shift link, study targets, reminders.

-- 1. goals: allow 'plan' and add plan columns
alter table goals drop constraint if exists goals_period_check;
alter table goals add constraint goals_period_check
  check (period in ('daily','weekly','monthly','project','plan'));
alter table goals
  add column if not exists archived boolean not null default false,
  add column if not exists archived_at timestamptz,
  add column if not exists target int,
  add column if not exists due_date date,
  add column if not exists days int[],
  add column if not exists tag text,
  add column if not exists duration_months int,
  add column if not exists start_date date,
  add column if not exists plan_days int,
  add column if not exists schedule jsonb,
  add column if not exists paused_ranges jsonb not null default '[]'::jsonb;

-- 2. shift history (created here if your database never had it)
create table if not exists slot_completions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  goal_id uuid not null references goals on delete cascade,
  done_on date not null,
  slot_idx int not null,
  unique (goal_id, done_on, slot_idx)
);
alter table slot_completions
  add column if not exists status text not null default 'done',
  add column if not exists topic text,
  add column if not exists note text,
  add column if not exists moved_to date,
  add column if not exists moved_done boolean not null default false;
alter table slot_completions drop constraint if exists slot_completions_status_check;
alter table slot_completions add constraint slot_completions_status_check
  check (status in ('done','missed','skipped','moved'));
alter table slot_completions enable row level security;
drop policy if exists "own slots" on slot_completions;
create policy "own slots" on slot_completions for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- other tables the app uses (no-ops if they already exist)
create table if not exists rest_days (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  day date not null, primary key (user_id, day));
create table if not exists time_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  goal_id uuid references goals on delete cascade,
  seconds int not null, log_date date not null);
create table if not exists reviews (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  week_start date not null, note text not null default '', primary key (user_id, week_start));

-- 3. timer sessions can be counted against a shift
alter table time_entries add column if not exists slot_idx int;
alter table time_entries alter column goal_id drop not null;
-- what you studied in a timer session, and when it ran
alter table time_entries
  add column if not exists note text,
  add column if not exists started_at timestamptz,
  add column if not exists ended_at timestamptz;

-- 4. study targets and reminder lead time
create table if not exists user_settings (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  daily_target_minutes int,
  weekly_target_minutes int,
  reminder_lead int not null default 5
);
alter table user_settings enable row level security;
drop policy if exists "own settings" on user_settings;
create policy "own settings" on user_settings for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 5. push notification subscriptions (one row per browser/phone)
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  tz text not null default 'UTC',
  created_at timestamptz not null default now()
);
alter table push_subscriptions enable row level security;
drop policy if exists "own push" on push_subscriptions;
create policy "own push" on push_subscriptions for all using (user_id = auth.uid()) with check (user_id = auth.uid());