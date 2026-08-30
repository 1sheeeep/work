<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Briefcase, ChatDotRound, Connection, DataAnalysis, DocumentChecked, Expand, Grid, Monitor, OfficeBuilding, SwitchButton, User, UserFilled } from '@element-plus/icons-vue'
import { authStore } from '../stores/auth'

const route = useRoute()
const router = useRouter()
const mobileNavOpen = ref(false)
const loggingOut = ref(false)
const activePath = computed(() => route.path)
const user = computed(() => authStore.state.user)
const navigationGroups = computed(() => [
  { label: '日常使用', items: [
    { path: '/dashboard', label: '托管首页', icon: Grid },
    { path: '/candidates', label: '待处理消息', icon: UserFilled },
    { path: '/resume-intakes', label: '简历登记与审核', icon: DocumentChecked },
    { path: '/boss-accounts', label: '账号连接', icon: Connection },
    { path: '/auto-replies', label: '回复设置与记录', icon: ChatDotRound },
  ] },
  ...(user.value?.role !== 'RECRUITER' ? [{ label: '管理员设置', items: [
    { path: '/job-positions', label: '职位资料', icon: Briefcase },
    { path: '/organization', label: '集团与企业', icon: OfficeBuilding },
    ...(user.value?.role === 'SYSTEM_ADMIN' ? [{ path: '/hr-users', label: 'HR 用户', icon: User }] : []),
  ] }] : []),
  ...(user.value?.role === 'SYSTEM_ADMIN' ? [{ label: '系统维护', items: [
    { path: '/audit-logs', label: '操作日志', icon: DataAnalysis },
    { path: '/operations', label: '运行保障', icon: Monitor },
  ] }] : []),
])
const roleLabel = computed(() => ({ SYSTEM_ADMIN: '系统管理员', RECRUITMENT_ADMIN: '招聘管理员', RECRUITER: '招聘专员' }[user.value?.role ?? 'SYSTEM_ADMIN']))
const workspaceLabel = computed(() => ({ dashboard: '托管首页', organization: '组织管理', 'boss-accounts': '账号连接', 'job-positions': '职位资料', candidates: '待处理消息', 'resume-intakes': '简历登记与审核', 'auto-replies': '回复设置与记录', 'hr-users': 'HR 用户', 'audit-logs': '操作日志', operations: '运行保障' }[String(route.name)] ?? '离开托管助手'))

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
        <div class="brand-mark" aria-hidden="true">候</div>
        <div><strong>候选人接待助手</strong><span>HR 离开时自动回复</span></div>
      </div>
      <nav class="nav-list" aria-label="主导航">
        <section v-for="group in navigationGroups" :key="group.label" class="nav-group" :class="{ secondary: group.label !== '日常使用' }">
          <span class="nav-group-label">{{ group.label }}</span>
          <button
          v-for="item in group.items" :key="item.path" type="button" class="nav-item"
          :class="{ active: activePath === item.path }"
          :aria-current="activePath === item.path ? 'page' : undefined"
          @click="navigate(item.path)"
        >
          <el-icon :size="20"><component :is="item.icon" /></el-icon><span>{{ item.label }}</span>
          </button>
        </section>
      </nav>
      <div class="sidebar-foot"><i></i><div><span>系统保护已开启</span><strong>异常时自动停止发送</strong></div></div>
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
      <template #header><div class="drawer-brand"><span class="brand-mark">候</span><strong>候选人接待助手</strong></div></template>
      <nav class="drawer-nav" aria-label="移动端主导航">
        <section v-for="group in navigationGroups" :key="group.label"><span class="drawer-group-label">{{ group.label }}</span><button v-for="item in group.items" :key="item.path" type="button" :class="{ active: activePath === item.path }" @click="navigate(item.path)"><el-icon :size="20"><component :is="item.icon" /></el-icon>{{ item.label }}</button></section>
      </nav>
    </el-drawer>
  </div>
</template>

