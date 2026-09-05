<script setup lang="ts">
withDefaults(defineProps<{
  label: string
  value?: string | number
  description?: string
  tone?: 'teal' | 'blue' | 'violet' | 'amber' | 'rose' | 'green'
}>(), {
  value: '—',
  description: '',
  tone: 'teal',
})
</script>

<template>
  <article class="card-indicator metric-card-ui" :class="`card-tone--${tone}`">
    <slot name="icon" />
    <div class="metric-card-ui__content">
      <span>{{ label }}</span>
      <strong><slot name="value">{{ value }}</slot></strong>
      <small v-if="description">{{ description }}</small>
    </div>
  </article>
</template>

<style scoped>
.metric-card-ui { min-width: 0; }
.metric-card-ui__content { min-width: 0; }
.metric-card-ui__content > span,
.metric-card-ui__content > strong,
.metric-card-ui__content > small { display: block; }
.metric-card-ui__content > span,
.metric-card-ui__content > small { color: var(--text-secondary); font-size: 12px; }
.metric-card-ui__content > strong { margin: 6px 0; color: var(--text); font-size: var(--metric-value-size, 30px); line-height: 1.1; font-variant-numeric: tabular-nums; }
.metric-card-ui__content > small { overflow-wrap: anywhere; }
</style>
