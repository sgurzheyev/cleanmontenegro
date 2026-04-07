-- Anti-spam cooldown for mission status changes (DB-level enforcement)
-- Enforces: max 1 mission status change per 10 seconds per user (auth.uid()).
-- Service role is exempt (webhooks / backoffice).

alter table public.profiles
  add column if not exists last_mission_status_action_at timestamptz;

create or replace function public.enforce_mission_status_cooldown()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_last timestamptz;
begin
  -- Only when status changes
  if new.status is not distinct from old.status then
    return new;
  end if;

  -- Allow service role / server-side jobs
  if auth.role() = 'service_role' then
    return new;
  end if;

  v_uid := auth.uid();
  if v_uid is null then
    -- If unauthenticated, do not allow status changes via client.
    raise exception 'Anti-spam: Please wait 10 seconds before changing mission status.';
  end if;

  select last_mission_status_action_at
    into v_last
  from public.profiles
  where id = v_uid;

  if v_last is not null and (now() - v_last) < interval '10 seconds' then
    raise exception 'Anti-spam: Please wait 10 seconds before changing mission status.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_mission_status_cooldown on public.missions;
create trigger trg_enforce_mission_status_cooldown
before update of status on public.missions
for each row
execute function public.enforce_mission_status_cooldown();

create or replace function public.bump_mission_status_action_timestamp()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if auth.role() = 'service_role' then
    return new;
  end if;

  v_uid := auth.uid();
  if v_uid is null then
    return new;
  end if;

  update public.profiles
    set last_mission_status_action_at = now()
  where id = v_uid;

  return new;
end;
$$;

drop trigger if exists trg_bump_mission_status_action_timestamp on public.missions;
create trigger trg_bump_mission_status_action_timestamp
after update of status on public.missions
for each row
execute function public.bump_mission_status_action_timestamp();

