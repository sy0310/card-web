alter table wishlist_items
  add column if not exists purchase_option_id uuid
    references card_purchase_options(id) on delete set null,
  add column if not exists option_label_snapshot text,
  add column if not exists unit_price_snapshot numeric(10, 2);

create index if not exists wishlist_items_purchase_option_id_idx
  on wishlist_items(purchase_option_id);

update wishlist_items wi
set
  option_label_snapshot = coalesce(wi.option_label_snapshot, 'Single'),
  unit_price_snapshot = coalesce(wi.unit_price_snapshot, c.price)
from cards c
where wi.card_id = c.id
  and wi.unit_price_snapshot is null;
