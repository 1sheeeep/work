import { flushPromises, mount } from '@vue/test-utils'
import { api } from '../services/api'
import CandidatesView from './CandidatesView.vue'

vi.mock('../services/api',()=>({api:{get:vi.fn(),post:vi.fn()},apiErrorMessage:(_e:unknown,f:string)=>f,apiFieldErrors:()=>({}),ensureCsrf:vi.fn()}))
vi.mock('../stores/auth',()=>({authStore:{state:{user:{id:'admin',username:'admin',displayName:'系统管理员',role:'SYSTEM_ADMIN'}}}}))

describe('CandidatesView',()=>{
  it('requires job, source id and candidate name before creating',async()=>{
    vi.mocked(api.get).mockResolvedValueOnce({data:[]}).mockResolvedValueOnce({data:[]}).mockResolvedValueOnce({data:[]})
    const wrapper=mount(CandidatesView,{attachTo:document.body});await flushPromises()
    await wrapper.findAll('button').find(button=>button.text().includes('新增候选人'))?.trigger('click');await flushPromises()
    const dialog=wrapper.get('.el-dialog')
    await dialog.findAll('button').find(button=>button.text().includes('加入工作台'))?.trigger('click');await flushPromises()
    expect(dialog.findAll('.el-form-item.is-error').length).toBeGreaterThanOrEqual(3)
    expect(api.post).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
