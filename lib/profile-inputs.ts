import {isIsoDate,parseDateInput} from './date-input'

export const paymentMethods=['Bank Account','Other']
export const qualificationLevels=['Matric','Intermediate','Diploma','Bachelor’s','Master’s','Other'] as const
export const dropdownKeys=['department','location','reports_to_text','employment_type','work_location_mobility'] as const
export type DropdownKey=typeof dropdownKeys[number]
export type LineManagerOption={designation:string;employee_no:string;name:string;location:string|null}
export type DepartmentDesignation={id:number;department_id:number;department:string;title:string}
export type ProfileOptions=Record<DropdownKey,string[]>&{
 line_managers?:LineManagerOption[]
 department_designations?:DepartmentDesignation[]
 department_options?:{id:number;name:string}[]
}
export function designationTitles(options:ProfileOptions|null,department:string):string[]{
 if(!options?.department_designations)return options?.reports_to_text??[]
 return options.department_designations.filter(item=>item.department.toLowerCase()===department.trim().toLowerCase()).map(item=>item.title)
}
export function departmentNames(options:ProfileOptions|null):string[]{
 return options?.department_options?.map(item=>item.name)??options?.department??[]
}
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
export function confirmationDate(joiningDate:string,probation:string):string{
 const normalized=joiningDate.trim().replace(/^(\d{1,2})\/(\d{1,2})\//,(_,day:string,month:string)=>day.padStart(2,'0')+'/'+month.padStart(2,'0')+'/')
 const joining=isIsoDate(normalized)?normalized:parseDateInput(normalized)
 if(!joining||!/^[0-6]$/.test(probation))return ''
 const [year,month,day]=joining.split('-').map(Number)
 const target=new Date(Date.UTC(year,month-1+Number(probation),1))
 const lastDay=new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth()+1,0)).getUTCDate()
 target.setUTCDate(Math.min(day,lastDay))
 return target.toISOString().slice(0,10)
}
