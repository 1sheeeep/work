<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { BellFilled, WarningFilled } from '@element-plus/icons-vue'
import { useNotificationCenter, type NotificationType } from '../composables/useNotificationCenter'

const router = useRouter()
const { unreadCount, recentItems, markAsRead, markAllAsRead } = useNotificationCenter()
const popoverVisible = ref(false)

const typeIcon: Record<NotificationType, any> = {
  MANUAL_REVIEW_REQUIRED: WarningFilled,
}

const typeClass: Record<NotificationType, string> = {
  MANUAL_REVIEW_REQUIRED: 'notif-type--amber',
}

function formatTime(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins} 分钟前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  return `${days} 天前`
}

function handleClick(item: { id: string; link?: string; read: boolean }) {
  markAsRead(item.id)
  if (item.link) {
    popoverVisible.value = false
    router.push(item.link)
  }
}
</script>

<template>
  <el-popover
    v-model:visible="popoverVisible"
    placement="bottom-end"
    :width="360"
    trigger="click"
    :offset="8"
    popper-class="notification-popover"
  >
    <template #reference>
      <button
        class="notification-bell"
        type="button"
        aria-label="通知中心"
        :title="`${unreadCount} 条未读通知`"
      >
        <el-icon :size="20"><BellFilled /></el-icon>
        <span v-if="unreadCount" class="notification-badge">{{ unreadCount > 99 ? '99+' : unreadCount }}</span>
      </button>
    </template>

    <div class="notif-panel">
      <div class="notif-header">
        <strong>待 HR 手动处理</strong>
        <button
          v-if="unreadCount"
          type="button"
          class="notif-mark-all"
          @click="markAllAsRead"
        >
          全部已读
        </button>
      </div>

      <div v-if="!recentItems.length" class="notif-empty">
        <el-icon :size="32"><BellFilled /></el-icon>
        <span>暂无通知</span>
        <small>AI 已读但未自动回复的会话会显示在这里</small>
      </div>

      <ul v-else class="notif-list">
        <li
          v-for="item in recentItems"
          :key="item.id"
          class="notif-item"
          :class="{ 'notif-item--unread': !item.read }"
          role="button"
          tabindex="0"
          @click="handleClick(item)"
          @keydown.enter="handleClick(item)"
          @keydown.space.prevent="handleClick(item)"
        >
          <span class="notif-dot" :class="typeClass[item.type]" aria-hidden="true">
            <el-icon :size="14"><component :is="typeIcon[item.type]" /></el-icon>
          </span>
          <div class="notif-body">
            <div class="notif-title-row">
              <strong>{{ item.title }}</strong>
              <time>{{ formatTime(item.createdAt) }}</time>
            </div>
            <p>{{ item.message }}</p>
          </div>
        </li>
      </ul>
    </div>
  </el-popover>
</template>

<style scoped>
.notification-bell {
  position: relative;
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  background: color-mix(in srgb, var(--surface) 86%, transparent);
  color: var(--text-secondary);
  cursor: pointer;
  box-shadow: var(--shadow-ground), inset 0 1px 0 rgba(255,255,255,.48);
  transition: background var(--transition-fast), color var(--transition-fast), border-color var(--transition-fast), transform var(--transition-fast), box-shadow var(--transition-fast);
}

.notification-bell:hover {
  background: var(--surface-row);
  color: var(--text);
  border-color: var(--border-strong);
  box-shadow: var(--shadow-raised);
  transform: translateY(-1px);
}

.notification-bell:focus-visible {
  outline: 3px solid rgba(20, 184, 166, .28);
  outline-offset: 2px;
}

.notification-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: #b42318;
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  line-height: 18px;
  text-align: center;
  pointer-events: none;
  box-shadow:0 0 0 2px var(--surface), 0 4px 10px rgba(180,35,24,.22);
}
</style>

<style>
.notification-popover {
  padding: 0 !important;
  border-radius: var(--radius-panel) !important;
  border: 1px solid var(--border) !important;
  background: var(--glass-bg) !important;
  backdrop-filter: var(--glass-blur) !important;
  -webkit-backdrop-filter: var(--glass-blur) !important;
  box-shadow: var(--shadow-floating) !important;
}

.notif-panel {
  display: flex;
  flex-direction: column;
  max-height: 420px;
}

.notif-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px 12px;
  border-bottom: 1px solid var(--border-subtle);
  background: linear-gradient(180deg, rgba(255,255,255,.7), transparent);
}

.notif-header strong {
  font-size: 15px;
  color: var(--text);
}

.notif-mark-all {
  border: 0;
  background: none;
  color: var(--color-accent);
  font-size: 12px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  transition: background var(--transition-fast);
}

.notif-mark-all:hover {
  background: var(--surface-teal);
}

.notif-empty {
  display: grid;
  justify-items: center;
  gap: 8px;
  padding: 48px 24px;
  color: var(--text-secondary);
  text-align: center;
}

.notif-empty span {
  font-size: 14px;
  color: var(--text);
}

.notif-empty small {
  font-size: 12px;
  max-width: 220px;
  line-height: 1.5;
}

.notif-list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  flex: 1;
}

.notif-item {
  display: flex;
  gap: 12px;
  padding: 14px 18px;
  cursor: pointer;
  border-bottom: 1px solid var(--border-subtle);
  transition: background var(--transition-fast), box-shadow var(--transition-fast);
}

.notif-item:hover {
  background: var(--surface-row);
  box-shadow: inset 3px 0 0 color-mix(in srgb, var(--primary) 30%, transparent);
}

.notif-item:focus-visible {
  outline: 2px solid rgba(20, 184, 166, .22);
  outline-offset: -2px;
}

.notif-item--unread {
  background: linear-gradient(90deg, rgba(240,253,250,.94), rgba(255,255,255,.7));
}

.notif-dot {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  margin-top: 2px;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.5);
}

.notif-type--teal { background: var(--surface-teal); color: var(--brand-700); }
.notif-type--amber { background: var(--surface-amber); color: var(--warning); }
.notif-type--blue { background: var(--surface-blue); color: var(--color-info); }
.notif-type--rose { background: var(--surface-rose); color: var(--danger); }

.notif-body {
  min-width: 0;
  flex: 1;
}

.notif-title-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.notif-title-row strong {
  font-size: 13px;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.notif-title-row time {
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

.notif-body p {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
</style>
