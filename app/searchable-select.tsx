'use client'

import {Children,isValidElement,useEffect,useId,useRef,useState} from 'react'
import type {ChangeEvent,ReactNode,SelectHTMLAttributes} from 'react'
import {createPortal} from 'react-dom'

type Props=Omit<SelectHTMLAttributes<HTMLSelectElement>,'multiple'|'size'|'defaultValue'>&{value:string|number}
type Option={value:string;label:string;disabled:boolean}

function optionText(node:ReactNode):string{
 return Children.toArray(node).map(child=>isValidElement<{children?:ReactNode}>(child)?optionText(child.props.children):String(child)).join('')
}

export default function SearchableSelect({children,value,onChange,disabled,required,name,id,style,className,...props}:Props){
 const options=Children.toArray(children).filter(isValidElement).map(child=>{
  const option=child as React.ReactElement<{value?:string|number;children?:ReactNode;disabled?:boolean}>
  const label=optionText(option.props.children)
  return {value:String(option.props.value??label),label,disabled:!!option.props.disabled}
 }).sort((a,b)=>{
  if(a.value==='')return -1
  if(b.value==='')return 1
  const left=a.label.match(/^(?:DPT\s*|DP|DS|P)?(\d+)\b/i)
  const right=b.label.match(/^(?:DPT\s*|DP|DS|P)?(\d+)\b/i)
  return left&&right?Number(left[1])-Number(right[1]):a.label.localeCompare(b.label,undefined,{numeric:true,sensitivity:'base'})
 })
 const selected=options.find(option=>option.value===String(value))
 const placeholder=options.find(option=>option.value==='')?.label??'Search by ID or name'
 const [open,setOpen]=useState(false)
 const [query,setQuery]=useState('')
 const [index,setIndex]=useState(0)
 const [bounds,setBounds]=useState({top:0,left:0,width:0,maxHeight:240})
 const input=useRef<HTMLInputElement>(null)
 const active=useRef<HTMLDivElement>(null)
 const listId=useId()
 const tokens=query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean)
 const filtered=options.filter(option=>tokens.every(token=>(option.label+' '+option.value).toLocaleLowerCase().includes(token)))
 const enabled=filtered.filter(option=>!option.disabled)

 useEffect(()=>{
  input.current?.setCustomValidity(required&&!String(value)?'Please select an option from the list.':'')
 },[required,value])
 useEffect(()=>{
  if(!open)return
  const place=()=>{
   const rect=input.current?.getBoundingClientRect()
   if(!rect)return
   const room=window.innerHeight-rect.bottom
   const above=room<180&&rect.top>room
   const height=Math.min(240,Math.max(100,above?rect.top-8:room-8))
   setBounds({top:above?Math.max(8,rect.top-height):rect.bottom+2,left:rect.left,width:rect.width,maxHeight:height})
  }
  place()
  window.addEventListener('resize',place)
  window.addEventListener('scroll',place,true)
  return ()=>{window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true)}
 },[open])
 useEffect(()=>{active.current?.scrollIntoView({block:'nearest'})},[index,query,open])
 function choose(option:Option){
  if(option.disabled)return
  onChange?.({target:{value:option.value},currentTarget:{value:option.value}} as ChangeEvent<HTMLSelectElement>)
  setOpen(false);setQuery('')
 }
 function show(){
  setQuery('');setIndex(Math.max(0,options.filter(option=>!option.disabled).findIndex(option=>option.value===String(value))));setOpen(true)
 }
 return <span style={{display:'inline-block',width:'100%',minWidth:0,...style}} className={className}>
  {name&&<input type="hidden" name={name} value={value} disabled={disabled}/>}
  <input ref={input} id={id} role="combobox" aria-label={props['aria-label']} aria-labelledby={props['aria-labelledby']}
   aria-autocomplete="list" aria-expanded={open&&!disabled} aria-controls={open?listId:undefined}
   aria-activedescendant={open&&enabled[index]?listId+'-'+filtered.indexOf(enabled[index]):undefined}
   autoComplete="off" disabled={disabled} required={required} placeholder={placeholder}
   value={open?query:selected?.label??''} style={{width:'100%',boxSizing:'border-box'}}
   onFocus={show} onClick={()=>{if(!open)show()}} onBlur={()=>{setOpen(false);setQuery('')}}
   onChange={event=>{setQuery(event.target.value);setIndex(0);setOpen(true)}}
   onKeyDown={event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setOpen(false);setQuery('')}
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
     event.preventDefault()
     if(!open){show();return}
     setIndex(old=>Math.max(0,Math.min(enabled.length-1,old+(event.key==='ArrowDown'?1:-1))))
    }
    if(open&&event.key==='Home'){event.preventDefault();setIndex(0)}
    if(open&&event.key==='End'){event.preventDefault();setIndex(Math.max(0,enabled.length-1))}
    if(event.key==='Enter'){event.preventDefault();if(open&&enabled[index])choose(enabled[index]);else if(!open)show()}
   }}/>
  {open&&!disabled&&createPortal(<div id={listId} role="listbox" aria-label={props['aria-label']??'Options'}
   style={{position:'fixed',zIndex:10000,...bounds,overflowY:'auto',background:'#fff',color:'#152b3b',border:'1px solid #94a3b8',borderRadius:6,boxShadow:'0 4px 12px #0002'}}>
   {filtered.map((option,i)=><div key={option.value} id={listId+'-'+i} role="option" aria-selected={option.value===String(value)}
    aria-disabled={option.disabled} ref={option===enabled[index]?active:undefined}
    onMouseDown={event=>event.preventDefault()} onClick={()=>choose(option)}
    onMouseMove={()=>{if(!option.disabled)setIndex(enabled.indexOf(option))}}
    style={{padding:'9px 12px',cursor:option.disabled?'default':'pointer',opacity:option.disabled?.55:1,background:option===enabled[index]?'#e5eef5':'#fff'}}>
    {option.label}
   </div>)}
   {!filtered.length&&<div role="status" style={{padding:12}}>No matching options</div>}
  </div>,document.body)}
 </span>
}
