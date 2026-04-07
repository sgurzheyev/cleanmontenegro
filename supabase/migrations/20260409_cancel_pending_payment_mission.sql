-- Creator-only: delete unpaid Paymob draft missions (Phantom Pins).

create or replace function public.cancel_pending_payment_mission(p_mission_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  delete from public.missions
  where id = p_mission_id
    and creator_id = auth.uid()
    and status = 'pending_payment';

  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'Mission not found or cannot be cancelled';
  end if;
end;
$$;

revoke all on function public.cancel_pending_payment_mission(uuid) from public;
grant execute on function public.cancel_pending_payment_mission(uuid) to authenticated;
