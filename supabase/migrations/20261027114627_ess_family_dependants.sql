begin;
create table public.employee_family_details(
 employee_id uuid primary key references public.employees(id) on delete restrict,
 spouse jsonb check(spouse is null or jsonb_typeof(spouse)='object'),
 children jsonb not null default '[]'::jsonb check(jsonb_typeof(children)='array'),
 updated_at timestamptz not null default now()
);
alter table public.employee_family_details enable row level security;
revoke all on public.employee_family_details from public,anon,authenticated;
grant select on public.employee_family_details to authenticated;
create policy "Employee or HR reads family details" on public.employee_family_details for select to authenticated using(
 public.is_hr_admin() or exists(select 1 from public.employee_accounts a join public.employees e on e.id=a.employee_id
 where a.employee_id=employee_family_details.employee_id and a.user_id=(select auth.uid())
 and a.is_active and not a.must_change_password and e.employment_state<>'inactive')
);
-- Audit metadata only: do not duplicate medical information or CNICs in logs.
create table public.employee_family_updates(
 id uuid primary key default gen_random_uuid(),
 employee_id uuid not null references public.employees(id) on delete restrict,
 actor_id uuid not null,
 spouse_recorded boolean not null,
 children_count integer not null,
 occurred_at timestamptz not null default now()
);
alter table public.employee_family_updates enable row level security;
revoke all on public.employee_family_updates from public,anon,authenticated;
grant select on public.employee_family_updates to authenticated;
create policy "HR reads family update history" on public.employee_family_updates for select to authenticated using(public.is_hr_admin());

create function hrms_private.validate_family_member(p_member jsonb)
returns jsonb language plpgsql immutable security invoker set search_path='' as $f$
declare v_name text; v_cnic text; v_age numeric; v_conditions text;
begin
 if p_member is null or jsonb_typeof(p_member)<>'object' then raise exception 'A dependant must be a single person' using errcode='22023'; end if;
 if exists(select 1 from jsonb_object_keys(p_member) k where k<>all(array['full_name','age','pre_existing_conditions','cnic'])) then raise exception 'Unsupported dependant field' using errcode='22023'; end if;
 if jsonb_typeof(p_member->'full_name') is distinct from 'string' then raise exception 'Name is required' using errcode='22023'; end if;
 v_name=btrim(p_member->>'full_name');
 if v_name='' or length(v_name)>200 then raise exception 'Name must contain 1 to 200 characters' using errcode='22023'; end if;
 if jsonb_typeof(p_member->'age') is distinct from 'number' then raise exception 'Age in whole years is required' using errcode='22023'; end if;
 v_age=(p_member->>'age')::numeric;
 if v_age<0 or mod(v_age,1)<>0 then raise exception 'Age must be a non-negative whole number' using errcode='22023'; end if;
 if p_member?'cnic' and jsonb_typeof(p_member->'cnic') not in ('string','null') then raise exception 'CNIC must be text' using errcode='22023'; end if;
 v_cnic=regexp_replace(coalesce(p_member->>'cnic',''),'[-[:space:]]','','g');
 if v_age>18 and v_cnic='' then raise exception 'CNIC is required for every dependant over 18' using errcode='22023'; end if;
 if v_cnic<>'' and v_cnic!~'^[0-9]{13}$' then raise exception 'CNIC must contain 13 digits' using errcode='22023'; end if;
 if p_member?'pre_existing_conditions' and jsonb_typeof(p_member->'pre_existing_conditions') not in ('string','null') then raise exception 'Pre-existing conditions must be text' using errcode='22023'; end if;
 v_conditions=btrim(coalesce(p_member->>'pre_existing_conditions',''));
 if length(v_conditions)>4000 then raise exception 'Pre-existing conditions must be at most 4000 characters' using errcode='22023'; end if;
 return jsonb_build_object('full_name',v_name,'age',v_age,'pre_existing_conditions',v_conditions,'cnic',v_cnic);
end $f$;
revoke all on function hrms_private.validate_family_member(jsonb) from public,anon,authenticated;

create function hrms_private.my_family_details()
returns jsonb language plpgsql stable security definer set search_path='' as $f$
declare v_id uuid; v_row public.employee_family_details%rowtype;
begin
 select e.id into v_id from public.employee_accounts a join public.employees e on e.id=a.employee_id
 where a.user_id=auth.uid() and a.is_active and not a.must_change_password and e.employment_state<>'inactive';
 if v_id is null then raise exception 'Active employee sign-in required' using errcode='42501'; end if;
 select * into v_row from public.employee_family_details where employee_id=v_id;
 return jsonb_build_object('spouse',v_row.spouse,'children',coalesce(v_row.children,'[]'::jsonb),'updated_at',v_row.updated_at);
end $f$;
revoke all on function hrms_private.my_family_details() from public,anon,authenticated;
grant execute on function hrms_private.my_family_details() to authenticated;

create function hrms_private.save_my_family_details(p_spouse jsonb,p_children jsonb,p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare v_id uuid; v_row public.employee_family_details%rowtype; v_spouse jsonb;
 v_children jsonb:='[]'::jsonb; v_child jsonb;
begin
 select e.id into v_id from public.employee_accounts a join public.employees e on e.id=a.employee_id
 where a.user_id=auth.uid() and a.is_active and not a.must_change_password and e.employment_state<>'inactive'
 for share of a for update of e;
 if v_id is null then raise exception 'Active employee sign-in required' using errcode='42501'; end if;
 if p_spouse is not null and p_spouse<>'null'::jsonb then
  v_spouse=hrms_private.validate_family_member(p_spouse);
 end if;
 if p_children is null or jsonb_typeof(p_children)<>'array' then raise exception 'Children must be a list' using errcode='22023'; end if;
 for v_child in select value from jsonb_array_elements(p_children) loop
  v_children=v_children||jsonb_build_array(hrms_private.validate_family_member(v_child));
 end loop;
 select * into v_row from public.employee_family_details where employee_id=v_id for update;
 if v_row.updated_at is distinct from p_expected_updated_at then raise exception 'Family details changed elsewhere. Reload before saving.' using errcode='40001'; end if;
 if v_row.employee_id is not null and v_row.spouse is not distinct from v_spouse and v_row.children=v_children then return hrms_private.my_family_details(); end if;
 insert into public.employee_family_details(employee_id,spouse,children,updated_at)
 values(v_id,v_spouse,v_children,clock_timestamp())
 on conflict(employee_id) do update set spouse=excluded.spouse,children=excluded.children,updated_at=clock_timestamp();
 insert into public.employee_family_updates(employee_id,actor_id,spouse_recorded,children_count)
 values(v_id,auth.uid(),v_spouse is not null,jsonb_array_length(v_children));
 return hrms_private.my_family_details();
end $f$;
revoke all on function hrms_private.save_my_family_details(jsonb,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function hrms_private.save_my_family_details(jsonb,jsonb,timestamptz) to authenticated;
create function public.my_family_details() returns jsonb language sql stable security invoker set search_path='' as $f$
 select hrms_private.my_family_details();
$f$;
revoke all on function public.my_family_details() from public,anon,authenticated;
grant execute on function public.my_family_details() to authenticated;
create function public.save_my_family_details(p_spouse jsonb,p_children jsonb,p_expected_updated_at timestamptz)
returns jsonb language sql security invoker set search_path='' as $f$
 select hrms_private.save_my_family_details(p_spouse,p_children,p_expected_updated_at);
$f$;
revoke all on function public.save_my_family_details(jsonb,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.save_my_family_details(jsonb,jsonb,timestamptz) to authenticated;
commit;
