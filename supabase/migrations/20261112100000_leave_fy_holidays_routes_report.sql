begin;

-- Leave rollout, 12 November 2026.
-- 1. Public holidays move to an HR-editable table organised by fiscal year (1 July to 30 June).
--    A year with no saved holiday calendar uses the latest earlier year's dates, shifted to the same day and month.
-- 2. The July-June leave year applies to every applicant, not only pilot applicants.
-- 3. The HR approval stage is removed: Line Manager, then HOD, then CEO only for unpaid leave above 15 days in the year.
-- 4. HR leave summary report.

create table public.leave_holidays(
 id uuid primary key default gen_random_uuid(),
 fy int not null check (fy between 2020 and 2100),
 holiday_date date not null unique,
 name text not null check (length(btrim(name)) between 1 and 80),
 needs_review boolean not null default false,
 created_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 constraint leave_holidays_in_fy check (holiday_date>=make_date(fy,7,1) and holiday_date<make_date(fy+1,7,1))
);
create index leave_holidays_fy on public.leave_holidays(fy);
-- A row here means HR's calendar for that fiscal year is saved (even if empty) and no longer inherits.
create table public.leave_holiday_years(fy int primary key check (fy between 2020 and 2100));
alter table public.leave_holidays enable row level security;
alter table public.leave_holiday_years enable row level security;
revoke all on public.leave_holidays,public.leave_holiday_years from public,anon,authenticated;

create function hrms_private.leave_holiday_source(p_fy int) returns int
language sql stable security definer set search_path='' as $f$
 select max(fy) from public.leave_holiday_years where fy<=p_fy;
$f$;

create function hrms_private.leave_holiday_dates(p_fy int) returns date[]
language sql stable security definer set search_path='' as $f$
 select coalesce(array_agg(q.d order by q.d),'{}'::date[]) from (
  select (h.holiday_date+make_interval(years=>p_fy-h.fy))::date as d
  from public.leave_holidays h where h.fy=hrms_private.leave_holiday_source(p_fy)) q;
$f$;

create function hrms_private.leave_holiday_list(p_fy int) returns jsonb
language sql stable security definer set search_path='' as $f$
 select coalesce(jsonb_agg(jsonb_build_object(
  'date',(h.holiday_date+make_interval(years=>p_fy-h.fy))::date,'name',h.name,
  'needs_review',h.needs_review or h.fy<>p_fy,'carried_forward',h.fy<>p_fy) order by h.holiday_date),'[]'::jsonb)
 from public.leave_holidays h where h.fy=hrms_private.leave_holiday_source(p_fy);
$f$;

-- Called before HR's first edit of a fiscal year: saves the inherited dates so the edit applies to a full calendar.
create function hrms_private.leave_holiday_materialize(p_fy int) returns void
language plpgsql security definer set search_path='' as $f$
declare v_src int;
begin
 if exists(select 1 from public.leave_holiday_years where fy=p_fy) then return;end if;
 v_src=hrms_private.leave_holiday_source(p_fy);
 insert into public.leave_holiday_years(fy) values(p_fy);
 if v_src is not null then
  insert into public.leave_holidays(fy,holiday_date,name,needs_review,created_by)
  select p_fy,(h.holiday_date+make_interval(years=>p_fy-h.fy))::date,h.name,true,auth.uid()
  from public.leave_holidays h where h.fy=v_src
  on conflict(holiday_date) do nothing;
 end if;
end $f$;

