# Bandana HRMS Upgrade 3A (staged deployment)

## What this package includes

- Supabase migration `supabase/003_ess_mss_foundation.sql` (additive, no automatic account creation).
- Mobile-friendly `/portal` ESS summary and manager team summary.
- `/change-password` first-use change screen.
- Login screen accepts email and HR-assigned usernames, but username accounts only work **after** an authorised provisioning process links a Supabase Auth user to an employee.
- HR directory from Upgrade 2 remains.

## Order of operations

1. Export a current database backup. Review migration before executing.
2. Run `003_ess_mss_foundation.sql` in Supabase SQL Editor.
3. Upload updated application files to existing GitHub repository, preserving paths; Vercel should rebuild.
4. Test existing HR admin login and employee directory first.
5. **Do not activate employee access yet**. A dedicated admin-only provisioning process must be designed and tested. Do not give shared passwords; issue unique temporary passwords separately.
6. Only after verified linking and access testing should HR activate accounts.

## Known limits / security

- New `employee_accounts` table defaults all links to `is_active=false`.
- Linking and provisioning are not included in 3A. `username`, `login_email`, `user_id`, and `employee_id` must be reviewed together by authorised HR staff before activation. A new auth user must be created via an admin-controlled workflow, never using secrets exposed in the browser or repository.
- `resolve_login_name` is exposed to anonymous requests to support username sign-in and can disclose whether a username exists. Rate limiting, abuse controls and generic errors should be put in place before use outside a controlled test environment.
- Supabase password reset via email cannot serve employees without verified email. HR-assisted recovery requires an admin-controlled design.
- `confirm_password_changed` relies on the application's successful `updateUser()` call; for stronger enforcement, implement an auth event/identity-level proof and session invalidation before broad activation. Never assume a forced-change flag by itself prevents access to all future APIs.
- Existing HR-only tables retain their RLS protections. Self-service summary RPCs deliberately exclude payroll, personal ID and extended profile JSON.
- Manager team mappings are empty until explicitly approved and inserted; unverified text reporting lines are never treated as permissions.
- Leave requests and manager approvals are not included in Upgrade 3A.
- This staged build has not been validated against the user's deployed GitHub commit or live Supabase project. Test build and RLS in a separate environment before production.
