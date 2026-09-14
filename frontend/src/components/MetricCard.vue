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
    <div class="metric-card-ui__glow" aria-hidden="true" />
    <div class="metric-card-ui__shine" aria-hidden="true" />
    <div class="metric-card-ui__top-line" aria-hidden="true" />
    <slot name="icon" />
    <div class="metric-card-ui__content">
      <span>{{ label }}</span>
      <strong><slot name="value">{{ value }}</slot></strong>
      <small v-if="description">{{ description }}</small>
    </div>
  </article>
</template>

<style scoped>
.metric-card-ui { min-width:0; position:relative; overflow:hidden; isolation:isolate; border:0; border-radius:var(--radius-panel); background:linear-gradient(145deg, rgba(255,255,255,.82) 0%, rgba(255,255,255,.58) 100%); box-shadow:0 1px 2px rgba(17,28,45,.03), 0 4px 14px rgba(17,28,45,.05), inset 0 1px 0 rgba(255,255,255,.72); transition:background 180ms ease, box-shadow 280ms cubic-bezier(.2,0,0,1), transform 280ms cubic-bezier(.2,0,0,1); }
.metric-card-ui:hover { background:linear-gradient(145deg, rgba(255,255,255,.94) 0%, rgba(255,255,255,.78) 100%); box-shadow:0 2px 4px rgba(17,28,45,.05), 0 12px 32px rgba(17,28,45,.10), inset 0 1px 0 rgba(255,255,255,.88), 2px 0 0 0 color-mix(in srgb, var(--indicator-accent, var(--primary)) 14%, transparent); transform:translateY(-2px); }
.metric-card-ui:active { animation:card-press 180ms ease-out both; }
.metric-card-ui:focus-visible { outline:3px solid rgba(20,184,166,.35); outline-offset:2px; border-radius:var(--radius-panel); }
.metric-card-ui__glow { position:absolute; top:-40%; right:-15%; width:160px; height:140px; border-radius:50%; background:radial-gradient(circle, color-mix(in srgb, var(--indicator-accent, var(--primary)) 16%, transparent) 0%, transparent 68%); pointer-events:none; opacity:.7; filter:blur(8px); }
.metric-card-ui__shine { position:absolute; inset:0; border-radius:inherit; background:linear-gradient(180deg, rgba(255,255,255,.52), transparent); mask-image:linear-gradient(to bottom, black 0%, black 42%, transparent 100%); pointer-events:none; z-index:0; }
.metric-card-ui__top-line { position:absolute; top:0; left:0; right:0; height:1px; background:linear-gradient(90deg, transparent 0%, rgba(255,255,255,.5) 25%, color-mix(in srgb, var(--indicator-accent, var(--primary)) 14%, rgba(255,255,255,.88)) 50%, rgba(255,255,255,.5) 75%, transparent 100%); opacity:.85; pointer-events:none; z-index:1; }
.metric-card-ui__content { min-width:0; position:relative; z-index:1; display:flex; flex-direction:column; gap:4px; padding:20px 22px; }
.metric-card-ui__content > span,
.metric-card-ui__content > small { color:var(--text-secondary); font-size:12px; line-height:1.4; letter-spacing:.01em; }
.metric-card-ui__content > strong { margin:4px 0; color:var(--text); font-size:var(--metric-value-size, 31px); font-weight:780; line-height:1.05; letter-spacing:-.02em; font-variant-numeric:tabular-nums; }
.metric-card-ui :deep(.el-icon) { display:grid; place-items:center; flex:0 0 auto; width:44px; height:44px; margin-bottom:4px; border-radius:12px; color:var(--indicator-accent,var(--primary)); background:color-mix(in srgb, var(--indicator-accent,var(--primary)) 10%, white 90%); font-size:22px; box-shadow:0 1px 4px color-mix(in srgb, var(--indicator-accent,var(--primary)) 18%, transparent), inset 0 1px 0 rgba(255,255,255,.62); }

:global(:root[data-theme="dark"]) .metric-card-ui { background:linear-gradient(145deg, rgba(30,36,51,.82) 0%, rgba(26,31,44,.58) 100%); box-shadow:0 1px 2px rgba(0,0,0,.22), 0 4px 14px rgba(0,0,0,.18), inset 0 1px 0 rgba(255,255,255,.04); }
:global(:root[data-theme="dark"]) .metric-card-ui:hover { background:linear-gradient(145deg, rgba(36,42,58,.94) 0%, rgba(30,36,51,.78) 100%); box-shadow:0 2px 4px rgba(0,0,0,.30), 0 12px 32px rgba(0,0,0,.28), inset 0 1px 0 rgba(255,255,255,.06), 2px 0 0 0 color-mix(in srgb, var(--indicator-accent, var(--primary)) 18%, transparent); }
:global(:root[data-theme="dark"]) .metric-card-ui :deep(.el-icon) { background:color-mix(in srgb, var(--indicator-accent,var(--primary)) 14%, rgba(30,36,51,.9) 86%); box-shadow:0 1px 4px color-mix(in srgb, var(--indicator-accent,var(--primary)) 24%, transparent), inset 0 1px 0 rgba(255,255,255,.06); }
:global(:root[data-theme="dark"]) .metric-card-ui__glow { opacity:.35; }
:global(:root[data-theme="dark"]) .metric-card-ui__shine { background:linear-gradient(180deg, rgba(255,255,255,.07), transparent); }
:global(:root[data-theme="dark"]) .metric-card-ui__top-line { background:linear-gradient(90deg, transparent 0%, rgba(255,255,255,.08) 25%, rgba(255,255,255,.22) 50%, rgba(255,255,255,.08) 75%, transparent 100%); }
</style>
