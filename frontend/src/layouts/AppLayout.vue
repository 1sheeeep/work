<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Briefcase, Connection, DataAnalysis, DocumentChecked, Expand, Fold, Grid, Moon, Sunny, SwitchButton, UserFilled } from '@element-plus/icons-vue'
import NotificationBell from '../components/NotificationBell.vue'
import MobileBottomNav from '../components/MobileBottomNav.vue'
import { authStore } from '../stores/auth'

const route = useRoute()
const router = useRouter()
const mobileNavOpen = ref(false)
const loggingOut = ref(false)
const sidebarCollapsed = ref(false)
const theme = ref<'light'|'dark'>('light')
const activePath = computed(() => route.path)
const user = computed(() => authStore.state.user)
const navigationGroups = computed(() => [
  { label: '日常工作', items: [
    { path: '/dashboard', label: '今日值守', icon: Grid },
    { path: '/resume-intakes', label: '简历分析', icon: DocumentChecked },
    { path: '/boss-accounts', label: '招聘账号', icon: Connection },
    { path: '/job-positions', label: '岗位资料', icon: Briefcase },
  ] },
])
const systemItems = computed(() => user.value?.role === 'SYSTEM_ADMIN'
  ? [
      { path: '/hr-users', label: 'HR 用户管理', icon: UserFilled },
      { path: '/system-logs', label: '项目运行日志', icon: DataAnalysis },
    ]
  : [])
const roleLabel = computed(() => ({ SYSTEM_ADMIN: '系统管理员', RECRUITMENT_ADMIN: '招聘管理员', RECRUITER: '招聘专员' }[user.value?.role ?? 'SYSTEM_ADMIN']))
const workspaceLabel = computed(() => ({ dashboard: '今日总览', 'boss-accounts': '招聘账号', 'job-positions': '岗位资料', 'resume-intakes': '简历分析', 'hr-users': 'HR 用户管理', 'system-logs': '项目运行日志' }[String(route.name)] ?? '招聘值守台'))

const transitionName = ref('fade-slide')
watch(() => route.path, (_to, from) => {
  const toDepth = (route.meta?.depth as number) ?? 0
  const fromDepth = (router.resolve(from ?? '/dashboard').meta?.depth as number) ?? 0
  transitionName.value = toDepth > fromDepth ? 'slide-left' : toDepth < fromDepth ? 'slide-right' : 'fade-slide'
})

try {
  sidebarCollapsed.value = window.localStorage.getItem('recruitment-sidebar-collapsed') === '1'
} catch {
  sidebarCollapsed.value = false
}

function navigate(path: string) {
  mobileNavOpen.value = false
  void router.push(path)
}

function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value
  try {
    window.localStorage.setItem('recruitment-sidebar-collapsed', sidebarCollapsed.value ? '1' : '0')
  } catch {
    // 本地存储不可用时仍保留当前会话状态
  }
}

function normalizeTheme(t: string | null) {
  return t === 'dark' ? 'dark' : 'light'
}

function applyTheme(t: string | null) {
  const nextTheme = normalizeTheme(t)
  theme.value = nextTheme
  document.documentElement.classList.add('theme-switching')
  try {
    localStorage.setItem('theme', nextTheme)
  } catch {
    // 本地存储不可用时，主题仍在当前页面即时生效
  }
  document.documentElement.setAttribute('data-theme', nextTheme)
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.documentElement.classList.remove('theme-switching')
    })
  })
}

function cycleTheme() {
  applyTheme(theme.value === 'dark' ? 'light' : 'dark')
}

