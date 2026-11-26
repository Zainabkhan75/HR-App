# Reporting review, 26 November 2026

C05 remains open. Live hrms_private.leave_reporting_links reads profile.line_manager_employee_no and manager_team_links, while the employee portal traverses position_records. Live my_team_summary also reads manager_team_links. Comparing active employees with their nearest occupied ancestor found 5 expected leave links missing and 3 unexpected links. This review does not change approval routes or existing leave requests.

C06 remains open. Employee portal reporting has recursive nearest-occupied-ancestor lookup; hrms_private.employee_reporting_hierarchy stops at the immediate parent, and leave routing uses legacy links. No active employee currently requires vacancy fallback, as verified by recursive live database query. Existing team trees include vacant structural positions; that does not itself implement approval fallback.

C08: Organisation Exceptions added to HR Admin Reports with CSV download, search, sorting, pagination and department filtering. Checks active employee assignments, legacy text-only assignments, legacy manager conflicts, all position designation/sub-department/parent references, reporting cycles, vacant-ancestor chains, unmapped sub-departments and duplicate names/titles. Vacancy fallback and duplicate-title findings are review information, not automatic errors. Reports retain existing HR Admin authorization and CSV formula protection.

Validation: report unit tests (6), existing build tests (26), Next.js production build. Live RLS policies checked for all newly queried registers. No employee or reporting records modified.
