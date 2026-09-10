import { describe, expect, it } from 'vitest'
import {
  businessDateText,
  businessDayEndInstant,
  businessDayStartInstant,
} from './businessTime'

describe('business time', () => {
  it('uses the Shanghai business date across the UTC midnight boundary', () => {
    expect(businessDateText(new Date('2026-08-09T23:30:00.000Z')))
      .toBe('2026-08-10')
  })

  it('converts a business date to its exact UTC query window', () => {
    expect(businessDayStartInstant('2026-08-10'))
      .toBe('2026-08-09T16:00:00.000Z')
    expect(businessDayStartInstant('2026-08-10', true))
      .toBe('2026-08-10T16:00:00.000Z')
    expect(businessDayEndInstant('2026-08-10'))
      .toBe('2026-08-10T15:59:59.999Z')
  })
})
