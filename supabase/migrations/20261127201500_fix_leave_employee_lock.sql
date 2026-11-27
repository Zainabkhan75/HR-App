do $migration$
declare definition text;
begin
  definition := pg_get_functiondef('hrms_private.leave_action(text,jsonb)'::regprocedure);
  if to_regclass('public.employee_records') is null or strpos(definition,'perform 1 from public.employees where id=v_id for update;') = 0 then
    raise exception 'Unexpected employee lock definition';
  end if;
  definition := replace(definition,'perform 1 from public.employees where id=v_id for update;', 'perform 1 from public.employee_records where id=v_id for update;');
  definition := replace(definition,'perform 1 from public.employees where id=v_manager for update;', 'perform 1 from public.employee_records where id=v_manager for update;');
  execute definition;
  perform 1 from public.employee_records limit 1 for update;
end $migration$;