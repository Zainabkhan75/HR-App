begin;

create table hrms_private.leave_application_forms(
 request_id uuid primary key references public.leave_requests(id),
 form_revision text not null default 'BND-HR-LVF-001 Rev 0',
 signed_at timestamptz not null default now(),
 details jsonb not null
);
revoke all on hrms_private.leave_application_forms from public,anon,authenticated;

create function hrms_private.submit_leave_application(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare
 v_form jsonb:=p_payload->'application';
 v_result jsonb;
begin
 if not hrms_private.leave_pilot_access(true) then
  raise exception 'Leave applications are restricted to pilot applicants' using errcode='42501';
 end if;
 if v_form->'declaration' is distinct from 'true'::jsonb
    or coalesce(length(btrim(v_form->>'signature')),0) not between 1 and 150
    or coalesce(v_form->>'on_probation','') not in ('yes','no','unsure')
    or coalesce(length(btrim(v_form->>'contact')),0) not between 1 and 80
    or coalesce(length(v_form->>'handover'),0)>150
    or coalesce(length(v_form->>'short_leave_time'),0)>80
    or coalesce(length(v_form->>'other_document'),0)>200
    or (p_payload->>'hours' is not null and nullif(btrim(v_form->>'short_leave_time'),'') is null)
    or (p_payload->>'leave_type'='maternity' and nullif(v_form->>'childbirth','') is null) then
  raise exception 'Complete the employee details, leave details and signed declaration' using errcode='22023';
 end if;
 v_result:=hrms_private.leave_action('submit',p_payload);
 insert into hrms_private.leave_application_forms(request_id,details)
 values((v_result->>'id')::uuid,jsonb_build_object(
  'declaration',true,'signature',btrim(v_form->>'signature'),'on_probation',v_form->>'on_probation',
  'contact',btrim(v_form->>'contact'),'handover',btrim(v_form->>'handover'),
  'short_leave_time',case when p_payload->>'hours' is not null then btrim(v_form->>'short_leave_time') end,
  'childbirth',case when p_payload->>'leave_type'='maternity' then (v_form->>'childbirth')::date end,
  'medical_certificate',v_form->'medical_certificate'='true'::jsonb,
  'other_document',btrim(v_form->>'other_document')
 ));
 return v_result;
end $f$;
revoke all on function hrms_private.submit_leave_application(jsonb) from public,anon;
grant execute on function hrms_private.submit_leave_application(jsonb) to authenticated;

create or replace function public.leave_action(p_action text,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $f$
begin
 if p_action='submit' then
  return hrms_private.submit_leave_application(p_payload);
 end if;
 if p_action='cancel' and not hrms_private.leave_pilot_access(true) then
  raise exception 'Leave applications are restricted to pilot applicants' using errcode='42501';
 end if;
 if not public.is_hr_admin() and not hrms_private.leave_pilot_access(false) then
  raise exception 'Leave and Inbox are coming in Phase 2' using errcode='42501';
 end if;
 return hrms_private.leave_action(p_action,p_payload);
end $f$;

commit;
