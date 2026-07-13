-- A checkout request is created once even if the browser retries after a slow
-- connection or receipt-image failure.
alter table wishlists
add column if not exists checkout_request_id uuid;

create unique index if not exists wishlists_checkout_request_id_idx
on wishlists (checkout_request_id)
where checkout_request_id is not null;

-- Keep only a privacy-preserving hash of the request origin. It supports a
-- small server-side rate limit without storing an IP address.
alter table storefront_search_events
add column if not exists dedupe_bucket timestamptz,
add column if not exists client_fingerprint text;

create unique index if not exists storefront_search_events_dedupe_idx
on storefront_search_events (
  anonymous_session_id,
  normalized_query,
  coalesce(category, ''),
  dedupe_bucket
)
where anonymous_session_id is not null
  and dedupe_bucket is not null;

create index if not exists storefront_search_events_fingerprint_created_at_idx
on storefront_search_events (client_fingerprint, created_at desc)
where client_fingerprint is not null;
