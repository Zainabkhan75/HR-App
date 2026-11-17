begin;

create or replace function hrms_private.msgbox_workspace(p_year int)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
begin
  if auth.uid() is null then
    raise exception 'Active employee sign-in required' using errcode='42501';
  end if;
  perform hrms_private.leave_actor();
  return jsonb_build_object(
    'is_hr',false,'msgbox_only',true,'pilot_applicant',false,'employee_id',null,
    'year',p_year,'policy',null,'manager',null,'balances','[]'::jsonb,
    'requests','[]'::jsonb,'approvals','[]'::jsonb,
    'unread_count',(
      select count(*) from public.work_inbox i
      where i.recipient_user_id=auth.uid() and i.read_at is null
    ),
    'inbox',coalesce((
      select jsonb_agg(to_jsonb(message) order by message.created_at desc)
      from (
        select i.*,r.year as request_year from public.work_inbox i
        left join public.leave_requests r on r.id=i.request_id
        where i.recipient_user_id=auth.uid() order by i.created_at desc limit 200
      ) message
    ),'[]'::jsonb)
  );
end;
$$;

commit;
