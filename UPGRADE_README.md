# Bandana HRMS Upgrade 2: Full profile and employee actions

This upgrade is intended for the **existing** GitHub/Vercel/Supabase project. It does **not** reset the employee table, roles or existing employee numbers.

## Important sequence

1. Export/backup existing Supabase employee records and record the existing number of employees, including anyone added since the workbook import.
2. Upload the updated *source files* from this ZIP into the **same GitHub repository**, preserving paths. Do **not** upload the private SQL import file, original workbook, personal data or secrets.
3. In the **existing Supabase HR App project**, SQL Editor, run `supabase/002_employee_profiles.sql` exactly once. This adds `employment_state`, `employee_details`, an action audit table, and protected status/delete functions. Old source record status is not treated as verified current employment status.
4. In Supabase SQL Editor run the separately supplied `Bandana_Private_Profile_Import.sql` (confidential; **never commit to GitHub**). It matches on `BND-` employee numbers and will **not overwrite existing extended-field edits**. Rows created after the source workbook remain untouched. If a source record is no longer present it is not recreated.
5. Verify employee count and inspect a few source-matched profiles, including blank/unverified entries. Audit permissions from a non-HR account before staff access.
6. Deploy the matching upgraded files from GitHub through Vercel. **Do not assume automatic deployment implies full testing.**

## What's included

- Edit employee profile in tabs for core information, contact, employment, pay/benefits, historical August payroll, and source verification.
- Three actions on each row: Edit, Deactivate/Reactivate (same button toggles) and restricted Delete (requires matching employee ID and reason).
- Status filter; imported records default to `unverified` until reviewed.
- Audit entries for status changes and deletion, including a retained snapshot upon deletion.
- Existing employee IDs, historical workbook text, original core data and live additions preserved.

## Security / production limits

- The current application is **HR-admin-only**; do not enable ESS/MSS until sensitive fields are placed behind separately tested permissions.
- Deletion is for erroneous records, not employment exit, and is **permanent** in the employee directory. It is protected by an audit snapshot and linked-table foreign key constraints; take a backup first.
- `record_status` reflects original source descriptions; `employment_state` is an administrative status and initially `unverified`.
- Payroll data labelled August 2026 is historical and MUST NOT be treated as current pay.
- The import stores workbook values as text, including ambiguous Excel serial date values. Validate dates before any operational use.
- This does not implement payroll, payslip delivery, ESS/MSS, notification automation, or reliable production backups.
- A Vercel Hobby subscription is not licensed for operational company/commercial use.
