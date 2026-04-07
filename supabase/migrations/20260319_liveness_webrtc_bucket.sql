-- Create dedicated bucket for liveness videos (WebRTC recordings)
do $$
begin
  if not exists (select 1 from storage.buckets where id = 'liveness-videos') then
    insert into storage.buckets (id, name, public)
    values ('liveness-videos', 'liveness-videos', true);
  end if;
end $$;

-- Allow common video mime types (plus images if needed)
update storage.buckets
set allowed_mime_types = array[
  'video/webm',
  'video/mp4',
  'video/quicktime',
  'video/x-m4v'
]::text[]
where id = 'liveness-videos';

