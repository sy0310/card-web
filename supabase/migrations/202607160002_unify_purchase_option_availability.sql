-- Forward-only migration: the preceding migration may already be deployed.
-- `is_active` remains as a compatibility column, while status is now the only
-- availability source for storefront and order validation.
alter table card_purchase_options
add column if not exists status text;

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select conname
    from pg_constraint
    where conrelid = 'public.card_purchase_options'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.card_purchase_options drop constraint %I', constraint_name);
  end loop;
end $$;

-- Historical Active=false has the highest precedence. Old sold_out values
-- become visible-but-unavailable pending options; absent values stay available.
update card_purchase_options
set status = case
  when is_active is false then 'archived'
  when lower(trim(coalesce(status, ''))) = 'sold_out' then 'pending'
  when lower(trim(coalesce(status, ''))) in ('available', 'pending', 'archived')
    then lower(trim(status))
  else 'available'
end;

-- Defaults must point only to a purchasable option. Do not choose a replacement:
-- storefront selection falls back to the first available option at read time.
update card_purchase_options
set is_default = false
where status <> 'available';

-- Stop carrying an independent visibility state forward.
update card_purchase_options
set is_active = true
where is_active is distinct from true;

alter table card_purchase_options
  alter column status set default 'available',
  alter column status set not null;

alter table card_purchase_options
  add constraint card_purchase_options_status_check
    check (status in ('available', 'pending', 'archived')),
  add constraint card_purchase_options_default_available_check
    check (not is_default or status = 'available');
