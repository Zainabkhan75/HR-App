-- Preserve the current profile-update implementation and its access checks,
-- removing the monetary benefit from the employee-editable field allowlist.
do $migration$
declare
 definition text;
 restricted_definition text;
begin
 select pg_get_functiondef(
  'hrms_private.update_my_employee_profile(jsonb,timestamptz,timestamptz)'::regprocedure
 ) into definition;
 restricted_definition := replace(
  definition,
  ',''medical_hospitalisation_limit_person_year_pkr''',
  ''
 );
 if definition = restricted_definition then
  raise exception 'Expected medical-cover field was absent. Review the current employee update function.';
 end if;
 execute restricted_definition;
end;
$migration$;
