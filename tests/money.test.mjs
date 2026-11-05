import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../lib/money.ts', import.meta.url), 'utf8')
const code = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS}}).outputText
const exports = {}
new Function('exports', code)(exports)
const {formatMoney, formatMoneyField, moneyInputValue} = exports

test('money displays separators and two decimals for numeric and legacy string values', () => {
 for (const [input, expected] of [[125000, '125,000.00'], ['125000.5', '125,000.50'],
  ['1,250.50', '1,250.50'], [0, '0.00'], ['PKR 125000', '125,000.00'],
  ['-1250.25', '-1,250.25'], ['1.005', '1.01']]) {
  assert.equal(formatMoney(input), expected)
 }
})

test('missing and nonnumeric values do not become zero', () => {
 for (const input of [null, undefined, '', ' ']) assert.equal(formatMoney(input), '')
 for (const input of ['Not available', 'As per policy', '12,34', Infinity]) {
  assert.equal(formatMoney(input), String(input))
 }
})

test('money formatting never applies to employee IDs, bank details, days or minutes', () => {
 for (const field of ['Employee ID#', 'Bank Account Number', 'IBAN', 'No. Days', 'Over Time Minutes']) {
  assert.equal(formatMoneyField(field, '001234'), '001234')
 }
 assert.equal(formatMoneyField('Payroll | Payable Salary (Rs.)', '125000'), '125,000.00')
 assert.equal(formatMoneyField('medical_hospitalisation_limit_person_year_pkr', 450000), '450,000.00')
 assert.equal(moneyInputValue('125,000.50'), '125000.50')
 assert.equal(moneyInputValue('1.'), '1.')
})
