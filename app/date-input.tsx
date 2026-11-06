'use client'
import {displayShortDate,isIsoDate,parseShortDate} from '../lib/date-input'

type Props={value:string;onChange:(value:string)=>void;required?:boolean;disabled?:boolean;min?:string;max?:string;referenceYear?:number;birthDate?:boolean}

export default function DateInput({value,onChange,required,disabled,min,max,referenceYear,birthDate}:Props){
 const upperBound=max??(birthDate?new Date().toISOString().slice(0,10):undefined)
 const inRange=(date:string)=>(!min||date>=min)&&(!upperBound||date<=upperBound)
 const invalidDateMessage='Enter a valid date in DD/MM/YY within the allowed range.'
 return <input type="text" inputMode="numeric" placeholder="DD/MM/YY" title="DD/MM/YY"
  required={required} disabled={disabled} value={displayShortDate(value)}
  onChange={event=>{
   const input=event.currentTarget
   const raw=input.value
   const digits=raw.replace(/\D/g,'')
   if(digits.length>6||/[^\d/]/.test(raw)){
    input.setCustomValidity('Enter the date as DD/MM/YY.')
    onChange(raw)
    return
   }
   const typed=[digits.slice(0,2),digits.slice(2,4),digits.slice(4,6)].filter(Boolean).join('/')
   const legacyYear=value.match(/\/([0-9]{4})$/)?.[1]
   const originalYear=isIsoDate(value)?Number(value.slice(0,4)):legacyYear?Number(legacyYear):referenceYear
   const today=new Date().toISOString().slice(0,10)
   const currentYear=Number(today.slice(0,4))
   let birthYear=Math.floor(currentYear/100)*100+Number(digits.slice(4,6))
   if(birthYear>currentYear)birthYear-=100
   const parsed=parseShortDate(typed,originalYear??(birthDate?birthYear:undefined))
   const valid=parsed&&inRange(parsed)
   input.setCustomValidity(!typed||valid?'':invalidDateMessage)
   onChange(parsed&&valid?parsed:typed)
  }}
  ref={input=>{if(!value||isIsoDate(value))input?.setCustomValidity(!value||inRange(value)?'':invalidDateMessage)}}
 />
}
