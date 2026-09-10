import {
  type FormEvent,
  type PropsWithChildren,
  useId,
} from "react";
import { DialogCloseButton } from "../../components/DialogCloseButton";
import { useDialogFocus } from "../../components/useDialogFocus";

export function IamDialog({
  title,
  children,
  onClose,
}: PropsWithChildren<{ title: string; onClose: () => void }>) {
  const { dialogRef, onKeyDown } = useDialogFocus(onClose);
  const titleId = useId();

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className="write-dialog iam-dialog"
        onKeyDown={onKeyDown}
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
      >
        <header className="table-heading">
          <h2 id={titleId}>{title}</h2>
          <DialogCloseButton onClick={onClose} />
        </header>
        {children}
      </section>
    </div>
  );
}

export function DialogActions({
  danger = false,
  onClose,
  submitting,
  submitLabel,
}: {
  danger?: boolean;
  onClose: () => void;
  submitting: boolean;
  submitLabel: string;
}) {
  return (
    <div className="form-actions">
      <button
        className="button button-secondary"
        disabled={submitting}
        onClick={onClose}
        type="button"
      >
        取消
      </button>
      <button
        className={`button ${danger ? "button-danger" : "button-primary"}`}
        disabled={submitting}
        type="submit"
      >
        {submitting ? "正在提交" : submitLabel}
      </button>
    </div>
  );
}

export function formValues(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  return new FormData(event.currentTarget);
}
