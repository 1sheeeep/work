<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Briefcase, Connection, DataAnalysis, Expand, OfficeBuilding, Operation, SwitchButton, User, UserFilled } from '@element-plus/icons-vue'
import { authStore } from '../stores/auth'

const route = useRoute()
const router = useRouter()
const mobileNavOpen = ref(false)
const loggingOut = ref(false)
const activePath = computed(() => route.path)
const user = computed(() => authStore.state.user)
const navigation = computed(() => [
  { path: '/organization', label: '集团与企业', icon: OfficeBuilding },
  { path: '/boss-accounts', label: 'BOSS 账号', icon: Connection },
  { path: '/job-positions', label: '职位管理', icon: Briefcase },
  { path: '/recruitment-tasks', label: '招聘任务', icon: Operation },
  ...(user.value?.role === 'SYSTEM_ADMIN' ? [
    { path: '/hr-users', label: 'HR 用户', icon: User },
    { path: '/audit-logs', label: '操作日志', icon: DataAnalysis },
  ] : []),
])
const roleLabel = computed(() => ({ SYSTEM_ADMIN: '系统管理员', RECRUITMENT_ADMIN: '招聘管理员', RECRUITER: '招聘专员' }[user.value?.role ?? 'SYSTEM_ADMIN']))
const workspaceLabel = computed(() => ({ organization: '组织管理', 'boss-accounts': 'BOSS 账号', 'job-positions': '职位管理', 'recruitment-tasks': '招聘任务', 'hr-users': 'HR 用户', 'audit-logs': '操作日志' }[String(route.name)] ?? '招聘工作台'))

function navigate(path: string) {
  mobileNavOpen.value = false
  void router.push(path)
}

async function handleLogout() {
  loggingOut.value = true
  try {
    await authStore.logout()
    await router.replace('/login')
  } catch {
    ElMessage.error('退出失败，请重试')
  } finally {
    loggingOut.value = false
  }
}
</script>

<template>
  <div class="app-layout">
    <a class="skip-link" href="#main-content">跳到主要内容</a>
    <aside class="sidebar">
      <div class="brand-block">
        <div class="brand-mark" aria-hidden="true">招</div>
        <div><strong>招聘自动化控制台</strong><span>集团 HR 工作台</span></div>
      </div>
      <nav class="nav-list" aria-label="主导航">
        <button
          v-for="item in navigation" :key="item.path" type="button" class="nav-item"
          :class="{ active: activePath === item.path }"
          :aria-current="activePath === item.path ? 'page' : undefined"
          @click="navigate(item.path)"
        >
          <el-icon :size="20"><component :is="item.icon" /></el-icon><span>{{ item.label }}</span>
        </button>
      </nav>
      <div class="sidebar-foot"><span>当前闭环</span><strong>自动招聘任务</strong></div>
    </aside>

    <section class="workspace">
      <header class="topbar">
        <button class="mobile-menu-button" type="button" aria-label="打开导航" @click="mobileNavOpen = true">
          <el-icon :size="22"><Expand /></el-icon>
        </button>
        <div class="topbar-context"><span>工作空间</span><strong>{{ workspaceLabel }}</strong></div>
        <div class="user-area">
          <div class="user-avatar" aria-hidden="true"><el-icon><UserFilled /></el-icon></div>
          <div class="user-copy"><strong>{{ user?.displayName }}</strong><span>{{ roleLabel }}</span></div>
          <el-button :loading="loggingOut" :icon="SwitchButton" text @click="handleLogout">退出</el-button>
        </div>
      </header>
      <main id="main-content" tabindex="-1"><RouterView /></main>
    </section>

    <el-drawer v-model="mobileNavOpen" direction="ltr" size="280px" :show-close="false">
      <template #header><div class="drawer-brand"><span class="brand-mark">招</span><strong>招聘自动化控制台</strong></div></template>
      <nav class="drawer-nav" aria-label="移动端主导航">
        <button v-for="item in navigation" :key="item.path" type="button" :class="{ active: activePath === item.path }" @click="navigate(item.path)">
          <el-icon :size="20"><component :is="item.icon" /></el-icon>{{ item.label }}
        </button>
      </nav>
    </el-drawer>
  </div>
