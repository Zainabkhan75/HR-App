create function public.my_direct_team_positions() returns table(position_id bigint, position_title text, employee_no text, full_name text)
language sql stable security definer set search_path = '' as $$
 select child.id, child.position_title, member.employee_no::text, member.full_name::text
 from public.employee_accounts account
 join public.employee_records holder on holder.id=account.employee_id
 join public.position_records child on child.reports_to_position_id=holder.position_id and child.id<>holder.position_id
 left join public.employee_records member on member.position_id=child.id and member.employment_state='active'
 where account.user_id=auth.uid() and account.is_active and not account.must_change_password and holder.employment_state='active'
 order by child.position_title,child.id,member.employee_no
$$;
revoke all on function public.my_direct_team_positions() from public,anon;
grant execute on function public.my_direct_team_positions() to authenticated;