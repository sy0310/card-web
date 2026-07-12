-- Preview cards that will be changed before running the UPDATE below.
select
  id,
  title,
  album_era,
  pob_name,
  original_ig_url
from cards
where source = 'instagram'
  and (
    coalesce(title, '') ~ '[,，]+[[:space:]]*$'
    or coalesce(album_era, '') ~ '[,，]+[[:space:]]*$'
    or coalesce(pob_name, '') ~ '[,，]+[[:space:]]*$'
  )
order by created_at desc;

-- Run this block only after reviewing the preview results above.
update cards
set
  title = case
    when title ~ '[,，]+[[:space:]]*$'
      then btrim(regexp_replace(title, '[,，]+[[:space:]]*$', ''))
    else title
  end,
  album_era = case
    when album_era ~ '[,，]+[[:space:]]*$'
      then btrim(regexp_replace(album_era, '[,，]+[[:space:]]*$', ''))
    else album_era
  end,
  pob_name = case
    when pob_name ~ '[,，]+[[:space:]]*$'
      then btrim(regexp_replace(pob_name, '[,，]+[[:space:]]*$', ''))
    else pob_name
  end
where source = 'instagram'
  and (
    coalesce(title, '') ~ '[,，]+[[:space:]]*$'
    or coalesce(album_era, '') ~ '[,，]+[[:space:]]*$'
    or coalesce(pob_name, '') ~ '[,，]+[[:space:]]*$'
  );

-- Confirm no Instagram card fields still end in an English or Chinese comma.
select count(*) as remaining_rows
from cards
where source = 'instagram'
  and (
    coalesce(title, '') ~ '[,，]+[[:space:]]*$'
    or coalesce(album_era, '') ~ '[,，]+[[:space:]]*$'
    or coalesce(pob_name, '') ~ '[,，]+[[:space:]]*$'
  );
