begin;

alter table public.employee_action_audit drop constraint employee_action_audit_action_check;
alter table public.employee_action_audit add constraint employee_action_audit_action_check
check(action in ('deactivate','reactivate','delete','admin_password_generated','admin_login_email_changed',
 'bulk_credential_create','bulk_credential_reset','bulk_administration_updated'));

create table public.bulk_upload_results(
 actor_id uuid references auth.users(id),file_hash text, result jsonb not null,
 created_at timestamptz not null default now(),primary key(actor_id,file_hash));
create table public.bulk_credential_jobs(
 id uuid primary key default gen_random_uuid(), actor_id uuid not null references auth.users(id),
 file_hash text not null,employee_id uuid not null references public.employee_records(id),
 action text not null check(action in ('CREATE','RESET')),confirmed_email text,
 status text not null default 'pending' check(status in ('pending','sending','complete','failed','uncertain')),
 result jsonb,error text,created_at timestamptz not null default now(),claimed_at timestamptz,
 unique(actor_id,file_hash,employee_id));
alter table public.bulk_upload_results enable row level security;
alter table public.bulk_credential_jobs enable row level security;
revoke all on public.bulk_upload_results,public.bulk_credential_jobs from public,anon,authenticated;
grant all on public.bulk_upload_results,public.bulk_credential_jobs to service_role;

create function public.claim_bulk_credential_job(p_id uuid,p_actor uuid)
returns timestamptz language sql set search_path=''
as $$
 with claimed as (
  update public.bulk_credential_jobs set status='sending',claimed_at=now()
  where id=p_id and actor_id=p_actor and exists(select 1 from public.user_roles where user_id=p_actor and role='hr_admin')
   and (status in ('pending','failed') or (status='sending' and action='CREATE' and claimed_at<now()-interval '5 minutes'))
  returning claimed_at
 ) select claimed_at from claimed;
$$;
create function public.finish_bulk_credential_job(p_id uuid,p_actor uuid,p_claim timestamptz,p_result jsonb,p_error text)
returns void language plpgsql set search_path=''
as $$
declare job public.bulk_credential_jobs%rowtype;
begin
 update public.bulk_credential_jobs
 set status=case when p_error is null then 'complete' when p_error like 'UNCERTAIN:%' then 'uncertain' else 'failed' end,result=p_result,error=p_error
 where id=p_id and actor_id=p_actor and status='sending' and claimed_at=p_claim
 and exists(select 1 from public.user_roles where user_id=p_actor and role='hr_admin') returning * into job;
 if not found then raise exception 'Credential job changed'; end if;
 insert into public.employee_action_audit(employee_id,employee_no,action,actor_id,reason,record_snapshot)
 select job.employee_id,e.employee_no,'bulk_credential_'||lower(job.action),p_actor,
  case when p_error is null then 'Bulk upload credential action completed' else 'Bulk upload credential action failed' end,
  jsonb_build_object('file_hash',job.file_hash,'error',p_error)
 from public.employees e where e.id=job.employee_id;
end;
$$;

create function public.apply_complete_employee_bulk_upload(p_rows jsonb,p_actor uuid,p_file_hash text)
returns jsonb language plpgsql set search_path=''
as $$
declare item jsonb; controls jsonb; result jsonb; employee public.employee_records%rowtype;
 account public.employee_accounts%rowtype; expected jsonb; code text; old_sub text; family_stamp timestamptz;
