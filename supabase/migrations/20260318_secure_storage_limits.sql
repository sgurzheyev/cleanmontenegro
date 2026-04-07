-- Secure Supabase Storage bucket limits (DB-level enforcement)
-- Prevent backend bypass uploads (large files / non-image MIME types).

update storage.buckets
set
  file_size_limit = 2097152,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']::text[]
where id in (
  -- Avatar uploads
  'avatars',
  -- Mission / proof photo uploads
  'order-photos'
);

