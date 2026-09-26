import router from './router'
import { authStore } from './stores/auth'

vi.mock('./stores/auth', () => ({
  authStore: {
    loadCurrentUser: vi.fn().mockResolvedValue({
      id: 'admin',
      displayName: '系统管理员',
      role: 'SYSTEM_ADMIN',
    }),
  },
}))

describe('router contract', () => {
  it('allows recruitment administrators but redirects recruiters away from HR management', async () => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    vi.mocked(authStore.loadCurrentUser).mockResolvedValue({ role: 'RECRUITMENT_ADMIN' } as never)
    await router.push('/hr-users')
    expect(router.currentRoute.value.path).toBe('/hr-users')
    await router.push('/dashboard')
    vi.mocked(authStore.loadCurrentUser).mockResolvedValue({ role: 'RECRUITER' } as never)
    await router.push('/hr-users')
    expect(router.currentRoute.value.path).toBe('/dashboard')
    vi.mocked(authStore.loadCurrentUser).mockResolvedValue({ role: 'SYSTEM_ADMIN' } as never)
  })
  it('keeps the current component routes', () => {
    const componentPaths = router.getRoutes()
      .filter(route => !['/', '/login', '/hr-login'].includes(route.path) && Boolean(route.components?.default))
      .map(route => route.path)
      .sort()

    expect(componentPaths).toEqual([
      '/boss-accounts',
      '/dashboard',
      '/hr-users',
      '/job-positions',
      '/resume-intakes',
      '/system-logs',
    ])
  })

  it('provides a dedicated HR login entry without duplicating authenticated pages', () => {
    const route = router.getRoutes().find(item => item.path === '/hr-login')
    expect(route?.meta.public).toBe(true)
    expect(route?.meta.portal).toBe('hr')
  })

  it.each([
    ['/ai-settings', '/resume-intakes'],
    ['/organization', '/job-positions'],
    ['/candidates', '/dashboard#attention-panel'],
    ['/auto-replies', '/dashboard'],
    ['/audit-logs', '/system-logs'],
    ['/operations', '/system-logs'],
  ])('redirects the retired URL %s to %s', (source, destination) => {
    const route = router.getRoutes().find(item => item.path === source)
    expect(route?.redirect).toBe(destination)
    expect(route?.components?.default).toBeUndefined()
  })
})
