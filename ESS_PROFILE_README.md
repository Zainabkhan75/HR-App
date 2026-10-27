# ESS profile and family release

Employees open /portal after signing in. All save/read RPCs resolve the employee from auth.uid(); no target employee ID is accepted. Active account linkage and completed password setup are required; inactive employee records are denied.

## Editable information
- My profile: name, designation, department, location, recorded reporting-line text, CNIC/passport, work email, employment type, date of joining, mobility and probation.
- Contact details: mobile, personal mobile, personal email and address.
- Family & dependants: one optional spouse and a list of children, each with name, age in whole years, pre-existing conditions and CNIC.
- CNIC is mandatory strictly over 18 years and optional at 18 or younger. Any CNIC provided must contain 13 digits; hyphens/spaces are normalised.
- Empty health-condition fields mean not provided; the form suggests entering None when no conditions apply.

Employee ID, salary, benefits and historical payroll remain read-only. Editing profile emails does not change Auth credentials. Reporting-line text edits do not grant manager roles or change verified manager-team mappings.

## Storage and access
Family and medical data are in employee_family_details, not in broadly returned profile JSON. Only own-employee RPCs return family details. HR can read the table through its existing HR role; managers receive no dependent/medical access to their teams.
Family/profile audit tables record actor, timestamp and changed-field/count metadata without copying medical text or CNIC values.
Existing contact edits retain their transactional before/after audit history.

All saves use optimistic concurrency timestamps and controlled JSON field allowlists. Contact, profile and family drafts are preserved when switching sections. Reload controls explicitly clear unsaved edits after conflicts.

## Verification
- node --test tests/ess-profile.test.mjs tests/family-profile.test.mjs
- Production builds validate TSX and types.
- Database checks ran in transactions that were rolled back, covering adult CNIC rules, age validation, single-spouse object enforcement, multiple children, own-record isolation, read-only salary/ID/role fields, contact preservation and stale-write rejection.
- Employee/detail row fingerprints and empty family/audit tables are checked after rollback.

Existing legacy-function security warnings remain outside this release. No employee record, account activation or existing policy is bulk modified.
