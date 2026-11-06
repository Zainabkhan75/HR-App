create table public.monthly_payroll (
  employee_id uuid not null references public.employees(id) on delete restrict,
  payroll_month date not null check (payroll_month >= date '2026-10-01' and extract(day from payroll_month) = 1),
  fields jsonb not null check (jsonb_typeof(fields) = 'object'),
  published_at timestamptz not null default now(),
  primary key (employee_id, payroll_month)
);
create index monthly_payroll_period_idx on public.monthly_payroll(payroll_month);
alter table public.monthly_payroll enable row level security;
revoke all on public.monthly_payroll from public, anon, authenticated;
grant select on public.monthly_payroll to authenticated;
grant select, insert on public.monthly_payroll to service_role;

create function hrms_private.monthly_payslip_employee_id()
returns uuid language sql stable security definer set search_path = '' as $$
    select a.employee_id from public.employee_accounts a
    join public.employees e on e.id = a.employee_id
    where a.user_id = (select auth.uid())
      and a.is_active and not a.must_change_password and e.employment_state <> 'inactive'
$$;
revoke all on function hrms_private.monthly_payslip_employee_id() from public, anon;
grant execute on function hrms_private.monthly_payslip_employee_id() to authenticated;
create policy "Employees read their own published slips"
  on public.monthly_payroll for select to authenticated
  using (employee_id = (select hrms_private.monthly_payslip_employee_id()));

create function public.publish_monthly_payroll(p_month date, p_rows jsonb, p_actor uuid)
returns integer language plpgsql security invoker set search_path = '' as $$
declare inserted integer;
begin
  if not exists (select 1 from public.user_roles where user_id = p_actor and role = 'hr_admin') then
    raise exception 'HR administrator access required';
  end if;
  if p_month is null or p_month < date '2026-10-01' or extract(day from p_month) <> 1 then
    raise exception 'Invalid payroll month';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Invalid payroll rows';
  end if;
  if jsonb_array_length(p_rows) not between 1 and 2000 then
    raise exception 'Invalid payroll row count';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(260611, (p_month - date '2026-10-01'));
  if exists (select 1 from public.monthly_payroll where payroll_month = p_month) then
    raise exception 'This payroll month is already published';
  end if;
  insert into public.monthly_payroll(employee_id, payroll_month, fields)
    select r.employee_id, p_month, r.fields
    from jsonb_to_recordset(p_rows) as r(employee_id uuid, fields jsonb);
  get diagnostics inserted = row_count;
  return inserted;
end;
$$;
revoke all on function public.publish_monthly_payroll(date,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.publish_monthly_payroll(date,jsonb,uuid) to service_role;
