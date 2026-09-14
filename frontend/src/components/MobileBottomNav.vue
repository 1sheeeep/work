<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Briefcase, Connection, DocumentChecked, Grid } from '@element-plus/icons-vue'

const route = useRoute()
const router = useRouter()

const navItems = [
  { path: '/dashboard', label: '值守', icon: Grid },
  { path: '/resume-intakes', label: '人才', icon: DocumentChecked },
  { path: '/job-positions', label: '岗位', icon: Briefcase },
  { path: '/boss-accounts', label: '账号', icon: Connection },
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
    min-height: 62px;
    padding: 6px 8px;
    padding-bottom: env(safe-area-inset-bottom, 0);
    background: color-mix(in srgb, var(--surface) 88%, transparent);
    backdrop-filter: blur(18px) saturate(1.08);
    -webkit-backdrop-filter: blur(18px) saturate(1.08);
    border-top: 1px solid color-mix(in srgb, var(--border) 76%, transparent);
    box-shadow: 0 -14px 30px rgba(17,28,45,.08);
    z-index: 15;
  }
  .mobile-bottom-nav button {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    flex: 1;
    min-height: 48px;
    padding: 4px 0;
    border: 0;
    border-radius: var(--radius-control);
    background: transparent;
    color: var(--text-secondary);
    font-size: 10px;
    cursor: pointer;
    transition: color var(--transition-fast), background var(--transition-fast), transform var(--transition-fast);
  }
  .mobile-bottom-nav button.active {
    background: var(--surface-teal);
    color: var(--primary);
    font-weight: 700;
  }
  .mobile-bottom-nav button:active {
    transform: scale(.97);
  }
}
</style>