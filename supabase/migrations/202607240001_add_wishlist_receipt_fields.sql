-- Create private bucket for wishlist receipts
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'wishlist-receipts',
  'wishlist-receipts',
  false,
  10485760,
  array['image/png']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = array['image/png'];

-- Add columns step-by-step for full compatibility
alter table public.wishlists
  add column if not exists receipt_token uuid;

alter table public.wishlists
  add column if not exists receipt_storage_path text;

alter table public.wishlists
  add column if not exists receipt_generated_at timestamptz;

alter table public.wishlists
  add column if not exists receipt_expires_at timestamptz;

alter table public.wishlists
  alter column receipt_token set default gen_random_uuid();

-- Backfill any existing null tokens
update public.wishlists
set receipt_token = gen_random_uuid()
where receipt_token is null;

alter table public.wishlists
  alter column receipt_token set not null;

-- Unique partial / full index on receipt_token
create unique index if not exists wishlists_receipt_token_unique
  on public.wishlists (receipt_token);

-- Index for expired receipts cleanup cron query
create index if not exists wishlists_expired_receipts_index
  on public.wishlists (receipt_expires_at)
  where receipt_storage_path is not null;

-- Create cleanup queue table for orphaned and expired receipt files
create table if not exists public.receipt_file_cleanup_queue (
  storage_path text primary key,
  wishlist_id uuid not null
    references public.wishlists(id)
    on delete cascade,
  reason text not null,
  delete_after timestamptz not null default now(),
  attempt_count integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists receipt_cleanup_queue_due_index
  on public.receipt_file_cleanup_queue (delete_after);
