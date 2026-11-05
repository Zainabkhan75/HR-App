'use client'

import {useState} from 'react'
import {formatMoney, moneyInputValue} from '../lib/money'

export default function MoneyInput({value, onChange}: {value: string; onChange: (value: string) => void}) {
 const [focused, setFocused] = useState(false)
 return <input
  type="text"
  inputMode="decimal"
  value={focused ? moneyInputValue(value) : formatMoney(value)}
  onFocus={() => setFocused(true)}
  onBlur={() => setFocused(false)}
  onChange={event => onChange(moneyInputValue(event.target.value))}
 />
}
