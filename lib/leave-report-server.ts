import ExcelJS from 'exceljs'
import {serverSupabase} from './server'
import {applyFilter, detailCells, detailColumns, summaryCells, summaryColumns, validPeriod} from './leave-report'
import type {Cell, LeaveReport, ReportFilter} from './leave-report'

// Access is enforced in the database: leave_report raises 42501 unless the caller is an HR administrator.
export async function loadLeaveReport(from: string, to: string) {
  if (!validPeriod(from, to)) return {status: 400 as const}
  const db = await serverSupabase()
  const {data: {user}} = await db.auth.getUser()
  if (!user) return {status: 401 as const}
  const {data, error} = await db.rpc('leave_report', {p_from: from, p_to: to})
  if (error) return {status: error.code === '42501' ? 403 as const : error.code === '22023' ? 400 as const : 503 as const}
  if (!data) return {status: 503 as const}
  return {status: 200 as const, report: data as LeaveReport}
}

const displayDate = (value: string) => value.slice(8, 10) + '/' + value.slice(5, 7) + '/' + value.slice(0, 4)

// Text that a spreadsheet could read as a formula is stored as plain text.
const safeCell = (value: Cell): Cell => typeof value === 'string' && /^[\s]*[=+@\-\t\r]/.test(value) ? "'" + value : value

export async function leaveReportWorkbook(report: LeaveReport, filter: ReportFilter): Promise<ArrayBuffer> {
  const filtered = applyFilter(report, filter)
  const workbook = new ExcelJS.Workbook()
  workbook.created = new Date()
  const period = 'Period: ' + displayDate(report.from) + ' to ' + displayDate(report.to)
  const add = (name: string, title: string, columns: readonly string[], rows: Cell[][], numeric: number[]) => {
    const sheet = workbook.addWorksheet(name, {views: [{state: 'frozen', ySplit: 4}]})
    sheet.addRow(['Bandana · ' + title]).font = {bold: true, size: 14}
    sheet.addRow([period + ' · Generated ' + new Date().toLocaleString('en-GB', {timeZone: 'Asia/Karachi'}) + ' PKT'])
    sheet.addRow([])
    sheet.addRow([...columns]).font = {bold: true}
    for (const row of rows) sheet.addRow(row.map(safeCell))
    columns.forEach((column, index) => {
      const width = Math.max(column.length, ...rows.map(row => String(row[index] ?? '').length))
      sheet.getColumn(index + 1).width = Math.min(48, Math.max(10, width + 2))
      if (numeric.includes(index)) sheet.getColumn(index + 1).numFmt = '0.00'
    })
    sheet.autoFilter = {from: {row: 4, column: 1}, to: {row: 4, column: columns.length}}
  }
  add('Leave Summary', 'Leave Summary Report', summaryColumns, filtered.summary.map(summaryCells), [6, 7, 8, 9, 10, 11, 12])
  add('Leave Requests', 'Leave Requests in Period', detailColumns, filtered.detail.map(detailCells), [8, 9])
  return await workbook.xlsx.writeBuffer() as ArrayBuffer
}
