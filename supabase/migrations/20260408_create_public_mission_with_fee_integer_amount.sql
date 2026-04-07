-- Align RPC signature: integer EGP goal + double precision coordinates (Supabase/Postgres).

drop function if exists public.create_public_mission_with_fee(
  text,
  text,
  numeric,
  double precision,
  double precision,
  text[]
);

drop function if exists public.create_public_mission_with_fee(
  text,
  text,
  integer,
  double precision,
  double precision,
  text[]
);

create or replace function public.create_public_mission_with_fee(
  p_title text,
  p_description text,
  p_amount_target integer,
  p_location_lat double precision,
  p_location_lng double precision,
  p_photo_urls text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_fee integer := 49;
  v_goal integer;
  v_wallet numeric;
  v_desc text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  v_goal := greatest(0, coalesce(p_amount_target, 0));
  if v_goal < 50 then
    raise exception 'Crowdfunding goal must be at least 50 EGP';
  end if;

  v_desc := coalesce(nullif(trim(coalesce(p_description, '')), ''), nullif(trim(coalesce(p_title, '')), ''));

  select coalesce(wallet_balance, 0)
  into v_wallet
  from public.profiles
  where id = v_uid
  for update;

  if not found then
    raise exception 'Profile not found';
  end if;

  if floor(v_wallet)::bigint < v_fee then
    raise exception 'Insufficient wallet balance for Scout Stake (49 EGP)';
  end if;

  update public.profiles
  set wallet_balance = coalesce(wallet_balance, 0) - v_fee
  where id = v_uid;

  insert into public.missions (
    creator_id,
    category,
    status,
    amount_target,
    current_funding,
    location_lat,
    location_lng,
    description,
    photo_urls
  )
  values (
    v_uid,
    'public',
    'funding',
    v_goal,
    0,
    p_location_lat,
    p_location_lng,
    v_desc,
    coalesce(p_photo_urls, array[]::text[])
  );
end;
$$;

revoke all on function public.create_public_mission_with_fee(
  text,
  text,
  integer,
  double precision,
  double precision,
  text[]
) from public;

grant execute on function public.create_public_mission_with_fee(
  text,
  text,
  integer,
  double precision,
  double precision,
  text[]
) to authenticated;

grant execute on function public.create_public_mission_with_fee(
  text,
  text,
  integer,
  double precision,
  double precision,
  text[]
) to service_role;
