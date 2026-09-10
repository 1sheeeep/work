import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {matchingRuleApi} from '../modules/matchingRuleApi'
import {logisticsAuthorizationApi} from '../modules/logisticsAuthorizationApi'
import {LogisticsMatchingRulesPage,parseLogisticsMatchingRulesQuery,toLogisticsMatchingRulesUrl} from './LogisticsMatchingRulesPage'
const runtime=vi.hoisted(()=>({search:'',push:vi.fn()}))
vi.mock('@tanstack/react-router',()=>({useRouter:()=>({history:{push:runtime.push}}),useRouterState:({select}:{select:(s:unknown)=>unknown})=>select({location:{searchStr:runtime.search}})}))
vi.mock('../auth/AuthContext',()=>({useAuth:()=>({hasPermission:(p:string)=>p==='logistics.matching_rule.write'})}))
vi.mock('../modules/matchingRuleApi',()=>({matchingRuleApi:{list:vi.fn(),create:vi.fn(),archive:vi.fn()}}))
vi.mock('../modules/logisticsAuthorizationApi',()=>({logisticsAuthorizationApi:{listEnabledChannels:vi.fn()}}))
const rule={id:'11111111-1111-4111-8111-111111111111',name:'UAT 美国小包',priority:10,platform:'Shopify',shop:undefined,channel:'UAT 标准渠道',warehouse:'UAT 仓',autoHandover:true,noHandoverStart:'22:00:00',noHandoverEnd:'06:00:00',note:undefined,status:'ACTIVE' as const,createdByDisplayName:'UAT ERP Tester',version:0,createdAt:'2026-08-10T00:00:00Z',updatedAt:'2026-08-10T00:00:00Z'}
const channel={id:'22222222-2222-4222-8222-222222222222',authorizationId:'33333333-3333-4333-8333-333333333333',providerCode:'BIAOJU' as const,providerName:'镖锔科技物流',accountLabel:'华南账号',accountStatus:'ACTIVE' as const,channelCode:'UAT 标准渠道',channelName:'UAT 标准渠道',enabled:true,providerAvailable:true,effectiveEnabled:true,version:0,lastSyncedAt:'2026-08-10T00:00:00Z',updatedAt:'2026-08-10T00:00:00Z'}
beforeEach(()=>{runtime.search='';runtime.push.mockReset();vi.mocked(matchingRuleApi.list).mockReset().mockResolvedValue({items:[rule],page:0,size:100,totalElements:1,totalPages:1});vi.mocked(matchingRuleApi.create).mockReset().mockResolvedValue(rule);vi.mocked(matchingRuleApi.archive).mockReset().mockResolvedValue({...rule,status:'ARCHIVED'});vi.mocked(logisticsAuthorizationApi.listEnabledChannels).mockReset().mockResolvedValue([channel])})
afterEach(cleanup)
describe('logistics matching rules',()=>{
 it('bounds query and serializes filters',()=>{expect(parseLogisticsMatchingRulesQuery('?status=BAD&autoHandover=MAYBE&updatedFrom=2026-99-99')).toEqual(expect.objectContaining({status:'ALL',autoHandover:'ALL',updatedFrom:''}));expect(toLogisticsMatchingRulesUrl({platform:' Shopify ',status:'ENABLED',autoHandover:'NO'})).toBe('/logistics/matching-rules?platform=Shopify&status=ENABLED&autoHandover=NO')})
 it('loads and creates a real rule',async()=>{render(<LogisticsMatchingRulesPage/>);expect(await screen.findByText('UAT 美国小包')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'新增物流匹配规则'}));const d=within(screen.getByRole('dialog',{name:'新增物流匹配规则'}));await d.findByRole('option',{name:'镖锔科技物流 / 华南账号 / UAT 标准渠道'});fireEvent.change(d.getByLabelText('规则名称'),{target:{value:' UAT 美国小包 '}});fireEvent.change(d.getByLabelText('物流渠道'),{target:{value:'UAT 标准渠道'}});fireEvent.submit(d.getByRole('button',{name:'保存规则'}).closest('form')!);await waitFor(()=>expect(matchingRuleApi.create).toHaveBeenCalledWith(expect.objectContaining({name:'UAT 美国小包',priority:100,channel:'UAT 标准渠道'})))})
})
