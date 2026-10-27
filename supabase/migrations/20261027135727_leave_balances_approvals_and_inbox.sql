begin;
create table public.leave_policies(year int primary key check(year between 2020 and 2100),annual int not null default 10 check(annual>=0),sick int not null default 10 check(sick>=0),casual int not null default 10 check(casual>=0),weekdays_only boolean not null default true,holidays date[] not null default '{}');
insert into public.leave_policies(year) values(extract(year from current_date)::int);
create table public.leave_openings(employee_id uuid references public.employees(id),year int references public.leave_policies(year),leave_type text check(leave_type in ('annual','sick','casual')),entitlement int not null check(entitlement>=0),taken int not null check(taken>=0 and taken<=entitlement),confirmed_by uuid not null references auth.users(id),confirmed_at timestamptz not null default now(),primary key(employee_id,year,leave_type));
create table public.leave_requests(id uuid primary key default gen_random_uuid(),employee_id uuid not null references public.employees(id),manager_employee_id uuid not null references public.employees(id),year int not null references public.leave_policies(year),leave_type text not null check(leave_type in ('annual','sick','casual')),start_date date not null,end_date date not null,charge_dates date[] not null,days int not null check(days>0),reason text not null check(length(reason) between 1 and 2000),status text not null default 'pending' check(status in ('pending','approved','rejected','cancelled')),decision_note text,decided_by uuid references auth.users(id),decided_at timestamptz,created_at timestamptz not null default now(),check(end_date>=start_date),check(employee_id<>manager_employee_id),check(cardinality(charge_dates)=days));
create index leave_requests_employee_year on public.leave_requests(employee_id,year,status);
create index leave_requests_manager on public.leave_requests(manager_employee_id,status);
create table public.work_inbox(id uuid primary key default gen_random_uuid(),recipient_user_id uuid not null references auth.users(id),sender_user_id uuid references auth.users(id),kind text not null check(kind in ('leave_request','leave_decision','task','alert')),title text not null check(length(title) between 1 and 200),body text not null default '' check(length(body)<=2000),request_id uuid references public.leave_requests(id),read_at timestamptz,completed_at timestamptz,created_at timestamptz not null default now());
create index work_inbox_recipient on public.work_inbox(recipient_user_id,created_at desc);
create table public.workflow_email_outbox(id uuid primary key default gen_random_uuid(),inbox_id uuid not null unique references public.work_inbox(id),recipient_email text not null,subject text not null,link_path text not null,status text not null default 'waiting_for_setup' check(status in ('waiting_for_setup','pending','sending','sent','failed','cancelled')),attempts int not null default 0,provider_id text,last_error text,created_at timestamptz not null default now(),sent_at timestamptz);
create table public.leave_admin_audit(id uuid primary key default gen_random_uuid(),actor_id uuid not null references auth.users(id),action text not null,details jsonb not null,created_at timestamptz not null default now());
alter table public.leave_policies enable row level security;
alter table public.leave_openings enable row level security;
alter table public.leave_requests enable row level security;
alter table public.work_inbox enable row level security;
alter table public.workflow_email_outbox enable row level security;
alter table public.leave_admin_audit enable row level security;
revoke all on public.leave_policies,public.leave_openings,public.leave_requests,public.work_inbox,public.workflow_email_outbox,public.leave_admin_audit from anon,authenticated;

create function hrms_private.leave_hr() returns boolean language sql stable security definer set search_path='' as $f$ select auth.uid() is not null and exists(select 1 from public.user_roles where user_id=auth.uid() and role='hr_admin');$f$;
create function hrms_private.leave_actor() returns uuid language plpgsql stable security definer set search_path='' as $f$
declare v uuid;begin select e.id into v from public.employee_accounts a join public.employees e on e.id=a.employee_id where a.user_id=auth.uid() and a.is_active and not a.must_change_password and e.employment_state<>'inactive';if v is null then raise exception 'Active employee sign-in required' using errcode='42501';end if;return v;end $f$;
create function hrms_private.leave_notify(p_user uuid,p_kind text,p_title text,p_body text,p_request uuid) returns void language plpgsql security definer set search_path='' as $f$
declare v uuid;v_email text;begin
 insert into public.work_inbox(recipient_user_id,sender_user_id,kind,title,body,request_id) values(p_user,auth.uid(),p_kind,p_title,p_body,p_request) returning id into v;
 select login_email into v_email from public.employee_accounts where user_id=p_user and is_active;
 if v_email is not null then insert into public.workflow_email_outbox(inbox_id,recipient_email,subject,link_path) values(v,v_email,p_title,'/workspace?section='||case when p_kind='leave_request' then 'approvals' else 'inbox' end||case when p_request is null then '' else '&request='||p_request::text end);end if;