</template>

<style scoped>
.app-layout { min-height: 100dvh; }
.skip-link { position: fixed; top: -80px; left: 16px; z-index: 3000; padding: 10px 14px; border-radius: 8px; background: #fff; color: var(--brand-900); }
.skip-link:focus { top: 12px; }
.sidebar { position: fixed; inset: 0 auto 0 0; z-index: 20; display: flex; width: 232px; flex-direction: column; padding: 24px 16px; background: var(--brand-950); color: #fff; }
.brand-block { display: flex; align-items: center; gap: 12px; min-height: 52px; padding: 0 8px; }
.brand-block strong { display: block; font-size: 15px; letter-spacing: .01em; }
.brand-block span { display: block; margin-top: 4px; color: #a6c7c2; font-size: 12px; }
.brand-mark { display: grid; width: 40px; height: 40px; flex: 0 0 auto; place-items: center; border-radius: 10px; background: var(--brand-600); color: #fff; font-weight: 800; }
.nav-list { display: grid; gap: 6px; margin-top: 36px; }
.nav-item, .drawer-nav button { display: flex; width: 100%; min-height: 46px; align-items: center; gap: 12px; border: 0; border-radius: 8px; cursor: pointer; font-weight: 600; text-align: left; transition: background-color .18s ease, color .18s ease; }
.nav-item { padding: 0 14px; background: transparent; color: #bad2ce; }
.nav-item:hover { background: rgba(255,255,255,.07); color: #fff; }
.nav-item.active { background: rgba(45,212,191,.15); color: #fff; box-shadow: inset 3px 0 0 #2dd4bf; }
.sidebar-foot { margin-top: auto; padding: 16px 12px 4px; border-top: 1px solid rgba(255,255,255,.12); }
.sidebar-foot span { display: block; color: #83aaa4; font-size: 12px; }
.sidebar-foot strong { display: block; margin-top: 5px; font-size: 13px; }
.workspace { min-height: 100dvh; margin-left: 232px; }
.topbar { position: sticky; top: 0; z-index: 15; display: flex; height: 72px; align-items: center; justify-content: space-between; padding: 0 28px 0 32px; border-bottom: 1px solid var(--border); background: rgba(255,255,255,.94); backdrop-filter: blur(12px); }
.topbar-context span { display: block; color: var(--text-secondary); font-size: 12px; }
.topbar-context strong { display: block; margin-top: 3px; font-size: 15px; }
.user-area { display: flex; align-items: center; gap: 10px; }
.user-avatar { display: grid; width: 36px; height: 36px; place-items: center; border-radius: 9px; background: var(--brand-100); color: var(--brand-700); }
.user-copy strong, .user-copy span { display: block; }
.user-copy strong { font-size: 13px; }
.user-copy span { margin-top: 2px; color: var(--text-secondary); font-size: 11px; }
.mobile-menu-button { display: none; width: 44px; height: 44px; place-items: center; border: 1px solid var(--border); border-radius: 8px; background: #fff; color: var(--text); }
.drawer-brand { display: flex; align-items: center; gap: 12px; color: var(--text); }
.drawer-nav { display: grid; gap: 8px; }
.drawer-nav button { padding: 0 14px; background: transparent; color: var(--text-secondary); }
.drawer-nav button.active { background: var(--brand-100); color: var(--brand-900); }
@media (max-width: 899px) {
  .sidebar { display: none; }
  .workspace { margin-left: 0; }
  .topbar { height: 64px; padding: 0 14px; }
  .mobile-menu-button { display: grid; }
  .topbar-context { margin-right: auto; margin-left: 12px; }
  .user-copy, .user-avatar { display: none; }
}
</style>
