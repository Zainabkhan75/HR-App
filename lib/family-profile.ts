export type FamilyMember={full_name:string;age:number;pre_existing_conditions:string;cnic:string}
export type FamilyDetails={spouse:FamilyMember|null;children:FamilyMember[];updated_at:string|null}
export type MemberDraft={key:string;full_name:string;age:string;pre_existing_conditions:string;cnic:string}
export const memberDraft=(member?:FamilyMember):MemberDraft=>({key:crypto.randomUUID(),full_name:member?.full_name??'',age:member?String(member.age):'',pre_existing_conditions:member?.pre_existing_conditions??'',cnic:member?.cnic??''})
export function memberValue(draft:MemberDraft):FamilyMember{
 return {full_name:draft.full_name.trim(),age:Number(draft.age),pre_existing_conditions:draft.pre_existing_conditions.trim(),cnic:draft.cnic.replace(/[-\s]/g,'')}
}
export function memberError(draft:MemberDraft,isSpouse=false):string{
 if(!draft.full_name.trim())return 'Enter a name for each dependant.'
 if(draft.age.trim()===''||!Number.isInteger(Number(draft.age))||Number(draft.age)<0)return 'Enter age in whole years for each dependant.'
 const cnic=draft.cnic.replace(/[-\s]/g,'')
 if((isSpouse||Number(draft.age)>=18)&&!cnic)return 'CNIC is required for every spouse and children aged 18 or older.'
 if(cnic&&!/^[0-9]{13}$/.test(cnic))return 'CNIC must contain 13 digits, with or without hyphens.'
 return ''
}

export function familySnapshot(value:Pick<FamilyDetails,'spouse'|'children'>):string{
 const canonical=(person:FamilyMember)=>({full_name:person.full_name,age:person.age,pre_existing_conditions:person.pre_existing_conditions,cnic:person.cnic})
 return JSON.stringify({spouse:value.spouse?canonical(value.spouse):null,children:value.children.map(canonical)})
}
