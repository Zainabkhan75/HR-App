const profileDateFields=new Set([
 'date_of_birth','date_of_joining','leaving_date','previous_employment_start',
 'previous_employment_end','education_start','education_end','offer_date',
 'acceptance_joining_confirmation_due',
])
export const isProfileDateField=(key:string)=>profileDateFields.has(key)

export function isIsoDate(value:string){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false
 const date=new Date(value+'T00:00:00Z')
 return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value
}

export function displayShortDate(value:string|null|undefined){
 if(!value)return ''
 if(isIsoDate(value))return value.slice(8,10)+'/'+value.slice(5,7)+'/'+value.slice(2,4)
 const legacy=value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
 if(legacy)return legacy[1].padStart(2,'0')+'/'+legacy[2].padStart(2,'0')+'/'+legacy[3].slice(2)
 return value
}

export function parseShortDate(value:string,referenceYear?:number){
 const parts=value.match(/^(\d{2})\/(\d{2})\/(\d{2})$/)
 if(!parts)return null
 const year=Number(parts[3])
 const fullYear=referenceYear!==undefined&&referenceYear%100===year?referenceYear:year+(year<50?2000:1900)
 const iso=fullYear+'-'+parts[2]+'-'+parts[1]
 return isIsoDate(iso)?iso:null
}

export function parseDateInput(value:string,referenceYear?:number){
 const full=value.match(/^(\d{2})\/(\d{2})\/((?:19|20)\d{2})$/)
 if(!full)return parseShortDate(value,referenceYear)
 const iso=`${full[3]}-${full[2]}-${full[1]}`
 return isIsoDate(iso)?iso:null
}
