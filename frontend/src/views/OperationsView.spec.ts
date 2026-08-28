import { flushPromises,mount } from '@vue/test-utils'
import { api } from '../services/api'
import OperationsView from './OperationsView.vue'

vi.mock('../services/api',()=>({api:{get:vi.fn()},apiErrorMessage:(_e:unknown,f:string)=>f}))

describe('OperationsView',()=>{
  it('shows migration, append-only audit and gateway state',async()=>{
    vi.mocked(api.get).mockResolvedValue({data:{status:'READY',flywayVersion:'8',auditAppendOnly:true,checkedAt:'2026-08-28T08:00:00Z',gateways:[{operation:'boss.inspect',consecutiveFailures:0,requestsInWindow:2,availablePermits:8}]}})
    const wrapper=mount(OperationsView);await flushPromises()
    expect(wrapper.text()).toContain('READY')
    expect(wrapper.text()).toContain('V8')
    expect(wrapper.text()).toContain('只追加')
    expect(wrapper.text()).toContain('boss.inspect')
  })
})
