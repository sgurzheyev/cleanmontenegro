-- SECURITY: prevent cleaners/creators from bypassing admin review
-- Nobody except the Admin/system trusted RPC should be able to set
-- public.missions.status = 'completed'.

-- NOTE: This trigger runs on status updates. It blocks only when the
-- authenticated user is the participant (creator_id or cleaner_id) of the
-- mission row.
-- Admin users are determined by the same identifiers used in the frontend:
-- - email == 'sgurzheyev@gmail.com'
-- - email contains 'tg_6618910143'
-- - profiles.telegram_username == 'sergiogurgini'
-- Additionally, 'service_role' is always allowed.

create or replace function public.block_participants_status_completed()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid;
  v_is_admin boolean := false;
begin
  v_uid := auth.uid();

  -- If no user context, don't block.
  if v_uid is null then
    return new;
  end if;

  -- Allow system/service role.
  if coalesce((auth.jwt() ->> 'role'), '') = 'service_role' then
    return new;
  end if;

  -- Allow admin accounts.
  select exists (
    select 1
    from auth.users u
    where u.id = v_uid
      and (
        u.email = 'sgurzheyev@gmail.com'
        or u.email ilike '%tg_6618910143%'
      )
  ) into v_is_admin;

  if not v_is_admin then
    select exists (
      select 1
      from public.profiles p
      where p.id = v_uid
        and lower(p.telegram_username) = 'sergiogurgini'
    ) into v_is_admin;
  end if;

  -- Block ONLY participants setting completed.
  if new.status = 'completed'
     and not v_is_admin
     and (
       (old.cleaner_id is not null and old.cleaner_id = v_uid)
       or
       (old.creator_id is not null and old.creator_id = v_uid)
     )
  then
    raise exception 'Security Error: Only admin/system can mark missions as completed.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_block_cleaner_status_completed on public.missions;
drop trigger if exists trg_block_participants_status_completed on public.missions;

create trigger trg_block_participants_status_completed
before update of status on public.missions
for each row
execute function public.block_participants_status_completed();

