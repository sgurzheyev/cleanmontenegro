alter table public.missions
  add column if not exists liveness_lat double precision;

alter table public.missions
  add column if not exists liveness_lng double precision;