-- After a holiday is added or deleted: re-count working-day leave from today onwards.
-- Days already taken keep their charge. HR is alerted where a balance goes below zero
-- or a request no longer contains a chargeable day.
create function hrms_private.leave_recalculate(p_fy int) returns int
language plpgsql security definer set search_path='' as $f$
declare r public.leave_requests%rowtype;v_policy public.leave_policies%rowtype;v_h date[];v_new date[];v_changed int:=0;v_user uuid;v_hr uuid;v_open public.leave_openings%rowtype;v_used numeric;v_name text;
begin
 select * into v_policy from public.leave_policies where year=p_fy;
 if v_policy.year is null then return 0;end if;
 v_h=hrms_private.leave_holiday_dates(p_fy);
 for r in select * from public.leave_requests where year=p_fy and status in ('pending','approved') and leave_type in ('annual','sick','casual') and end_date>=current_date order by created_at for update loop
  select coalesce(array_agg(q.d order by q.d),'{}'::date[]) into v_new from (
   select d from unnest(r.charge_dates) d where d<current_date
   union
   select g::date from generate_series(greatest(r.start_date,current_date)::timestamp,r.end_date::timestamp,interval '1 day') g
   where (not v_policy.weekdays_only or extract(isodow from g)<6) and not(g::date=any(v_h))) q;
  continue when v_new=r.charge_dates;
  select full_name into v_name from public.employees where id=r.employee_id;
  if cardinality(v_new)=0 or (r.days<1 and cardinality(v_new)<>1) then
   for v_hr in select user_id from public.user_roles where role='hr_admin' loop
    perform hrms_private.leave_notify(v_hr,'alert','Leave request needs HR review',v_name||': '||r.leave_type||' leave, '||r.start_date||' to '||r.end_date||', no longer contains a working day after a holiday change. Its charge of '||r.days||' day(s) was left unchanged.',r.id);
   end loop;
   continue;
  end if;
  update public.leave_requests set charge_dates=v_new,days=case when r.days<1 then r.days else cardinality(v_new) end where id=r.id;
  v_changed=v_changed+1;
  if r.days>=1 then
   select user_id into v_user from public.employee_accounts where employee_id=r.employee_id and is_active;
   if v_user is not null then perform hrms_private.leave_notify(v_user,'alert','Leave charge updated','Your '||r.leave_type||' leave, '||r.start_date||' to '||r.end_date||', is now charged as '||cardinality(v_new)||' day(s) (previously '||r.days||') following a change to the company holiday calendar.',r.id);end if;
   select * into v_open from public.leave_openings where employee_id=r.employee_id and year=p_fy and leave_type=r.leave_type;
   select coalesce(sum(days),0) into v_used from public.leave_requests where employee_id=r.employee_id and year=p_fy and leave_type=r.leave_type and status in ('pending','approved');
   if v_open.employee_id is not null and v_open.entitlement-v_open.taken-v_used<0 then
    for v_hr in select user_id from public.user_roles where role='hr_admin' loop
     perform hrms_private.leave_notify(v_hr,'alert','Leave balance below zero',v_name||': '||r.leave_type||' leave balance is '||(v_open.entitlement-v_open.taken-v_used)||' day(s) after a holiday change. Review the request for '||r.start_date||' to '||r.end_date||'.',r.id);
    end loop;
   end if;
  end if;
 end loop;
 return v_changed;
end $f$;
revoke all on function hrms_private.leave_holiday_source(int),hrms_private.leave_holiday_dates(int),hrms_private.leave_holiday_list(int),hrms_private.leave_holiday_materialize(int),hrms_private.leave_recalculate(int) from public,anon,authenticated;

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
 elsif p_action='task' then
  v_user=(p_payload->>'recipient_user_id')::uuid;
  if not exists(select 1 from public.employee_accounts a join public.employees e on e.id=a.employee_id where a.user_id=v_user and a.is_active and not a.must_change_password and e.employment_state<>'inactive') then raise exception 'Choose an active employee account' using errcode='22023';end if;
  if nullif(btrim(p_payload->>'title'),'') is null or length(p_payload->>'title')>200 or length(coalesce(p_payload->>'body',''))>2000 then raise exception 'Enter a title (up to 200 characters) and details (up to 2000 characters)' using errcode='22023';end if;
  perform hrms_private.leave_notify(v_user,'task',btrim(p_payload->>'title'),coalesce(p_payload->>'body',''),null);
 else raise exception 'Unsupported setup action' using errcode='22023';end if;
 insert into public.leave_admin_audit(actor_id,action,details) values(auth.uid(),p_action,p_payload||case when p_action='opening' then jsonb_build_object('previous',to_jsonb(v_old)) else '{}'::jsonb end);
 return jsonb_build_object('ok',true);
end $f$;

