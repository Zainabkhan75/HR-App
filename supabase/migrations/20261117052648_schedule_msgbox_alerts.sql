begin;

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Set msgbox_alert_url and msgbox_alert_secret in Vault to enable delivery.
-- The URL is the deployed /api/internal/msgbox-alerts endpoint.
select cron.schedule('deliver-msgbox-alerts', '* * * * *', $job$
  select net.http_post(
    url:=endpoint.decrypted_secret,
    headers:=jsonb_build_object('Authorization','Bearer ' || secret.decrypted_secret),
    timeout_milliseconds:=25000
  )
  from vault.decrypted_secrets endpoint
  cross join vault.decrypted_secrets secret
  where endpoint.name='msgbox_alert_url' and secret.name='msgbox_alert_secret'
    and exists (
      select 1 from public.workflow_email_outbox q
      where q.automatic and (q.status='pending' or (q.status in ('failed','sending')
        and q.last_attempt_at<now()-interval '2 minutes'
        and q.first_attempt_at>now()-interval '23 hours'
        and q.attempts<6))
    );
$job$);

commit;
