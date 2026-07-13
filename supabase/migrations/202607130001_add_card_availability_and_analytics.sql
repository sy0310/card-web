-- Keep cards that have order history instead of deleting them. Pending cards stay
-- visible but cannot be requested; archived cards are hidden from the storefront.
alter table cards
add column if not exists availability_status text not null default 'available'
check (availability_status in ('available', 'pending', 'archived'));

create index if not exists cards_availability_status_created_at_idx
on cards (availability_status, created_at desc);

update cards
set availability_status = 'available'
where availability_status is null;

-- Preserve the merchandising attributes used by receipts and analytics. New orders
-- write these snapshots; the update makes historic rows usable immediately.
alter table wishlist_items
add column if not exists card_title_snapshot text,
add column if not exists group_name_snapshot text,
add column if not exists album_era_snapshot text,
add column if not exists image_url_snapshot text;

update wishlist_items wi
set
  card_title_snapshot = coalesce(wi.card_title_snapshot, c.title),
  group_name_snapshot = coalesce(wi.group_name_snapshot, c.group_name),
  album_era_snapshot = coalesce(wi.album_era_snapshot, c.album_era),
  image_url_snapshot = coalesce(wi.image_url_snapshot, c.image_url)
from cards c
where wi.card_id = c.id
  and (
    wi.card_title_snapshot is null
    or wi.group_name_snapshot is null
    or wi.album_era_snapshot is null
    or wi.image_url_snapshot is null
  );

create table if not exists storefront_search_events (
  id bigint generated always as identity primary key,
  normalized_query text not null,
  category text,
  result_count integer not null default 0 check (result_count >= 0),
  anonymous_session_id text,
  created_at timestamptz not null default now()
);

create index if not exists storefront_search_events_created_at_idx
on storefront_search_events (created_at desc);

create index if not exists storefront_search_events_query_created_at_idx
on storefront_search_events (normalized_query, created_at desc);

alter table storefront_search_events enable row level security;

-- Search events are written only by the server route using the service role.
-- Authenticated admins can inspect them through the same server-side API.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'storefront_search_events'
      and policyname = 'Admin Read Search Events'
  ) then
    create policy "Admin Read Search Events"
    on storefront_search_events
    for select
    to authenticated
    using (true);
  end if;
end $$;

-- Existing public reads must not expose archived inventory. The authenticated admin
-- policy remains separate, so admins can still see every status in the dashboard.
do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'cards'
      and policyname = 'Public Read Cards'
  ) then
    alter policy "Public Read Cards"
    on cards
    using (availability_status <> 'archived');
  end if;
end $$;
