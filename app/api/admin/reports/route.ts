import {NextResponse} from 'next/server'
import {adminReports} from '../../../../lib/admin-report-server'
export const dynamic='force-dynamic'
export async function GET(){const result=await adminReports();return NextResponse.json(result.status===200?{data:result.data,generatedAt:result.generatedAt}:{error:result.status===401?'Sign in required':result.status===403?'HR administrator access required':'Reports unavailable'},{status:result.status,headers:{'Cache-Control':'private, no-store','Vary':'Cookie'}})}
