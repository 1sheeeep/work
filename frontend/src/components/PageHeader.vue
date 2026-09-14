<template>
  <header class="page-heading">
    <slot />
  </header>
</template>

<style scoped>
.page-heading {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px 20px;
  margin-bottom: 6px;
  padding: 2px 0 4px;
}
.page-heading :deep(h1) {
  margin: 0 0 4px;
  padding-top: 0;
  color: var(--text-primary);
  font-size: clamp(18px, 1.6vw, 22px);
  font-weight: 700;
  line-height: 1.3;
  letter-spacing: -.01em;
}
.page-heading :deep(p) {
  margin: 0;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.55;
}
.page-heading > :deep(div:first-child) { min-width: 0; }
@media (max-width: 600px) {
  .page-heading { align-items: stretch; flex-direction: column; gap: 14px; }
}
</style>
