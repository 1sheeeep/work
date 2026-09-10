import { type KeyboardEvent, useEffect, useRef } from 'react'

const selector = 'button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])'

// Shared by existing dialog surfaces; preserves their markup and business actions.
export function useDialogFocus(onClose: () => void, busy = false) {
  const dialogRef = useRef<HTMLElement>(null)
  const focusable = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(selector) ?? [])
    .filter(element => element.tabIndex >= 0 && !element.closest('[hidden], [inert]') && (element.checkVisibility?.() ?? true))

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = dialogRef.current
    // A destructive confirmation explicitly marks its safe return button.
    const initial = dialog?.querySelector<HTMLElement>('[data-dialog-initial-focus]:not(:disabled)')
    const target = initial ?? focusable()[0] ?? dialog
    target?.focus()
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = overflow
      if (opener?.isConnected) opener.focus()
    }
  }, [])

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (!busy) onClose()
      return
    }
    if (event.key !== 'Tab') return
    const items = focusable()
    const first = items[0]
    const last = items.at(-1)
    if (!first || !last) {
      event.preventDefault()
      dialogRef.current?.focus()
    } else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }
  return { dialogRef, onKeyDown }
}
