-- Constitution v6.0: Garbage report submission — status → 'review' only. No payouts / wallet mutations.

create or replace function public.complete_public_mission_with_report(
  p_mission_id uuid,
  p_after_photo_urls text[],
  p_completion_lat double precision,
  p_completion_lng double precision,
  p_completion_distance_meters integer,
  p_proof_video_url text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_after_photo_urls is null or coalesce(array_length(p_after_photo_urls, 1), 0) < 1 then
    raise exception 'After photos are required';
  end if;

  if p_proof_video_url is null or length(trim(p_proof_video_url)) = 0 then
    raise exception 'Video proof is required';
  end if;

  if p_completion_lat is null or p_completion_lng is null then
    raise exception 'Completion coordinates are required';
  end if;

  update public.missions m
  set
    after_photo_urls = p_after_photo_urls,
    completion_lat = p_completion_lat,
    completion_lng = p_completion_lng,
    completion_distance_meters = p_completion_distance_meters,
    proof_video_url = trim(p_proof_video_url),
    report_submitted_at = now(),
    status = 'review'
  where m.id = p_mission_id
    and m.cleaner_id = uid
    and m.category = 'public'
    and m.status = 'in_progress';

  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'Mission not found or not eligible for garbage report';
  end if;
end;
$$;

revoke all on function public.complete_public_mission_with_report(
  uuid, text[], double precision, double precision, integer, text
) from public;

grant execute on function public.complete_public_mission_with_report(
  uuid, text[], double precision, double precision, integer, text
) to authenticated;
