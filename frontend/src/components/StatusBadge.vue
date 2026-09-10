<script setup lang="ts">
withDefaults(defineProps<{
  label: string
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'violet'
  compact?: boolean
}>(), {
  tone: 'neutral',
  compact: false,
})
</script>

<template>
  <span class="status-badge" :class="[`status-badge--${tone}`, { 'status-badge--compact': compact }]">
    <i aria-hidden="true" />
    <span>{{ label }}</span>
  </span>
</template>

<style scoped>
.status-badge {
  display: inline-flex;
  min-height: 26px;
  max-width: 100%;
  align-items: center;
  gap: 7px;
  padding: 4px 9px;
  border: 1px solid var(--status-border, var(--border));
  border-radius: 7px;
  background: var(--status-surface, var(--surface-slate));
  color: var(--status-text, var(--text-secondary));
  font-size: 12px;
  font-weight: 650;
  line-height: 1.3;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.48);
}
.status-badge > i { width: 7px; height: 7px; flex: 0 0 auto; border-radius: 50%; background: currentColor; box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 12%, transparent); }
.status-badge > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.status-badge--compact { min-height: 22px; padding: 2px 7px; font-size: 11px; }
.status-badge--success { --status-surface: var(--color-success-bg); --status-border: #cfe8dc; --status-text: var(--success); }
.status-badge--warning { --status-surface: var(--surface-amber); --status-border: var(--border-amber); --status-text: var(--warning); }
.status-badge--danger { --status-surface: var(--surface-rose); --status-border: var(--border-rose); --status-text: var(--danger); }
.status-badge--info { --status-surface: var(--surface-blue); --status-border: var(--border-blue); --status-text: #315f9b; }
.status-badge--violet { --status-surface: var(--surface-violet); --status-border: var(--border-violet); --status-text: #7253a6; }
</style>
