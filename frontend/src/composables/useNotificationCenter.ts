import { computed, reactive, readonly } from 'vue'

export type NotificationType = 'MANUAL_REVIEW_REQUIRED'

export interface NotificationItem {
  id: string
  type: NotificationType
  title: string
  message: string
  link?: string
  read: boolean
  createdAt: number
  sourceId?: string
}

const STORAGE_KEY = 'recruitment-notifications'
const MAX_NOTIFICATIONS = 50

const state = reactive<{ items: NotificationItem[] }>({ items: [] })

function loadFromStorage(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) state.items = (JSON.parse(raw) as NotificationItem[])
      .filter(item => item.type === 'MANUAL_REVIEW_REQUIRED')
  } catch {
    state.items = []
  }
}

function persist(): void {
  try {
    const trimmed = state.items.slice(0, MAX_NOTIFICATIONS)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed))
  } catch {
    // 本地存储不可用时保留内存状态
  }
}

function generateId(): string {
  return `n_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export function useNotificationCenter() {
  if (!state.items.length) loadFromStorage()
  const retained = state.items.filter(item => item.type === 'MANUAL_REVIEW_REQUIRED')
  if (retained.length !== state.items.length) {
    state.items = retained
    persist()
  }

  const unreadCount = computed(() => state.items.filter(n => !n.read).length)
  const recentItems = computed(() => state.items.slice(0, 20))

  function addNotification(type: NotificationType, title: string, message: string, link?: string, sourceId?: string): void {
    if (sourceId && state.items.some(item => item.sourceId === sourceId)) return
    const item: NotificationItem = {
      id: generateId(),
      type,
      title,
      message,
      link,
      read: false,
      createdAt: Date.now(),
      sourceId,
    }
    state.items.unshift(item)
    if (state.items.length > MAX_NOTIFICATIONS) {
      state.items.length = MAX_NOTIFICATIONS
    }
    persist()
  }

  function markAsRead(id: string): void {
    const item = state.items.find(n => n.id === id)
    if (item) {
      item.read = true
      persist()
    }
  }

  function markAllAsRead(): void {
    state.items.forEach(n => { n.read = true })
    persist()
  }

  function clearAll(): void {
    state.items.length = 0
    persist()
  }

  return {
    state: readonly(state),
    unreadCount,
    recentItems,
    addNotification,
    markAsRead,
    markAllAsRead,
    clearAll,
  }
}
