import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ShopifyAuthorizationLink } from './ShopifyAuthorizationLink'

const originalClipboard = navigator.clipboard

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: originalClipboard,
  })
})

describe('ShopifyAuthorizationLink', () => {
  it('copies the link and keeps browser authorization manual', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    const authorizationUrl = 'https://authorization.example/shopify/oauth/authorize?grant=safe'

    render(<ShopifyAuthorizationLink authorizationUrl={authorizationUrl} />)
    fireEvent.click(screen.getByRole('button', { name: '复制安装链接' }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(authorizationUrl))
    expect(screen.getByText(/安装链接已复制/)).toBeTruthy()
    expect(screen.getByText(/请勿在其他店铺的浏览器中打开/)).toBeTruthy()
  })
})