<style scoped>
.app-layout { min-height: 100dvh; }
.skip-link { position: fixed; top: -80px; left: 16px; z-index: 3000; padding: 10px 14px; border-radius: 8px; background: #fff; color: var(--brand-900); }
.skip-link:focus { top: 12px; }
.sidebar { position: fixed; inset: 0 auto 0 0; z-index: 20; display: flex; width: 260px; flex-direction: column; padding: 22px 16px; background: linear-gradient(180deg,#092f2c 0%,#082724 58%,#061f1d 100%); color: #fff; overflow-y: auto; box-shadow: 8px 0 30px rgba(5,31,29,.08); }
.brand-block { display: flex; align-items: center; gap: 12px; min-height: 56px; padding: 0 8px; }
.brand-block strong { display: block; font-size: 15px; letter-spacing: .01em; }
.brand-block span { display: block; margin-top: 4px; color: #a6c7c2; font-size: 12px; }
.brand-mark { display: grid; width: 42px; height: 42px; flex: 0 0 auto; place-items: center; border:1px solid rgba(255,255,255,.16); border-radius: 13px; background: linear-gradient(135deg,#14b8a6,#0d9488); color: #fff; font-weight: 800; box-shadow:0 8px 20px rgba(13,148,136,.25); }
.nav-list { display: grid; gap: 22px; margin-top: 32px; }
.nav-group { display: grid; gap: 5px; }
.nav-group-label,.drawer-group-label { display:block; padding:0 12px 8px; color:#75a49e; font-size:11px; font-weight:750; letter-spacing:.1em; }
.nav-group.secondary{padding-top:18px;border-top:1px solid rgba(255,255,255,.08)}
.nav-item, .drawer-nav button { display: flex; width: 100%; min-height: 48px; align-items: center; gap: 12px; border: 0; border-radius: 11px; cursor: pointer; font-weight: 650; text-align: left; transition: background-color .18s ease, color .18s ease, transform .18s ease; }
.nav-item { padding: 0 14px; background: transparent; color: #bad2ce; }
.nav-item:hover { transform:translateX(2px); background: rgba(255,255,255,.075); color: #fff; }
.nav-item.active { background: linear-gradient(90deg,rgba(45,212,191,.2),rgba(45,212,191,.1)); color: #fff; box-shadow: inset 3px 0 0 #5eead4,0 5px 16px rgba(0,0,0,.08); }
.sidebar-foot { display:flex;align-items:center;gap:10px;margin-top: auto; padding: 16px 12px 4px; border-top: 1px solid rgba(255,255,255,.12); }
.sidebar-foot i{width:9px;height:9px;border-radius:50%;background:#34d399;box-shadow:0 0 0 5px rgba(52,211,153,.12)}
.sidebar-foot span { display: block; color: #b3d2ce; font-size: 12px; }
.sidebar-foot strong { display: block; margin-top: 4px; color:#729d97;font-size: 11px;font-weight:500; }
.workspace { min-height: 100dvh; margin-left: 260px; }
.topbar { position: sticky; top: 0; z-index: 15; display: flex; height: 74px; align-items: center; justify-content: space-between; padding: 0 32px 0 40px; border-bottom: 1px solid rgba(221,231,228,.9); background: rgba(250,252,251,.88); backdrop-filter: blur(16px); }
.topbar-context span { display: block; color: var(--text-secondary); font-size: 12px; }
.topbar-context strong { display: block; margin-top: 3px; font-size: 15px; }
.user-area { display: flex; align-items: center; gap: 11px;padding:5px 6px 5px 8px;border:1px solid var(--border);border-radius:12px;background:rgba(255,255,255,.78); }
.user-avatar { display: grid; width: 36px; height: 36px; place-items: center; border-radius: 9px; background: var(--brand-100); color: var(--brand-700); }
.user-copy strong, .user-copy span { display: block; }
.user-copy strong { font-size: 13px; }
.user-copy span { margin-top: 2px; color: var(--text-secondary); font-size: 11px; }
.mobile-menu-button { display: none; width: 44px; height: 44px; place-items: center; border: 1px solid var(--border); border-radius: 8px; background: #fff; color: var(--text); }
.drawer-brand { display: flex; align-items: center; gap: 12px; color: var(--text); }
.drawer-nav { display: grid; gap: 8px; }
.drawer-nav section { display:grid; gap:6px; margin-bottom:16px; }
.drawer-group-label { color:var(--text-secondary); }
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
