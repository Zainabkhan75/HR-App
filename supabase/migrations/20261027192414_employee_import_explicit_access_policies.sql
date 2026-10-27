create policy service_managed_jobs on hrms_private.employee_import_jobs as restrictive for all to authenticated using(false) with check(false);
create policy service_managed_results on hrms_private.employee_import_results as restrictive for all to authenticated using(false) with check(false);