begin
 if p_actor is null or not exists(select 1 from public.user_roles where user_id=p_actor and role='hr_admin') then
  raise exception 'HR administrator required';
 end if;
 if p_file_hash is null or p_file_hash !~ '^[0-9a-f]{64}$' or jsonb_typeof(p_rows) is distinct from 'array'
  or jsonb_array_length(p_rows) not between 1 and 1000 then raise exception 'Invalid upload'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_actor::text||p_file_hash,0));
 select r.result into result from public.bulk_upload_results r where actor_id=p_actor and file_hash=p_file_hash;
 if found then return result; end if;
 lock table public.employee_records in share row exclusive mode;
 for item in select value from jsonb_array_elements(p_rows) loop
  controls:=coalesce(item->'control','{}'::jsonb);
  if jsonb_typeof(controls)<>'object' or exists(select 1 from jsonb_object_keys(controls) k
   where k not in ('employment_state','leaving_date','status_reason','marital_status','login_email','email_verified','account_active','must_change_password','credential_action')) then raise exception 'Invalid administration fields'; end if;
  if controls ? 'employment_state' and controls->>'employment_state' not in ('active','inactive') then raise exception 'Invalid employment status'; end if;
  if controls ? 'marital_status' and controls->>'marital_status' not in ('Single','Married') then raise exception 'Invalid marital status'; end if;
  if controls ? 'credential_action' and controls->>'credential_action' not in ('CREATE','RESET') then raise exception 'Invalid credential action'; end if;
  if controls->>'credential_action'='RESET' and controls->>'must_change_password'='NO' then
   raise exception 'RESET requires a password change at next sign-in';
  end if;
  if controls ? 'account_active' and controls->>'account_active' not in ('YES','NO') then raise exception 'Invalid account status'; end if;
  if controls ? 'must_change_password' and controls->>'must_change_password' not in ('YES','NO') then raise exception 'Invalid password setup flag'; end if;
  if item->>'action'='NEW' then
   if controls ?| array['account_active','must_change_password'] then raise exception 'For NEW employees use credential action CREATE'; end if;
   continue;
  end if;
  select * into strict employee from public.employee_records where employee_no=item->>'employee_no' for update;
  if controls ? 'marital_status' then
   select updated_at into family_stamp from public.employee_family_details where employee_id=employee.id for update;
   if family_stamp is distinct from (item->>'expected_family_updated_at')::timestamptz then
    raise exception 'Family details changed. Preview again.';
   end if;
  end if;
  select * into account from public.employee_accounts where employee_id=employee.id for update;
  expected:=case when account.employee_id is null then 'null'::jsonb else
   jsonb_build_object('employee_id',account.employee_id,'user_id',account.user_id,'username',account.username,
    'login_email',account.login_email,'is_active',account.is_active,'must_change_password',account.must_change_password) end;
  if expected is distinct from item->'expected_account' then raise exception 'Employee account changed. Preview again.'; end if;
  if exists(select 1 from public.user_roles where user_id=account.user_id and role='hr_admin')
    and controls ?| array['employment_state','account_active','must_change_password','credential_action'] then
   raise exception 'Administrator account status and passwords use the administrator workflow';
  end if;
 end loop;
 result:=public.apply_september_employee_bulk_upload_v2(p_rows,p_actor,p_file_hash);
 old_sub:=current_setting('request.jwt.claim.sub',true);
 perform set_config('request.jwt.claim.sub',p_actor::text,true);
 for item in select value from jsonb_array_elements(p_rows) loop
  controls:=coalesce(item->'control','{}'::jsonb);
  code:=item->>'employee_no';
  if item->>'action'='NEW' then
   select created->>'employee_no' into code from jsonb_array_elements(result->'created') created
   where created->>'reference'=item->>'reference';
  end if;
  select * into strict employee from public.employee_records where employee_no=code for update;
  if controls ? 'leaving_date' and (controls->>'employment_state') is distinct from 'inactive' then
   update public.employees set leaving_date=(controls->>'leaving_date')::date where id=employee.id;
  end if;
  if controls ? 'employment_state' and controls->>'employment_state'<>employee.employment_state then
   perform public.set_employee_state_with_date(employee.id,controls->>'employment_state',controls->>'status_reason',(controls->>'leaving_date')::date);
  end if;
  if controls ? 'marital_status' then
   insert into public.employee_family_details(employee_id,spouse,children,marital_status)
   values(employee.id,null,'[]'::jsonb,controls->>'marital_status')
   on conflict(employee_id) do update set marital_status=excluded.marital_status,updated_at=clock_timestamp();
  end if;
  if jsonb_array_length(coalesce(item->'family','[]'::jsonb))>0 then
   if exists(select 1 from public.employee_family_details where employee_id=employee.id and marital_status='Single') then
    raise exception 'Select Married before adding family members';
   end if;
   update public.employee_family_details set marital_status='Married' where employee_id=employee.id and marital_status is null;
  end if;
  select * into account from public.employee_accounts where employee_id=employee.id for update;
  if controls ? 'login_email' and account.employee_id is null and item->>'action'<>'NEW'
   and controls->>'credential_action' is distinct from 'CREATE' then
   raise exception 'Choose CREATE for an employee without an account';
  end if;
  if controls ? 'login_email' and account.employee_id is not null then
   if controls->>'email_verified' is distinct from 'YES' then raise exception 'Confirm email ownership'; end if;
   perform public.confirm_employee_login_email(employee.id,p_actor,controls->>'login_email');
  end if;
  if controls ?| array['account_active','must_change_password'] then
   if account.employee_id is null then raise exception 'Employee has no linked account'; end if;
   update public.employee_accounts set
    is_active=case when controls ? 'account_active' then controls->>'account_active'='YES' else is_active end,
    must_change_password=case when controls ? 'must_change_password' then controls->>'must_change_password'='YES' else must_change_password end
   where employee_id=employee.id;
  end if;
  if controls ? 'credential_action' or (item->>'action'='NEW' and account.employee_id is null and coalesce(controls->>'employment_state','active')='active') then
   if (select employment_state from public.employee_records where id=employee.id)<>'active' then
    raise exception 'Credential actions require an active employee';
   end if;
   if controls->>'credential_action'='CREATE' and account.employee_id is not null then raise exception 'Employee already has an account'; end if;
   if controls->>'credential_action'='RESET' and not coalesce(account.is_active,false) then raise exception 'Password reset requires an active account'; end if;
   if controls ? 'login_email' and controls->>'email_verified' is distinct from 'YES' then raise exception 'Confirm email ownership'; end if;
   insert into public.bulk_credential_jobs(actor_id,file_hash,employee_id,action,confirmed_email)
   values(p_actor,p_file_hash,employee.id,coalesce(controls->>'credential_action','CREATE'),controls->>'login_email');
  end if;
  if controls<>'{}'::jsonb then
   insert into public.employee_action_audit(employee_id,employee_no,action,actor_id,reason,record_snapshot)
   values(employee.id,code,'bulk_administration_updated',p_actor,coalesce(controls->>'status_reason','HR bulk upload'),controls);
  end if;
 end loop;
 perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);
 result:=result||jsonb_build_object('applied',jsonb_array_length(p_rows),'newEmployees',jsonb_array_length(result->'created'),
  'fields',coalesce((result->>'fields')::int,0)+(select count(*) from jsonb_array_elements(p_rows) upload_row
   cross join lateral jsonb_object_keys(coalesce(upload_row->'control','{}'::jsonb)-'email_verified') field));
 insert into public.bulk_upload_results(actor_id,file_hash,result) values(p_actor,p_file_hash,result);
 return result;
end;
$$;
revoke all on function public.apply_complete_employee_bulk_upload(jsonb,uuid,text),
 public.claim_bulk_credential_job(uuid,uuid),public.finish_bulk_credential_job(uuid,uuid,timestamptz,jsonb,text) from public,anon,authenticated;
grant execute on function public.apply_complete_employee_bulk_upload(jsonb,uuid,text),
 public.claim_bulk_credential_job(uuid,uuid),public.finish_bulk_credential_job(uuid,uuid,timestamptz,jsonb,text) to service_role;
commit;
