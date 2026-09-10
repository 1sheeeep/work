const BUSINESS_TIME_ZONE = 'Asia/Shanghai'
const BUSINESS_UTC_OFFSET = '+08:00'

export function businessDateText(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  )
  return `${values.year}-${values.month}-${values.day}`
}

export function businessDayStartInstant(value: string, nextDay = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const instant = new Date(`${value}T00:00:00.000${BUSINESS_UTC_OFFSET}`)
  if (Number.isNaN(instant.valueOf())) return undefined
  if (nextDay) instant.setUTCDate(instant.getUTCDate() + 1)
  return instant.toISOString()
}

export function businessDayEndInstant(value: string) {
  const nextDay = businessDayStartInstant(value, true)
  if (!nextDay) return undefined
  return new Date(new Date(nextDay).valueOf() - 1).toISOString()
}
