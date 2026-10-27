export function validLoginEmail(value:unknown):value is string{
 return typeof value==='string'&&value.trim().length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}
