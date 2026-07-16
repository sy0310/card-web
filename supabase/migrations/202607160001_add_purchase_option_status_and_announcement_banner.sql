alter table card_purchase_options
add column if not exists status text not null default 'available'
check (status in ('available', 'sold_out'));

update card_purchase_options
set status = 'available'
where status is null;

insert into site_settings (key, value) values
  ('banner_enabled', 'true'),
  ('banner_text', 'IG @meguro_abebe pls check carrd go rules before DM !!')
on conflict (key) do nothing;
