export type CustomerServiceShop = {
  id: string
  displayName: string
}

export type Money = { amount: string; currencyCode: string }
export type MoneyBag = { shopMoney: Money; presentmentMoney: Money }
export type PageInfo = { hasNextPage: boolean; endCursor?: string }

export type ReturnDuty = { id: string; price: MoneyBag }
export type ReturnLine = {
  id: string
  fulfillmentLineId: string
  orderLineId: string
  name: string
  sku?: string
  quantity: number
  processableQuantity: number
  processedQuantity: number
  refundableQuantity: number
  refundedQuantity: number
  reasonHandle?: string
  reasonName?: string
  duties: ReturnDuty[]
}
export type ReturnItem = {
  id: string
  name: string
  orderId: string
  orderName: string
  status: 'CANCELED' | 'CLOSED' | 'DECLINED' | 'OPEN' | 'REQUESTED'
  createdAt: string
  closedAt?: string
  requestApprovedAt?: string
  totalQuantity: number
  lineItems: ReturnLine[]
}
export type ReturnCatalogPage = {
  state: 'NOT_CONFIGURED' | 'CONNECTED'
  returns: ReturnItem[]
  pageInfo: PageInfo
  fetchedAt?: string
}
export type ReturnRefundLineSelection = { returnLineId: string; quantity: number }
export type ReturnRefundDutySelection = { dutyId: string; refundType: 'FULL' | 'PROPORTIONAL' }
export type ReturnRefundSelection = {
  returnId: string
  lineItems: ReturnRefundLineSelection[]
  refundShipping: boolean
  refundDuties: ReturnRefundDutySelection[]
}
export type ReturnRefundPreview = ReturnRefundSelection & {
  state: 'REFUNDABLE' | 'NOT_REFUNDABLE'
  shippingAmount?: MoneyBag
  dutyAmount?: MoneyBag
  refundAmount: MoneyBag
  maximumRefundable: MoneyBag
  previewToken?: string
  expiresAt?: string
  fetchedAt: string
}
export type ReturnRefundProcessResult = {
  returnId: string
  returnStatus: string
  outcome: 'APPLIED' | 'PENDING' | 'REVIEW_REQUIRED'
  refundAmount: MoneyBag
  recoveredFromShopify: boolean
  updatedAt: string
}

export type Dispute = {
  id: string
  orderId?: string
  orderName?: string
  status: 'ACCEPTED' | 'LOST' | 'NEEDS_RESPONSE' | 'PREVENTED' | 'UNDER_REVIEW' | 'WON' | 'CHARGE_REFUNDED'
  type: 'CHARGEBACK' | 'INQUIRY'
  reason: string
  networkReasonCode?: string
  amount: Money
  initiatedAt: string
  evidenceDueBy?: string
  evidenceSentOn?: string
  finalizedOn?: string
}
export type DisputeCatalogPage = {
  state: 'NOT_CONFIGURED' | 'CONNECTED'
  disputes: Dispute[]
  pageInfo: PageInfo
  fetchedAt?: string
}

export type CustomerServiceApi = {
  listReturns(input: { shopId: string; limit: number; cursor?: string; query?: string }): Promise<ReturnCatalogPage>
  decideReturn(input: {
    shopId: string
    returnId: string
    decision: 'APPROVE' | 'DECLINE'
    declineReason?: 'FINAL_SALE' | 'OTHER' | 'RETURN_PERIOD_ENDED'
    declineNote?: string
    notifyCustomer: boolean
    idempotencyKey: string
  }): Promise<{ status: string; recoveredFromShopify: boolean; updatedAt: string }>
  previewReturnRefund(input: { shopId: string } & ReturnRefundSelection): Promise<ReturnRefundPreview>
  processReturnRefund(input: { shopId: string } & ReturnRefundSelection & {
    previewToken: string
    notifyCustomer: boolean
    idempotencyKey: string
  }): Promise<ReturnRefundProcessResult>
  listDisputes(input: { shopId: string; limit: number; cursor?: string }): Promise<DisputeCatalogPage>
}

export type CustomerServiceCapabilities = {
  manageReturns: boolean
  readDisputes: boolean
}
