// HR leave summary report: shared by the report screen and the Excel download.
export type SummaryRow = {
  employee_no: string; name: string; designation: string | null; department: string | null; active: boolean
  fy: number; leave_type: string; entitlement: number | null; opening_taken: number | null
  approved_period: number; pending_period: number; approved_fy: number; pending_fy: number; balance: number | null
}
export type DetailRow = {
  employee_no: string; name: string; designation: string | null; department: string | null
  fy: number; leave_type: string; start_date: string; end_date: string; days: number; days_in_period: number
  status: string; reason: string; applied_at: string; decided_at: string | null; decided_by: string | null
}
export type LeaveReport = { from: string; to: string; summary: SummaryRow[]; detail: DetailRow[] }
export type ReportFilter = { employees: string[]; department: string; designation: string; leaveType: string; search: string }
export type Cell = string | number | null

export const emptyFilter: ReportFilter = { employees: [], department: '', designation: '', leaveType: '', search: '' }

const isoDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const stamp = Date.parse(value + 'T00:00:00Z')
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value
}

// The database accepts periods of up to three years.
export function validPeriod(from: unknown, to: unknown): boolean {
  if (!isoDate(from) || !isoDate(to) || to < from) return false
  return (Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86_400_000 <= 1100
}

// Fiscal years run 1 July to 30 June.
export function fiscalYearOf(date: string): number {
  const year = Number(date.slice(0, 4))
  return Number(date.slice(5, 7)) < 7 ? year - 1 : year
}
export function fiscalYearLabel(year: number): string {
  const two = (value: number) => String(value % 100).padStart(2, '0')
  return 'FY ' + two(year) + '-' + two(year + 1)
}
export function fiscalYearPeriod(year: number): { from: string; to: string } {
  return { from: year + '-07-01', to: (year + 1) + '-06-30' }
}

const leaveTypeNames: Record<string, string> = {
  annual: 'Annual Leave', casual: 'Casual Leave', sick: 'Sick Leave', maternity: 'Maternity Leave', unpaid: 'Leave Without Pay',
}
export const leaveTypeLabel = (type: string): string => leaveTypeNames[type] ?? type
export const leaveTypeOptions = Object.keys(leaveTypeNames)

export function cleanFilter(value: unknown): ReportFilter {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const text = (key: string) => typeof source[key] === 'string' ? (source[key] as string).slice(0, 200) : ''
  const employees = Array.isArray(source.employees)
    ? source.employees.filter((item): item is string => typeof item === 'string').slice(0, 2000) : []
  return { employees, department: text('department'), designation: text('designation'), leaveType: text('leaveType'), search: text('search') }
}

type Person = { employee_no: string; name: string; designation: string | null; department: string | null; leave_type: string }
export function matchesFilter(row: Person, filter: ReportFilter): boolean {
  const query = filter.search.trim().toLowerCase()
  return (filter.employees.length === 0 || filter.employees.includes(row.employee_no))
    && (!filter.department || row.department === filter.department)
    && (!filter.designation || row.designation === filter.designation)
    && (!filter.leaveType || row.leave_type === filter.leaveType)
    && (!query || row.employee_no.toLowerCase().includes(query) || row.name.toLowerCase().includes(query))
}
export function applyFilter(report: LeaveReport, filter: ReportFilter): LeaveReport {
  return {
    ...report,
    summary: report.summary.filter(row => matchesFilter(row, filter)),
    detail: report.detail.filter(row => matchesFilter(row, filter)),
  }
}

const days = (value: number | null): number | null => value === null ? null : Math.round(value * 100) / 100
const shortDate = (value: string | null): string => value ? value.slice(8, 10) + '/' + value.slice(5, 7) + '/' + value.slice(0, 4) : ''
const titleCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)

export const summaryColumns = [
  'Employee ID', 'Name', 'Designation', 'Department', 'Fiscal Year', 'Leave Type', 'Entitlement', 'Opening Taken',
  'Approved in Period', 'Pending in Period', 'Approved in FY', 'Pending in FY', 'Balance',
] as const
export function summaryCells(row: SummaryRow): Cell[] {
  return [
    row.employee_no, row.name, row.designation ?? '', row.department ?? '', fiscalYearLabel(row.fy), leaveTypeLabel(row.leave_type),
    days(row.entitlement), days(row.opening_taken), days(row.approved_period), days(row.pending_period),
    days(row.approved_fy), days(row.pending_fy), days(row.balance),
  ]
}

export const detailColumns = [
  'Employee ID', 'Name', 'Designation', 'Department', 'Fiscal Year', 'Leave Type', 'From', 'To', 'Days Charged',
  'Days in Period', 'Status', 'Reason', 'Applied On', 'Decided On', 'Decided By',
] as const
export function detailCells(row: DetailRow): Cell[] {
  return [
    row.employee_no, row.name, row.designation ?? '', row.department ?? '', fiscalYearLabel(row.fy), leaveTypeLabel(row.leave_type),
    shortDate(row.start_date), shortDate(row.end_date), days(row.days),
    row.status === 'approved' || row.status === 'pending' ? days(row.days_in_period) : null,
    titleCase(row.status), row.reason, shortDate(row.applied_at), shortDate(row.decided_at), row.decided_by ?? '',
  ]
}

export function uniqueSorted(values: (string | null)[]): string[] {
  return [...new Set(values.filter((value): value is string => !!value))].sort((a, b) => a.localeCompare(b))
}
