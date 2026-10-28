-- Record credential regeneration without storing the generated password.
alter table public.employee_action_audit
 drop constraint employee_action_audit_action_check;

alter table public.employee_action_audit
 add constraint employee_action_audit_action_check
 check (action = any (array['deactivate','reactivate','delete','admin_password_generated']));
