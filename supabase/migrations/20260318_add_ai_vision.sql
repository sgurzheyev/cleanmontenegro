-- AI Vision moderation fields

alter table public.missions
  add column if not exists ai_confidence_score integer,
  add column if not exists ai_verdict text;