onMounted(() => {
  try {
    applyTheme(localStorage.getItem('theme'))
  } catch {
    applyTheme('light')
  }
})

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
  <div class="app-layout" :class="{ 'sidebar-collapsed': sidebarCollapsed }">
    <a class="skip-link" href="#main-content">跳到主要内容</a>
    <aside class="sidebar">
      <div class="sidebar-brand">
        <div class="brand-mark" aria-hidden="true">招</div>
        <div class="brand-info">
          <strong>招聘值守台</strong>
          <span>内部招聘 · 安全协作</span>
          <span class="brand-status"><i></i>测试阶段 · 只读监测</span>
        </div>
      </div>
      <nav class="sidebar-nav" aria-label="主导航">
        <button
          v-for="(item, idx) in [...navigationGroups.flatMap(g => g.items), ...systemItems]" :key="item.path"
          type="button" class="nav-item"
          :class="{ active: activePath === item.path }"
          :aria-current="activePath === item.path ? 'page' : undefined"
          :style="{ '--stagger': idx }"
          @click="navigate(item.path)"
        >
          <span class="nav-icon"><el-icon :size="20"><component :is="item.icon" /></el-icon></span>
          <span class="nav-label">{{ item.label }}</span>
          <span class="nav-indicator"></span>
        </button>
      </nav>
      <div class="sidebar-bottom">
        <div class="safety-badge"><i></i><span>安全保护已开启</span></div>
        <button class="theme-toggle" type="button" :aria-label="`主题：${theme === 'dark' ? '暗色' : '亮色'}`" @click="cycleTheme">
          <el-icon :size="18"><component :is="theme === 'dark' ? Moon : Sunny" /></el-icon>
        </button>
        <button class="sidebar-toggle" type="button" :aria-label="sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'" :aria-expanded="!sidebarCollapsed" :title="sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'" @click="toggleSidebar">
          <el-icon :size="16"><component :is="sidebarCollapsed ? Expand : Fold" /></el-icon>
        </button>
      </div>
    </aside>

    <section class="workspace">
      <header class="topbar">
        <button class="mobile-menu-button" type="button" aria-label="打开导航" @click="mobileNavOpen = true">
          <el-icon :size="22"><Expand /></el-icon>
        </button>
        <div class="topbar-context"><span>招聘工作台</span><span class="breadcrumb-sep">/</span><strong>{{ workspaceLabel }}</strong></div>
        <div class="topbar-right">
          <span class="monitor-chip"><i></i>只读监测</span>
          <NotificationBell />
          <div class="user-area">
            <div class="user-avatar" aria-hidden="true"><el-icon><UserFilled /></el-icon></div>
            <div class="user-copy"><strong>{{ user?.displayName }}</strong><span>{{ roleLabel }}</span></div>
            <el-button :loading="loggingOut" :icon="SwitchButton" text @click="handleLogout">退出</el-button>
          </div>
        </div>
      </header>
      <main id="main-content" class="workspace-content" tabindex="-1">
        <RouterView v-slot="{ Component }">
          <Transition :name="transitionName" mode="out-in">
            <component :is="Component" :key="route.path" />
          </Transition>
        </RouterView>
      </main>
      <MobileBottomNav />
    </section>

    <el-drawer v-model="mobileNavOpen" direction="ltr" size="288px" :show-close="false">
      <template #header><div class="drawer-brand"><span class="brand-mark">招</span><span><strong>招聘值守台</strong><small>内部招聘 · 安全协作</small></span></div></template>
      <nav class="drawer-nav" aria-label="移动端主导航">
        <section v-for="group in navigationGroups" :key="group.label"><span class="drawer-group-label">{{ group.label }}</span><button v-for="item in group.items" :key="item.path" type="button" :class="{ active: activePath === item.path }" @click="navigate(item.path)"><el-icon :size="20"><component :is="item.icon" /></el-icon>{{ item.label }}</button></section>
        <section v-if="systemItems.length"><span class="drawer-group-label">系统</span><button v-for="item in systemItems" :key="item.path" type="button" :class="{ active: activePath === item.path }" @click="navigate(item.path)"><el-icon :size="20"><component :is="item.icon" /></el-icon>{{ item.label }}</button></section>
      </nav>
    </el-drawer>
  </div>
</template>

