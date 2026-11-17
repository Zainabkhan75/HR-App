begin;

alter table public.workflow_email_outbox add column automatic boolean not null default false;
create index workflow_email_outbox_automatic_queue on public.workflow_email_outbox(created_at,id)
  where automatic and status in ('pending','failed','sending');

-- Match Email Employees: work first, personal second, and reject shared addresses.
create function hrms_private.msgbox_alert_address(p_user uuid)
returns text language sql stable set search_path=''
as $$
  select candidate.address
  from public.employee_accounts a
  join public.employees e on e.id=a.employee_id and e.employment_state='active'
  join public.employee_details d on d.employee_id=e.id
  cross join lateral (values
    (1,lower(btrim(d.profile->>'email'))),
    (2,lower(btrim(d.profile->>'personal_email')))
  ) candidate(priority,address)
  where a.user_id=p_user and a.is_active
    and length(candidate.address)<=254
    and candidate.address ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    and not exists (
      select 1 from public.employee_details other
      join public.employees owner on owner.id=other.employee_id
      where other.employee_id<>e.id and candidate.address in
        (lower(btrim(other.profile->>'email')),lower(btrim(other.profile->>'personal_email')))
    )
  order by candidate.priority limit 1;
$$;

create function hrms_private.queue_msgbox_alert()
returns trigger language plpgsql security definer set search_path=''
as $$
declare
  address text := hrms_private.msgbox_alert_address(new.recipient_user_id);
begin
  if address is null then return new; end if;
  insert into public.workflow_email_outbox(inbox_id,recipient_email,subject,link_path,status,automatic)
  values(new.id,address,'You have a new message','/portal?section=msgbox&message=' || new.id,'pending',true);
  return new;
end;
$$;

create or replace function hrms_private.leave_notify(p_user uuid,p_kind text,p_title text,p_body text,p_request uuid)
returns void language plpgsql security definer set search_path=''
as $$
begin
  insert into public.work_inbox(recipient_user_id,sender_user_id,kind,title,body,request_id)
  values(p_user,auth.uid(),p_kind,p_title,p_body,p_request);
end;
$$;

create trigger queue_msgbox_alert after insert on public.work_inbox
for each row execute function hrms_private.queue_msgbox_alert();

create function hrms_private.claim_msgbox_alerts()
returns table(id uuid,recipient_email text,link_path text,attempts int,title text,body text)
language sql security definer set search_path=''
as $$
  with candidates as (
    select q.id,
      hrms_private.msgbox_alert_address(i.recipient_user_id)=q.recipient_email
      and (i.kind<>'leave_request' or (r.status='pending' and i.completed_at is null
        and (route.request_id is null or route.approvers[route.stage]=i.recipient_user_id))) as deliver
    from public.workflow_email_outbox q
    join public.work_inbox i on i.id=q.inbox_id
    left join public.leave_requests r on r.id=i.request_id
    left join hrms_private.leave_request_route route on route.request_id=r.id
    where q.automatic and (
      q.status='pending' or (q.status in ('failed','sending')
        and q.last_attempt_at<now()-interval '2 minutes'
        and q.first_attempt_at>now()-interval '23 hours'
        and q.attempts<6)
    )
    order by q.created_at,q.id limit 5 for update of q skip locked
  ), claimed as (
    update public.workflow_email_outbox q
    set status=case when c.deliver is true then 'sending' else 'cancelled' end,
        attempts=q.attempts+case when c.deliver is true then 1 else 0 end,
        first_attempt_at=case when c.deliver is true then coalesce(q.first_attempt_at,now()) else q.first_attempt_at end,
        last_attempt_at=case when c.deliver is true then now() else q.last_attempt_at end
    from candidates c where q.id=c.id
    returning q.id,q.inbox_id,q.recipient_email,q.link_path,q.attempts,q.status
  )
  select c.id,c.recipient_email,c.link_path,c.attempts,i.title,i.body
  from claimed c join public.work_inbox i on i.id=c.inbox_id where c.status='sending';
$$;

create function public.claim_msgbox_alerts()
returns table(id uuid,recipient_email text,link_path text,attempts int,title text,body text)
language sql security invoker set search_path=''
as $$ select * from hrms_private.claim_msgbox_alerts(); $$;

revoke all on function hrms_private.msgbox_alert_address(uuid), hrms_private.queue_msgbox_alert(),
  hrms_private.claim_msgbox_alerts(), public.claim_msgbox_alerts() from public,anon,authenticated;
grant execute on function hrms_private.claim_msgbox_alerts(), public.claim_msgbox_alerts() to service_role;

create function hrms_private.msgbox_workspace(p_year int)
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

create function public.msgbox_workspace(p_year int)
returns jsonb language sql stable security invoker set search_path=''
as $$ select hrms_private.msgbox_workspace(p_year); $$;

revoke all on function hrms_private.msgbox_workspace(int), public.msgbox_workspace(int) from public,anon,authenticated;
grant execute on function hrms_private.msgbox_workspace(int), public.msgbox_workspace(int) to authenticated;

create or replace function public.leave_action(p_action text,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path=''
as $$
begin
  if p_action='submit' then
    return hrms_private.submit_leave_application(p_payload);
  end if;
  if p_action in ('read','complete') then
    return hrms_private.leave_action(p_action,p_payload);
  end if;
  if p_action='cancel' and not hrms_private.leave_pilot_access(true) then
    raise exception 'Leave applications are restricted to pilot applicants' using errcode='42501';
  end if;
  if not public.is_hr_admin() and not hrms_private.leave_pilot_access(false) then
    raise exception 'Leave access is restricted to pilot participants' using errcode='42501';
  end if;
  return hrms_private.leave_action(p_action,p_payload);
end;
$$;

commit;
