<script setup lang="ts">
withDefaults(defineProps<{
  label: string
  value?: string | number
  description?: string
  tone?: 'teal' | 'blue' | 'violet' | 'amber' | 'rose' | 'green'
}>(), {
  value: '-',
  description: '',
  tone: 'teal',
})
</script>

<template>
  <article class="card-indicator metric-card-ui" :class="`card-tone--${tone}`">
    <div class="metric-card-ui__bg-pattern" aria-hidden="true" />
    <slot name="icon" />
    <div class="metric-card-ui__content">
      <span>{{ label }}</span>
      <strong><slot name="value">{{ value }}</slot></strong>
      <small v-if="description">{{ description }}</small>
    </div>
  </article>
</template>

<style scoped>
.metric-card-ui { min-width: 0; position: relative; overflow: hidden; }
.metric-card-ui__bg-pattern {
  position: absolute;
  top: -16px;
  right: -22px;
  width: 118px;
  height: 96px;
  opacity: 0.45;
  background:
    radial-gradient(circle at 28% 65%, var(--indicator-accent, var(--primary)) 0 3px, transparent 4px),
    radial-gradient(circle at 56% 42%, var(--indicator-accent, var(--primary)) 0 3px, transparent 4px),
    linear-gradient(135deg, transparent 0 42%, color-mix(in srgb, var(--indicator-accent, var(--primary)) 18%, transparent) 42% 44%, transparent 44% 60%, color-mix(in srgb, var(--indicator-accent, var(--primary)) 14%, transparent) 60% 62%, transparent 62%);
  border-radius: 42% 0 0 58%;
  mask-image: linear-gradient(to left, black, transparent);
  pointer-events: none;
}
.metric-card-ui__content { min-width: 0; position: relative; z-index: 1; }
.metric-card-ui__content > span,
.metric-card-ui__content > strong,
.metric-card-ui__content > small { display: block; }
.metric-card-ui__content > span,
.metric-card-ui__content > small { color: var(--text-secondary); font-size: 12px; }
.metric-card-ui__content > strong { margin: 6px 0; color: var(--text); font-size: var(--metric-value-size, 30px); line-height: 1.1; font-variant-numeric: tabular-nums; }
.metric-card-ui__content > small { overflow-wrap: anywhere; }
</style>