create or replace function hrms_private.leave_workspace(p_year int) returns jsonb language plpgsql stable security definer set search_path='' as $f$
declare v_id uuid;v_hr boolean;v_policy public.leave_policies%rowtype;v_result jsonb;v_manager jsonb;
begin
 v_hr=hrms_private.leave_hr();if not v_hr then v_id=hrms_private.leave_approval_actor();else select a.employee_id into v_id from public.employee_accounts a join public.employees e on e.id=a.employee_id where a.user_id=auth.uid() and a.is_active and not a.must_change_password and e.employment_state<>'inactive';end if;
 select * into v_policy from public.leave_policies where year=p_year;
 select jsonb_build_object('name',e.full_name,'designation',e.designation,'ready',count(*) over()=1 and coalesce(a.is_active,false) and e.employment_state<>'inactive') into v_manager from hrms_private.leave_reporting_links l join public.employees e on e.id=l.manager_employee_id left join public.employee_accounts a on a.employee_id=e.id where l.member_employee_id=v_id limit 1;
 select jsonb_build_object('is_hr',v_hr,'employee_id',v_id,'year',p_year,'policy',case when v_policy.year is null then null else to_jsonb(v_policy)||jsonb_build_object('holidays',to_jsonb(hrms_private.leave_holiday_dates(p_year))) end,'holiday_list',hrms_private.leave_holiday_list(p_year),'manager',v_manager,
 'balances',coalesce((select jsonb_agg(jsonb_build_object('type',k,'entitlement',coalesce(o.entitlement,(to_jsonb(v_policy)->>k)::int),'opening_taken',o.taken,'verified',o.employee_id is not null,
 'taken',coalesce(o.taken,0)+coalesce((select sum(r.days * cardinality(array(select d from unnest(r.charge_dates) d where d<=current_date)) / cardinality(r.charge_dates)) from public.leave_requests r where r.employee_id=v_id and r.year=p_year and r.leave_type=k and r.status='approved'),0),
 'approved',coalesce((select sum(days) from public.leave_requests r where r.employee_id=v_id and r.year=p_year and r.leave_type=k and r.status='approved'),0),
 'pending',coalesce((select sum(days) from public.leave_requests r where r.employee_id=v_id and r.year=p_year and r.leave_type=k and r.status='pending'),0))) from unnest(array['annual','sick','casual']) k left join public.leave_openings o on o.employee_id=v_id and o.year=p_year and o.leave_type=k),'[]'::jsonb),
 'requests',coalesce((select jsonb_agg(to_jsonb(q) order by q.created_at desc) from(select r.*,e.full_name as employee_name,e.employee_no,m.full_name as manager_name from public.leave_requests r join public.employees e on e.id=r.employee_id join public.employees m on m.id=r.manager_employee_id where r.employee_id=v_id and r.year=p_year)q),'[]'::jsonb),
 'approvals',coalesce((select jsonb_agg(to_jsonb(q) order by q.created_at desc) from(select r.*,e.full_name as employee_name,e.employee_no,
 case when route.request_id is not null then route.approvers[route.stage]=auth.uid()
 else r.manager_employee_id=v_id end as can_decide
 from public.leave_requests r join public.employees e on e.id=r.employee_id left join hrms_private.leave_request_route route on route.request_id=r.id
 where r.year=p_year and (v_hr or route.approvers[route.stage]=auth.uid() or (route.request_id is null and r.manager_employee_id=v_id and exists(select 1 from hrms_private.leave_reporting_links l where l.manager_employee_id=v_id and l.member_employee_id=r.employee_id))))q),'[]'::jsonb),
 'team',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'name',e.full_name,'employee_no',e.employee_no,'user_id',a.user_id,'account_active',coalesce(a.is_active and not a.must_change_password,false))) from hrms_private.leave_reporting_links l join public.employees e on e.id=l.member_employee_id left join public.employee_accounts a on a.employee_id=e.id where l.manager_employee_id=v_id and e.employment_state<>'inactive' and exists(select 1 from public.user_roles where user_id=auth.uid() and role='manager')),'[]'::jsonb),
 'inbox',coalesce((select jsonb_agg(to_jsonb(q) order by q.created_at desc) from(select i.*,r.year as request_year from public.work_inbox i left join public.leave_requests r on r.id=i.request_id where recipient_user_id=auth.uid() order by i.created_at desc limit 200)q),'[]'::jsonb)) into v_result;
 if v_hr then v_result=v_result||jsonb_build_object(
 'employees',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'name',e.full_name,'employee_no',e.employee_no,'designation',e.designation,'account_active',coalesce(a.is_active and not a.must_change_password,false),'is_manager',exists(select 1 from public.user_roles where user_id=a.user_id and role='manager'),'user_id',a.user_id) order by e.employee_no) from public.employees e left join public.employee_accounts a on a.employee_id=e.id where e.employment_state<>'inactive'),'[]'::jsonb),
 'links',coalesce((select jsonb_agg(to_jsonb(l)) from hrms_private.leave_reporting_links l),'[]'::jsonb),
 'openings',coalesce((select jsonb_agg(to_jsonb(o)) from public.leave_openings o where year=p_year),'[]'::jsonb),
 'email_queue',coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'subject',q.subject,'status',q.status,'created_at',q.created_at,'pilot',exists(select 1 from public.work_inbox i join hrms_private.leave_request_route route on route.request_id=i.request_id where i.id=q.inbox_id and i.kind in ('leave_request','leave_decision')))) from(select * from public.workflow_email_outbox order by created_at desc limit 100)q),'[]'::jsonb));end if;
 return v_result;
end $f$;

