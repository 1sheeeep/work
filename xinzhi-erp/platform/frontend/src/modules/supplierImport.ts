import type { SupplierCreateInput } from './supplierApi'

const headers = [
  'businessCode', 'name', 'contactName', 'contactPhone', 'contactEmail',
  'address', 'taxRegistrationNumber', 'settlementCurrency',
  'paymentTermsDays', 'notes',
] as const

export const supplierCsvTemplate = `${headers.join(',')}\r\n`

export type SupplierImportError = { row: number; field: string; message: string }
export type SupplierImportResult = { items: SupplierCreateInput[]; errors: SupplierImportError[] }

function rows(input: string) {
  const result: string[][] = []
  let current: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < input.length; index += 1) {
    const value = input[index]
    if (quoted) {
      if (value === '"' && input[index + 1] === '"') { cell += '"'; index += 1 }
      else if (value === '"') quoted = false
      else cell += value
    } else if (value === '"') quoted = true
    else if (value === ',') { current.push(cell); cell = '' }
    else if (value === '\n') { current.push(cell.replace(/\r$/, '')); result.push(current); current = []; cell = '' }
    else cell += value
  }
  if (quoted) throw new Error('CSV 中存在未闭合的引号。')
  current.push(cell.replace(/\r$/, ''))
  if (current.some(Boolean)) result.push(current)
  return result
}

function nullable(value: string | undefined) { return value?.trim() || null }

export function parseSupplierCsv(input: string): SupplierImportResult {
  if (input.length > 1024 * 1024) return { items: [], errors: [{ row: 0, field: 'file', message: '文件不能超过 1 MB。' }] }
  let parsed: string[][]
  try { parsed = rows(input) } catch (cause) {
    return { items: [], errors: [{ row: 0, field: 'file', message: cause instanceof Error ? cause.message : 'CSV 格式无法识别。' }] }
  }
  if (parsed.length < 2) return { items: [], errors: [{ row: 0, field: 'file', message: '文件必须包含表头和至少一行供应商。' }] }
  const actual = parsed[0].map((value, index) => (index === 0 ? value.replace(/^\uFEFF/, '') : value).trim())
  if (actual.length !== headers.length || actual.some((value, index) => value !== headers[index])) {
    return { items: [], errors: [{ row: 1, field: 'header', message: '表头不符合模板，请重新下载模板。' }] }
  }
  if (parsed.length - 1 > 200) return { items: [], errors: [{ row: 0, field: 'file', message: '单次最多导入 200 家供应商。' }] }

  const items: SupplierCreateInput[] = []
  const errors: SupplierImportError[] = []
  const codes = new Set<string>()
  parsed.slice(1).forEach((values, index) => {
    const row = index + 2
    const businessCode = (values[0] ?? '').trim().toUpperCase()
    const name = (values[1] ?? '').trim()
    const contactEmail = nullable(values[4])?.toLowerCase() ?? null
    const currency = nullable(values[7])?.toUpperCase() ?? null
    const termsText = nullable(values[8])
    const paymentTermsDays = termsText === null ? null : Number(termsText)
    let valid = true
    if (!/^[A-Z][A-Z0-9_-]{1,63}$/.test(businessCode)) { errors.push({ row, field: 'businessCode', message: '编码需为 2–64 位大写字母、数字、下划线或连字符。' }); valid = false }
    else if (codes.has(businessCode)) { errors.push({ row, field: 'businessCode', message: '文件内供应商编码不能重复。' }); valid = false }
    if (!name || name.length > 200) { errors.push({ row, field: 'name', message: '名称必填且不能超过 200 字。' }); valid = false }
    if (contactEmail && (contactEmail.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(contactEmail))) { errors.push({ row, field: 'contactEmail', message: '邮箱格式无效。' }); valid = false }
    if (currency && !/^[A-Z]{3}$/.test(currency)) { errors.push({ row, field: 'settlementCurrency', message: '币种需为 3 位大写字母。' }); valid = false }
    if (paymentTermsDays !== null && (!Number.isSafeInteger(paymentTermsDays) || paymentTermsDays < 0 || paymentTermsDays > 3650)) { errors.push({ row, field: 'paymentTermsDays', message: '账期天数需为 0–3650 的整数。' }); valid = false }
    const bounded: Array<[string, string | null, number]> = [
      ['contactName', nullable(values[2]), 120], ['contactPhone', nullable(values[3]), 40],
      ['address', nullable(values[5]), 500], ['taxRegistrationNumber', nullable(values[6]), 120],
      ['notes', nullable(values[9]), 2000],
    ]
    bounded.forEach(([field, value, maximum]) => { if (value && value.length > maximum) { errors.push({ row, field, message: `内容不能超过 ${maximum} 字。` }); valid = false } })
    codes.add(businessCode)
    if (valid) items.push({ businessCode, name, contactName: nullable(values[2]), contactPhone: nullable(values[3]), contactEmail, address: nullable(values[5]), taxRegistrationNumber: nullable(values[6]), settlementCurrency: currency, paymentTermsDays, notes: nullable(values[9]) })
  })
  return { items, errors }
}

export function supplierExportCsv(items: SupplierCreateInput[]) {
  const quote = (value: string | number | null) => {
    const text = value === null ? '' : String(value)
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  return [headers.join(','), ...items.map((item) => headers.map((key) => quote(item[key])).join(','))].join('\r\n') + '\r\n'
}
