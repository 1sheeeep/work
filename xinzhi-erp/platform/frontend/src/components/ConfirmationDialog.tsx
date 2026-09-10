import { type ReactNode, useId } from 'react'
import { DialogCloseButton } from './DialogCloseButton'
import { useDialogFocus } from './useDialogFocus'

type ConfirmationDialogProps = {
  title: string
  description: string
  confirmLabel?: string
  busyLabel?: string
  busy?: boolean
  destructive?: boolean
  children?: ReactNode
  onClose: () => void
  onConfirm: () => void
}

export function ConfirmationDialog({
  title,
  description,
  confirmLabel = '确认',
  busyLabel = '正在处理…',
  busy = false,
  destructive = false,
  children,
  onClose,
  onConfirm,
}: ConfirmationDialogProps) {
  const titleId = useId()
  const descriptionId = useId()
  const { dialogRef, onKeyDown } = useDialogFocus(onClose, busy)
  return <section className="warehouse-dialog-backdrop" role="presentation">
    <section className="warehouse-dialog warehouse-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} aria-busy={busy} ref={dialogRef} tabIndex={-1} onKeyDown={onKeyDown}>
      <header className="table-heading">
        <div><h2 id={titleId}>{title}</h2></div>
        <DialogCloseButton disabled={busy} onClick={onClose} />
      </header>
      <div className="warehouse-confirm-body">
        <p id={descriptionId}>{description}</p>
        {children}
      </div>
      <footer className="warehouse-confirm-actions">
        <button type="button" className="button button-secondary" disabled={busy} data-dialog-initial-focus={destructive ? '' : undefined} onClick={onClose}>返回</button>
        <button className={`button ${destructive ? 'button-danger is-danger' : 'button-primary is-primary'}`} type="button" disabled={busy} data-dialog-initial-focus={!destructive ? '' : undefined} onClick={onConfirm}>
          {busy ? busyLabel : confirmLabel}
        </button>
      </footer>
    </section>
  </section>
}
