import { createRouter, createWebHistory } from 'vue-router'
import { authStore } from './stores/auth'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: () => import('./views/LoginView.vue'), meta: { public: true } },
    {
      path: '/', component: () => import('./layouts/AppLayout.vue'),
      children: [
        { path: '', redirect: '/organization' },
        { path: 'organization', name: 'organization', component: () => import('./views/OrganizationView.vue') },
        { path: 'boss-accounts', name: 'boss-accounts', component: () => import('./views/BossAccountsView.vue') },
        { path: 'job-positions', name: 'job-positions', component: () => import('./views/JobPositionsView.vue') },
        { path: 'recruitment-tasks', name: 'recruitment-tasks', component: () => import('./views/RecruitmentTasksView.vue') },
        { path: 'hr-users', name: 'hr-users', component: () => import('./views/HrUsersView.vue'), meta: { role: 'SYSTEM_ADMIN' } },
        { path: 'audit-logs', name: 'audit-logs', component: () => import('./views/AuditLogView.vue'), meta: { role: 'SYSTEM_ADMIN' } },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/organization' },
  ],
})

router.beforeEach(async (to) => {
  const user = await authStore.loadCurrentUser()
  if (to.meta.public) {
    if (to.name === 'login' && user) return { name: 'organization' }
    return true
  }
  if (!user) return { name: 'login', query: { redirect: to.fullPath } }
  if (to.meta.role && user.role !== to.meta.role) return { name: 'organization' }
  return true
})

export default router
