-- Liveness video metadata for mission report submission
alter table public.missions
  add column if not exists proof_video_url text;

alter table public.missions
  add column if not exists report_submitted_at timestamptz;

