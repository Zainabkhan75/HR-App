# Bandana leave and Inbox

Employees use `/workspace`, linked from the employee portal. HR uses the Leave & Inbox link in the employee directory. The left sidebar contains leave applications, Inbox, manager approvals and HR setup where authorised. Approval links preserve their workspace destination through sign-in; a link alone never authorises a decision.

## Initial policy

The user authorised 10 annual, 10 sick and 10 casual whole days, January–December, excluding Saturdays and Sundays. The initial policy is for 2026. No public holidays, historical leave usage, employee-manager relationships or new sign-in accounts were inferred. HR can configure policy years and holiday dates. Once a year has requests, counting rules are frozen; individual entitlement and opening corrections remain possible subject to reservations.

HR verifies opening usage separately for each employee and leave type, including an explicit zero where verified. Before verification, the screen shows the policy entitlement but marks taken/available figures as awaiting HR verification. Applications require a verified opening balance and exactly one verified line manager with an active account, completed password setup and the manager role. Profile reporting text does not control approval routing.

## Accounting and approvals

Each application snapshots its chargeable dates. Taken to date includes opening usage and approved charge dates through today. Upcoming approved days and pending days are shown separately. Available to request deducts opening usage, all approved days and pending reservations once. Employee-row locks serialise submissions, decisions, withdrawals, balance corrections and reporting assignment changes. Overlapping pending/approved requests, cross-year requests, requests without chargeable days and insufficient balances are rejected.

Only the assigned, currently linked line manager can approve or reject; rejection requires a note. HR sees an overview but cannot approve on a manager's behalf through this workflow. Employees may withdraw their own pending requests. Decisions and withdrawals complete the original Inbox task and release pending reservations as appropriate. Repeated decisions are rejected.

## Inbox and email

All active employees have an Inbox. HR can assign tasks to active employee accounts. Managers can assign tasks only to their verified direct reports. Recipients can mark items read and complete assigned tasks. Direct conversations are deferred as requested. The Inbox shows its latest 200 items; HR sees the latest 100 email queue entries.

Transactional email is **not connected or sending**. The database queues notification subjects, verified account email addresses and authenticated approval links with `waiting_for_setup`. Resolving a request cancels its unsent approval email. A sender, delivery integration and queue dispatcher must be configured before automatic email delivery can be enabled. No email credentials or paid service were assumed. Existing Supabase password-recovery email is independent of this application notification queue.

## Access and validation

The six new tables have RLS enabled, restrictive deny policies and no grants to anonymous/authenticated clients. Three authenticated public SECURITY INVOKER RPCs call private, restricted SECURITY DEFINER implementations with explicit employee/HR/manager checks. The private notification helper is not granted to API users. Existing roles, employee records, salary, family data and previous functions are retained.

Local verification: `node --test tests/*.test.mjs` and `npm run build`. `tests/leave-integration.sql` exercises the lifecycle using synthetic identities inside an explicitly rolled-back transaction; it must run as the database administrator in a controlled verification session. It creates no lasting test users or records and checks employee/profile fingerprints. Additional authenticated-role checks reject direct table reads and non-HR setup.

At release verification there were 185 employee records, one active employee account and no verified manager links. Production rollout needs real manager accounts and HR-verified opening balances. The release does not create or assign them automatically.
