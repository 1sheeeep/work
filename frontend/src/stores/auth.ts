import { reactive, readonly } from 'vue'
import { api, ensureCsrf, resetCsrf } from '../services/api'
import type { AuthenticatedUser } from '../types'

const state = reactive<{ user: AuthenticatedUser | null; initialized: boolean }>({ user: null, initialized: false })
let loadPromise: Promise<AuthenticatedUser | null> | null = null

async function loadCurrentUser(): Promise<AuthenticatedUser | null> {
  if (state.initialized) return state.user
  if (!loadPromise) {
    loadPromise = api.get<AuthenticatedUser>('/auth/me')
      .then(({ data }) => { state.user = data; return data })
      .catch(() => { state.user = null; return null })
      .finally(() => { state.initialized = true; loadPromise = null })
  }
  return loadPromise
}

async function login(username: string, password: string): Promise<AuthenticatedUser> {
  await ensureCsrf()
  const { data } = await api.post<AuthenticatedUser>('/auth/login', { username, password })
  state.user = data
  state.initialized = true
  return data
}

async function logout(): Promise<void> {
  await ensureCsrf()
  await api.post('/auth/logout')
  resetCsrf()
  state.user = null
  state.initialized = true
}

export const authStore = { state: readonly(state), loadCurrentUser, login, logout }
