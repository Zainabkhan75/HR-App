begin;

alter table public.work_inbox
 drop constraint work_inbox_kind_check,
 drop constraint work_inbox_body_check,
 add column email_already_sent boolean not null default false,
 add constraint work_inbox_kind_check check(kind in ('leave_request','leave_decision','task','alert','message')),
 add constraint work_inbox_body_check check(length(body)<=case when kind='message' then 20000 else 2000 end);

create or replace function hrms_private.queue_msgbox_alert()
returns trigger language plpgsql security definer set search_path=''
as $$
declare address text;
begin
  if new.email_already_sent then return new; end if;
  address := hrms_private.msgbox_alert_address(new.recipient_user_id);
  if address is null then return new; end if;
  insert into public.workflow_email_outbox(inbox_id,recipient_email,subject,link_path,status,automatic)
  values(new.id,address,'You have a new message','/portal?section=msgbox&message=' || new.id,'pending',true);
  return new;
end;
$$;

create function public.finish_admin_message(p_actor uuid,p_campaign uuid,p_status text,p_result jsonb,p_error text,p_copies jsonb)
returns jsonb language plpgsql security invoker set search_path=''
as $$
declare
  campaign jsonb;
  expected int;
  inserted int;
begin
  campaign := public.finish_admin_email(p_actor,p_campaign,p_status,p_result,p_error);
  if p_status<>'accepted' then return campaign; end if;
  select count(*) into expected from jsonb_array_elements(campaign->'recipients') r
  where not coalesce((r->>'test')::boolean,false);
  if jsonb_typeof(p_copies) is distinct from 'array' or jsonb_array_length(p_copies)<>expected then
    raise exception 'The My Msgs copy could not be verified';
  end if;
  insert into public.work_inbox(id,recipient_user_id,sender_user_id,kind,title,body,email_already_sent)
  select (r->>'msgbox_message_id')::uuid,a.user_id,p_actor,'message',campaign->>'subject',copy->>'body',true
  from jsonb_array_elements(campaign->'recipients') r
  join jsonb_array_elements(p_copies) copy on copy->>'id'=r->>'msgbox_message_id'
  join public.employee_accounts a on a.employee_id=(r->>'id')::uuid and a.user_id=(r->>'msgbox_user_id')::uuid
  where a.is_active and not coalesce((r->>'test')::boolean,false);
  get diagnostics inserted=row_count;
  if inserted<>expected then raise exception 'An employee portal account changed before the My Msgs copy was saved'; end if;
  return campaign;
end;
$$;
revoke all on function public.finish_admin_message(uuid,uuid,text,jsonb,text,jsonb) from public,anon,authenticated;
grant execute on function public.finish_admin_message(uuid,uuid,text,jsonb,text,jsonb) to service_role;

-- Convert pending requests that have not received their manager decision.
lock table public.leave_requests in share row exclusive mode;
do $$
begin
  if exists(select 1 from public.leave_requests r join hrms_private.leave_request_route q on q.request_id=r.id
            where r.status='pending' and q.stage>1) then
    raise exception 'Resolve pending requests already past line manager review before changing approval routing';
  end if;
end;
$$;
update hrms_private.leave_request_route q set approvers=q.approvers[1:1]
from public.leave_requests r where r.id=q.request_id and r.status='pending' and cardinality(q.approvers)>1;

