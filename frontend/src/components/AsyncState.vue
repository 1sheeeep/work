<script setup lang="ts">
withDefaults(defineProps<{
  state: 'loading' | 'empty' | 'error'
  title?: string
  message?: string
  rows?: number
  retryLabel?: string
  embedded?: boolean
}>(), {
  title: '',
  message: '',
  rows: 7,
  retryLabel: '重试',
  embedded: false,
})

defineEmits<{ retry: [] }>()
</script>

<template>
  <section
    class="async-state"
    :class="[`async-state--${state}`, { 'async-state--embedded': embedded }]"
    :role="state === 'error' ? 'alert' : 'status'"
    :aria-live="state === 'error' ? 'assertive' : 'polite'"
    :aria-busy="state === 'loading'"
  >
    <el-skeleton v-if="state === 'loading'" :rows="rows" animated />
    <template v-else>
      <span class="async-state__icon"><slot name="icon" /></span>
      <strong>{{ title }}</strong>
      <p v-if="message">{{ message }}</p>
      <slot />
      <el-button v-if="state === 'error'" @click="$emit('retry')">{{ retryLabel }}</el-button>
    </template>
  </section>
</template>

<style scoped>
.async-state {
  display: grid;
  min-width: 0;
  justify-items: center;
  gap: 14px;
  padding: 56px 24px;
  border: 1px solid var(--border);
  border-radius: var(--radius-panel);
  background: var(--surface);
  box-shadow: var(--shadow-rest);
  color: var(--text-secondary);
  text-align: center;
}
.async-state--loading { display: block; padding: 28px; }
.async-state--error { border-color: var(--border-rose); background: linear-gradient(145deg, var(--surface-rose), var(--surface)); }
.async-state--empty { background: linear-gradient(145deg, var(--surface-slate), var(--surface)); }
.async-state--embedded { border: 0; border-radius: 0; background: transparent; box-shadow: none; padding: 48px 24px; }
.async-state__icon { display: grid; width: 56px; height: 56px; place-items: center; border-radius: 16px; background: var(--surface-soft); color: var(--primary); font-size: 26px; }
.async-state--error .async-state__icon { background: color-mix(in srgb, var(--surface-rose) 70%, var(--danger) 10%); color: var(--danger); }
.async-state--empty .async-state__icon { background: var(--surface-muted); color: var(--text-tertiary); }
.async-state strong { color: var(--text); font-size: 15px; font-weight: 600; }
.async-state p { max-width: 60ch; margin: 0; line-height: 1.65; overflow-wrap: anywhere; font-size: 13px; }
</style>