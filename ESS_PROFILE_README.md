# ESS profile release

Employees open /portal after signing in. Only their own linked, active employee account is used; the profile endpoints take no target employee ID. Password setup must be complete, and inactive employment records are denied.

## Employee capabilities
- View personal and employment information.
- Edit mobile, personal mobile, personal email and personal address directly.
- View salary and benefits, plus the explicitly historical August 2026 payroll snapshot.
- Changing a profile contact email does not change Supabase Auth login credentials.
- Identity, organisation, work email and compensation remain read-only in ESS.

## Database
The migration adds a private implementation schema, two authenticated public RPC wrappers, and an RLS-protected employee_contact_audit table. It changes no existing records or existing policies.
Update patches allow only the four contact keys, merge into the existing profile JSON and require the last-read updated_at timestamp. Each changed save adds an audit entry in the same transaction. Empty/no-op saves add none.

HR administrators can inspect contact history in employee_contact_audit through their existing HR role; employees can read only their own history.

## Verification
Run client field-filter tests with:
`node --test tests/ess-profile.test.mjs`

Production database verification used rolled-back transactions to test own-profile access, anonymous and unlinked-user rejection, disabled-account and first-login gates, protected fields, invalid email rejection, stale-write rejection, audit creation, no-op behavior and preservation of salary/payroll JSON. The original details fingerprint and account flags were checked after rollback.

Existing security advisor warnings in older functions are not modified by this release. In particular, tightening legacy function grants and enforcing password-change completion independently of the existing confirmation RPC should be handled separately.

## Scope
HR approval, leave workflows, bulk account provisioning and corrections to imported employee data are not part of this release.
