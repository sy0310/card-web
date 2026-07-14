alter table cards
add column if not exists unlimited_inventory boolean not null default true;

update cards
set unlimited_inventory = true
where unlimited_inventory is null;
