import type { Money, MoneyBag } from './contracts'

export function dateTime(value?: string) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(date)
}

export function money(value?: Money | MoneyBag) {
  const selected = value && 'presentmentMoney' in value ? value.presentmentMoney : value
  if (!selected) return '—'
  try {
    return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: selected.currencyCode }).format(Number(selected.amount))
  } catch {
    return `${selected.amount} ${selected.currencyCode}`
  }
}

export function commandKey(prefix: string, identity: string) {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `${prefix}.${identity.split('/').at(-1) ?? 'item'}.${random}`.slice(0, 100)
}

export function errorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : '操作暂时无法完成，请稍后重试。'
}
