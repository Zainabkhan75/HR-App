create function hrms_private.employee_signin_activity()
returns table(employee_no text, full_name text, login_linked boolean, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
 if auth.uid() is null or not public.is_hr_admin() then
  raise exception 'HR administrator access required' using errcode = '42501';
 end if;
 return query
 select e.employee_no, e.full_name, a.user_id is not null, u.last_sign_in_at
 from public.employees e
 left join public.employee_accounts a on a.employee_id = e.id
 left join auth.users u on u.id = a.user_id
 order by u.last_sign_in_at desc nulls last, e.employee_no;
end;
$$;

revoke all on function hrms_private.employee_signin_activity() from public, anon, authenticated;
grant execute on function hrms_private.employee_signin_activity() to authenticated;

create function public.employee_signin_activity()
returns table(employee_no text, full_name text, login_linked boolean, last_sign_in_at timestamptz)
language sql stable security invoker set search_path = '' as $$
 select * from hrms_private.employee_signin_activity();
$$;

revoke all on function public.employee_signin_activity() from public, anon, authenticated;
grant execute on function public.employee_signin_activity() to authenticated;
