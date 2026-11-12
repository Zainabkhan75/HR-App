import {NextResponse} from 'next/server'
import {leaveReportWorkbook, loadLeaveReport} from '../../../../lib/leave-report-server'
import {cleanFilter} from '../../../../lib/leave-report'

export const dynamic = 'force-dynamic'
const headers = {'Cache-Control': 'private, no-store', 'Vary': 'Cookie'}
const messages: Record<number, string> = {
  400: 'Choose a valid period of up to three years',
  401: 'Sign in required',
  403: 'HR administrator access required',
  503: 'Leave report unavailable',
}

// Excel download of the leave summary report for the chosen period and filters.
export async function POST(request: Request) {
  let body: Record<string, unknown>
  try {
    const parsed: unknown = await request.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error('Invalid request')
    body = parsed as Record<string, unknown>
  } catch {
    return NextResponse.json({error: 'Invalid request'}, {status: 400, headers})
  }
  const from = typeof body.from === 'string' ? body.from : ''
  const to = typeof body.to === 'string' ? body.to : ''
  const result = await loadLeaveReport(from, to)
  if (result.status !== 200) return NextResponse.json({error: messages[result.status]}, {status: result.status, headers})
  try {
    const bytes = await leaveReportWorkbook(result.report, cleanFilter(body.filter))
    return new NextResponse(new Uint8Array(bytes), {headers: {
      ...headers,
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="Bandana_Leave_Summary_' + from + '_to_' + to + '.xlsx"',
    }})
  } catch {
    return NextResponse.json({error: messages[503]}, {status: 503, headers})
  }
}
