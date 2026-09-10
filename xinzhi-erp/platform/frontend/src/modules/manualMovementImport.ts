import type { ManualMovementLineInput } from './manualMovementApi'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const requiredHeaders = ['skuId', 'locationId', 'quantity'] as const
const allowedHeaders = new Set([
  ...requiredHeaders,
  'unitPrice',
  'currency',
  'extensionKey',
  'extensionValue',
  'note',
])

export type ManualMovementImportError = {
  row: number
  field: string
  message: string
}

export type ManualMovementImportResult = {
  lines: ManualMovementLineInput[]
  errors: ManualMovementImportError[]
}

export const manualMovementCsvTemplate =
  'skuId,locationId,quantity,unitPrice,currency,' +
  'extensionKey,extensionValue,note\r\n'

const spreadsheetHeaders = [
  'skuId',
  'locationId',
  'quantity',
  'unitPrice',
  'currency',
  'extensionKey',
  'extensionValue',
  'note',
]

export const manualMovementExcelTemplate =
  '<?xml version="1.0"?>' +
  '<?mso-application progid="Excel.Sheet"?>' +
  '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" ' +
  'xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">' +
  '<Worksheet ss:Name="Manual movement"><Table><Row>' +
  spreadsheetHeaders
    .map((header) => `<Cell><Data ss:Type="String">${header}</Data></Cell>`)
    .join('') +
  '</Row></Table></Worksheet></Workbook>'

function parseRows(input: string) {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        cell += '"'
        index += 1
      } else if (character === '"') {
        quoted = false
      } else {
        cell += character
      }
    } else if (character === '"') {
      quoted = true
    } else if (character === ',') {
      row.push(cell)
      cell = ''
    } else if (character === '\n') {
      row.push(cell.replace(/\r$/, ''))
      rows.push(row)
      row = []
      cell = ''
    } else {
      cell += character
    }
  }
  if (quoted) {
    throw new Error('CSV 中存在未闭合的引号。')
  }
  row.push(cell.replace(/\r$/, ''))
  if (row.some((value) => value !== '')) rows.push(row)
  return rows
}