end $f$;
create function hrms_private.leave_workspace(p_year int) returns jsonb language plpgsql stable security definer set search_path='' as $f$
declare v_id uuid;v_hr boolean;v_policy public.leave_policies%rowtype;v_result jsonb;v_manager jsonb;
begin
 v_hr=hrms_private.leave_hr();if not v_hr then v_id=hrms_private.leave_actor();else select employee_id into v_id from public.employee_accounts where user_id=auth.uid() and is_active and not must_change_password;end if;
 select * into v_policy from public.leave_policies where year=p_year;
 select jsonb_build_object('name',e.full_name,'designation',e.designation,'ready',count(*) over()=1 and coalesce(a.is_active and not a.must_change_password,false) and e.employment_state<>'inactive' and exists(select 1 from public.user_roles where user_id=a.user_id and role='manager')) into v_manager from public.manager_team_links l join public.employees e on e.id=l.manager_employee_id left join public.employee_accounts a on a.employee_id=e.id where l.member_employee_id=v_id limit 1;
 select jsonb_build_object('is_hr',v_hr,'employee_id',v_id,'year',p_year,'policy',case when v_policy.year is null then null else to_jsonb(v_policy) end,'manager',v_manager,
 'balances',coalesce((select jsonb_agg(jsonb_build_object('type',k,'entitlement',coalesce(o.entitlement,(to_jsonb(v_policy)->>k)::int),'opening_taken',o.taken,'verified',o.employee_id is not null,
 'taken',coalesce(o.taken,0)+coalesce((select sum(cardinality(array(select d from unnest(r.charge_dates) d where d<=current_date))) from public.leave_requests r where r.employee_id=v_id and r.year=p_year and r.leave_type=k and r.status='approved'),0),
 'approved',coalesce((select sum(days) from public.leave_requests r where r.employee_id=v_id and r.year=p_year and r.leave_type=k and r.status='approved'),0),
 'pending',coalesce((select sum(days) from public.leave_requests r where r.employee_id=v_id and r.year=p_year and r.leave_type=k and r.status='pending'),0))) from unnest(array['annual','sick','casual']) k left join public.leave_openings o on o.employee_id=v_id and o.year=p_year and o.leave_type=k),'[]'::jsonb),
 'requests',coalesce((select jsonb_agg(to_jsonb(q) order by q.created_at desc) from(select r.*,e.full_name as employee_name,e.employee_no,m.full_name as manager_name from public.leave_requests r join public.employees e on e.id=r.employee_id join public.employees m on m.id=r.manager_employee_id where r.employee_id=v_id and r.year=p_year)q),'[]'::jsonb),
 'approvals',coalesce((select jsonb_agg(to_jsonb(q) order by q.created_at desc) from(select r.*,e.full_name as employee_name,e.employee_no from public.leave_requests r join public.employees e on e.id=r.employee_id where r.year=p_year and (v_hr or (r.manager_employee_id=v_id and exists(select 1 from public.manager_team_links l where l.manager_employee_id=v_id and l.member_employee_id=r.employee_id) and exists(select 1 from public.user_roles where user_id=auth.uid() and role='manager'))))q),'[]'::jsonb),
 'inbox',coalesce((select jsonb_agg(to_jsonb(q) order by q.created_at desc) from(select i.* from public.work_inbox i where recipient_user_id=auth.uid() order by created_at desc limit 200)q),'[]'::jsonb)) into v_result;
 if v_hr then v_result=v_result||jsonb_build_object(
 'employees',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'name',e.full_name,'employee_no',e.employee_no,'designation',e.designation,'account_active',coalesce(a.is_active and not a.must_change_password,false),'is_manager',exists(select 1 from public.user_roles where user_id=a.user_id and role='manager'),'user_id',a.user_id) order by e.employee_no) from public.employees e left join public.employee_accounts a on a.employee_id=e.id where e.employment_state<>'inactive'),'[]'::jsonb),
 'links',coalesce((select jsonb_agg(to_jsonb(l)) from public.manager_team_links l),'[]'::jsonb),
 'openings',coalesce((select jsonb_agg(to_jsonb(o)) from public.leave_openings o where year=p_year),'[]'::jsonb),
 'email_queue',coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'subject',q.subject,'status',q.status,'created_at',q.created_at)) from(select * from public.workflow_email_outbox order by created_at desc limit 100)q),'[]'::jsonb));end if;
 return v_result;
