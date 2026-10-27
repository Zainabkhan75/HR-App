# ESS profile release

Employees open /portal after signing in. Only their own linked, active employee account is used; the profile endpoints take no target employee ID. Password setup must be complete, and inactive employment records are denied.

## Employee capabilities
- View personal and employment information.
- Edit mobile, personal mobile, personal email and personal address directly.
- View salary and benefits, plus the explicitly historical August 2026 payroll snapshot.
- Changing a profile contact email does not change Supabase Auth login credentials.
- Edit profile identity, organisation and employment fields directly; employee ID, compensation and access permissions remain protected.
- Edit one spouse and multiple children in the Family tab; CNIC is required for dependants over 18.

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

## Profile dropdowns and employment inputs
Department, location and recorded reporting line use distinct current employee values. Employment type and mobility include existing source categories, retained when their last user changes category; Permanent is also available by request. No matching of recorded reporting titles to manager identities is performed.

Selecting Permanent sets probation to 3 months. Other employment types accept a blank value or whole months from 0 through 6. Newly entered joining dates use DD/MM/YYYY and must be real calendar dates. Existing imported dates and probation text remain unchanged until explicitly edited. The client and authenticated server wrapper validate changed values; the existing private profile save implementation is retained.

The dropdown migrations change functions only. Integration checks run in rolled-back transactions, including Permanent defaults, bounds, leap dates, access rejection and compensation preservation. Run all local checks with `node --test tests/*.test.mjs`.
