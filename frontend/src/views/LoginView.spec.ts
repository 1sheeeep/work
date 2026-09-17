import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { nextTick } from 'vue'
import LoginView from './LoginView.vue'

describe('LoginView', () => {
  it('shows field-level validation before submitting an empty form', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/login', name: 'login', component: LoginView },
        { path: '/hr-login', name: 'hr-login', component: LoginView },
        { path: '/dashboard', component: { template: '<div>dashboard</div>' } },
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

  it('explains the HR portal and keeps the alternate entry accessible', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/login', name: 'login', component: LoginView },
        { path: '/hr-login', name: 'hr-login', component: LoginView },
      ],
    })
    await router.push('/hr-login')
    await router.isReady()

    const wrapper = mount(LoginView, { global: { plugins: [router] } })

    expect(wrapper.get('#login-title').text()).toBe('HR 登录')
    expect(wrapper.get('.login-card__eyebrow').text()).toBe('招聘值守台')
    expect(wrapper.get('.login-options a').text()).toBe('切换到系统管理员登录')
    expect(wrapper.get('.login-options a').attributes('aria-label')).toBe('切换到系统管理员登录')
    expect(wrapper.get('.brand-description').text()).toContain('统一接待招聘消息')

    wrapper.unmount()
  })

  it('clears stale validation when switching between login portals', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/login', name: 'login', component: LoginView },
        { path: '/hr-login', name: 'hr-login', component: LoginView },
      ],
    })
    await router.push('/login')
    await router.isReady()

    const wrapper = mount(LoginView, { global: { plugins: [router] }, attachTo: document.body })
    await wrapper.get('button.login-submit').trigger('click')
    await flushPromises()
    await nextTick()
    expect(wrapper.findAll('.el-form-item.is-error')).toHaveLength(2)

    await router.push('/hr-login')
    await flushPromises()
    await nextTick()

    expect(wrapper.get('#login-title').text()).toBe('HR 登录')
    expect(wrapper.findAll('.el-form-item.is-error')).toHaveLength(0)

    wrapper.unmount()
  })
})
