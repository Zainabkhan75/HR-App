begin;
create policy rpc_managed_access on public.leave_policies as restrictive for all to authenticated using(false) with check(false);
create policy rpc_managed_access on public.leave_openings as restrictive for all to authenticated using(false) with check(false);
create policy rpc_managed_access on public.leave_requests as restrictive for all to authenticated using(false) with check(false);
create policy rpc_managed_access on public.work_inbox as restrictive for all to authenticated using(false) with check(false);
create policy rpc_managed_access on public.workflow_email_outbox as restrictive for all to authenticated using(false) with check(false);
create policy rpc_managed_access on public.leave_admin_audit as restrictive for all to authenticated using(false) with check(false);
create or replace function hrms_private.leave_workspace(p_year int) returns jsonb language plpgsql stable security definer set search_path='' as $f$
declare v_id uuid;v_hr boolean;v_policy public.leave_policies%rowtype;v_result jsonb;v_manager jsonb;
begin
 v_hr=hrms_private.leave_hr();if not v_hr then v_id=hrms_private.leave_actor();else select a.employee_id into v_id from public.employee_accounts a join public.employees e on e.id=a.employee_id where a.user_id=auth.uid() and a.is_active and not a.must_change_password and e.employment_state<>'inactive';end if;
 select * into v_policy from public.leave_policies where year=p_year;
 select jsonb_build_object('name',e.full_name,'designation',e.designation,'ready',count(*) over()=1 and coalesce(a.is_active and not a.must_change_password,false) and e.employment_state<>'inactive' and exists(select 1 from public.user_roles where user_id=a.user_id and role='manager')) into v_manager from public.manager_team_links l join public.employees e on e.id=l.manager_employee_id left join public.employee_accounts a on a.employee_id=e.id where l.member_employee_id=v_id limit 1;
 select jsonb_build_object('is_hr',v_hr,'employee_id',v_id,'year',p_year,'policy',case when v_policy.year is null then null else to_jsonb(v_policy) end,'manager',v_manager,
 'balances',coalesce((select jsonb_agg(jsonb_build_object('type',k,'entitlement',coalesce(o.entitlement,(to_jsonb(v_policy)->>k)::int),'opening_taken',o.taken,'verified',o.employee_id is not null,
 'taken',coalesce(o.taken,0)+coalesce((select sum(cardinality(array(select d from unnest(r.charge_dates) d where d<=current_date))) from public.leave_requests r where r.employee_id=v_id and r.year=p_year and r.leave_type=k and r.status='approved'),0),
 'approved',coalesce((select sum(days) from public.leave_requests r where r.employee_id=v_id and r.year=p_year and r.leave_type=k and r.status='approved'),0),
 'pending',coalesce((select sum(days) from public.leave_requests r where r.employee_id=v_id and r.year=p_year and r.leave_type=k and r.status='pending'),0))) from unnest(array['annual','sick','casual']) k left join public.leave_openings o on o.employee_id=v_id and o.year=p_year and o.leave_type=k),'[]'::jsonb),
 'requests',coalesce((select jsonb_agg(to_jsonb(q) order by q.created_at desc) from(select r.*,e.full_name as employee_name,e.employee_no,m.full_name as manager_name from public.leave_requests r join public.employees e on e.id=r.employee_id join public.employees m on m.id=r.manager_employee_id where r.employee_id=v_id and r.year=p_year)q),'[]'::jsonb),
 'approvals',coalesce((select jsonb_agg(to_jsonb(q) order by q.created_at desc) from(select r.*,e.full_name as employee_name,e.employee_no from public.leave_requests r join public.employees e on e.id=r.employee_id where r.year=p_year and (v_hr or (r.manager_employee_id=v_id and exists(select 1 from public.manager_team_links l where l.manager_employee_id=v_id and l.member_employee_id=r.employee_id) and exists(select 1 from public.user_roles where user_id=auth.uid() and role='manager'))))q),'[]'::jsonb),
 'team',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'name',e.full_name,'employee_no',e.employee_no,'user_id',a.user_id,'account_active',coalesce(a.is_active and not a.must_change_password,false))) from public.manager_team_links l join public.employees e on e.id=l.member_employee_id left join public.employee_accounts a on a.employee_id=e.id where l.manager_employee_id=v_id and e.employment_state<>'inactive' and exists(select 1 from public.user_roles where user_id=auth.uid() and role='manager')),'[]'::jsonb),
 'inbox',coalesce((select jsonb_agg(to_jsonb(q) order by q.created_at desc) from(select i.*,r.year as request_year from public.work_inbox i left join public.leave_requests r on r.id=i.request_id where recipient_user_id=auth.uid() order by i.created_at desc limit 200)q),'[]'::jsonb)) into v_result;
 if v_hr then v_result=v_result||jsonb_build_object(
 'employees',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'name',e.full_name,'employee_no',e.employee_no,'designation',e.designation,'account_active',coalesce(a.is_active and not a.must_change_password,false),'is_manager',exists(select 1 from public.user_roles where user_id=a.user_id and role='manager'),'user_id',a.user_id) order by e.employee_no) from public.employees e left join public.employee_accounts a on a.employee_id=e.id where e.employment_state<>'inactive'),'[]'::jsonb),
 'links',coalesce((select jsonb_agg(to_jsonb(l)) from public.manager_team_links l),'[]'::jsonb),
 'openings',coalesce((select jsonb_agg(to_jsonb(o)) from public.leave_openings o where year=p_year),'[]'::jsonb),
 'email_queue',coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'subject',q.subject,'status',q.status,'created_at',q.created_at)) from(select * from public.workflow_email_outbox order by created_at desc limit 100)q),'[]'::jsonb));end if;
 return v_result;
