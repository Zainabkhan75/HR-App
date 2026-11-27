create or replace function hrms_private.leave_year_entitlement(p_type text, p_full_days numeric, p_year integer, p_joined date)
returns numeric language sql immutable strict set search_path = pg_catalog as $$
  with bounds as (
    select make_date(p_year, 7, 1) as starts, make_date(p_year + 1, 7, 1) as ends
  )
  select case
    when p_joined >= ends then 0
    when p_type <> 'annual' or p_joined <= starts then p_full_days
    else ceil(4 * p_full_days * (ends - p_joined) / (ends - starts)) / 4
  end from bounds
$$;
revoke all on function hrms_private.leave_year_entitlement(text,numeric,integer,date) from public, anon, authenticated;
do $$
begin
  if hrms_private.leave_year_entitlement('annual',15,2027,date '2028-01-07') <> 7.25
     or hrms_private.leave_year_entitlement('casual',10,2027,date '2028-06-30') <> 10
     or hrms_private.leave_year_entitlement('sick',8,2027,date '2028-06-30') <> 8
     or hrms_private.leave_year_entitlement('annual',15,2027,date '2027-07-01') <> 15
     or hrms_private.leave_year_entitlement('annual',15,2027,date '2028-06-30') <> 0.25 then
    raise exception 'Leave-year entitlement check failed';
  end if;
end $$;
create or replace function hrms_private.leave_policy_for_year(target_year integer)
returns setof public.leave_policies language sql stable set search_path=pg_catalog as $$
  select target_year,p.annual,p.sick,p.casual,p.weekdays_only,
         case when p.year=target_year then p.holidays else '{}'::date[] end
  from public.leave_policies p where p.year<=target_year and target_year between 2020 and 2100
  order by p.year desc limit 1
$$;
create or replace function hrms_private.ensure_leave_policy_year(target_year integer)
returns void language plpgsql set search_path=pg_catalog as $$
begin
  if exists(select 1 from public.leave_policies where year=target_year) then return; end if;
  perform pg_advisory_xact_lock(4242,target_year);
  insert into public.leave_policies(year,annual,sick,casual,weekdays_only,holidays)
    select * from hrms_private.leave_policy_for_year(target_year)
    on conflict(year) do nothing;
end $$;
revoke all on function hrms_private.leave_policy_for_year(integer), hrms_private.ensure_leave_policy_year(integer) from public,anon,authenticated;
do $$
declare item record; original text;
begin
  for item in select * from (values
    ('hrms_private.leave_workspace(integer)','from public.leave_policies where year=p_year;', 'from hrms_private.leave_policy_for_year(p_year);'),
    ('hrms_private.leave_action(text,jsonb)','select * into v_policy from public.leave_policies where year=v_year for share;', 'perform hrms_private.ensure_leave_policy_year(v_year); select * into v_policy from public.leave_policies where year=v_year for share;'),
    ('hrms_private.leave_admin(text,jsonb)', 'elsif p_action=''opening'' then', 'elsif p_action=''opening'' then perform hrms_private.ensure_leave_policy_year(v_year);'),
    ('hrms_private.leave_recalculate(integer)','from public.leave_policies where year=p_fy;', 'from hrms_private.leave_policy_for_year(p_fy);')
  ) as replacements(signature,needle,replacement) loop
    original := pg_get_functiondef(item.signature::regprocedure);
    if strpos(original,item.needle)=0 then raise exception 'Unexpected definition for %',item.signature; end if;
    execute replace(original,item.needle,item.replacement);
  end loop;
end $$;