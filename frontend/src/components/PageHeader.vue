<template>
  <header class="page-heading">
    <slot />
  </header>
</template>

<style scoped>
.page-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px 24px;
  margin-bottom: 24px;
}
.page-heading :deep(h1) {
  margin: 0 0 8px;
  font-size: clamp(24px, 2vw, 30px);
  font-weight: 700;
  line-height: 1.3;
  letter-spacing: -.025em;
}
.page-heading :deep(p) {
  margin: 0;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.65;
}
.page-heading > :deep(div:first-child) { min-width: 0; }
@media (max-width: 600px) {
  .page-heading { align-items: stretch; flex-direction: column; gap: 14px; }
}
</style>
