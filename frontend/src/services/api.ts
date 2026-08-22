import axios, { AxiosError } from 'axios'
import type { ApiErrorBody } from '../types'

export const api = axios.create({
  baseURL: '/api', timeout: 12_000, withCredentials: true, withXSRFToken: false,
  xsrfCookieName: 'XSRF-TOKEN', xsrfHeaderName: 'X-XSRF-TOKEN',
})

let csrfPromise: Promise<void> | null = null

export async function ensureCsrf(): Promise<void> {
  if (!csrfPromise) {
    csrfPromise = api.get<{ headerName: string; token: string }>('/auth/csrf')
      .then(({ data }) => {
        api.defaults.headers.common[data.headerName] = data.token
      })
      .catch((error) => {
        csrfPromise = null
        throw error
      })
  }
  await csrfPromise
}

export function resetCsrf(): void {
  csrfPromise = null
  delete api.defaults.headers.common['X-XSRF-TOKEN']
}

export function apiErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const body = (error as AxiosError<ApiErrorBody>).response?.data
    if (body?.message) return body.message
    if (error.code === 'ECONNABORTED') return '请求超时，请检查服务状态后重试'
  }
  return fallback
}

export function apiFieldErrors(error: unknown): Record<string, string> {
  if (!axios.isAxiosError(error)) return {}
  return (error as AxiosError<ApiErrorBody>).response?.data?.fieldErrors ?? {}
}
