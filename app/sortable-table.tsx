'use client'

import {useState} from 'react'

const collator = new Intl.Collator(undefined, {numeric: true, sensitivity: 'base'})
type SortValue = string | number | null | undefined

function numericValue(value: string | number) {
 return typeof value === 'number' || /^-?\d+(?:\.\d+)?$/.test(value) ? Number(value) : NaN
}

export function useTableSort(initialColumn?: string, initialAscending = true) {
 const [sort, setSort] = useState<{column: string; ascending: boolean} | null>(
  initialColumn ? {column: initialColumn, ascending: initialAscending} : null
 )

 function sortRows<Row>(rows: readonly Row[], valueFor: (row: Row, column: string) => SortValue): readonly Row[] {
  if (!sort) return rows
  return [...rows].sort((a, b) => {
   const left = valueFor(a, sort.column)
   const right = valueFor(b, sort.column)
   if (left == null || left === '') return right == null || right === '' ? 0 : 1
   if (right == null || right === '') return -1
   const leftNumber = numericValue(left)
   const rightNumber = numericValue(right)
   const comparison = Number.isFinite(leftNumber) && Number.isFinite(rightNumber)
    ? leftNumber - rightNumber
    : collator.compare(String(left), String(right))
   return sort.ascending ? comparison : -comparison
  })
 }

 function heading(column: string, label = column, onSort?: () => void) {
  const active = sort?.column === column
  return <th key={column} scope="col" aria-sort={active ? (sort.ascending ? 'ascending' : 'descending') : undefined}>
   <button type="button" className="sort-heading" onClick={() => {
    setSort(previous => ({column, ascending: previous?.column === column ? !previous.ascending : true}))
    onSort?.()
   }}>{label}<span aria-hidden="true">{active ? (sort.ascending ? '↑' : '↓') : '↕'}</span></button>
  </th>
 }

 return {sortRows, heading}
}
