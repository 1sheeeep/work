import { createRouter, createWebHistory } from 'vue-router'
import { authStore } from './stores/auth'

const router = createRouter({
  history: createWebHistory(),
  scrollBehavior(to) {
    if (to.hash) return { el: to.hash, behavior: 'smooth' }
    return { top: 0 }
  },
  routes: [
    { path: '/login', name: 'login', component: () => import('./views/LoginView.vue'), meta: { public: true } },
    { path: '/hr-login', name: 'hr-login', component: () => import('./views/LoginView.vue'), meta: { public: true, portal: 'hr' } },
    {
      path: '/', component: () => import('./layouts/AppLayout.vue'),
      children: [
        { path: '', redirect: '/dashboard' },
        { path: 'dashboard', name: 'dashboard', component: () => import('./views/DashboardView.vue') },
        { path: 'organization', redirect: '/job-positions' },
        { path: 'boss-accounts', name: 'boss-accounts', component: () => import('./views/BossAccountsView.vue') },
        { path: 'job-positions', name: 'job-positions', component: () => import('./views/JobPositionsView.vue') },
        { path: 'candidates', redirect: '/dashboard#attention-panel' },
        { path: 'resume-intakes', name: 'resume-intakes', component: () => import('./views/ResumeIntakesView.vue') },
        { path: 'system-logs', name: 'system-logs', component: () => import('./views/SystemLogsView.vue'), meta: { role: 'SYSTEM_ADMIN' } },
        { path: 'auto-replies', redirect: '/dashboard' },
        { path: 'hr-users', redirect: '/boss-accounts' },
        { path: 'audit-logs', redirect: '/system-logs' },
        { path: 'operations', redirect: '/system-logs' },
        { path: 'ai-settings', redirect: '/resume-intakes' },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/dashboard' },
  ],
})

router.beforeEach(async (to) => {
  const user = await authStore.loadCurrentUser()
  if (to.meta.public) {
    if (to.name === 'login' && user) return { name: 'dashboard' }
    return true
  }
  if (!user) return { name: 'login', query: { redirect: to.fullPath } }
  if (to.meta.role && user.role !== to.meta.role) return { name: 'dashboard' }
  return true
})

export default router