<style scoped>
.app-layout { position:relative; min-height:100dvh; }.skip-link { position:fixed; top:-80px; left:16px; z-index:3000; padding:12px 16px; background:white; color:var(--primary); border-radius:8px; }.skip-link:focus { top:12px; }
/* ── 侧边栏 ── */
.sidebar { position:fixed; inset:0 auto 0 0; width:232px; display:flex; flex-direction:column; padding:20px 12px; background:linear-gradient(180deg,#08111e 0%,#0f1b2b 54%,#0c1724 100%); color:white; z-index:20; overflow-y:auto; overflow-x:hidden; box-shadow:inset -1px 0 0 rgba(255,255,255,.055), 14px 0 34px rgba(17,28,45,.08); transition:width 280ms cubic-bezier(.4,0,.2,1),padding 280ms cubic-bezier(.4,0,.2,1); }
.sidebar::before { content:''; position:absolute; inset:0; pointer-events:none; background:radial-gradient(circle at 50% 4%, rgba(45,212,191,.16), transparent 26%), linear-gradient(180deg, rgba(255,255,255,.04), transparent 30%); }
.sidebar > * { position:relative; z-index:1; }
.sidebar::-webkit-scrollbar { width:4px; }
.sidebar::-webkit-scrollbar-thumb { background:rgba(255,255,255,.12); border-radius:2px; }

/* ── 品牌区 ── */
.sidebar-brand { display:flex; flex-direction:column; align-items:center; gap:8px; padding:8px 0 20px; margin-bottom:4px; border-bottom:1px solid rgba(255,255,255,.06); }
.brand-mark { position:relative; display:grid; place-items:center; width:48px; height:48px; flex:0 0 auto; border-radius:14px; background:linear-gradient(145deg,#14b8a6 0%,#0d9488 40%,#0f766e 100%); color:white; font-size:23px; font-weight:800; letter-spacing:.02em; text-shadow:0 1px 2px rgba(0,0,0,.18); box-shadow:0 4px 20px rgba(13,148,136,.3),0 1px 3px rgba(0,0,0,.12),inset 0 0.5px 0 rgba(255,255,255,.18); transition:transform 300ms cubic-bezier(.34,1.56,.64,1),box-shadow 300ms ease,width 280ms cubic-bezier(.4,0,.2,1),height 280ms cubic-bezier(.4,0,.2,1),font-size 280ms cubic-bezier(.4,0,.2,1),border-radius 280ms cubic-bezier(.4,0,.2,1); }
.brand-mark::before { content:''; position:absolute; inset:-3px; border-radius:17px; background:linear-gradient(135deg,#2dd4bf,#14b8a6,#0d9488,#2dd4bf); opacity:0; z-index:-1; transition:opacity 300ms ease; filter:blur(5px); }
.brand-mark::after { content:''; position:absolute; inset:3px; border-radius:11px; border:1.5px solid rgba(255,255,255,.15); pointer-events:none; }
.brand-mark:hover { transform:scale(1.08); box-shadow:0 6px 28px rgba(13,148,136,.4),0 2px 6px rgba(0,0,0,.15),inset 0 0.5px 0 rgba(255,255,255,.22); }
.brand-mark:hover::before { opacity:.5; }
.brand-info { text-align:center; }
.brand-info strong { display:block; font-size:15px; letter-spacing:.01em; }
.brand-info > span { display:block; margin-top:3px; color:rgba(255,255,255,.45); font-size:11px; }
.brand-status { display:inline-flex; align-items:center; gap:6px; margin-top:8px; padding:4px 10px; border-radius:var(--radius-pill); background:rgba(232,173,75,.12); color:#e8ad4b; font-size:10px; }
.brand-status i { width:6px; height:6px; border-radius:50%; background:#e8ad4b; flex:0 0 auto; }

/* ── 导航 ── */
.sidebar-nav { display:flex; flex-direction:column; gap:3px; flex:1; padding:4px 0; }
.nav-item { position:relative; display:flex; align-items:center; gap:12px; width:100%; padding:11px 14px; min-height:44px; border:0; border-radius:10px; text-align:left; cursor:pointer; background:transparent; color:rgba(255,255,255,.65); font-size:13px; font-weight:500; transition:background 160ms ease, color 160ms ease, transform 160ms ease; animation:navEnter 360ms ease both; animation-delay:calc(var(--stagger,0)*50ms + 80ms); }
@keyframes navEnter { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
.nav-icon { display:grid; place-items:center; width:34px; height:34px; flex:0 0 auto; border-radius:8px; background:rgba(255,255,255,.04); transition:background 200ms ease, transform 200ms ease; }
.nav-item:hover { background:rgba(255,255,255,.06); color:white; transform:translateX(2px); }
.nav-item:hover .nav-icon { background:rgba(255,255,255,.10); transform:scale(1.06); }
.nav-item.active { background:rgba(13,148,136,.12); color:#b5fff2; }
.nav-item.active .nav-icon { background:rgba(13,148,136,.22); }
.nav-indicator { position:absolute; left:0; top:10px; bottom:10px; width:3px; border-radius:0 2px 2px 0; background:#2dd4bf; transform:scaleY(1); transition:transform 200ms cubic-bezier(.34,1.56,.64,1); }
.nav-item:not(.active) .nav-indicator { transform:scaleY(0); }
.nav-item:focus-visible { outline:2px solid #5eead4; outline-offset:-2px; }

/* ── 底部区 ── */
.sidebar-bottom { display:flex; align-items:center; gap:6px; margin-top:auto; padding:16px 6px 0; border-top:1px solid rgba(255,255,255,.06); }
.safety-badge { display:flex; align-items:center; gap:7px; flex:1; min-width:0; font-size:11px; color:rgba(255,255,255,.55); }
.safety-badge i { width:7px; height:7px; border-radius:50%; background:#34c99b; flex:0 0 auto; box-shadow:0 0 6px rgba(52,201,155,.4); }
.safety-badge span { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.theme-toggle { display:grid; place-items:center; width:34px; height:34px; flex:0 0 auto; border:0; border-radius:8px; background:rgba(255,255,255,.04); color:rgba(255,255,255,.55); cursor:pointer; transition:background 160ms ease, color 160ms ease, transform 300ms ease; }
.theme-toggle:hover { background:rgba(255,255,255,.10); color:white; transform:rotate(15deg); }
.sidebar-toggle { display:grid; place-items:center; width:34px; height:34px; flex:0 0 auto; border:1px solid rgba(255,255,255,.10); border-radius:8px; background:rgba(255,255,255,.04); color:rgba(255,255,255,.55); cursor:pointer; transition:background 160ms ease, color 160ms ease, border-color 160ms ease; }
.sidebar-toggle:hover { border-color:rgba(45,212,191,.4); background:rgba(45,212,191,.10); color:#8ce9dc; }
.sidebar-toggle:focus-visible { outline:2px solid #5eead4; outline-offset:2px; }

/* ── 折叠态 ── */
.sidebar-collapsed .sidebar { width:72px; padding-inline:8px; }
.sidebar-collapsed .workspace { margin-left:72px; }
.sidebar-collapsed .sidebar-brand { padding:8px 0 16px; border-bottom-color:transparent; }
.sidebar-collapsed .brand-info { display:none; }
.sidebar-collapsed .brand-mark { width:42px; height:42px; font-size:19px; border-radius:12px; }
.sidebar-collapsed .sidebar-nav { gap:2px; }
.sidebar-collapsed .nav-item { justify-content:center; padding:11px 0; animation:none; }
.sidebar-collapsed .nav-label { display:none; }
.sidebar-collapsed .nav-item:hover { transform:none; }
.sidebar-collapsed .nav-indicator { left:50%; top:auto; bottom:4px; width:4px; height:4px; border-radius:50%; transform:translateX(-50%) scale(1); }
.sidebar-collapsed .nav-item:not(.active) .nav-indicator { transform:translateX(-50%) scale(0); }
.sidebar-collapsed .sidebar-bottom { flex-direction:column; gap:8px; padding:12px 0 0; }
.sidebar-collapsed .safety-badge span { display:none; }
.sidebar-collapsed .safety-badge i { width:8px; height:8px; }

/* ── 抽屉导航（保留） ── */
.drawer-brand { display:flex; align-items:center; gap:12px; }
.drawer-brand small { margin-top:4px; color:var(--text-secondary); font-size:11px; }
.drawer-nav { display:grid; gap:20px; }
.drawer-nav section { display:grid; gap:6px; }
.drawer-group-label { color:var(--text-secondary); font-size:12px; margin-bottom:6px; }
.drawer-nav button { display:flex; align-items:center; gap:12px; width:100%; padding:12px 14px; min-height:46px; border:0; border-radius:var(--radius-control); text-align:left; cursor:pointer; font-weight:600; background:transparent; color:var(--text); transition:background var(--transition-fast); }
.drawer-nav button.active { background:var(--brand-50); color:var(--primary); }
.monitor-chip i { width:7px; height:7px; border-radius:50%; background:#e8ad4b; flex:0 0 auto; }

/* ── 工作区 ── */
.workspace { position:relative; margin-left:232px; min-height:100dvh; transition:margin-left 280ms cubic-bezier(.4,0,.2,1); }
.workspace::before { content:''; position:fixed; inset:0 0 auto 232px; height:180px; pointer-events:none; background:linear-gradient(180deg, rgba(255,255,255,.34), transparent); transition:inset 280ms cubic-bezier(.4,0,.2,1); }
.sidebar-collapsed .workspace::before { left:72px; }
.workspace-content { position:relative; z-index:1; padding:30px 30px 50px; min-width:0; }

/* ── 顶栏 ── */
.topbar { position:sticky; top:0; z-index:15; display:flex; align-items:center; justify-content:space-between; gap:16px; min-height:56px; padding:9px 30px; border-bottom:1px solid color-mix(in srgb, var(--border) 78%, transparent); background:color-mix(in srgb, var(--surface) 84%, transparent); backdrop-filter:blur(18px) saturate(1.08); -webkit-backdrop-filter:blur(18px) saturate(1.08); box-shadow:0 1px 0 rgba(255,255,255,.5); }
.topbar-context { display:flex; align-items:center; gap:10px; min-width:0; }
.topbar-context span { color:var(--text-secondary); font-size:12px; }
.breadcrumb-sep { color:var(--border); font-size:14px; }
.topbar-context strong { font-size:14px; }
.topbar-right,.user-area { display:flex; align-items:center; gap:14px; }
.monitor-chip { display:flex; align-items:center; gap:7px; font-size:11px; color:var(--warning); }
.user-avatar { width:34px; height:34px; display:grid; place-items:center; border-radius:var(--radius-control); background:var(--brand-50); color:var(--primary); }
.user-copy strong,.user-copy span { display:block; }
.user-copy strong { font-size:12px; }
.user-copy span { font-size:10px; color:var(--text-secondary); margin-top:2px; }
.mobile-menu-button { display:none; border:1px solid var(--border); background:var(--surface); border-radius:var(--radius-control); width:44px; height:44px; place-items:center; }

/* ── 响应式 ── */
@media(max-width:899px) { .sidebar { display:none; }.workspace,.sidebar-collapsed .workspace { margin-left:0; }.mobile-menu-button { display:grid; flex:0 0 auto; }.topbar { padding:10px 16px; gap:12px; }.topbar-context { margin-right:auto; }.topbar-context span,.topbar-context .breadcrumb-sep,.monitor-chip,.user-copy { display:none; }.topbar-context strong { border:0; padding:0; }.workspace-content { padding:20px 16px 36px; } }
@media(max-width:460px) { .workspace-content { padding:18px 12px 30px; }.user-avatar { display:none; }.topbar-right,.user-area { gap:0; } }

/* ── 页面过渡 ── */
.slide-left-enter-active,
.slide-left-leave-active,
.slide-right-enter-active,
.slide-right-leave-active {
  transition: opacity 200ms ease, transform 200ms ease;
}
.slide-left-enter-from { opacity: 0; transform: translateX(18px); }
.slide-left-leave-to { opacity: 0; transform: translateX(-12px); }
.slide-right-enter-from { opacity: 0; transform: translateX(-18px); }
.slide-right-leave-to { opacity: 0; transform: translateX(12px); }
</style>