end $f$;
create or replace function hrms_private.leave_action(p_action text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $f$
declare v_id uuid;v_req public.leave_requests%rowtype;v_policy public.leave_policies%rowtype;v_open public.leave_openings%rowtype;v_start date;v_end date;v_dates date[];v_manager uuid;v_user uuid;v_count int;v_used int;v_type text;v_name text;v_decision text;
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501';end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Invalid request' using errcode='22023';end if;
 if not hrms_private.leave_hr() then v_id=hrms_private.leave_actor();else select a.employee_id into v_id from public.employee_accounts a join public.employees e on e.id=a.employee_id where a.user_id=auth.uid() and a.is_active and not a.must_change_password and e.employment_state<>'inactive';end if;
 if p_action in ('read','complete') then update public.work_inbox set read_at=coalesce(read_at,now()),completed_at=case when p_action='complete' and kind='task' then coalesce(completed_at,now()) else completed_at end where id=(p_payload->>'id')::uuid and recipient_user_id=auth.uid();return jsonb_build_object('ok',true);end if;
 if v_id is null then raise exception 'An active employee account is required for leave requests or manager decisions' using errcode='42501';end if;
 if p_action='task' then
  v_user=(p_payload->>'recipient_user_id')::uuid;
  if not exists(select 1 from public.user_roles where user_id=auth.uid() and role='manager') or not exists(select 1 from public.employee_accounts a join public.manager_team_links l on l.member_employee_id=a.employee_id join public.employees e on e.id=a.employee_id where a.user_id=v_user and a.is_active and not a.must_change_password and e.employment_state<>'inactive' and l.manager_employee_id=v_id) then raise exception 'Managers can assign tasks only to active verified direct reports' using errcode='42501';end if;
  if nullif(btrim(p_payload->>'title'),'') is null or length(p_payload->>'title')>200 or length(coalesce(p_payload->>'body',''))>2000 then raise exception 'Enter a title (up to 200 characters) and details (up to 2000 characters)' using errcode='22023';end if;
  perform hrms_private.leave_notify(v_user,'task',btrim(p_payload->>'title'),coalesce(p_payload->>'body',''),null);
  return jsonb_build_object('ok',true);
 end if;
 if p_action='submit' then
  v_type=p_payload->>'leave_type';v_start=(p_payload->>'start_date')::date;v_end=(p_payload->>'end_date')::date;
  if v_type is null or v_type<>all(array['annual','sick','casual']) or v_start is null or v_end is null or v_end<v_start or extract(year from v_start)<>extract(year from v_end) or v_end-v_start>366 or nullif(btrim(p_payload->>'reason'),'') is null or length(p_payload->>'reason')>2000 then raise exception 'Enter a leave type, dates within one leave year, and a reason (up to 2000 characters)' using errcode='22023';end if;
  perform 1 from public.employees where id=v_id for update;
  select * into v_policy from public.leave_policies where year=extract(year from v_start)::int for share;
  if v_policy.year is null then raise exception 'HR must configure this leave year first' using errcode='22023';end if;
  select * into v_open from public.leave_openings where employee_id=v_id and year=v_policy.year and leave_type=v_type for share;
  if v_open.employee_id is null then raise exception 'HR must verify your opening leave balance first' using errcode='22023';end if;
  select count(*),min(manager_employee_id::text)::uuid into v_count,v_manager from public.manager_team_links where member_employee_id=v_id;
  if v_count<>1 or v_manager=v_id then raise exception 'HR must assign one verified line manager first' using errcode='22023';end if;
  select a.user_id into v_user from public.employee_accounts a join public.employees e on e.id=a.employee_id where a.employee_id=v_manager and a.is_active and not a.must_change_password and e.employment_state<>'inactive' and exists(select 1 from public.user_roles where user_id=a.user_id and role='manager');
  if v_user is null then raise exception 'Your line manager needs an active manager account with password setup complete' using errcode='22023';end if;
  select array_agg(d::date order by d) into v_dates from generate_series(v_start::timestamp,v_end::timestamp,interval '1 day') d where (not v_policy.weekdays_only or extract(isodow from d)<6) and not(d::date=any(v_policy.holidays));
  if coalesce(cardinality(v_dates),0)=0 then raise exception 'These dates contain no chargeable leave days' using errcode='22023';end if;
  if exists(select 1 from public.leave_requests where employee_id=v_id and status in ('pending','approved') and daterange(start_date,end_date,'[]') && daterange(v_start,v_end,'[]')) then raise exception 'These dates overlap another pending or approved request' using errcode='22023';end if;
  select coalesce(sum(days),0) into v_used from public.leave_requests where employee_id=v_id and year=v_policy.year and leave_type=v_type and status in ('pending','approved');
  if v_open.entitlement-v_open.taken-v_used<cardinality(v_dates) then raise exception 'Insufficient available leave balance; pending requests reserve days' using errcode='22023';end if;
  insert into public.leave_requests(employee_id,manager_employee_id,year,leave_type,start_date,end_date,charge_dates,days,reason) values(v_id,v_manager,v_policy.year,v_type,v_start,v_end,v_dates,cardinality(v_dates),btrim(p_payload->>'reason')) returning * into v_req;
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
   if v_req.manager_employee_id<>v_id or v_req.employee_id=v_id or not exists(select 1 from public.manager_team_links where manager_employee_id=v_id and member_employee_id=v_req.employee_id) or not exists(select 1 from public.user_roles where user_id=auth.uid() and role='manager') then raise exception 'Only the assigned current line manager can decide this request' using errcode='42501';end if;
   v_decision=p_payload->>'decision';if v_decision is null or v_decision<>all(array['approved','rejected']) then raise exception 'Choose Approve or Reject' using errcode='22023';end if;
   if v_decision='rejected' and nullif(btrim(p_payload->>'note'),'') is null then raise exception 'Give a reason for rejecting this request' using errcode='22023';end if;
   if length(coalesce(p_payload->>'note',''))>2000 then raise exception 'Decision note must be at most 2000 characters' using errcode='22023';end if;
  end if;
  update public.leave_requests set status=v_decision,decision_note=btrim(p_payload->>'note'),decided_by=auth.uid(),decided_at=now() where id=v_req.id;
  update public.work_inbox set completed_at=now() where request_id=v_req.id and kind='leave_request';
  update public.workflow_email_outbox set status='cancelled' where inbox_id in(select id from public.work_inbox where request_id=v_req.id and kind='leave_request') and status in ('waiting_for_setup','pending','failed');
  select user_id into v_user from public.employee_accounts where employee_id=case when p_action='cancel' then v_req.manager_employee_id else v_req.employee_id end and is_active;
  if v_user is not null then perform hrms_private.leave_notify(v_user,'leave_decision','Leave request '||v_decision,'The '||v_req.leave_type||' leave request for '||v_req.start_date||' to '||v_req.end_date||' was '||v_decision||'.',v_req.id);end if;
  return jsonb_build_object('ok',true);
 end if;
 raise exception 'Unsupported action' using errcode='22023';
end $f$;
commit;
