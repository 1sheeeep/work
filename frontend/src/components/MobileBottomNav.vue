<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Briefcase, Connection, DocumentChecked, Grid } from '@element-plus/icons-vue'

const route = useRoute()
const router = useRouter()

const navItems = [
  { path: '/dashboard', label: '值守', icon: Grid },
  { path: '/boss-accounts', label: '账号', icon: Connection },
  { path: '/job-positions', label: '岗位', icon: Briefcase },
  { path: '/resume-intakes', label: '简历', icon: DocumentChecked },
]

const activePath = computed(() => route.path)

function navigate(path: string) {
  void router.push(path)
}
</script>

<template>
  <nav class="mobile-bottom-nav" aria-label="移动端导航">
    <button
      v-for="item in navItems"
      :key="item.path"
      type="button"
      :class="{ active: activePath === item.path }"
      :aria-current="activePath === item.path ? 'page' : undefined"
      @click="navigate(item.path)"
    >
      <component :is="item.icon" :size="20" />
      <span>{{ item.label }}</span>
    </button>
  </nav>
</template>

<style scoped>
.mobile-bottom-nav {
  display: none;
}
@media (max-width: 899px) {
  .mobile-bottom-nav {
    display: flex;
    justify-content: space-around;
    align-items: center;
    position: sticky;
    bottom: 0;
    height: 56px;
    padding: 0 4px;
    padding-bottom: env(safe-area-inset-bottom, 0);
    background: var(--surface);
    border-top: 1px solid var(--border);
    z-index: 15;
  }
  .mobile-bottom-nav button {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    flex: 1;
    height: 100%;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--text-secondary);
    font-size: 10px;
    cursor: pointer;
    transition: color var(--transition-fast);
  }
  .mobile-bottom-nav button.active {
    color: var(--primary);
  }
}
</style>