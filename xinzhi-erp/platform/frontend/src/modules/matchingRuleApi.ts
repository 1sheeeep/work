import { ApiError, apiClient } from '../api/client'

const BASE = '/api/v1/logistics/matching-rules'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export type MatchingRule = { id: string; name: string; priority: number; platform?: string; shop?: string; channel: string; warehouse?: string; autoHandover: boolean; noHandoverStart?: string; noHandoverEnd?: string; note?: string; status: 'ACTIVE' | 'ARCHIVED'; createdByDisplayName: string; version: number; createdAt: string; updatedAt: string }
export type MatchingRulePage = { items: MatchingRule[]; page: number; size: number; totalElements: number; totalPages: number }
export type MatchingRuleInput = { name: string; priority: number; platform?: string; shop?: string; channel: string; warehouse?: string; autoHandover: boolean; noHandoverStart?: string; noHandoverEnd?: string; note?: string }
export type MatchingRuleListInput = {
  platform?: string
  shop?: string
  channel?: string
  warehouse?: string
  status?: string
  autoHandover?: boolean
  priority?: number
  updatedFrom?: string
  updatedTo?: string
  name?: string
  page?: number
  size?: number
  signal?: AbortSignal
}
type Wire = Record<string, unknown>
function invalid(field: string): never { throw new ApiError('Invalid matching rule response', { status: 502, code: 'invalid_response', details: { field } }) }
function record(value: unknown, field: string): Wire { if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(field); return value as Wire }
function exact(value: Wire, fields: readonly string[], field: string) { if (Object.keys(value).some(key => !fields.includes(key)) || fields.some(key => !(key in value))) invalid(`${field}.shape`) }
function text(value: unknown, field: string) { if (typeof value !== 'string' || !value.trim()) invalid(field); return value }
function optional(value: unknown, field: string) { return value === null ? undefined : text(value, field) }
function integer(value: unknown, field: string) { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid(field); return value }
function parse(value: unknown): MatchingRule { const w = record(value, 'rule'); const expected = ['id','name','priority','platform','shop','channel','warehouse','autoHandover','noHandoverStart','noHandoverEnd','note','status','createdByDisplayName','version','createdAt','updatedAt']; if (Object.keys(w).some(k => !expected.includes(k)) || expected.some(k => !(k in w))) invalid('rule.shape'); const id=text(w.id,'rule.id'); if(!UUID.test(id)) invalid('rule.id'); if(typeof w.autoHandover!=='boolean') invalid('rule.autoHandover'); if(w.status!=='ACTIVE'&&w.status!=='ARCHIVED') invalid('rule.status'); const createdAt=text(w.createdAt,'rule.createdAt'); const updatedAt=text(w.updatedAt,'rule.updatedAt'); if(Number.isNaN(Date.parse(createdAt))||Number.isNaN(Date.parse(updatedAt))) invalid('rule.time'); return { id, name:text(w.name,'rule.name'), priority:integer(w.priority,'rule.priority'), platform:optional(w.platform,'rule.platform'), shop:optional(w.shop,'rule.shop'), channel:text(w.channel,'rule.channel'), warehouse:optional(w.warehouse,'rule.warehouse'), autoHandover:w.autoHandover, noHandoverStart:optional(w.noHandoverStart,'rule.noHandoverStart'), noHandoverEnd:optional(w.noHandoverEnd,'rule.noHandoverEnd'), note:optional(w.note,'rule.note'), status:w.status, createdByDisplayName:text(w.createdByDisplayName,'rule.createdByDisplayName'), version:integer(w.version,'rule.version'), createdAt, updatedAt } }
function page(value: unknown): MatchingRulePage { const w=record(value,'page'); exact(w,['items','page','size','totalElements','totalPages'],'page'); if(!Array.isArray(w.items)) invalid('page.items'); const result={items:w.items.map(parse),page:integer(w.page,'page.page'),size:integer(w.size,'page.size'),totalElements:integer(w.totalElements,'page.totalElements'),totalPages:integer(w.totalPages,'page.totalPages')}; if(result.size<1||result.items.length>result.size)invalid('page.size'); return result }
function requestId(){return `matching-rule.${crypto.randomUUID()}`}
export const matchingRuleApi = {
  async list(input: MatchingRuleListInput) { const p=new URLSearchParams(); for(const [key,value] of Object.entries(input)){if(key!=='signal'&&value!==undefined&&value!=='')p.set(key,String(value))} return page(await apiClient.request<unknown>(`${BASE}?${p}`,{signal:input.signal})) },
  async create(input: MatchingRuleInput){return parse(await apiClient.request<unknown>(BASE,{method:'POST',headers:{'X-Request-Id':requestId()},body:input}))},
  async archive(id:string,version:number){return parse(await apiClient.request<unknown>(`${BASE}/${id}/archive`,{method:'POST',headers:{'X-Request-Id':requestId()},body:{version}}))},
}