export function parseManualMovementCsv(
  input: string,
): ManualMovementImportResult {
  if (input.length > 5 * 1024 * 1024) {
    return {
      lines: [],
      errors: [
        {
          row: 0,
          field: 'file',
          message: '文件超过 5 MB 限制。',
        },
      ],
    }
  }
  let rows: string[][]
  try {
    rows = parseRows(input)
  } catch (error) {
    return {
      lines: [],
      errors: [
        {
          row: 0,
          field: 'file',
          message:
            error instanceof Error
              ? error.message
              : 'CSV 格式无法识别。',
        },
      ],
    }
  }
  if (rows.length < 2) {
    return {
      lines: [],
      errors: [
        {
          row: 0,
          field: 'file',
          message: '文件必须包含表头和至少一行明细。',
        },
      ],
    }
  }
  const headers = rows[0].map((value, index) =>
    index === 0 ? value.replace(/^\uFEFF/, '').trim() : value.trim(),
  )
  const errors: ManualMovementImportError[] = []
  for (const header of headers) {
    if (!allowedHeaders.has(header)) {
      errors.push({
        row: 1,
        field: header || 'header',
        message: '存在不支持的列。',
      })
    }
  }
  for (const required of requiredHeaders) {
    if (!headers.includes(required)) {
      errors.push({
        row: 1,
        field: required,
        message: '缺少必填列。',
      })
    }
  }
  if (new Set(headers).size !== headers.length) {
    errors.push({
      row: 1,
      field: 'header',
      message: '表头不能重复。',
    })
  }
  if (errors.length > 0) return { lines: [], errors }
  if (rows.length - 1 > 500) {
    return {
      lines: [],
      errors: [
        {
          row: 0,
          field: 'file',
          message: '单次最多导入 500 行。',
        },
      ],
    }
  }
  const indexes = Object.fromEntries(
    headers.map((header, index) => [header, index]),
  ) as Record<string, number>
  const lines: ManualMovementLineInput[] = []
  const skuIds = new Set<string>()
  rows.slice(1).forEach((values, index) => {
    const rowNumber = index + 2
    const skuId = values[indexes.skuId]?.trim() ?? ''
    const locationId = values[indexes.locationId]?.trim() ?? ''
    const quantityText = values[indexes.quantity]?.trim() ?? ''
    const quantity = Number(quantityText)
    const unitPriceText = values[indexes.unitPrice]?.trim() ?? ''
    const unitPrice =
      unitPriceText === '' ? undefined : Number(unitPriceText)
    const currency = values[indexes.currency]?.trim() || undefined
    const extensionKey =
      values[indexes.extensionKey]?.trim() || undefined
    const extensionValue =
      values[indexes.extensionValue]?.trim() || undefined
    const note = values[indexes.note]?.trim() || undefined
    let valid = true
    if (!UUID_PATTERN.test(skuId)) {
      errors.push({
        row: rowNumber,
        field: 'skuId',
        message: 'SKU ID 必须是合法 UUID。',
      })
      valid = false
    } else if (skuIds.has(skuId.toLowerCase())) {
      errors.push({
        row: rowNumber,
        field: 'skuId',
        message: '同一 SKU 只能出现一次。',
      })
      valid = false
    }
    if (!UUID_PATTERN.test(locationId)) {
      errors.push({
        row: rowNumber,
        field: 'locationId',
        message: '库位 ID 必须是合法 UUID。',
      })
      valid = false
    }
    if (!Number.isSafeInteger(quantity) || quantity < 1) {
      errors.push({
        row: rowNumber,
        field: 'quantity',
        message: '数量必须是正整数。',
      })
      valid = false
    }
    if (note && note.length > 300) {
      errors.push({
        row: rowNumber,
        field: 'note',
        message: '行备注不能超过 300 个字符。',
      })
      valid = false
    }
    if (
      unitPrice !== undefined &&
      (!Number.isFinite(unitPrice) || unitPrice < 0)
    ) {
      errors.push({
        row: rowNumber,
        field: 'unitPrice',
        message: '单价必须是非负数。',
      })
      valid = false
    }
    if (currency && !/^[A-Z]{3}$/.test(currency)) {
      errors.push({
        row: rowNumber,
        field: 'currency',
        message: '币种必须是三个大写字母。',
      })
      valid = false
    }
    if ((extensionKey && !extensionValue) || (!extensionKey && extensionValue)) {
      errors.push({
        row: rowNumber,
        field: 'extensionKey',
        message: '扩展属性名称和值必须同时填写。',
      })
      valid = false
    }
    if (
      (extensionKey && extensionKey.length > 50) ||
      (extensionValue && extensionValue.length > 200)
    ) {
      errors.push({
        row: rowNumber,
        field: 'extensionKey',
        message: '扩展属性名称最多 50 字，值最多 200 字。',
      })
      valid = false
    }
    if (valid) {
      skuIds.add(skuId.toLowerCase())
      lines.push({
        skuId,
        locationId,
        quantity,
        unitPrice,
        currency: unitPrice === undefined ? undefined : currency ?? 'CNY',
        extensionAttributes:
          extensionKey && extensionValue
            ? { [extensionKey]: extensionValue }
            : undefined,
        note,
      })
    }
  })
  return { lines: errors.length === 0 ? lines : [], errors }
}

function decodeXml(value: string) {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')
}

function spreadsheetXmlToCsv(input: string) {
  const rows = [...input.matchAll(/<Row\b[^>]*>([\s\S]*?)<\/Row>/gi)]
  if (rows.length === 0) {
    throw new Error('Excel 模板格式无法识别。')
  }
  return rows
    .map((row) => {
      const cells = [
        ...row[1].matchAll(/<Data\b[^>]*>([\s\S]*?)<\/Data>/gi),
      ].map((cell) => decodeXml(cell[1].trim()))
      return cells
        .map((cell) => `"${cell.replaceAll('"', '""')}"`)
        .join(',')
    })
    .join('\r\n')
}

export function parseManualMovementImportFile(
  filename: string,
  input: string,
) {
  if (/\.(xls|xml)$/i.test(filename)) {
    try {
      return parseManualMovementCsv(spreadsheetXmlToCsv(input))
    } catch (error) {
      return {
        lines: [],
        errors: [
          {
            row: 0,
            field: 'file',
            message:
              error instanceof Error
                ? error.message
                : 'Excel 模板格式无法识别。',
          },
        ],
      }
    }
  }
  return parseManualMovementCsv(input)
}
