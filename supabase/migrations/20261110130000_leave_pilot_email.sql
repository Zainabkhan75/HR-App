begin;

alter table public.workflow_email_outbox
 add column first_attempt_at timestamptz,
 add column last_attempt_at timestamptz;

-- Retry within the provider's idempotency window, including a crashed sender.
create function hrms_private.claim_leave_pilot_email(p_id uuid)
returns table(id uuid, kind text, request_id uuid, request_year integer, attempts integer)
language sql security definer set search_path='' as $f$
 update public.workflow_email_outbox q
 set status='sending', attempts=q.attempts+1,
     first_attempt_at=coalesce(q.first_attempt_at,now()), last_attempt_at=now()
 from public.work_inbox i
 join public.leave_requests r on r.id=i.request_id
 join hrms_private.leave_request_route route on route.request_id=r.id
 where q.id=p_id and q.inbox_id=i.id
 and ((i.kind='leave_request' and r.status='pending' and i.completed_at is null
       and i.recipient_user_id=route.approvers[route.stage])
      or (i.kind='leave_decision' and r.status in ('approved','rejected','cancelled')))
 and (q.status in ('waiting_for_setup','failed')
      or (q.status='sending' and q.last_attempt_at<now()-interval '2 minutes'))
 and (q.first_attempt_at is null or q.first_attempt_at>now()-interval '23 hours')
 returning q.id,i.kind,r.id,r.year,q.attempts;
$f$;
revoke all on function hrms_private.claim_leave_pilot_email(uuid) from public,anon,authenticated;
grant usage on schema hrms_private to service_role;
grant execute on function hrms_private.claim_leave_pilot_email(uuid) to service_role;

create function public.claim_leave_pilot_email(p_id uuid)
returns table(id uuid, kind text, request_id uuid, request_year integer, attempts integer)
language sql security invoker set search_path='' as $f$
 select * from hrms_private.claim_leave_pilot_email(p_id);
$f$;
revoke all on function public.claim_leave_pilot_email(uuid) from public,anon,authenticated;
grant execute on function public.claim_leave_pilot_email(uuid) to service_role;

commit;
