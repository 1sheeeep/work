import { flushPromises, mount } from '@vue/test-utils'
import { api } from '../services/api'
import InterviewsView from './InterviewsView.vue'

vi.mock('../services/api',()=>({api:{get:vi.fn(),post:vi.fn(),patch:vi.fn()},apiErrorMessage:(_e:unknown,f:string)=>f,ensureCsrf:vi.fn()}))

describe('InterviewsView',()=>{
  it('does not submit when no eligible candidate is selected',async()=>{
    vi.mocked(api.get).mockResolvedValueOnce({data:[]}).mockResolvedValueOnce({data:[]}).mockResolvedValueOnce({data:[]})
    const wrapper=mount(InterviewsView,{attachTo:document.body});await flushPromises()
    await wrapper.findAll('button').find(button=>button.text().includes('安排面试'))?.trigger('click');await flushPromises()
    const dialog=wrapper.get('.el-dialog')
    await dialog.findAll('button').find(button=>button.text().includes('创建面试安排'))?.trigger('click');await flushPromises()
    expect(dialog.text()).toContain('请选择候选人、填写时区并完整提供至少两个候选时间')
    expect(api.post).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
