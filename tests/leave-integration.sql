-- Run in the connected project as postgres. Synthetic identities and all writes
-- exist only inside this transaction and are always rolled back.
begin;

-- Exercise the existing private workflow behind the production access gate.
-- These wrapper changes roll back with the fixtures.
create or replace function public.leave_action(p_action text,p_payload jsonb)
returns jsonb language sql security invoker set search_path=''
as $$select hrms_private.leave_action(p_action,p_payload)$$;
create or replace function public.leave_workspace(p_year integer)
returns jsonb language sql stable security invoker set search_path=''
as $$select hrms_private.leave_workspace(p_year)$$;
do $test$
declare
 requester_user uuid:=gen_random_uuid();requester uuid;hr_user uuid;manager uuid;outsider uuid;
 manager_user uuid:=gen_random_uuid();outsider_user uuid:=gen_random_uuid();
 r jsonb;v jsonb;request_id uuid;other_id uuid;before_core text;before_details text; t text;
begin
 select user_id into hr_user from public.user_roles where role='hr_admin' limit 1;
 assert hr_user is not null;
 select md5(string_agg(to_jsonb(e)::text,'' order by id)) into before_core from public.employees e;
 select md5(string_agg(to_jsonb(e)::text,'' order by employee_id)) into before_details from public.employee_details e;
 perform set_config('request.jwt.claim.sub',hr_user::text,true);
 insert into public.employees(employee_no,full_name,employment_state,location)
 values('299991','Leave test employee','active','Head Office') returning id into requester;
 insert into public.employees(employee_no,full_name,employment_state,location)
 values('299992','Leave test manager','active','Head Office') returning id into manager;
 insert into public.employees(employee_no,full_name,employment_state,location)
 values('299993','Leave test unrelated employee','active','Head Office') returning id into outsider;
 insert into auth.users(id,email,aud,role) values(requester_user,requester_user||'@example.invalid','authenticated','authenticated'),(manager_user,manager_user||'@example.invalid','authenticated','authenticated'),(outsider_user,outsider_user||'@example.invalid','authenticated','authenticated');
 insert into public.employee_accounts(employee_id,user_id,username,login_email,is_active,must_change_password) values(requester,requester_user,'leavetest299991@example.invalid',requester_user||'@example.invalid',true,false),(manager,manager_user,'leavetest299992@example.invalid',manager_user||'@example.invalid',true,false),(outsider,outsider_user,'leavetest299993@example.invalid',outsider_user||'@example.invalid',true,false);
 insert into public.user_roles(user_id,role) values(manager_user,'manager');
 perform set_config('request.jwt.claim.sub',hr_user::text,true);
 perform public.leave_admin('policy','{"year":2026,"annual":10,"sick":10,"casual":10,"weekdays_only":true,"holidays":["2026-11-04"]}');
 foreach t in array array['annual','sick','casual'] loop perform public.leave_admin('opening',jsonb_build_object('employee_id',requester,'year',2026,'leave_type',t,'entitlement',10,'taken',0));end loop;
 perform public.leave_admin('manager',jsonb_build_object('employee_id',requester,'manager_employee_id',manager));
 begin perform public.leave_admin('manager',jsonb_build_object('employee_id',requester,'manager_employee_id',requester));raise exception 'self assignment accepted';exception when sqlstate '22023' then null;end;
 perform set_config('request.jwt.claim.sub',requester_user::text,true);
 begin perform public.leave_admin('policy','{"year":2027}');raise exception 'non HR setup accepted';exception when insufficient_privilege then null;end;
 r:=public.leave_action('submit','{"leave_type":"annual","start_date":"2026-11-02","end_date":"2026-11-06","reason":"Synthetic verification"}');request_id:=(r->>'id')::uuid;
 assert (r->>'days')::numeric=4;
 v:=public.leave_workspace(2026);assert (v->'balances'->0->>'pending')::numeric=4;assert jsonb_array_length(v->'requests')=1;
 begin perform public.leave_action('submit','{"leave_type":"sick","start_date":"2026-11-03","end_date":"2026-11-03","reason":"Synthetic"}');raise exception 'overlap accepted';exception when sqlstate '22023' then null;end;
 begin perform public.leave_action('submit','{"leave_type":"annual","start_date":"2026-11-09","end_date":"2026-11-20","reason":"Synthetic"}');raise exception 'overbooking accepted';exception when sqlstate '22023' then null;end;
 begin perform public.leave_action('submit','{"leave_type":"casual","start_date":"2026-11-07","end_date":"2026-11-08","reason":"Synthetic"}');raise exception 'weekend accepted';exception when sqlstate '22023' then null;end;
 begin perform public.leave_action('submit','{"leave_type":"annual","start_date":"2026-12-31","end_date":"2027-01-01","reason":"Synthetic"}');raise exception 'cross year accepted';exception when sqlstate '22023' then null;end;
 begin perform public.leave_action('decide',jsonb_build_object('id',request_id,'decision','approved'));raise exception 'self approval accepted';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub',outsider_user::text,true);
 v:=public.leave_workspace(2026);assert jsonb_array_length(v->'requests')=0;assert jsonb_array_length(v->'approvals')=0;assert jsonb_array_length(v->'inbox')=0;
 begin perform public.leave_action('decide',jsonb_build_object('id',request_id,'decision','approved'));raise exception 'unrelated approval accepted';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub',manager_user::text,true);
 v:=public.leave_workspace(2026);assert jsonb_array_length(v->'approvals')=1;assert jsonb_array_length(v->'inbox')=1;assert jsonb_array_length(v->'team')=1;
 perform public.leave_action('task',jsonb_build_object('recipient_user_id',requester_user,'title','Synthetic manager task','body','Synthetic only'));
 begin perform public.leave_action('task',jsonb_build_object('recipient_user_id',outsider_user,'title','Synthetic wrong recipient','body','Test'));raise exception 'unrelated task accepted';exception when insufficient_privilege then null;end;
 perform public.leave_action('decide',jsonb_build_object('id',request_id,'decision','approved','note','Synthetic approval'));
 begin perform public.leave_action('decide',jsonb_build_object('id',request_id,'decision','rejected','note','Synthetic'));raise exception 'duplicate decision accepted';exception when sqlstate '40001' then null;end;
 perform set_config('request.jwt.claim.sub',requester_user::text,true);
 v:=public.leave_workspace(2026);assert (v->'balances'->0->>'approved')::numeric=4;assert (v->'balances'->0->>'pending')::numeric=0;assert jsonb_array_length(v->'inbox')=2;
 r:=public.leave_action('submit','{"leave_type":"casual","start_date":"2026-11-09","end_date":"2026-11-09","reason":"Synthetic reject"}');other_id:=(r->>'id')::uuid;
 perform set_config('request.jwt.claim.sub',manager_user::text,true);
 begin perform public.leave_action('decide',jsonb_build_object('id',other_id,'decision','rejected'));raise exception 'empty rejection accepted';exception when sqlstate '22023' then null;end;
 perform public.leave_action('decide',jsonb_build_object('id',other_id,'decision','rejected','note','Synthetic reason'));
 perform set_config('request.jwt.claim.sub',requester_user::text,true);
 r:=public.leave_action('submit','{"leave_type":"casual","start_date":"2026-11-09","end_date":"2026-11-09","reason":"Synthetic withdraw"}');other_id:=(r->>'id')::uuid;
 perform public.leave_action('cancel',jsonb_build_object('id',other_id));
 assert exists(select 1 from public.leave_requests where id=other_id and status='cancelled');
 assert exists(select 1 from public.workflow_email_outbox q join public.work_inbox i on i.id=q.inbox_id where i.request_id=other_id and i.kind='leave_request' and q.status='cancelled');
 perform set_config('request.jwt.claim.sub',hr_user::text,true);
 begin perform public.leave_admin('policy','{"year":2026,"annual":10,"sick":10,"casual":10,"weekdays_only":false,"holidays":[]}');raise exception 'historic counting rules changed';exception when sqlstate '22023' then null;end;
 begin perform public.leave_admin('opening',jsonb_build_object('employee_id',requester,'year',2026,'leave_type','annual','entitlement',3,'taken',0));raise exception 'entitlement below reserved accepted';exception when sqlstate '22023' then null;end;
 perform public.leave_admin('task',jsonb_build_object('recipient_user_id',requester_user,'title','Synthetic task','body','Test only'));
 perform set_config('request.jwt.claim.sub',requester_user::text,true);
 select id into other_id from public.work_inbox where recipient_user_id=requester_user and kind='task' order by created_at desc limit 1;
 perform public.leave_action('complete',jsonb_build_object('id',other_id));assert exists(select 1 from public.work_inbox where id=other_id and completed_at is not null);
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 begin perform public.leave_workspace(2026);raise exception 'unlinked access accepted';exception when insufficient_privilege then null;end;
 assert not has_function_privilege('anon','public.leave_workspace(integer)','execute');assert not has_function_privilege('anon','public.leave_action(text,jsonb)','execute');assert not has_table_privilege('authenticated','public.leave_requests','select');
 assert before_core=(select md5(string_agg(to_jsonb(e)::text,'' order by id)) from public.employees e where id not in (requester,manager,outsider));
 assert before_details=(select md5(string_agg(to_jsonb(e)::text,'' order by employee_id)) from public.employee_details e where employee_id not in (requester,manager,outsider));
 if to_regclass('hrms_private.leave_pilot_routes') is not null then
 perform set_config('request.jwt.claim.sub',requester_user::text,true);
 insert into hrms_private.leave_pilot_routes values(requester,manager_user,outsider_user);
 r:=public.leave_action('submit','{"leave_type":"casual","start_date":"2026-12-31","end_date":"2027-01-01","reason":"Staged test"}');
 other_id:=(r->>'id')::uuid;
 perform set_config('request.jwt.claim.sub',manager_user::text,true);
 perform public.leave_action('decide',jsonb_build_object('id',other_id,'decision','approved'));
 assert (select status from public.leave_requests where id=other_id)='pending';
 perform set_config('request.jwt.claim.sub',outsider_user::text,true);
 assert exists(select 1 from jsonb_array_elements(public.leave_workspace(2026)->'approvals') a where a->>'id'=other_id::text and a->>'can_decide'='true');
 perform public.leave_action('decide',jsonb_build_object('id',other_id,'decision','approved'));
 assert (select status from public.leave_requests where id=other_id)='approved';
 assert (select year=2026 and days=2 from public.leave_requests where id=other_id);
 assert (select count(*) from hrms_private.leave_stage_decisions s where s.request_id=other_id)=2;
 end if;
 if to_regclass('hrms_private.leave_pilot_routes') is not null then
 perform set_config('request.jwt.claim.sub',requester_user::text,true);
 r:=public.leave_action('submit','{"leave_type":"casual","start_date":"2027-02-01","end_date":"2027-02-01","hours":2,"reason":"Partial test"}');
 assert (r->>'days')::numeric=0.25;
 update hrms_private.leave_pilot_routes set ceo_user_id=manager_user where employee_id=requester;
 r:=public.leave_action('submit','{"leave_type":"unpaid","start_date":"2027-03-01","end_date":"2027-03-14","reason":"Unpaid test"}');
 other_id=(r->>'id')::uuid;
 assert (r->>'days')::numeric=14;
 perform set_config('request.jwt.claim.sub',manager_user::text,true);
 perform public.leave_action('decide',jsonb_build_object('id',other_id,'decision','approved'));
 perform set_config('request.jwt.claim.sub',outsider_user::text,true);
 perform public.leave_action('decide',jsonb_build_object('id',other_id,'decision','approved'));
 perform set_config('request.jwt.claim.sub',requester_user::text,true);
 r:=public.leave_action('submit','{"leave_type":"unpaid","start_date":"2027-03-20","end_date":"2027-03-21","reason":"CEO escalation test"}');
 other_id=(r->>'id')::uuid;
 assert (r->>'days')::numeric=2;
 assert (select cardinality(approvers)=3 from hrms_private.leave_request_route q where q.request_id=other_id);
 perform set_config('request.jwt.claim.sub',manager_user::text,true);
 perform public.leave_action('decide',jsonb_build_object('id',other_id,'decision','approved'));
 perform set_config('request.jwt.claim.sub',outsider_user::text,true);
 perform public.leave_action('decide',jsonb_build_object('id',other_id,'decision','approved'));
 assert (select status from public.leave_requests where id=other_id)='pending';
 perform set_config('request.jwt.claim.sub',manager_user::text,true);
 perform public.leave_action('decide',jsonb_build_object('id',other_id,'decision','approved'));
 assert (select status from public.leave_requests where id=other_id)='approved';
 end if;
end $test$;
rollback;
select 'Leave lifecycle, permissions, balance reservations, holidays, tasks and record preservation verified; every test write rolled back' as verification;
