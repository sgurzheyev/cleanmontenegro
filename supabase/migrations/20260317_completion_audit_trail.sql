-- Permanent Audit Trail for Mission Completion
-- Adds completion GPS + computed distance columns to missions.

alter table public.missions
  add column if not exists completion_lat double precision,
  add column if not exists completion_lng double precision,
  add column if not exists completion_distance_meters integer;

-- NOTE:
-- Your RPC `public.complete_public_mission_with_report(...)` must be updated to accept:
--   p_completion_lat double precision,
--   p_completion_lng double precision,
--   p_completion_distance_meters integer
-- and persist them into public.missions.(completion_lat, completion_lng, completion_distance_meters).
--
-- This repo does not currently contain the function definition, so we only add columns here.