end $f$;
create function hrms_private.leave_action(p_action text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $f$
declare v_id uuid;v_req public.leave_requests%rowtype;v_policy public.leave_policies%rowtype;v_open public.leave_openings%rowtype;v_start date;v_end date;v_dates date[];v_manager uuid;v_user uuid;v_count int;v_used int;v_type text;v_name text;v_decision text;
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501';end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Invalid request' using errcode='22023';end if;
 if not hrms_private.leave_hr() then v_id=hrms_private.leave_actor();else select employee_id into v_id from public.employee_accounts where user_id=auth.uid() and is_active and not must_change_password;end if;
 if p_action in ('read','complete') then update public.work_inbox set read_at=coalesce(read_at,now()),completed_at=case when p_action='complete' and kind='task' then coalesce(completed_at,now()) else completed_at end where id=(p_payload->>'id')::uuid and recipient_user_id=auth.uid();return jsonb_build_object('ok',true);end if;
 if v_id is null then raise exception 'An active employee account is required for leave requests or manager decisions' using errcode='42501';end if;
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

create function hrms_private.leave_admin(p_action text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $f$
declare v_year int;v_id uuid;v_manager uuid;v_user uuid;v_type text;v_taken int;v_total int;v_used int;v_dates date[];v_old public.leave_openings%rowtype;
begin
 if not hrms_private.leave_hr() then raise exception 'HR administrator access required' using errcode='42501';end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Invalid setup' using errcode='22023';end if;
 v_year=(p_payload->>'year')::int;
 if p_action='policy' then
  if v_year is null or v_year not between 2020 and 2100 then raise exception 'Choose a valid year' using errcode='22023';end if;
  perform pg_advisory_xact_lock(4242,v_year);perform 1 from public.leave_policies where year=v_year for update;
  if exists(select 1 from public.leave_requests where year=v_year) then raise exception 'This year has requests. Keep its counting rules intact; use individual balances for entitlement corrections.' using errcode='22023';end if;
  select coalesce(array_agg(value::date),'{}') into v_dates from jsonb_array_elements_text(coalesce(p_payload->'holidays','[]'));
  if exists(select 1 from unnest(v_dates) d where extract(year from d)::int<>v_year) then raise exception 'Holiday dates must belong to the selected year' using errcode='22023';end if;
  insert into public.leave_policies(year,annual,sick,casual,weekdays_only,holidays) values(v_year,(p_payload->>'annual')::int,(p_payload->>'sick')::int,(p_payload->>'casual')::int,(p_payload->>'weekdays_only')::boolean,v_dates) on conflict(year) do update set annual=excluded.annual,sick=excluded.sick,casual=excluded.casual,weekdays_only=excluded.weekdays_only,holidays=excluded.holidays;
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
 elsif p_action='task' then
  v_user=(p_payload->>'recipient_user_id')::uuid;
  if not exists(select 1 from public.employee_accounts a join public.employees e on e.id=a.employee_id where a.user_id=v_user and a.is_active and not a.must_change_password and e.employment_state<>'inactive') then raise exception 'Choose an active employee account' using errcode='22023';end if;
  if nullif(btrim(p_payload->>'title'),'') is null or length(p_payload->>'title')>200 or length(coalesce(p_payload->>'body',''))>2000 then raise exception 'Enter a title (up to 200 characters) and details (up to 2000 characters)' using errcode='22023';end if;
  perform hrms_private.leave_notify(v_user,'task',btrim(p_payload->>'title'),coalesce(p_payload->>'body',''),null);
 else raise exception 'Unsupported setup action' using errcode='22023';end if;
 insert into public.leave_admin_audit(actor_id,action,details) values(auth.uid(),p_action,p_payload||case when p_action='opening' then jsonb_build_object('previous',to_jsonb(v_old)) else '{}'::jsonb end);
 return jsonb_build_object('ok',true);
end $f$;
revoke all on function hrms_private.leave_hr(),hrms_private.leave_actor(),hrms_private.leave_notify(uuid,text,text,text,uuid),hrms_private.leave_workspace(int),hrms_private.leave_action(text,jsonb),hrms_private.leave_admin(text,jsonb) from public,anon,authenticated;
grant execute on function hrms_private.leave_workspace(int),hrms_private.leave_action(text,jsonb),hrms_private.leave_admin(text,jsonb) to authenticated;
create function public.leave_workspace(p_year int) returns jsonb language sql stable security invoker set search_path='' as $f$ select hrms_private.leave_workspace(p_year);$f$;
create function public.leave_action(p_action text,p_payload jsonb) returns jsonb language sql security invoker set search_path='' as $f$ select hrms_private.leave_action(p_action,p_payload);$f$;
create function public.leave_admin(p_action text,p_payload jsonb) returns jsonb language sql security invoker set search_path='' as $f$ select hrms_private.leave_admin(p_action,p_payload);$f$;
revoke all on function public.leave_workspace(int),public.leave_action(text,jsonb),public.leave_admin(text,jsonb) from public,anon;
grant execute on function public.leave_workspace(int),public.leave_action(text,jsonb),public.leave_admin(text,jsonb) to authenticated;
commit;
