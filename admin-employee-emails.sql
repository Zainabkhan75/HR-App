create table if not exists hrms_private.admin_email_campaigns(
 id uuid primary key default gen_random_uuid(),actor_id uuid not null references auth.users(id),subject text not null,body text not null,recipients jsonb not null,reply_to text not null,
 status text not null default 'draft' check(status in ('draft','sending','accepted','failed','uncertain')),created_at timestamptz not null default now(),
 first_attempt_at timestamptz,updated_at timestamptz not null default now(),provider_result jsonb,error_message text
);
alter table hrms_private.admin_email_campaigns enable row level security;
revoke all on hrms_private.admin_email_campaigns from public,anon,authenticated;
grant select,insert,update on hrms_private.admin_email_campaigns to service_role;
create or replace function public.prepare_admin_email(p_actor uuid,p_subject text,p_body text,p_recipients jsonb,p_reply_to text) returns jsonb language plpgsql security invoker set search_path='' as $f$
declare c hrms_private.admin_email_campaigns%rowtype;
begin
 if not exists(select 1 from public.user_roles where user_id=p_actor and role='hr_admin') then raise exception 'HR administrator required';end if;
 if nullif(btrim(p_subject),'') is null or length(p_subject)>200 or nullif(btrim(p_body),'') is null or length(p_body)>20000 or jsonb_typeof(p_recipients)<>'array' or jsonb_array_length(p_recipients)<1 or jsonb_array_length(p_recipients)>100 then raise exception 'Invalid email campaign';end if;
 insert into hrms_private.admin_email_campaigns(actor_id,subject,body,recipients,reply_to) values(p_actor,p_subject,p_body,p_recipients,p_reply_to) returning * into c;
 return to_jsonb(c);
end $f$;
create or replace function public.claim_admin_email(p_actor uuid,p_campaign uuid) returns jsonb language plpgsql security invoker set search_path='' as $f$
declare c hrms_private.admin_email_campaigns%rowtype;
begin
 if not exists(select 1 from public.user_roles where user_id=p_actor and role='hr_admin') then raise exception 'HR administrator required';end if;
 select * into c from hrms_private.admin_email_campaigns where id=p_campaign and actor_id=p_actor for update;
 if c.id is null then raise exception 'Email preview not found';end if;
 if c.status='accepted' then return to_jsonb(c);end if;
 if c.status='sending' and c.updated_at>now()-interval '2 minutes' then raise exception 'This email is already being sent';end if;
 if c.first_attempt_at<now()-interval '23 hours' then raise exception 'Retry window expired. Check Resend before preparing another send.';end if;
 update hrms_private.admin_email_campaigns set status='sending',first_attempt_at=coalesce(first_attempt_at,now()),updated_at=now(),error_message=null where id=c.id returning * into c;
 return to_jsonb(c);
end $f$;
create or replace function public.finish_admin_email(p_actor uuid,p_campaign uuid,p_status text,p_result jsonb,p_error text default null) returns jsonb language plpgsql security invoker set search_path='' as $f$
declare c hrms_private.admin_email_campaigns%rowtype;
begin
 if not exists(select 1 from public.user_roles where user_id=p_actor and role='hr_admin') or p_status not in ('accepted','failed','uncertain') then raise exception 'Not authorised';end if;
 update hrms_private.admin_email_campaigns set status=p_status,provider_result=p_result,error_message=left(p_error,500),updated_at=now()
 where id=p_campaign and actor_id=p_actor and status='sending' returning * into c;
 if c.id is null then raise exception 'Email status changed. Refresh before retrying.';end if;return to_jsonb(c);
end $f$;
create or replace function public.admin_email_history(p_actor uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $f$
begin
 if not exists(select 1 from public.user_roles where user_id=p_actor and role='hr_admin') then raise exception 'HR administrator required';end if;
 return (select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from(select id,subject,status,created_at,updated_at,error_message,jsonb_array_length(recipients) recipient_count from hrms_private.admin_email_campaigns where actor_id=p_actor order by created_at desc limit 20)t);
end $f$;
revoke all on function public.prepare_admin_email(uuid,text,text,jsonb,text),public.claim_admin_email(uuid,uuid),public.finish_admin_email(uuid,uuid,text,jsonb,text),public.admin_email_history(uuid) from public,anon,authenticated;
grant execute on function public.prepare_admin_email(uuid,text,text,jsonb,text),public.claim_admin_email(uuid,uuid),public.finish_admin_email(uuid,uuid,text,jsonb,text),public.admin_email_history(uuid) to service_role;
create or replace function public.read_admin_email(p_actor uuid,p_campaign uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $f$
begin
 if not exists(select 1 from public.user_roles where user_id=p_actor and role='hr_admin') then raise exception 'HR administrator required';end if;
 return(select to_jsonb(c) from hrms_private.admin_email_campaigns c where id=p_campaign and actor_id=p_actor);
end $f$;
revoke all on function public.read_admin_email(uuid,uuid) from public,anon,authenticated;
grant execute on function public.read_admin_email(uuid,uuid) to service_role;
notify pgrst,'reload schema';