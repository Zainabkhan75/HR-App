'use client'

type Props={titles:readonly string[]|null;value:string;onChange:(title:string)=>void;disabled?:boolean}

export default function DesignationSelect({titles,value,onChange,disabled}:Props){
 const legacy=!!value&&(!titles||!titles.includes(value))
 return <select value={value} disabled={disabled||titles===null} onChange={event=>onChange(event.target.value)}>
  <option value="">{titles?'Select a designation':'Loading designations…'}</option>
  {legacy&&<option value={value} disabled>{value} (previously recorded)</option>}
  {titles?.map(title=><option key={title} value={title}>{title}</option>)}
 </select>
}
