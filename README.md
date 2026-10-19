# Bandana HRMS - first working codebase

Temporary HR admin directory, built with Next.js and Supabase. This is an **initial development build**, not yet a live HR/payroll system.

## Included
- Secure sign-in through Supabase Auth (email/password initially)
- HR-admin only employee directory with search, missing-data counts, edit and create
- Server-enforced access through PostgreSQL row-level security (RLS)
- SQL sequence allocating `BND-` employee numbers with no reuse
- Mobile-responsive admin UI
- Workbook-to-CSV extraction utility, to run locally; payroll columns excluded

## Setup
1. Create a Supabase project and execute `supabase/001_init.sql` in the SQL editor.
2. Create an email/password user in Supabase Authentication > Users. After verifying their identity, grant the `hr_admin` role using the SQL example at the bottom of the migration.
3. Run the `scripts/prepare_import.py` utility locally against your workbook to create a **private** CSV. Inspect its contents. Use Supabase Table Editor CSV import for `public.employees`, mapping its headers. This is a manual controlled step; do not put this CSV into GitHub.
4. Run the `setval(...)` command at the bottom of the SQL migration after importing and before creating new employees. This allocates the next `BND-` ID above the maximum imported ID.
5. Copy `.env.example` to `.env.local` and enter your Supabase Project URL and publishable/anon key (NEVER service-role key).
6. Run `npm install`, then `npm run dev`. Open http://localhost:3000.
7. For Vercel development previews, add the same environment variables to the project. Do not upload real employee data to a preview until hosting use terms, data approval, security and backup controls are confirmed.

## Status and limitations
- No ESS/MSS, leave workflow, email sending or payslip module yet.
- Existing `Reports To` values are imported as **unverified text**, not authoritative manager relationships.
- Only the selected basic columns are imported; pay, CNIC and personal contacts are not imported.
- No password reset UI, audit history or backup automation yet. These are required before production use.
- Employee updates are not yet effective-dated. Avoid overwriting fields if historic values are required.
- The pilot data should be reviewed for duplicate employee identities before inviting users.
- Free Vercel Hobby hosting is not licensed for company/commercial operation. Use it only for qualifying personal development, and deploy operational use to hosting that permits it.
