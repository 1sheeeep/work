<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Briefcase, ChatDotRound, Connection, Cpu, DataAnalysis, DocumentChecked, Expand, Grid, Monitor, OfficeBuilding, SwitchButton, User, UserFilled } from '@element-plus/icons-vue'
import { authStore } from '../stores/auth'

const route = useRoute()
const router = useRouter()
const mobileNavOpen = ref(false)
const loggingOut = ref(false)
const activePath = computed(() => route.path)
const user = computed(() => authStore.state.user)
const navigationGroups = computed(() => [
  { label: '工作台', items: [{ path: '/dashboard', label: '今日总览', icon: Grid }] },
  { label: '值守与消息', items: [
    { path: '/candidates', label: '待处理消息', icon: UserFilled },
    { path: '/auto-replies', label: '值守规则与记录', icon: ChatDotRound },
    { path: '/boss-accounts', label: '账号与浏览器', icon: Connection },
  ] },
  { label: '岗位与人才', items: [
    { path: '/job-positions', label: '岗位资料', icon: Briefcase },
    { path: '/resume-intakes', label: '简历审核与分析', icon: DocumentChecked },
  ] },
  ...(user.value?.role !== 'RECRUITER' ? [{ label: '组织设置', items: [
    { path: '/organization', label: '企业与集团', icon: OfficeBuilding },
    ...(user.value?.role === 'SYSTEM_ADMIN' ? [{ path: '/hr-users', label: 'HR 用户', icon: User }] : []),
  ] }] : []),
  ...(user.value?.role === 'SYSTEM_ADMIN' ? [{ label: '运行管理', items: [
    { path: '/ai-settings', label: 'AI 接入', icon: Cpu },
    { path: '/operations', label: '运行保障', icon: Monitor },
    { path: '/audit-logs', label: '操作日志', icon: DataAnalysis },
  ] }] : []),
])
const roleLabel = computed(() => ({ SYSTEM_ADMIN: '系统管理员', RECRUITMENT_ADMIN: '招聘管理员', RECRUITER: '招聘专员' }[user.value?.role ?? 'SYSTEM_ADMIN']))
const workspaceLabel = computed(() => ({ dashboard: '今日总览', organization: '企业与集团', 'boss-accounts': '账号与浏览器', 'job-positions': '岗位资料', candidates: '待处理消息', 'resume-intakes': '简历审核与分析', 'auto-replies': '值守规则与记录', 'hr-users': 'HR 用户', 'audit-logs': '操作日志', operations: '运行保障', 'ai-settings': 'AI 接入' }[String(route.name)] ?? '招聘值守台'))

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
        <div><strong>招聘值守台</strong><span>内部招聘 · 安全协作</span></div>
      </div>
      <div class="sidebar-mode"><i></i><span>测试阶段</span><small>只读监测，不自动发送</small></div>
      <nav class="nav-list" aria-label="主导航">
        <section v-for="group in navigationGroups" :key="group.label" class="nav-group">
          <span class="nav-group-label">{{ group.label }}</span>
          <button
            v-for="item in group.items" :key="item.path" type="button" class="nav-item"
            :class="{ active: activePath === item.path }"
            :aria-current="activePath === item.path ? 'page' : undefined"
            @click="navigate(item.path)"
          >
            <el-icon :size="19"><component :is="item.icon" /></el-icon><span>{{ item.label }}</span>
          </button>
        </section>
      </nav>
      <div class="sidebar-foot"><i></i><div><span>安全保护已开启</span><strong>异常、掉线或页面变化时暂停</strong></div></div>
    </aside>

    <section class="workspace">
      <header class="topbar">
        <button class="mobile-menu-button" type="button" aria-label="打开导航" @click="mobileNavOpen = true">
          <el-icon :size="22"><Expand /></el-icon>
        </button>
        <div class="topbar-context"><span>招聘工作台</span><strong>{{ workspaceLabel }}</strong></div>
        <div class="topbar-right">
          <span class="monitor-chip"><i></i>只读监测</span>
          <div class="user-area">
            <div class="user-avatar" aria-hidden="true"><el-icon><UserFilled /></el-icon></div>
            <div class="user-copy"><strong>{{ user?.displayName }}</strong><span>{{ roleLabel }}</span></div>
            <el-button :loading="loggingOut" :icon="SwitchButton" text @click="handleLogout">退出</el-button>
          </div>
        </div>
      </header>
      <main id="main-content" tabindex="-1"><RouterView /></main>
    </section>

    <el-drawer v-model="mobileNavOpen" direction="ltr" size="288px" :show-close="false">
      <template #header><div class="drawer-brand"><span class="brand-mark">招</span><span><strong>招聘值守台</strong><small>内部招聘 · 安全协作</small></span></div></template>
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
.sidebar { position: fixed; inset: 0 auto 0 0; z-index: 20; display: flex; width: 252px; flex-direction: column; padding: 22px 14px 18px; background: radial-gradient(circle at 14% 0,rgba(42,165,151,.27),transparent 28%),linear-gradient(180deg,#082d2a 0%,#062522 57%,#041a18 100%); color: #fff; overflow-y: auto; box-shadow: 8px 0 30px rgba(5,31,29,.08); }
.brand-block { display: flex; align-items: center; gap: 12px; min-height: 54px; padding: 0 9px; }
.brand-block strong { display: block; font-size: 16px; letter-spacing: .01em; }.brand-block span { display: block; margin-top: 4px; color: #a6c7c2; font-size: 11px; }
.brand-mark { display: grid; width: 40px; height: 40px; flex: 0 0 auto; place-items: center; border:1px solid rgba(255,255,255,.16); border-radius: 12px; background: linear-gradient(135deg,#2dd4bf,#0f9488); color: #fff; font-weight: 850; box-shadow:0 8px 20px rgba(13,148,136,.25); }
.sidebar-mode { display:grid;grid-template-columns:8px auto;column-gap:8px;align-items:center;margin:22px 7px 0;padding:10px 11px;border:1px solid rgba(154,204,195,.17);border-radius:10px;background:rgba(255,255,255,.055);color:#d7f2ed;font-size:11px; }.sidebar-mode i,.sidebar-foot>i,.monitor-chip i{width:7px;height:7px;border-radius:50%;background:#f8b84e;box-shadow:0 0 0 4px rgba(248,184,78,.11)}.sidebar-mode small{grid-column:2;margin-top:3px;color:#8fb8b1;font-size:10px}
.nav-list { display: grid; gap: 18px; margin-top: 26px; }.nav-group { display: grid; gap: 4px; }.nav-group:not(:first-child){padding-top:17px;border-top:1px solid rgba(255,255,255,.07)}.nav-group-label,.drawer-group-label { display:block; padding:0 12px 8px; color:#75a49e; font-size:10px; font-weight:780; letter-spacing:.12em; }
.nav-item, .drawer-nav button { display: flex; width: 100%; min-height: 45px; align-items: center; gap: 11px; border: 0; border-radius: 10px; cursor: pointer; font-weight: 640; text-align: left; transition: background-color .18s ease, color .18s ease, transform .18s ease; }.nav-item { padding: 0 13px; background: transparent; color: #bad2ce; }.nav-item:hover { transform:translateX(2px); background: rgba(255,255,255,.075); color: #fff; }.nav-item.active { background: linear-gradient(90deg,rgba(45,212,191,.22),rgba(45,212,191,.09)); color: #fff; box-shadow: inset 3px 0 0 #5eead4,0 5px 16px rgba(0,0,0,.08); }
.sidebar-foot { display:flex;align-items:center;gap:10px;margin-top: auto; padding: 16px 11px 3px; border-top: 1px solid rgba(255,255,255,.12); }.sidebar-foot>i{background:#34d399;box-shadow:0 0 0 5px rgba(52,211,153,.12)}.sidebar-foot span { display: block; color: #b3d2ce; font-size: 11px; }.sidebar-foot strong { display: block; margin-top: 4px; color:#729d97;font-size: 10px;font-weight:500;line-height:1.4; }
.workspace { min-height: 100dvh; margin-left: 252px; }.topbar { position: sticky; top: 0; z-index: 15; display: flex; height: 72px; align-items: center; justify-content: space-between; padding: 0 32px 0 40px; border-bottom: 1px solid rgba(221,231,228,.9); background: rgba(250,252,251,.88); backdrop-filter: blur(16px); }.topbar-context span { display: block; color: var(--text-secondary); font-size: 11px; }.topbar-context strong { display: block; margin-top: 3px; font-size: 15px; }.topbar-right{display:flex;align-items:center;gap:12px}.monitor-chip{display:inline-flex;align-items:center;gap:7px;padding:7px 10px;border:1px solid #f0d8ac;border-radius:999px;background:#fff8eb;color:#9a6700;font-size:11px;font-weight:700}.monitor-chip i{background:#f8b84e;box-shadow:none}
.user-area { display: flex; align-items: center; gap: 10px;padding:5px 6px 5px 8px;border:1px solid var(--border);border-radius:12px;background:rgba(255,255,255,.78); }.user-avatar { display: grid; width: 34px; height: 34px; place-items: center; border-radius:9px; background: var(--brand-100); color: var(--brand-700); }.user-copy strong, .user-copy span { display: block; }.user-copy strong { font-size: 12px; }.user-copy span { margin-top: 2px; color: var(--text-secondary); font-size: 10px; }
.mobile-menu-button { display: none; width: 44px; height: 44px; place-items: center; border: 1px solid var(--border); border-radius: 8px; background: #fff; color: var(--text); }.drawer-brand { display: flex; align-items: center; gap: 12px; color: var(--text); }.drawer-brand strong,.drawer-brand small{display:block}.drawer-brand small{margin-top:3px;color:var(--text-secondary);font-size:11px}.drawer-nav { display: grid; gap: 8px; }.drawer-nav section { display:grid; gap:6px; margin-bottom:16px; }.drawer-group-label { color:var(--text-secondary); }.drawer-nav button { padding: 0 14px; background: transparent; color: var(--text-secondary); }.drawer-nav button.active { background: var(--brand-100); color: var(--brand-900); }
@media (max-width: 899px) {.sidebar { display: none; }.workspace { margin-left: 0; }.topbar { height: 64px; padding: 0 14px; }.mobile-menu-button { display: grid; }.topbar-context { margin-right: auto; margin-left: 12px; }.user-copy, .user-avatar,.monitor-chip { display: none; }}
</style>
