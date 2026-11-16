begin;

create function hrms_private.leave_cancel_approved(p_request_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare
  request public.leave_requests%rowtype;
  reason text := regexp_replace(p_reason, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  recipient uuid;
begin
  if not hrms_private.leave_hr() then
    raise exception 'HR administrator access required' using errcode='42501';
  end if;
  if reason is null or length(reason) not between 1 and 1800 then
    raise exception 'Enter a cancellation reason of up to 1800 characters' using errcode='22023';
  end if;

  select * into request from public.leave_requests where id=p_request_id;
  if not found then
    raise exception 'Leave request not available' using errcode='22023';
  end if;
  -- Match the employee-first lock order used by leave submissions and opening edits.
  perform 1 from public.employees where id=request.employee_id for update;
  select * into request from public.leave_requests where id=p_request_id for update;
  if not found or request.status <> 'approved' then
    raise exception 'Only approved leave can be cancelled. Refresh the page.' using errcode='40001';
  end if;

  -- Balances and reports calculate usage from request status. Keep the original decision.
  update public.leave_requests set status='cancelled' where id=request.id;
  insert into public.leave_admin_audit(actor_id, action, details)
  values(auth.uid(), 'cancel_approved', jsonb_build_object(
    'request_id', request.id, 'employee_id', request.employee_id,
    'year', request.year, 'leave_type', request.leave_type, 'days', request.days,
    'reason', reason
  ));

  -- Retain the approval in Inbox history and remove any unsent approval email from the queue.
  update public.workflow_email_outbox q set status='cancelled'
  from public.work_inbox i
  where i.id=q.inbox_id and i.request_id=request.id
    and i.kind in ('leave_request','leave_decision')
    and q.status in ('waiting_for_setup','pending','failed');

  select user_id into recipient from public.employee_accounts where employee_id=request.employee_id;
  if recipient is not null then
    perform hrms_private.leave_notify(recipient, 'leave_decision', 'Approved leave cancelled',
      format('HR cancelled your approved %s leave for %s to %s. Reason: %s',
        request.leave_type, request.start_date, request.end_date, reason), request.id);
  end if;
  return jsonb_build_object('ok', true);
end
$function$;

create function public.leave_cancel_approved(p_request_id uuid, p_reason text)
returns jsonb
language sql security invoker set search_path=''
as $function$
  select hrms_private.leave_cancel_approved(p_request_id, p_reason);
$function$;

revoke all on function hrms_private.leave_cancel_approved(uuid,text),
  public.leave_cancel_approved(uuid,text) from public, anon, authenticated;
grant execute on function hrms_private.leave_cancel_approved(uuid,text),
  public.leave_cancel_approved(uuid,text) to authenticated;

commit;
