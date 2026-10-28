import {NextResponse} from 'next/server'
import {uploadContext,readSnapshot} from '../../../../../lib/bulk-upload-server'
import {template} from '../../../../../lib/bulk-upload'

export const dynamic='force-dynamic'
export async function GET(){
 const ctx=await uploadContext()
 if(ctx.status!==200)return NextResponse.json({error:ctx.status===401?'Sign in required':'HR administrator access required'},{status:ctx.status,headers:{'Cache-Control':'private, no-store'}})
 try{const bytes=await template(await readSnapshot(ctx.db));return new NextResponse(new Uint8Array(bytes),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="Bandana_Employee_Bulk_Upload_Template.xlsx"','Cache-Control':'private, no-store'}})}
 catch{return NextResponse.json({error:'Could not create template'},{status:503,headers:{'Cache-Control':'private, no-store'}})}
}
