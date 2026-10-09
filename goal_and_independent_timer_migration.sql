-- Run in Supabase SQL Editor for an existing database.
alter table goals
  drop constraint if exists goals_period_check;

alter table goals
  add constraint goals_period_check
    check (period in ('daily', 'weekly', 'monthly', 'project')),
  add column if not exists duration_months integer;

alter table time_entries
  alter column goal_id drop not null;
