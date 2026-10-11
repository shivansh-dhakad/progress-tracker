-- Streakbook: complete schema for a NEW Supabase database.
-- Run once in Supabase > SQL Editor. (Existing database? Run the migration files instead, see README.)

create table goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  title text not null,
  period text not null check (period in ('daily','weekly','monthly','project','plan')),
  created_at timestamptz not null default now(),
  archived boolean not null default false,
  archived_at timestamptz,
  target int,
  due_date date,
  duration_months int,
  days int[],                          -- weekdays for repeating daily goals, Mon=0 ... Sun=6
  tag text,
  -- study plans (period = 'plan')
  start_date date,
  plan_days int,
  schedule jsonb,                      -- {"0":[["09:00","10:00"],["19:00","21:00",1]], ...}  Mon=0; a 3rd item of 1 means the shift was removed
  paused_ranges jsonb not null default '[]'::jsonb   -- [["2026-10-12","2026-10-16"],["2026-11-01",null]]  (null = until resumed)
);

create table completions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  goal_id uuid not null references goals on delete cascade,
  done_on date not null,
  unique (goal_id, done_on)
);

-- one row per shift that was handled: done, missed, skipped on purpose, or moved to another day
create table slot_completions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  goal_id uuid not null references goals on delete cascade,
  done_on date not null,               -- the day the shift was planned for
  slot_idx int not null,
  status text not null default 'done' check (status in ('done','missed','skipped','moved')),
  topic text,                          -- optional focus or subject for that shift
  note text,                           -- what you learned or did in that shift
  moved_to date,                       -- when status = 'moved': the day it will be done instead
  moved_done boolean not null default false,
  unique (goal_id, done_on, slot_idx)
);

create table logs (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  log_date date not null,
  note text not null default '',
  primary key (user_id, log_date)
);

create table rest_days (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  day date not null,
  primary key (user_id, day)
);

create table time_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  goal_id uuid references goals on delete cascade,   -- null = independent study session
  slot_idx int,                                       -- set when the session was counted against a plan shift
  seconds int not null,
  log_date date not null,
  note text,                                          -- what you studied in this session
  started_at timestamptz,
  ended_at timestamptz
);

create table reviews (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  week_start date not null,
  note text not null default '',
  primary key (user_id, week_start)
);

create table user_settings (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  daily_target_minutes int,
  weekly_target_minutes int,
  reminder_lead int not null default 5       -- minutes before a shift starts
);

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  tz text not null default 'UTC',
  created_at timestamptz not null default now()
);

alter table goals enable row level security;
alter table completions enable row level security;
alter table slot_completions enable row level security;
alter table logs enable row level security;
alter table rest_days enable row level security;
alter table time_entries enable row level security;
alter table reviews enable row level security;
alter table user_settings enable row level security;
alter table push_subscriptions enable row level security;

create policy "own goals" on goals for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own completions" on completions for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own slots" on slot_completions for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own logs" on logs for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rest" on rest_days for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own time" on time_entries for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own reviews" on reviews for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own settings" on user_settings for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own push" on push_subscriptions for all using (user_id = auth.uid()) with check (user_id = auth.uid());