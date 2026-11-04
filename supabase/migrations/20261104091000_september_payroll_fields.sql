alter table public.employee_details add column payroll_sep_2026 jsonb not null default '{}'::jsonb check (jsonb_typeof(payroll_sep_2026) = 'object');
