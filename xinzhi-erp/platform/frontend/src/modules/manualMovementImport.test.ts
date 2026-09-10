import { describe, expect, it } from 'vitest'
import {
  manualMovementCsvTemplate,
  manualMovementExcelTemplate,
  parseManualMovementImportFile,
  parseManualMovementCsv,
} from './manualMovementImport'

const skuA = 'a4700000-0000-4000-8000-000000000001'
const skuB = 'a4700000-0000-4000-8000-000000000002'
const locationA = 'a4700000-0000-4000-8000-000000000003'

describe('manualMovementImport', () => {
  it('parses quoted CSV into validated temporary lines', () => {
    const result = parseManualMovementCsv(
      '\uFEFFskuId,locationId,quantity,note\r\n' +
        `${skuA},${locationA},3,"found, counted"\r\n`,
    )
    expect(result).toEqual({
      lines: [
        {
          skuId: skuA,
          locationId: locationA,
          quantity: 3,
          note: 'found, counted',
        },
      ],
      errors: [],
    })
    expect(manualMovementCsvTemplate).toBe(
      'skuId,locationId,quantity,unitPrice,currency,' +
        'extensionKey,extensionValue,note\r\n',
    )
  })

  it.each([
    ['missing header', `skuId,quantity\n${skuA},1`],
    ['unknown header', `skuId,locationId,quantity,secret\n${skuA},${locationA},1,x`],
    ['invalid sku', `skuId,locationId,quantity\nbad,${locationA},1`],
    ['invalid location', `skuId,locationId,quantity\n${skuA},bad,1`],
    ['zero quantity', `skuId,locationId,quantity\n${skuA},${locationA},0`],
    ['decimal quantity', `skuId,locationId,quantity\n${skuA},${locationA},1.5`],
    [
      'duplicate sku',
      `skuId,locationId,quantity\n${skuA},${locationA},1\n${skuA},${locationA},2`,
    ],
    [
      'long note',
      `skuId,locationId,quantity,note\n${skuB},${locationA},1,${'x'.repeat(301)}`,
    ],
    ['unclosed quote', `skuId,locationId,quantity\n"${skuA},${locationA},1`],
  ])('rejects %s without returning partial lines', (_label, csv) => {
    const result = parseManualMovementCsv(csv)
    expect(result.lines).toEqual([])
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('bounds file size and row count before any write', () => {
    expect(parseManualMovementCsv('x'.repeat(1_000_001)).errors[0].field)
      .toBe('file')
    const rows = Array.from(
      { length: 501 },
      (_, index) =>
        `${index.toString(16).padStart(8, '0')}-0000-4000-8000-000000000001,${locationA},1`,
    )
    const result = parseManualMovementCsv(
      `skuId,locationId,quantity\n${rows.join('\n')}`,
    )
    expect(result.lines).toEqual([])
    expect(result.errors[0].message).toContain('500')
  })

  it('downloads and parses the allowlisted Excel template format', () => {
    expect(manualMovementExcelTemplate).toContain(
      '<?mso-application progid="Excel.Sheet"?>',
    )
    const workbook = manualMovementExcelTemplate.replace(
      '</Table>',
      `<Row>
        <Cell><Data ss:Type="String">${skuA}</Data></Cell>
        <Cell><Data ss:Type="String">${locationA}</Data></Cell>
        <Cell><Data ss:Type="Number">2</Data></Cell>
        <Cell><Data ss:Type="Number">3.5</Data></Cell>
        <Cell><Data ss:Type="String">CNY</Data></Cell>
        <Cell><Data ss:Type="String">quality</Data></Cell>
        <Cell><Data ss:Type="String">A</Data></Cell>
        <Cell><Data ss:Type="String">safe</Data></Cell>
      </Row></Table>`,
    )
    expect(parseManualMovementImportFile('template.xls', workbook)).toEqual({
      lines: [
        {
          skuId: skuA,
          locationId: locationA,
          quantity: 2,
          unitPrice: 3.5,
          currency: 'CNY',
          extensionAttributes: { quality: 'A' },
          note: 'safe',
        },
      ],
      errors: [],
    })
  })

  it('rejects malformed Excel and unsafe pricing fields', () => {
    expect(
      parseManualMovementImportFile('template.xls', '<html>bad</html>')
        .errors[0].message,
    ).toBe('Excel 模板格式无法识别。')
    expect(
      parseManualMovementCsv(
        'skuId,locationId,quantity,unitPrice,currency\n' +
          `${skuA},${locationA},1,-1,usd`,
      ).errors.map((error) => error.field),
    ).toEqual(expect.arrayContaining(['unitPrice', 'currency']))
  })
})
