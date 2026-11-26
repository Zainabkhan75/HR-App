create function public.my_team_hierarchy_details() returns table(position_id bigint,parent_id bigint,depth integer,position_code text,designation_id bigint,designation_title text,position_title text,employee_no text,full_name text)
language sql stable security definer set search_path='' as $$
 with recursive branch(id,parent_id,depth,path) as (
 select p.id,p.reports_to_position_id,1,array[e.position_id,p.id]
 from public.employee_accounts a join public.employee_records e on e.id=a.employee_id
 join public.position_records p on p.reports_to_position_id=e.position_id and p.id<>e.position_id
 where a.user_id=auth.uid() and a.is_active and not a.must_change_password and e.employment_state='active'
 union all
 select p.id,b.id,b.depth+1,b.path||p.id
 from branch b join public.position_records p on p.reports_to_position_id=b.id
 where not p.id=any(b.path)
 )
 select b.id,b.parent_id,b.depth,p.position_code,p.designation_id,d.title,p.position_title,m.employee_no::text,m.full_name::text
 from branch b join public.position_records p on p.id=b.id
 left join public.designations d on d.id=p.designation_id
 left join public.employee_records m on m.position_id=b.id and m.employment_state='active'
 order by p.position_title,b.id,m.full_name,m.employee_no
$$;
revoke all on function public.my_team_hierarchy_details() from public,anon;
grant execute on function public.my_team_hierarchy_details() to authenticated;