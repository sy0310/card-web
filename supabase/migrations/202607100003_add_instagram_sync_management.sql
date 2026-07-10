create table if not exists instagram_settings (
  id uuid primary key default gen_random_uuid(),
  session_id text,
  settings_json jsonb,
  proxy text,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create index if not exists instagram_settings_updated_at_idx
on instagram_settings(updated_at desc);

create table if not exists instagram_sync_logs (
  id uuid primary key default gen_random_uuid(),
  status text not null check (status in ('running', 'success', 'failed')),
  message text,
  posts_found integer,
  created_at timestamptz not null default now(),
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists instagram_sync_logs_created_at_idx
on instagram_sync_logs(created_at desc);

-- These tables are intentionally service-role-only. The admin APIs authenticate
-- the browser session first, then use the server-side service role key so that
-- session_id and proxy values are never readable from the client.
alter table instagram_settings enable row level security;
alter table instagram_sync_logs enable row level security;
