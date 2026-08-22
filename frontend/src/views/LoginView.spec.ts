import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { nextTick } from 'vue'
import LoginView from './LoginView.vue'

describe('LoginView', () => {
  it('shows field-level validation before submitting an empty form', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/login', component: LoginView },
        { path: '/organization', component: { template: '<div>organization</div>' } },
      ],
    })
    await router.push('/login')
    await router.isReady()

    const wrapper = mount(LoginView, { global: { plugins: [router] }, attachTo: document.body })
    await wrapper.get('button.login-submit').trigger('click')
    await flushPromises()
    await nextTick()

    expect(wrapper.findAll('.el-form-item.is-error')).toHaveLength(2)
    expect(wrapper.get('input[autocomplete="username"]').attributes('placeholder')).toBe('请输入系统用户名')

    wrapper.unmount()
  })
})
