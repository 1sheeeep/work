<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Briefcase, Connection, DataAnalysis, DocumentChecked, Expand, Grid, SwitchButton, UserFilled } from '@element-plus/icons-vue'
import { authStore } from '../stores/auth'

const route = useRoute()
const router = useRouter()
const mobileNavOpen = ref(false)
const loggingOut = ref(false)
const activePath = computed(() => route.path)
const user = computed(() => authStore.state.user)
const navigationGroups = computed(() => [
  { label: '日常工作', items: [
    { path: '/dashboard', label: '今日值守', icon: Grid },
    { path: '/boss-accounts', label: '招聘账号', icon: Connection },
    { path: '/job-positions', label: '岗位资料', icon: Briefcase },
    { path: '/resume-intakes', label: '简历分析', icon: DocumentChecked },
  ] },
])
const systemItems = computed(() => user.value?.role === 'SYSTEM_ADMIN'
  ? [{ path: '/system-logs', label: '项目运行日志', icon: DataAnalysis }]
  : [])
const roleLabel = computed(() => ({ SYSTEM_ADMIN: '系统管理员', RECRUITMENT_ADMIN: '招聘管理员', RECRUITER: '招聘专员' }[user.value?.role ?? 'SYSTEM_ADMIN']))
const workspaceLabel = computed(() => ({ dashboard: '今日总览', 'boss-accounts': '招聘账号', 'job-positions': '岗位资料', 'resume-intakes': '简历分析', 'system-logs': '项目运行日志' }[String(route.name)] ?? '招聘值守台'))

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
        <section v-if="systemItems.length" class="nav-group">
          <span class="nav-group-label">系统</span>
          <button v-for="item in systemItems" :key="item.path" type="button" class="nav-item" :class="{ active: activePath === item.path }" @click="navigate(item.path)">
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
      <main id="main-content" class="workspace-content" tabindex="-1">
        <RouterView v-slot="{ Component }">
          <Transition name="fade-slide" mode="out-in">
            <component :is="Component" :key="route.path" />
          </Transition>
        </RouterView>
      </main>
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
.app-layout { min-height:100dvh; }.skip-link { position:fixed; top:-80px; left:16px; z-index:3000; padding:12px 16px; background:white; color:var(--primary); border-radius:8px; }.skip-link:focus { top:12px; }
.sidebar { position:fixed; inset:0 auto 0 0; width:232px; display:flex; flex-direction:column; padding:24px 14px; background:var(--brand-950); color:white; z-index:20; overflow-y:auto; }
.brand-block,.drawer-brand { display:flex; align-items:center; gap:12px; padding:0 8px; }.brand-mark { display:grid; place-items:center; width:40px; height:40px; flex:0 0 auto; border-radius:12px; background:var(--primary); color:white; font-size:20px; font-weight:700; }
.brand-block strong,.brand-block span,.drawer-brand strong,.drawer-brand small { display:block; }.brand-block strong { font-size:16px; }.brand-block span { margin-top:4px; color:#a7b4c5; font-size:11px; }
.sidebar-mode { display:grid; grid-template-columns:8px minmax(0,1fr); align-items:center; gap:5px 8px; padding:12px; margin:24px 4px; background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.08); border-radius:10px; font-size:12px; }
.sidebar-mode small { grid-column:2; font-size:11px; color:#a7b4c5; }
.sidebar-mode i,.sidebar-foot > i,.monitor-chip i { width:7px; height:7px; border-radius:50%; background:#e8ad4b; flex:0 0 auto; }
.nav-list { display:grid; gap:28px; }.nav-group { display:grid; gap:5px; }.nav-group-label { padding:0 12px 7px; color:#91a1b6; font-size:11px; }
.nav-item,.drawer-nav button { display:flex; align-items:center; gap:12px; width:100%; padding:12px 14px; min-height:46px; border:0; border-radius:9px; text-align:left; cursor:pointer; font-weight:600; transition:background 180ms ease; }
.nav-item { background:transparent; color:#c5cfdd; }.nav-item:hover { background:rgba(255,255,255,.06); color:white; }.nav-item.active { background:#16453f; color:#7ee8d8; box-shadow:inset 3px 0 #2dd4bf; }
.sidebar-foot { display:flex; align-items:center; gap:10px; margin-top:auto; padding:22px 8px 0; font-size:11px; color:#c5cfdd; }.sidebar-foot > i { background:#34c99b; }.sidebar-foot span,.sidebar-foot strong { display:block; }.sidebar-foot strong { margin-top:5px; font-weight:400; font-size:10px; color:#91a1b6; }
.workspace { margin-left:232px; min-height:100dvh; }.workspace-content { padding:28px 28px 48px; min-width:0; }
.topbar { position:sticky; top:0; z-index:15; display:flex; align-items:center; justify-content:space-between; gap:16px; min-height:64px; padding:10px 28px; border-bottom:1px solid var(--border); background:var(--surface); }
.topbar-context { display:flex; align-items:center; gap:14px; min-width:0; }.topbar-context span { color:var(--text-secondary); font-size:12px; }.topbar-context strong { padding-left:14px; border-left:1px solid var(--border); font-size:14px; }
.topbar-right,.user-area { display:flex; align-items:center; gap:14px; }.monitor-chip { display:flex; align-items:center; gap:7px; font-size:11px; color:var(--warning); }
.user-avatar { width:34px; height:34px; display:grid; place-items:center; border-radius:10px; background:var(--brand-50); color:var(--primary); }.user-copy strong,.user-copy span { display:block; }.user-copy strong { font-size:12px; }.user-copy span { font-size:10px; color:var(--text-secondary); margin-top:2px; }
.mobile-menu-button { display:none; border:1px solid var(--border); background:white; border-radius:8px; width:44px; height:44px; place-items:center; }
.drawer-nav { display:grid; gap:20px; }.drawer-nav section { display:grid; gap:6px; }.drawer-group-label { color:var(--text-secondary); font-size:12px; margin-bottom:6px; }.drawer-nav button { background:transparent; color:var(--text); }.drawer-nav button.active { background:var(--brand-50); color:var(--primary); }.drawer-brand small { margin-top:4px; color:var(--text-secondary); font-size:11px; }
@media(max-width:899px) { .sidebar { display:none; }.workspace { margin-left:0; }.mobile-menu-button { display:grid; flex:0 0 auto; }.topbar { padding:10px 16px; gap:12px; }.topbar-context { margin-right:auto; }.topbar-context span,.monitor-chip,.user-copy { display:none; }.topbar-context strong { border:0; padding:0; }.workspace-content { padding:20px 16px 36px; } }
@media(max-width:460px) { .workspace-content { padding:18px 12px 30px; }.user-avatar { display:none; }.topbar-right,.user-area { gap:0; } }
</style>
