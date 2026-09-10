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
  gap: 16px 24px;
  margin-bottom: 20px;
  padding: 2px 0 4px;
}
.page-heading::before {
  content: '';
  position: absolute;
  left: 0;
  top: 6px;
  width: 32px;
  height: 3px;
  border-radius: var(--radius-pill);
  background: linear-gradient(90deg, var(--primary), transparent);
  opacity: .75;
}
.page-heading :deep(h1) {
  margin: 0 0 8px;
  padding-top: 12px;
  color: var(--text-primary);
  font-size: clamp(25px, 2vw, 31px);
  font-weight: 760;
  line-height: 1.22;
  letter-spacing: -.015em;
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
