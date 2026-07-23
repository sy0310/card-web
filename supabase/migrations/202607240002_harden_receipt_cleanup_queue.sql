-- Harden cleanup queue table: allow null wishlist_id, set null on delete, and enforce RLS
alter table public.receipt_file_cleanup_queue
  alter column wishlist_id drop not null;

alter table public.receipt_file_cleanup_queue
  drop constraint if exists receipt_file_cleanup_queue_wishlist_id_fkey;

alter table public.receipt_file_cleanup_queue
  add constraint receipt_file_cleanup_queue_wishlist_id_fkey
  foreign key (wishlist_id)
  references public.wishlists(id)
  on delete set null;

alter table public.receipt_file_cleanup_queue
  enable row level security;

revoke all on table public.receipt_file_cleanup_queue
  from anon, authenticated;
