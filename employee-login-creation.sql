create or replace function public.prepare_employee_login(p_employee uuid,p_actor uuid,p_token text default null)
returns jsonb language plpgsql security invoker set search_path='' as $f$
declare e public.employees%rowtype;d public.employee_details%rowtype; candidate text; selected text; cnic text; first_name text; job uuid; r jsonb;
begin
 if not exists(select 1 from public.user_roles where user_id=p_actor and role='hr_admin') then raise exception 'HR administrator required';end if;
 select * into e from public.employees where id=p_employee for update;
 select * into d from public.employee_details where employee_id=p_employee;
 if e.id is null or d.employee_id is null then raise exception 'Save the employee profile first';end if;
 if e.employment_state<>'active' then raise exception 'Activate the employee before creating a login';end if;
 if exists(select 1 from public.employee_accounts where employee_id=p_employee) then raise exception 'Employee already has a login. Its password was not changed.';end if;
 if exists(select 1 from hrms_private.employee_import_jobs j,jsonb_array_elements(j.rows) v where j.status in ('pending','running') and j.expires_at>now() and v->>'employee_id'=p_employee::text) then raise exception 'Login creation is already in progress. Please wait before retrying.';end if;
 foreach candidate in array array[lower(btrim(coalesce(d.profile->>'email',''))),lower(btrim(coalesce(d.profile->>'personal_email','')))] loop
  if candidate ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' and length(candidate)<=254
   and not exists(select 1 from public.employee_details where employee_id<>p_employee and (lower(btrim(coalesce(profile->>'email','')))=candidate or lower(btrim(coalesce(profile->>'personal_email','')))=candidate)) then selected:=candidate;exit;end if;
 end loop;
 if selected is null then raise exception 'Add a unique valid work or personal email before creating a login';end if;
 if exists(select 1 from auth.users where lower(email)=selected) then raise exception 'This email already belongs to a sign-in account. Resolve the conflict before creating a login.';end if;
 cnic:=regexp_replace(coalesce(d.profile->>'cnic_passport',''),'[-[:space:]]','','g');
 if cnic !~ '^[0-9]{13}$' then raise exception 'Add a valid 13-digit CNIC before creating a login';end if;
 first_name:=split_part(btrim(e.full_name),' ',1);
 if length(first_name)+4<6 then raise exception 'First name is too short for the agreed password rule. HR decision required.';end if;
 r:=jsonb_build_object('employee_id',e.id,'employee_no',e.employee_no,'login_email',selected,'expected_updated_at',e.updated_at,'expected_profile_updated_at',d.updated_at,'actor_id',p_actor);
 insert into hrms_private.employee_import_jobs(source_file,token_hash,expires_at,status,rows)
 values('Admin portal employee login creation',case when p_token is null then '' else encode(extensions.digest(p_token,'sha256'),'hex') end,now()+interval '10 minutes',case when p_token is null then 'running' else 'pending' end,jsonb_build_array(r)) returning id into job;
 return jsonb_build_object('job',job,'employee_id',e.id,'employee_no',e.employee_no,'full_name',e.full_name,'username',selected,'initial_password',first_name||right(cnic,4));
end $f$;
create or replace function public.finish_employee_login(p_job uuid,p_actor uuid) returns void language plpgsql security invoker set search_path='' as $f$
begin
 if not exists(select 1 from public.user_roles where user_id=p_actor and role='hr_admin') then raise exception 'HR administrator required';end if;
 update hrms_private.employee_import_jobs set status='completed',token_hash='' where id=p_job and source_file='Admin portal employee login creation' and rows->0->>'actor_id'=p_actor::text;
end $f$;
revoke all on function public.prepare_employee_login(uuid,uuid,text),public.finish_employee_login(uuid,uuid) from public,anon,authenticated;
grant execute on function public.prepare_employee_login(uuid,uuid,text),public.finish_employee_login(uuid,uuid) to service_role;