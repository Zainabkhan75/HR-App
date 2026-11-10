import type {Policy} from './leave'

// Leave years are identified by the calendar year in which they start.
export function leaveYear(date: string): number {
  const year = Number(date.slice(0, 4))
  return Number(date.slice(5, 7)) < 7 ? year - 1 : year
}

export const headOfficeEntitlements = { annual: 15, casual: 10, sick: 8 } as const

export function annualOpeningEntitlement(joiningDate: string, year: number): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(joiningDate)) return null
  const joined = Date.parse(joiningDate + 'T00:00:00Z')
  if (!Number.isFinite(joined) || new Date(joined).toISOString().slice(0, 10) !== joiningDate) return null
  const start = Date.UTC(year, 6, 1)
  const nextStart = Date.UTC(year + 1, 6, 1)
  const remaining = Math.max(0, nextStart - Math.max(start, joined))
  return Math.ceil(headOfficeEntitlements.annual * remaining / (nextStart - start))
}

export const companyHolidays2026 = {
  confirmed: [
    '2026-08-14', '2026-08-25', '2026-11-09', '2026-12-25',
    '2027-02-05', '2027-03-23', '2027-05-01', '2027-05-28',
  ],
  expected: [
    '2027-03-10', '2027-03-11', '2027-03-12', '2027-05-16',
    '2027-05-17', '2027-05-18', '2027-06-14', '2027-06-15',
  ],
} as const

export function casualLeaveCharge(hours: 2 | 4 | 'full-day'): number {
  if (hours === 2) return 0.25
  if (hours === 4) return 0.5
  return 1
}

export const maternityCalendarDays = 84

export function previewHeadOfficeLeave(
  start: string,
  end: string,
  type: 'annual' | 'casual' | 'sick' | 'maternity' | 'unpaid',
  duration: 2 | 4 | 'full-day',
  policy?: Policy,
): number | null {
  const parse = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN
    const timestamp = Date.parse(value + 'T00:00:00Z')
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
      ? timestamp : NaN
  }
  const first = parse(start)
  const last = parse(end)
  const day = 86_400_000
  if (!Number.isFinite(first) || !Number.isFinite(last) || last < first || last - first >= 366 * day) return null
  if (type === 'maternity') return (last - first) / day + 1 === maternityCalendarDays ? maternityCalendarDays : null
  if (type === 'unpaid') return (last - first) / day + 1
  if (type === 'casual' && duration !== 'full-day' && first !== last) return null
  const holidays = new Set<string>(policy?.holidays ?? [...companyHolidays2026.confirmed, ...companyHolidays2026.expected])
  let charge = 0
  for (let date = first; date <= last; date += day) {
    const current = new Date(date)
    if ((policy?.weekdays_only === false || (current.getUTCDay() !== 0 && current.getUTCDay() !== 6)) && !holidays.has(current.toISOString().slice(0, 10))) {
      charge += type === 'casual' ? casualLeaveCharge(duration) : 1
    }
  }
  return charge
}

export function requiresCeoUnpaidApproval(
  alreadyApprovedCalendarDays: number,
  requestedCalendarDays: number,
): boolean {
  return alreadyApprovedCalendarDays + requestedCalendarDays > 15
}

export function leaveApprovalRoute(
  lineManagerId: string,
  departmentHeadId: string,
  hrApproverId: string,
  ceoId?: string,
) {
  const stages = [{ role: 'line_manager', approverId: lineManagerId }]
  if (departmentHeadId !== lineManagerId) {
    stages.push({ role: 'department_head', approverId: departmentHeadId })
  }
  stages.push({ role: 'hr', approverId: hrApproverId })
  if (ceoId) stages.push({ role: 'ceo', approverId: ceoId })
  return stages
}
