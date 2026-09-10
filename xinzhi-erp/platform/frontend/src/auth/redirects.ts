const LOGIN_PATH = '/login'

export function sanitizePostLoginRedirect(value: unknown): string | undefined {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.startsWith('/\\')
  ) {
    return undefined
  }

  try {
    const target = new URL(value, 'https://erp.local')

    if (
      target.origin !== 'https://erp.local' ||
      target.pathname === LOGIN_PATH ||
      target.pathname.startsWith(`${LOGIN_PATH}/`)
    ) {
      return undefined
    }

    return `${target.pathname}${target.search}${target.hash}`
  } catch {
    return undefined
  }
}
