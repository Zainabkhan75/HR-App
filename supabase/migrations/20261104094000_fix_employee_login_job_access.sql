alter function public.prepare_employee_login(uuid,uuid,text) security definer;
alter function public.finish_employee_login(uuid,uuid) security definer;
alter function public.commit_employee_provision(uuid,uuid,uuid) security definer;
revoke all on function public.prepare_employee_login(uuid,uuid,text), public.finish_employee_login(uuid,uuid), public.commit_employee_provision(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.prepare_employee_login(uuid,uuid,text), public.finish_employee_login(uuid,uuid), public.commit_employee_provision(uuid,uuid,uuid) to service_role;
