import { describe, expect, it } from 'vitest'
import { parseSupplierCsv, supplierExportCsv } from './supplierImport'

describe('supplier CSV import', () => {
  it('normalizes supplier master data and preserves quoted values', () => {
    const result = parseSupplierCsv([
      'businessCode,name,contactName,contactPhone,contactEmail,address,taxRegistrationNumber,settlementCurrency,paymentTermsDays,notes',
      ' sup_north ,"North, Factory",Alice,123,ALICE@EXAMPLE.COM,Shanghai,TAX-01,cny,30,"stable, preferred"',
    ].join('\r\n'))
    expect(result.errors).toEqual([])
    expect(result.items).toEqual([expect.objectContaining({ businessCode: 'SUP_NORTH', name: 'North, Factory', contactEmail: 'alice@example.com', settlementCurrency: 'CNY', paymentTermsDays: 30, notes: 'stable, preferred' })])
    expect(supplierExportCsv(result.items)).toContain('"North, Factory"')
  })

  it('fails closed on duplicate codes and changed templates', () => {
    const header = 'businessCode,name,contactName,contactPhone,contactEmail,address,taxRegistrationNumber,settlementCurrency,paymentTermsDays,notes'
    expect(parseSupplierCsv(`${header}\nSUP_ONE,One,,,,,,,,\nSUP_ONE,Two,,,,,,,,`).errors[0]).toMatchObject({ row: 3, field: 'businessCode' })
    expect(parseSupplierCsv('name,businessCode\nOne,SUP_ONE').errors[0]).toMatchObject({ row: 1, field: 'header' })
  })
})