create or replace function hrms_private.leave_admin(p_action text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $f$
declare v_year int;v_id uuid;v_manager uuid;v_user uuid;v_type text;v_taken int;v_total int;v_used int;v_dates date[];v_old public.leave_openings%rowtype;v_from date;v_to date;
begin
 if not hrms_private.leave_hr() then raise exception 'HR administrator access required' using errcode='42501';end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Invalid setup' using errcode='22023';end if;
 v_year=(p_payload->>'year')::int;
 if p_action='policy' then
  if v_year is null or v_year not between 2020 and 2100 then raise exception 'Choose a valid year' using errcode='22023';end if;
  perform pg_advisory_xact_lock(4242,v_year);perform 1 from public.leave_policies where year=v_year for update;
  if exists(select 1 from public.leave_requests where year=v_year) then raise exception 'This year has requests. Keep its counting rules intact; use individual balances for entitlement corrections.' using errcode='22023';end if;
  insert into public.leave_policies(year,annual,sick,casual,weekdays_only,holidays) values(v_year,(p_payload->>'annual')::int,(p_payload->>'sick')::int,(p_payload->>'casual')::int,(p_payload->>'weekdays_only')::boolean,'{}') on conflict(year) do update set annual=excluded.annual,sick=excluded.sick,casual=excluded.casual,weekdays_only=excluded.weekdays_only;
 elsif p_action='opening' then
  v_id=(p_payload->>'employee_id')::uuid;v_type=p_payload->>'leave_type';v_total=(p_payload->>'entitlement')::int;v_taken=(p_payload->>'taken')::int;
  if v_type is null or v_type<>all(array['annual','sick','casual']) or v_total is null or v_taken is null or v_taken<0 or v_total<v_taken then raise exception 'Enter a valid entitlement and opening usage' using errcode='22023';end if;
  perform 1 from public.employees where id=v_id for update;
  select coalesce(sum(days),0) into v_used from public.leave_requests where employee_id=v_id and year=v_year and leave_type=v_type and status in ('approved','pending');
  if v_total<v_taken+v_used then raise exception 'Entitlement cannot be less than opening usage plus approved and pending days' using errcode='22023';end if;
  select * into v_old from public.leave_openings where employee_id=v_id and year=v_year and leave_type=v_type;
  insert into public.leave_openings(employee_id,year,leave_type,entitlement,taken,confirmed_by) values(v_id,v_year,v_type,v_total,v_taken,auth.uid()) on conflict(employee_id,year,leave_type) do update set entitlement=excluded.entitlement,taken=excluded.taken,confirmed_by=excluded.confirmed_by,confirmed_at=now();
 elsif p_action='manager' then
  v_id=(p_payload->>'employee_id')::uuid;v_manager=(p_payload->>'manager_employee_id')::uuid;
  if v_id is null or v_manager is null or v_id=v_manager then raise exception 'Choose a different employee as line manager' using errcode='22023';end if;
  perform 1 from public.employees where id=v_id for update;
  if exists(select 1 from public.leave_requests where employee_id=v_id and status='pending') then raise exception 'Resolve pending requests before changing this reporting assignment' using errcode='22023';end if;
  if not exists(select 1 from public.employee_accounts a join public.employees e on e.id=a.employee_id where a.employee_id=v_manager and a.is_active and not a.must_change_password and e.employment_state<>'inactive' and exists(select 1 from public.user_roles where user_id=a.user_id and role='manager')) then raise exception 'The manager needs an active manager account with password setup complete' using errcode='22023';end if;
  delete from public.manager_team_links where member_employee_id=v_id;insert into public.manager_team_links(manager_employee_id,member_employee_id) values(v_manager,v_id);
 elsif p_action='holiday_add' then
  v_from=(p_payload->>'from')::date;v_to=coalesce((p_payload->>'to')::date,v_from);
  if v_year is null or v_year not between 2020 and 2100 or v_from is null or v_to<v_from or v_to-v_from>30 or v_from<make_date(v_year,7,1) or v_to>=make_date(v_year+1,7,1) or coalesce(length(btrim(p_payload->>'name')),0) not between 1 and 80 then raise exception 'Enter a holiday name and dates inside the selected fiscal year (1 July to 30 June, up to 31 days)' using errcode='22023';end if;
  perform pg_advisory_xact_lock(4243,v_year);
  perform hrms_private.leave_holiday_materialize(v_year);
  insert into public.leave_holidays(fy,holiday_date,name,needs_review,created_by)
  select v_year,g::date,btrim(p_payload->>'name'),coalesce((p_payload->>'needs_review')::boolean,false),auth.uid() from generate_series(v_from::timestamp,v_to::timestamp,interval '1 day') g
  on conflict(holiday_date) do update set name=excluded.name,needs_review=excluded.needs_review;
  perform hrms_private.leave_recalculate(v_year);
 elsif p_action in ('holiday_delete','holiday_confirm') then
  v_from=(p_payload->>'date')::date;
  if v_year is null or v_from is null then raise exception 'Choose a holiday' using errcode='22023';end if;
  perform pg_advisory_xact_lock(4243,v_year);
  perform hrms_private.leave_holiday_materialize(v_year);
  if p_action='holiday_delete' then delete from public.leave_holidays where fy=v_year and holiday_date=v_from;
  else update public.leave_holidays set needs_review=false where fy=v_year and holiday_date=v_from;end if;
  if not found then raise exception 'Holiday not found. Refresh the page.' using errcode='22023';end if;
  if p_action='holiday_delete' then perform hrms_private.leave_recalculate(v_year);end if;
 else raise exception 'Unsupported setup action' using errcode='22023';end if;
 insert into public.leave_admin_audit(actor_id,action,details) values(auth.uid(),p_action,p_payload||case when p_action='opening' then jsonb_build_object('previous',to_jsonb(v_old)) else '{}'::jsonb end);
 return jsonb_build_object('ok',true);
end $f$;

create or replace function hrms_private.leave_action(p_action text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $f$
declare v_charge numeric;v_hours text;v_year int;v_next uuid;v_routed boolean;v_id uuid;v_req public.leave_requests%rowtype;v_policy public.leave_policies%rowtype;v_open public.leave_openings%rowtype;v_start date;v_end date;v_dates date[];v_manager uuid;v_user uuid;v_count int;v_used numeric;v_type text;v_name text;v_decision text;
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501';end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Invalid request' using errcode='22023';end if;
 if not hrms_private.leave_hr() then v_id=case when p_action='decide' then hrms_private.leave_approval_actor() else hrms_private.leave_actor() end;else select a.employee_id into v_id from public.employee_accounts a join public.employees e on e.id=a.employee_id where a.user_id=auth.uid() and a.is_active and not a.must_change_password and e.employment_state<>'inactive';end if;
 if p_action='read' then update public.work_inbox set read_at=coalesce(read_at,now()) where id=(p_payload->>'id')::uuid and recipient_user_id=auth.uid();return jsonb_build_object('ok',true);end if;
 if v_id is null then raise exception 'An active employee account is required for leave requests or manager decisions' using errcode='42501';end if;
 if p_action='submit' then
  v_type=p_payload->>'leave_type';v_start=(p_payload->>'start_date')::date;v_end=(p_payload->>'end_date')::date;
  if v_type is null or v_type<>all(array['annual','sick','casual','maternity','unpaid']) or v_start is null or v_end is null or v_end<v_start or extract(year from (v_start-interval '6 months'))<>extract(year from (v_end-interval '6 months')) or v_end-v_start>366 or nullif(btrim(p_payload->>'reason'),'') is null or length(p_payload->>'reason')>2000 then raise exception 'Enter a leave type, dates within one leave year, and a reason (up to 2000 characters)' using errcode='22023';end if;
  perform 1 from public.employees where id=v_id for update;
  v_year=extract(year from (v_start-interval '6 months'))::int;
  select * into v_policy from public.leave_policies where year=v_year for share;
  if v_policy.year is null then raise exception 'HR must configure this leave year first' using errcode='22023';end if;
  select * into v_open from public.leave_openings where employee_id=v_id and year=v_policy.year and leave_type=v_type for share;
  if v_open.employee_id is null and v_type in ('annual','sick','casual') then raise exception 'HR must verify your opening leave balance first' using errcode='22023';end if;
  select count(*),min(manager_employee_id::text)::uuid into v_count,v_manager from hrms_private.leave_reporting_links where member_employee_id=v_id;
  if v_count<>1 or v_manager=v_id then raise exception 'HR must assign one verified line manager first' using errcode='22023';end if;
  select a.user_id into v_user from public.employee_accounts a join public.employees e on e.id=a.employee_id where a.employee_id=v_manager and a.is_active and e.employment_state<>'inactive';
  if v_user is null then raise exception 'Your line manager needs an active sign-in account' using errcode='22023';end if;
  select array_agg(d::date order by d) into v_dates from generate_series(v_start::timestamp,v_end::timestamp,interval '1 day') d where v_type in ('maternity','unpaid') or ((not v_policy.weekdays_only or extract(isodow from d)<6) and not(d::date=any(hrms_private.leave_holiday_dates(v_policy.year))));
  if coalesce(cardinality(v_dates),0)=0 then raise exception 'These dates contain no chargeable leave days' using errcode='22023';end if;
  if exists(select 1 from public.leave_requests where employee_id=v_id and status in ('pending','approved') and daterange(start_date,end_date,'[]') && daterange(v_start,v_end,'[]')) then raise exception 'These dates overlap another pending or approved request' using errcode='22023';end if;
  select coalesce(sum(days),0) into v_used from public.leave_requests where employee_id=v_id and year=v_policy.year and leave_type=v_type and status in ('pending','approved');
  v_charge=cardinality(v_dates);
  v_hours=p_payload->>'hours';
  if v_hours is not null then
   if v_type<>'casual' or v_start<>v_end or v_hours not in ('2','4') then
    raise exception 'Partial leave requires one Casual Leave date and two or four hours' using errcode='22023';
   end if;
   v_charge=case when v_hours='2' then 0.25 else 0.5 end;
  end if;
  if v_type='maternity' and v_charge<>84 then raise exception 'Maternity Leave requires 84 consecutive calendar days' using errcode='22023';end if;
  if v_type in ('annual','sick','casual') and v_open.entitlement-v_open.taken-v_used<v_charge then raise exception 'Insufficient available leave balance; pending requests reserve days' using errcode='22023';end if;
  insert into public.leave_requests(employee_id,manager_employee_id,year,leave_type,start_date,end_date,charge_dates,days,reason) values(v_id,v_manager,v_policy.year,v_type,v_start,v_end,v_dates,v_charge,btrim(p_payload->>'reason')) returning * into v_req;
  if v_user=auth.uid() then raise exception 'A requester cannot approve their own leave' using errcode='22023';end if;
  insert into hrms_private.leave_request_route(request_id,approvers) values(v_req.id,array[v_user]);
  select full_name into v_name from public.employees where id=v_id;
  perform hrms_private.leave_notify(v_user,'leave_request','Leave approval requested',v_name||' requested '||v_req.days||' day(s) of '||v_type||' leave, '||v_start||' to '||v_end||'. Open the request to review.',v_req.id);
  return jsonb_build_object('id',v_req.id,'days',v_req.days);
 elsif p_action in ('decide','cancel') then
  select employee_id into v_manager from public.leave_requests where id=(p_payload->>'id')::uuid;
  perform 1 from public.employees where id=v_manager for update;
  select * into v_req from public.leave_requests where id=(p_payload->>'id')::uuid for update;
  if v_req.id is null then raise exception 'Request not available' using errcode='42501';end if;
  if v_req.status<>'pending' then raise exception 'This request has already been handled. Refresh the page.' using errcode='40001';end if;
  if p_action='cancel' then
   if v_req.employee_id<>v_id then raise exception 'Only your own pending requests can be withdrawn' using errcode='42501';end if;v_decision='cancelled';
  else
   select approvers[1] into v_next from hrms_private.leave_request_route where request_id=v_req.id for update;
   v_routed=found;
   if v_routed and v_next is distinct from auth.uid() then raise exception 'Only the current approver can decide this request' using errcode='42501';end if;
   if not v_routed and (v_req.manager_employee_id is distinct from v_id or v_req.employee_id=v_id or not exists(select 1 from hrms_private.leave_reporting_links where manager_employee_id=v_id and member_employee_id=v_req.employee_id)) then raise exception 'Only the assigned current line manager can decide this request' using errcode='42501';end if;
   v_decision=p_payload->>'decision';if v_decision is null or v_decision<>all(array['approved','rejected']) then raise exception 'Choose Approve or Reject' using errcode='22023';end if;
   if v_decision='rejected' and nullif(btrim(p_payload->>'note'),'') is null then raise exception 'Give a reason for rejecting this request' using errcode='22023';end if;
   if length(coalesce(p_payload->>'note',''))>2000 then raise exception 'Decision note must be at most 2000 characters' using errcode='22023';end if;
  end if;
  if v_routed then
   insert into hrms_private.leave_stage_decisions(request_id,stage,approver,decision,note)
   select request_id,stage,auth.uid(),v_decision,btrim(p_payload->>'note')
   from hrms_private.leave_request_route where request_id=v_req.id;
  end if;
  update public.leave_requests set status=v_decision,decision_note=btrim(p_payload->>'note'),decided_by=auth.uid(),decided_at=now() where id=v_req.id;
  update public.work_inbox set completed_at=now() where request_id=v_req.id and kind='leave_request';
  update public.workflow_email_outbox set status='cancelled' where inbox_id in(select id from public.work_inbox where request_id=v_req.id and kind='leave_request') and status in ('waiting_for_setup','pending','failed');
  select user_id into v_user from public.employee_accounts where employee_id=case when p_action='cancel' then v_req.manager_employee_id else v_req.employee_id end and is_active;
  if v_user is not null then perform hrms_private.leave_notify(v_user,'leave_decision','Leave request '||v_decision,'The '||v_req.leave_type||' leave request for '||v_req.start_date||' to '||v_req.end_date||' was '||v_decision||'.'||case when v_decision='rejected' then left(' Reason: '||btrim(p_payload->>'note'),1750) else '' end,v_req.id);end if;
  return jsonb_build_object('ok',true);
 end if;
 raise exception 'Unsupported action' using errcode='22023';
end $f$;

commit;
