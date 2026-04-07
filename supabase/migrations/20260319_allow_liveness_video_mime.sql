-- Allow short liveness videos for mission proof uploads
update storage.buckets
set allowed_mime_types = array[
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/quicktime',
  'video/x-m4v',
  'video/webm'
]::text[]
where id = 'order-photos';

