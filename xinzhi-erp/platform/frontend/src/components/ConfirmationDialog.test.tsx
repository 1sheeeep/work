import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConfirmationDialog } from './ConfirmationDialog'

afterEach(cleanup)

describe('shared confirmation keyboard behavior', () => {
  it('starts on the safe action, contains keyboard focus, and restores the opener', () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const onClose = vi.fn()
    const view = render(<ConfirmationDialog title="归档记录" description="归档后不再显示在当前列表。" destructive onClose={onClose} onConfirm={vi.fn()} />)
    const cancel = screen.getByRole('button', { name: '返回' })
    const confirm = screen.getByRole('button', { name: '确认' })
    expect(document.activeElement).toBe(cancel)
    const dialog = screen.getByRole('alertdialog')
    confirm.focus()
    fireEvent.keyDown(confirm, { key: 'Tab' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '关闭' }))
    fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(confirm)
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
    expect(document.getElementById(dialog.getAttribute('aria-describedby')!)?.textContent).toBe('归档后不再显示在当前列表。')
    view.unmount()
    expect(document.activeElement).toBe(opener)
    expect(document.body.style.overflow).not.toBe('hidden')
    opener.remove()
  })

  it('keeps a busy operation open and traps focus even when all buttons are disabled', () => {
    const onClose = vi.fn()
    render(<ConfirmationDialog title="保存" description="保存记录" busy onClose={onClose} onConfirm={vi.fn()} />)
    const dialog = screen.getByRole('alertdialog')
    expect(document.activeElement).toBe(dialog)
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(document.activeElement).toBe(dialog)
  })
})
