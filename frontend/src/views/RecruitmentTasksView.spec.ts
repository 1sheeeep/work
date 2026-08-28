import { flushPromises, mount } from '@vue/test-utils'
import { api } from '../services/api'
import RecruitmentTasksView from './RecruitmentTasksView.vue'

vi.mock('../services/api',()=>({api:{get:vi.fn()},apiErrorMessage:(_e:unknown,f:string)=>f,apiFieldErrors:()=>({}),ensureCsrf:vi.fn()}))
vi.mock('../stores/auth',()=>({authStore:{state:{user:{id:'admin',username:'admin',displayName:'系统管理员',role:'SYSTEM_ADMIN'}}}}))

describe('RecruitmentTasksView',()=>{
  it('requires an active job and task name before creating a draft',async()=>{
    vi.mocked(api.get).mockResolvedValueOnce({data:[]}).mockResolvedValueOnce({data:[]}).mockResolvedValueOnce({data:[]})
    const wrapper=mount(RecruitmentTasksView,{attachTo:document.body});await flushPromises()
    await wrapper.findAll('button').find(b=>b.text().includes('新增任务'))?.trigger('click');await flushPromises()
    const dialog=wrapper.get('.el-dialog');await dialog.findAll('button').find(b=>b.text().includes('创建草稿'))?.trigger('click');await flushPromises()
    expect(dialog.findAll('.el-form-item.is-error')).toHaveLength(2)
    expect(api.get).toHaveBeenCalledWith('/recruitment-tasks',expect.any(Object))
    wrapper.unmount()
  })
})
