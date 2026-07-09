create table if not exists card_purchase_options (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references cards(id) on delete cascade,
  label text not null,
  price numeric(10, 2) not null default 0,
  min_quantity integer not null default 1,
  max_quantity integer,
  is_default boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists card_purchase_options_card_id_idx
on card_purchase_options(card_id);

create index if not exists card_purchase_options_active_sort_idx
on card_purchase_options(card_id, is_active, sort_order);

create unique index if not exists card_purchase_options_one_default_per_card_idx
on card_purchase_options(card_id)
where is_default = true;

insert into card_purchase_options (
  card_id,
  label,
  price,
  min_quantity,
  max_quantity,
  is_default,
  is_active,
  sort_order
)
select
  id,
  'Single',
  coalesce(price, 0),
  1,
  null,
  true,
  true,
  0
from cards
where not exists (
  select 1
  from card_purchase_options
  where card_purchase_options.card_id = cards.id
);

alter table card_purchase_options enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'card_purchase_options'
      and policyname = 'Public Read Card Purchase Options'
  ) then
    create policy "Public Read Card Purchase Options"
    on card_purchase_options
    for select
    using (true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'card_purchase_options'
      and policyname = 'Admin All Card Purchase Options'
  ) then
    create policy "Admin All Card Purchase Options"
    on card_purchase_options
    for all
    to authenticated
    using (true)
    with check (true);
  end if;
end $$;
