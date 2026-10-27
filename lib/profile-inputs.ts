export const dropdownKeys=['department','location','reports_to_text','employment_type','work_location_mobility'] as const
export type DropdownKey=typeof dropdownKeys[number]
export type ProfileOptions=Record<DropdownKey,string[]>
export const isDropdown=(key:string):key is DropdownKey=>dropdownKeys.some(value=>value===key)
export function employmentChoice(draft:Record<string,string>,value:string):Record<string,string>{
 return {...draft,employment_type:value,probation:value==='Permanent'?'3':draft.employment_type==='Permanent'?'':draft.probation}
}
export function validJoiningDate(value:string):boolean{
 if(value==='')return true
 const match=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value)
 if(!match)return false
 const day=Number(match[1]),month=Number(match[2]),year=Number(match[3])
 if(year<1||month<1||month>12||day<1)return false
 const leap=year%4===0&&(year%100!==0||year%400===0)
 return day<=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31][month-1]
}
export function validProbation(value:string):boolean{return value===''||/^[0-6]$/.test(value)}
export const selectChoices=(values:readonly string[],current:string):string[]=>Array.from(new Set([...values,...(current&&!values.includes(current)?[current]:[])]))

export function reportingTitle(value:string):string{
 const clean=value.replace(/\s*\([^)]*\)/g,'').trim()
 const pieces=clean.split(' - ')
 if(pieces.length<2)return clean
 return clean.startsWith('Store Manager,')?pieces[0].trim():pieces.slice(1).join(' - ').trim()
}
