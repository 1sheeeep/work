import { flushPromises, mount } from '@vue/test-utils'
import { api } from '../services/api'
import CandidatesView from './CandidatesView.vue'

vi.mock('../services/api',()=>({api:{get:vi.fn(),post:vi.fn()},apiErrorMessage:(_e:unknown,f:string)=>f,apiFieldErrors:()=>({}),ensureCsrf:vi.fn()}))
vi.mock('../stores/auth',()=>({authStore:{state:{user:{id:'admin',username:'admin',displayName:'系统管理员',role:'SYSTEM_ADMIN'}}}}))

describe('CandidatesView',()=>{
  it('does not expose legacy manual candidate creation',async()=>{
    vi.mocked(api.get).mockResolvedValueOnce({data:[]}).mockResolvedValueOnce({data:[]})
    const wrapper=mount(CandidatesView,{attachTo:document.body});await flushPromises()
    expect(wrapper.find('.el-dialog').exists()).toBe(false)
    expect(wrapper.text()).toContain('不能在前端手工造数据')
    expect(api.post).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('shows clear queues, candidate inbox and selected summary',async()=>{
    vi.mocked(api.get).mockReset().mockResolvedValueOnce({data:[{id:'candidate-1',displayName:'张同学',currentTitle:'Java 开发',sourceReference:'BOSS',status:'SCREENING',humanTakenOver:false,privacyStatus:'ACTIVE',yearsExperience:3,education:'本科',updatedAt:'2026-08-29T06:00:00Z',latestMessageAt:'2026-08-29T06:00:00Z',latestMessagePreview:'您好，请问职位还在招聘吗？',latestMessageDirection:'INBOUND',needsHrFollowUp:true,pendingReviewDraft:false,jobPosition:{id:'job-1',title:'Java 工程师'},bossAccount:{id:'boss-1',displayName:'BOSS 上海账号'},company:{id:'company-1',name:'测试企业'}}]}).mockResolvedValueOnce({data:[]})
    const wrapper=mount(CandidatesView);await flushPromises()
    expect(wrapper.text()).toContain('快捷分类')
    expect(wrapper.text()).toContain('待 HR 跟进')
    expect(wrapper.text()).toContain('您好，请问职位还在招聘吗？')
    expect(wrapper.text()).toContain('应聘信息')
    expect(wrapper.text()).toContain('张同学')
  })
})
