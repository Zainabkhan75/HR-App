'use client'
import {useState} from 'react'
import {isIsoDate,parseDateInput} from '../lib/date-input'

type Props={value:string;onChange:(value:string)=>void;required?:boolean;disabled?:boolean;min?:string;max?:string;referenceYear?:number;birthDate?:boolean}

export default function DateInput({value,onChange,required,disabled,min,max,referenceYear,birthDate}:Props){
 const [typedDate,setTypedDate]=useState<string|null>(null)
 const today=new Date().toISOString().slice(0,10)
 const upperBound=max??(birthDate?today:undefined)
 const inRange=(date:string)=>(!min||date>=min)&&(!upperBound||date<=upperBound)
 const invalidDateMessage=birthDate?'Enter a valid date of birth on or before today. Use DD/MM/YYYY for the exact year.':'Enter a valid date in DD/MM/YY or DD/MM/YYYY within the allowed range.'
 const displayValue=isIsoDate(value)?value.split('-').reverse().join('/'):value
 return <input type="text" inputMode="numeric" placeholder="DD/MM/YYYY" title="DD/MM/YY or DD/MM/YYYY"
  required={required} disabled={disabled} value={typedDate??displayValue}
  onBlur={()=>setTypedDate(null)}
  onChange={event=>{
   const input=event.currentTarget
   const raw=input.value
   const digits=raw.replace(/\D/g,'')
   if(digits.length>8||/[^\d/]/.test(raw)){
    input.setCustomValidity('Enter the date as DD/MM/YY or DD/MM/YYYY.')
    setTypedDate(raw)
    onChange(raw)
    return
   }
   const typed=[digits.slice(0,2),digits.slice(2,4),digits.slice(4,8)].filter(Boolean).join('/')
   setTypedDate(typed)
   const legacyYear=value.match(/\/([0-9]{4})$/)?.[1]
   const originalYear=isIsoDate(value)?Number(value.slice(0,4)):legacyYear?Number(legacyYear):referenceYear
   const currentYear=Number(today.slice(0,4))
   const shortYear=Number(digits.slice(4,6))
   let birthYear=Math.floor(currentYear/100)*100+shortYear
   if(birthYear>currentYear)birthYear-=100
   const yearHint=originalYear!==undefined&&originalYear%100===shortYear?originalYear:birthDate?birthYear:referenceYear
   const parsed=parseDateInput(typed,yearHint)
   const valid=parsed&&inRange(parsed)
   input.setCustomValidity(!typed||valid?'':invalidDateMessage)
   onChange(parsed&&valid?parsed:typed)
  }}
  ref={input=>{if(!value||isIsoDate(value))input?.setCustomValidity(!value||inRange(value)?'':invalidDateMessage)}}
 />
}
