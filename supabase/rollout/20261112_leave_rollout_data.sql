-- Leave staff rollout data, 12 November 2026. Run ONCE, after migration
-- 20261112100000_leave_fy_holidays_routes_report.sql, and only after HR approval.
-- Tested against production inside a rolled-back transaction: 34 routes.
begin;

-- A. Organisation corrections confirmed by Zainab Khan on 12 November 2026.
-- Nadeem Akhtar (200028) and Muhammad Salman Safdar (200077) belong to Planning.
-- Their designations move to Planning only if nobody else holds them.
update public.designations g set department_id=(select id from public.departments where name='Planning')
 where g.id in (select designation_id from public.employee_records where employee_no in ('200077','200028'))
 and not exists(select 1 from public.employee_records x where x.designation_id=g.id and x.employee_no not in ('200077','200028'));
-- Salman Safdar reports to Ahsan Ali (200027), Planning Manager.
update public.employee_details d set profile=jsonb_set(d.profile,'{line_manager_employee_no}','"200027"'),updated_at=now()
 from public.employee_records r where r.id=d.employee_id and r.employee_no='200077';
update public.employee_records set reports_to_text='Planning Manager' where employee_no='200077';

-- B. Approval routes: Line Manager (from the employee profile), then HOD, then CEO only for
-- unpaid leave above 15 days in the fiscal year. No HR approval stage.
-- The HOD of each department is the CEO's direct report at the top of that branch.
-- For the seven HODs themselves the CEO acts as HOD. The CEO has no route.
insert into hrms_private.leave_pilot_routes(employee_id,hod_user_id,hr_user_id,ceo_user_id)
select e.id,h.user_id,null,c.user_id
from (values ('Design','200006'),('E-Commerce','200011'),('Warehouse','200011'),('E-Commerce Warehouse','200011'),
 ('Finance','200012'),('IT Department','200012'),('Human Resources','200023'),('Administration','200023'),
 ('Planning','200027'),('Supply Chain','200027'),('Sourcing','200027'),
 ('Marketing and Branding','200095'),('Visual Merchandising','200095'),('Retail Operations','200058')) m(dept,hod_no)
join public.employees e on e.department=m.dept and e.employment_state='active'
 and (m.dept<>'Retail Operations' or e.designation in ('Manager Retail Sales And Operation','Retail Operations Specialist'))
join lateral (select a.user_id from public.employee_accounts a join public.employee_records r on r.id=a.employee_id
 where a.is_active and r.employee_no=case when e.employee_no=m.hod_no then '200001' else m.hod_no end) h on true
cross join (select a.user_id from public.employee_accounts a join public.employee_records r on r.id=a.employee_id
 where a.is_active and r.employee_no='200001') c
on conflict(employee_id) do update set hod_user_id=excluded.hod_user_id,hr_user_id=null,ceo_user_id=excluded.ceo_user_id;

-- C. Withdraw the old pilot test request (200023, annual, 1 day) so testing restarts on the new route.
update public.leave_requests set status='cancelled',decision_note='Pilot test request closed before staff rollout',decided_at=now()
 where status='pending' and employee_id=(select id from public.employee_records where employee_no='200023');
update public.work_inbox set completed_at=now() where kind='leave_request' and completed_at is null
 and request_id in (select id from public.leave_requests where status='cancelled');
update public.workflow_email_outbox set status='cancelled' where status in ('waiting_for_setup','pending','failed')
 and inbox_id in (select id from public.work_inbox where kind='leave_request' and completed_at is not null);

commit;
