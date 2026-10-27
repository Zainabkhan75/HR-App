begin;
create table hrms_private.employee_import_jobs(id uuid primary key default gen_random_uuid(),source_file text not null,token_hash text not null,expires_at timestamptz not null,status text not null default 'pending' check(status in ('pending','running','completed')),rows jsonb not null,created_at timestamptz not null default now());
create table hrms_private.employee_import_results(job_id uuid references hrms_private.employee_import_jobs(id),source_row int,employee_id uuid references public.employees(id),user_id uuid references auth.users(id),status text not null,before_employee jsonb,before_profile jsonb,completed_at timestamptz not null default now(),primary key(job_id,source_row));
alter table hrms_private.employee_import_jobs enable row level security;
alter table hrms_private.employee_import_results enable row level security;
revoke all on hrms_private.employee_import_jobs,hrms_private.employee_import_results from public,anon,authenticated;
create function hrms_private.claim_employee_import(p_job uuid,p_token text) returns jsonb language plpgsql security definer set search_path='' as $f$
declare j hrms_private.employee_import_jobs%rowtype;
begin
 select * into j from hrms_private.employee_import_jobs where id=p_job for update;
 if j.id is null or j.expires_at<now() or j.status<>'pending' or j.token_hash<>encode(extensions.digest(p_token,'sha256'),'hex') then raise exception 'Import job unavailable' using errcode='42501';end if;
 update hrms_private.employee_import_jobs set status='running',token_hash='' where id=j.id;
 return jsonb_build_object('rows',j.rows);
end $f$;
create function hrms_private.commit_employee_import(p_job uuid,p_row int,p_user uuid) returns jsonb language plpgsql security definer set search_path='' as $f$
declare j hrms_private.employee_import_jobs%rowtype;r jsonb;e public.employees%rowtype;d public.employee_details%rowtype;
begin
 select * into j from hrms_private.employee_import_jobs where id=p_job and status='running' for share;
 if j.id is null or j.expires_at<now() then raise exception 'Import job unavailable' using errcode='42501';end if;
 select value into r from jsonb_array_elements(j.rows) where (value->>'source_row')::int=p_row;
 if r is null then raise exception 'Import row not approved' using errcode='42501';end if;
 select * into e from public.employees where id=(r->>'employee_id')::uuid for update;
 select * into d from public.employee_details where employee_id=e.id for update;
 if e.id is null or e.updated_at is distinct from (r->>'expected_core_updated_at')::timestamptz or d.updated_at is distinct from (r->>'expected_profile_updated_at')::timestamptz then raise exception 'Employee changed since import review' using errcode='40001';end if;
 if exists(select 1 from hrms_private.employee_import_results where job_id=p_job and source_row=p_row) then raise exception 'Row already imported' using errcode='40001';end if;
 if exists(select 1 from public.employee_accounts where employee_id=e.id) then raise exception 'Employee already has an account; preserve its credentials' using errcode='22023';end if;
 if p_user is not null and not exists(select 1 from auth.users where id=p_user and lower(email)=lower(r->>'login_email') and raw_app_meta_data->>'employee_import_job'=p_job::text and created_at>=j.created_at) then raise exception 'New account does not match approved import identity' using errcode='42501';end if;
 insert into hrms_private.employee_import_results(job_id,source_row,employee_id,user_id,status,before_employee,before_profile) values(p_job,p_row,e.id,p_user,case when p_user is null then 'profile_imported_email_pending' else 'profile_and_account_imported' end,to_jsonb(e),d.profile);
 update public.employees set full_name=r->'core'->>'full_name',designation=r->'core'->>'designation',department=r->'core'->>'department',location=r->'core'->>'location',reports_to_text=r->'core'->>'reports_to_text',updated_at=clock_timestamp() where id=e.id;
 insert into public.employee_details(employee_id,profile,updated_at) values(e.id,coalesce(d.profile,'{}'::jsonb)||(r->'profile'),clock_timestamp()) on conflict(employee_id) do update set profile=excluded.profile,updated_at=excluded.updated_at;
 if p_user is not null then insert into public.employee_accounts(employee_id,user_id,username,login_email,is_active,must_change_password) values(e.id,p_user,lower(e.employee_no),r->>'login_email',true,true);end if;
 return jsonb_build_object('employee_no',e.employee_no,'account_created',p_user is not null);
end $f$;
create or replace function public.claim_employee_import(p_job uuid,p_token text) returns jsonb language sql security invoker set search_path='' as $f$ select hrms_private.claim_employee_import(p_job,p_token);$f$;
create function public.commit_employee_import(p_job uuid,p_row int,p_user uuid) returns jsonb language sql security invoker set search_path='' as $f$ select hrms_private.commit_employee_import(p_job,p_row,p_user);$f$;
revoke all on function hrms_private.claim_employee_import(uuid,text),hrms_private.commit_employee_import(uuid,int,uuid),public.claim_employee_import(uuid,text),public.commit_employee_import(uuid,int,uuid) from public,anon,authenticated;
grant usage on schema hrms_private to service_role;
grant execute on function hrms_private.claim_employee_import(uuid,text),hrms_private.commit_employee_import(uuid,int,uuid),public.claim_employee_import(uuid,text),public.commit_employee_import(uuid,int,uuid) to service_role;
commit;
