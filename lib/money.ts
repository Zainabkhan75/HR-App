const moneyFields = new Set([
 'gross_fixed_salary_rs', 'salary_earned_rs', 'over_time_incentive_variable_pay',
 'bonus_others', 'deductions_loans_others', 'salary_arrears_others',
 'fuel_allowance_vehicle_allow', 'total_compensation_rs', 'wht_tax_deductions_rs',
 'lease_instalment_other_deduction', 'provident_fund_deductions', 'payable_salary_rs',
 'medical_hospitalisation_limit_person_year_pkr',
])

export function isMoneyField(field: string): boolean {
 const label = field.split(' | ').pop() ?? field
 const key = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
 return moneyFields.has(key)
}

const accountingFormat = new Intl.NumberFormat('en-US', {
 minimumFractionDigits: 2,
 maximumFractionDigits: 2,
 useGrouping: true,
})

export function moneyInputValue(value: unknown): string {
 const original = value == null ? '' : String(value).trim()
 const amount = original.replace(/^(?:PKR|Rs\.?)\s*/i, '').trim()
 const numeric = /^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(amount)
 return numeric ? amount.replace(/,/g, '') : original
}

export function formatMoney(value: unknown): string {
 const original = value == null ? '' : String(value).trim()
 if (!original) return ''
 const amount = moneyInputValue(original)
 if (!/^-?\d+(?:\.\d+)?$/.test(amount)) return original
 const number = Number(amount)
 if (!Number.isFinite(number)) return original
 return accountingFormat.format(number)
}

export function formatMoneyField(field: string, value: unknown): string {
 return isMoneyField(field) ? formatMoney(value) : value == null ? '' : String(value)
}
