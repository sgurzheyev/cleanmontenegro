-- Many RLS templates check missions.user_id = auth.uid(); this codebase inserts creator_id.
-- Add user_id when missing, keep it synced from creator_id on write, backfill old rows.

alter table public.missions add column if not exists user_id uuid references auth.users (id) on delete set null;

update public.missions
set user_id = creator_id
where user_id is null
  and creator_id is not null;

create or replace function public.missions_sync_user_id_from_creator ()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.creator_id is not null then
    new.user_id := new.creator_id;
  end if;
  return new;
end;
$$;

drop trigger if exists missions_bi_sync_user_id on public.missions;

create trigger missions_bi_sync_user_id
before insert or update of creator_id on public.missions
for each row
execute function public.missions_sync_user_id_from_creator ();
