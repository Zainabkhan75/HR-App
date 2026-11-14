do $migration$
declare
 definition text := pg_get_functiondef('hrms_private.update_my_employee_profile(jsonb,timestamptz,timestamptz)'::regprocedure);
 benefit_keys text := $keys$,'life_insurance','car_entitlement'$keys$;
begin
 if strpos(definition, benefit_keys) = 0 then
  raise exception 'Expected employee profile benefit allowlist was not found';
 end if;
 execute replace(definition, benefit_keys, '');
end
$migration$;
