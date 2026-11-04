import {fieldKey,payrollFields,payrollPeriodLabel,payrollProfileFields,sections} from '../app/employees/field-config'

export type ReportRow = Record<string,string>
export type ReportTable = {columns: string[]; rows: ReportRow[]}
type RecordData = Record<string,unknown>
export type ReportSources = {employees: RecordData[]; details: RecordData[]; accounts: RecordData[]; families: RecordData[]}

export function text(value: unknown): string {
 return value == null ? '' : String(value)
}

const record = (value: unknown): RecordData =>
 value && typeof value === 'object' && !Array.isArray(value) ? value as RecordData : {}

const identity = [
 ['Employee ID','employee_no'], ['Full Name','full_name'], ['Designation','designation'],
 ['Department','department'], ['Location','location'], ['Employment Status','employment_state'],
] as const
const core = [['Reports To','reports_to_text'],['Leaving Date','leaving_date'],
 ['Source Record Status','record_status'],['Source / Verification Note','source_note']] as const
const profileFields = sections.filter(section => section.key !== 'current-payroll')
 .flatMap(section => [...section.labels]).filter(label => label !== 'Reporting to')
const salaryFields = [...(sections.find(section => section.key === 'salary')?.labels ?? [])]
const payrollValues = payrollFields.filter(label => !payrollProfileFields.has(label))
const dependantFields = [
 ['Full Name','full_name'],['Age','age'],['Date of Birth','date_of_birth'],
 ['Pre-existing Conditions','pre_existing_conditions'],['CNIC','cnic'],
] as const
const loginColumns = ['Login Username','Login Status']

function addFields(row: ReportRow, fields: readonly (readonly [string,string])[], data: RecordData) {
 for (const [label, key] of fields) row[label] = text(data[key])
}

export function buildReports(source: ReportSources): {full: ReportTable; payroll: ReportTable} {
 const details = new Map(source.details.map(d => [text(d.employee_id), d]))
 const accounts = new Map(source.accounts.map(a => [text(a.employee_id), a]))
 const families = new Map(source.families.map(f => [text(f.employee_id), f]))
 const maxChildren = Math.max(0, ...source.families.map(f => Array.isArray(f.children) ? f.children.length : 0))
 const familyLabels = ['Spouse', ...Array.from({length: maxChildren}, (_, index) => 'Child ' + (index + 1))]
 const familyColumns = familyLabels.flatMap(label => dependantFields.map(([field]) => label + ' / ' + field))
 const full: ReportTable = {
  columns: [...identity.map(([label]) => label), ...core.map(([label]) => label), ...profileFields,
   'Payroll Period', ...payrollValues, ...loginColumns, ...familyColumns],
  rows: [],
 }
 const payroll: ReportTable = {
  columns: [...identity.map(([label]) => label), 'Date of Joining', 'Payroll Period', ...payrollValues, ...salaryFields],
  rows: [],
 }

 for (const employee of source.employees) {
  const id = text(employee.id)
  const detail = details.get(id)
  const profile = record(detail?.profile)
  const month = record(detail?.payroll_sep_2026)
  const account = accounts.get(id)
  const family = families.get(id)
  const children = Array.isArray(family?.children) ? family.children : []
  const base: ReportRow = {}
  addFields(base, identity, employee)

  const pay: ReportRow = {
   ...base,
   'Date of Joining': text(profile.date_of_joining),
   'Payroll Period': Object.keys(month).length ? payrollPeriodLabel : '',
  }
  for (const label of payrollValues) pay[label] = text(month[fieldKey(label)])
  for (const label of salaryFields) pay[label] = text(profile[fieldKey(label)])
  payroll.rows.push(pay)

  const row: ReportRow = {...base}
  addFields(row, core, employee)
  for (const label of profileFields) row[label] = text(profile[fieldKey(label)])
  for (const label of ['Payroll Period', ...payrollValues]) row[label] = pay[label]
  row['Login Username'] = text(account?.username)
  row['Login Status'] = !account ? 'No linked account' : !account.is_active ? 'Inactive login'
   : account.must_change_password ? 'Password change pending' : 'Ready'
  familyLabels.forEach((label, index) => {
   const member = record(index === 0 ? family?.spouse : children[index - 1])
   addFields(row, dependantFields.map(([field,key]) => [label + ' / ' + field,key] as const), member)
  })
  full.rows.push(row)
 }
 return {full, payroll}
}

export function reportCsv(table: ReportTable, rows = table.rows): string {
 const escape = (value: string) => '"' + (/^[\s]*[=+@\-\t\r]/.test(value) ? "'" + value : value).replace(/"/g,'""') + '"'
 return '\uFEFF' + [table.columns, ...rows.map(row => table.columns.map(column => row[column] ?? ''))]
  .map(row => row.map(escape).join(',')).join('\r\n')
}