create or replace function hrms_private.leave_action(p_action text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $f$
declare v_charge numeric;v_hours text;v_year int;v_pilot boolean;v_stages uuid[];v_next uuid;v_routed boolean;v_id uuid;v_req public.leave_requests%rowtype;v_policy public.leave_policies%rowtype;v_open public.leave_openings%rowtype;v_start date;v_end date;v_dates date[];v_manager uuid;v_user uuid;v_count int;v_used numeric;v_type text;v_name text;v_decision text;
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501';end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Invalid request' using errcode='22023';end if;
 if not hrms_private.leave_hr() then v_id=case when p_action='decide' then hrms_private.leave_approval_actor() else hrms_private.leave_actor() end;else select a.employee_id into v_id from public.employee_accounts a join public.employees e on e.id=a.employee_id where a.user_id=auth.uid() and a.is_active and not a.must_change_password and e.employment_state<>'inactive';end if;
 if p_action in ('read','complete') then update public.work_inbox set read_at=coalesce(read_at,now()),completed_at=case when p_action='complete' and kind='task' then coalesce(completed_at,now()) else completed_at end where id=(p_payload->>'id')::uuid and recipient_user_id=auth.uid();return jsonb_build_object('ok',true);end if;
 if v_id is null then raise exception 'An active employee account is required for leave requests or manager decisions' using errcode='42501';end if;
 if p_action='task' then
  v_user=(p_payload->>'recipient_user_id')::uuid;
  if not exists(select 1 from public.user_roles where user_id=auth.uid() and role='manager') or not exists(select 1 from public.employee_accounts a join hrms_private.leave_reporting_links l on l.member_employee_id=a.employee_id join public.employees e on e.id=a.employee_id where a.user_id=v_user and a.is_active and not a.must_change_password and e.employment_state<>'inactive' and l.manager_employee_id=v_id) then raise exception 'Managers can assign tasks only to active verified direct reports' using errcode='42501';end if;
  if nullif(btrim(p_payload->>'title'),'') is null or length(p_payload->>'title')>200 or length(coalesce(p_payload->>'body',''))>2000 then raise exception 'Enter a title (up to 200 characters) and details (up to 2000 characters)' using errcode='22023';end if;
  perform hrms_private.leave_notify(v_user,'task',btrim(p_payload->>'title'),coalesce(p_payload->>'body',''),null);
  return jsonb_build_object('ok',true);
 end if;
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
  select array_remove(array[ v_user, case when c.hod_user_id<>v_user then c.hod_user_id end, case when v_type='unpaid' and v_used+v_charge>15 and c.ceo_user_id<>v_user and c.ceo_user_id<>c.hod_user_id then c.ceo_user_id end ],null)
  into v_stages from hrms_private.leave_pilot_routes c where c.employee_id=v_id;
  if v_type='unpaid' and v_used+v_charge>15 and not exists(
   select 1 from hrms_private.leave_pilot_routes where employee_id=v_id and ceo_user_id is not null
  ) then raise exception 'HR must configure the CEO approver' using errcode='22023';end if;
  if v_stages is not null then
   if auth.uid()=any(v_stages) then raise exception 'A requester cannot approve their own leave' using errcode='22023';end if;
   insert into hrms_private.leave_request_route(request_id,approvers) values(v_req.id,v_stages);
  end if;
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
   select approvers[stage] into v_next from hrms_private.leave_request_route where request_id=v_req.id for update;
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
   select approvers[stage+1] into v_next from hrms_private.leave_request_route where request_id=v_req.id;
   if v_decision='approved' and v_next is not null then
    update hrms_private.leave_request_route set stage=stage+1 where request_id=v_req.id;
    update public.work_inbox set completed_at=now() where request_id=v_req.id and kind='leave_request' and completed_at is null;
    update public.workflow_email_outbox set status='cancelled' where inbox_id in(select id from public.work_inbox where request_id=v_req.id and kind='leave_request') and status in ('waiting_for_setup','pending','failed');
    perform hrms_private.leave_notify(v_next,'leave_request','Leave approval requested','A leave request is ready for your review.',v_req.id);
    return jsonb_build_object('ok',true,'status','pending');
   end if;
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

-- The HR approval stage is no longer used.
alter table hrms_private.leave_pilot_routes alter column hr_user_id drop not null;

-- HR leave summary report for any period. Balances are per fiscal year.
create function hrms_private.leave_report(p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path='' as $f$
declare v_result jsonb;
begin
 if not hrms_private.leave_hr() then raise exception 'HR administrator access required' using errcode='42501';end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>1100 then raise exception 'Choose a valid period of up to three years' using errcode='22023';end if;
 with fys as (
  select generate_series(extract(year from (p_from-interval '6 months'))::int,extract(year from (p_to-interval '6 months'))::int) as fy
 ),req as (
  select r.*,(select count(*) from unnest(r.charge_dates) d where d between p_from and p_to)::numeric/cardinality(r.charge_dates) as share
  from public.leave_requests r
 ),keys as (
  select o.employee_id,o.year as fy,o.leave_type from public.leave_openings o join fys on fys.fy=o.year
  union
  select r.employee_id,r.year,r.leave_type from req r join fys on fys.fy=r.year where r.status in ('pending','approved')
 )
 select jsonb_build_object('from',p_from,'to',p_to,
  'summary',coalesce((select jsonb_agg(jsonb_build_object(
    'employee_no',e.employee_no,'name',e.full_name,'designation',e.designation,'department',e.department,'active',e.employment_state<>'inactive',
    'fy',k.fy,'leave_type',k.leave_type,'entitlement',o.entitlement,'opening_taken',o.taken,
    'approved_period',t.approved_period,'pending_period',t.pending_period,'approved_fy',t.approved_fy,'pending_fy',t.pending_fy,
    'balance',case when o.employee_id is null then null else o.entitlement-o.taken-t.approved_fy-t.pending_fy end
   ) order by e.employee_no,k.fy,k.leave_type)
   from keys k join public.employees e on e.id=k.employee_id
   left join public.leave_openings o on o.employee_id=k.employee_id and o.year=k.fy and o.leave_type=k.leave_type
   cross join lateral (select
     coalesce(sum(r.days*r.share) filter (where r.status='approved'),0) as approved_period,
     coalesce(sum(r.days*r.share) filter (where r.status='pending'),0) as pending_period,
     coalesce(sum(r.days) filter (where r.status='approved'),0) as approved_fy,
     coalesce(sum(r.days) filter (where r.status='pending'),0) as pending_fy
    from req r where r.employee_id=k.employee_id and r.year=k.fy and r.leave_type=k.leave_type) t),'[]'::jsonb),
  'detail',coalesce((select jsonb_agg(jsonb_build_object(
    'employee_no',e.employee_no,'name',e.full_name,'designation',e.designation,'department',e.department,
    'fy',r.year,'leave_type',r.leave_type,'start_date',r.start_date,'end_date',r.end_date,'days',r.days,
    'days_in_period',r.days*r.share,'status',r.status,'reason',r.reason,'applied_at',r.created_at,'decided_at',r.decided_at,
    'decided_by',(select d.full_name from public.employee_accounts a join public.employees d on d.id=a.employee_id where a.user_id=r.decided_by limit 1)
   ) order by r.start_date,e.employee_no)
   from req r join public.employees e on e.id=r.employee_id where r.start_date<=p_to and r.end_date>=p_from),'[]'::jsonb)
 ) into v_result;
 return v_result;
end $f$;
revoke all on function hrms_private.leave_report(date,date) from public,anon;
grant execute on function hrms_private.leave_report(date,date) to authenticated;

create function public.leave_report(p_from date,p_to date) returns jsonb
language sql stable security invoker set search_path='' as $f$
 select hrms_private.leave_report(p_from,p_to);
$f$;
revoke all on function public.leave_report(date,date) from public,anon;
grant execute on function public.leave_report(date,date) to authenticated;

-- FY 26-27 calendar supplied for the pilot (lib/head-office-leave.ts). Names are HR-editable labels.
-- Moon-sighting dates are saved as needs_review until HR confirms them.
insert into public.leave_holiday_years(fy) values(2026);
insert into public.leave_holidays(fy,holiday_date,name,needs_review) values
 (2026,'2026-08-14','Independence Day',false),
 (2026,'2026-08-25','Company holiday',false),
 (2026,'2026-11-09','Iqbal Day',false),
 (2026,'2026-12-25','Quaid-e-Azam Day',false),
 (2026,'2027-02-05','Kashmir Day',false),
 (2026,'2027-03-23','Pakistan Day',false),
 (2026,'2027-05-01','Labour Day',false),
 (2026,'2027-05-28','Youm-e-Takbeer',false),
 (2026,'2027-03-10','Eid-ul-Fitr',true),
 (2026,'2027-03-11','Eid-ul-Fitr',true),
 (2026,'2027-03-12','Eid-ul-Fitr',true),
 (2026,'2027-05-16','Eid-ul-Adha',true),
 (2026,'2027-05-17','Eid-ul-Adha',true),
 (2026,'2027-05-18','Eid-ul-Adha',true),
 (2026,'2027-06-14','Ashura',true),
 (2026,'2027-06-15','Ashura',true);

commit;
