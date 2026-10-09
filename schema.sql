-- Run this in Supabase > SQL Editor
create table goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  title text not null,
  period text not null check (period in ('daily','weekly','monthly','project')),
  created_at timestamptz not null default now()
);
create table completions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  goal_id uuid not null references goals on delete cascade,
  done_on date not null,
  unique (goal_id, done_on)
);
create table logs (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  log_date date not null,
  note text not null default '',
  primary key (user_id, log_date)
);
alter table goals enable row level security;
alter table completions enable row level security;
alter table logs enable row level security;
create policy "own goals" on goals for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own completions" on completions for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own logs" on logs for all using (user_id = auth.uid()) with check (user_id = auth.uid());


-- Run once in Supabase > SQL Editor (after schema.sql)
alter table goals
  add column archived boolean not null default false,
  add column archived_at timestamptz,
  add column target int,
  add column due_date date,
  add column duration_months int,
  add column days int[],          -- weekdays for repeating daily goals, Mon=0 ... Sun=6
  add column tag text;
alter table goals drop constraint if exists goals_period_check;
alter table goals add constraint goals_period_check check (period in ('daily','weekly','monthly','project'));
update goals set archived_at = now() where archived and archived_at is null;
create table rest_days (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  day date not null, primary key (user_id, day));
create table time_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  goal_id uuid references goals on delete cascade,
  seconds int not null, log_date date not null);
create table reviews (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  week_start date not null, note text not null default '', primary key (user_id, week_start));
alter table rest_days enable row level security;
alter table time_entries enable row level security;
alter table reviews enable row level security;
create policy "own rest" on rest_days for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own time" on time_entries for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own reviews" on reviews for all using (user_id = auth.uid()) with check (user_id = auth.uid());