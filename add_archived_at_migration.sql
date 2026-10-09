-- Run in Supabase SQL Editor for databases that already have the earlier schema.
alter table goals add column if not exists archived_at timestamptz;
update goals set archived_at = now() where archived and archived_at is null;
