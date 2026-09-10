import { useEffect, useRef } from "react";
import { DialogCloseButton } from "../components/DialogCloseButton";
import type { ActivationCredential } from "./types";

type CredentialDialogProps = {
  credential: ActivationCredential;
  onClose: () => void;
};

export function CredentialDialog({
  credential,
  onClose,
}: CredentialDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previouslyFocused.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable =
        dialogRef.current?.querySelectorAll<HTMLElement>("button");
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      previouslyFocused.current?.focus();
    };
  }, [onClose]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(credential.token);
    } catch {
      /* Selection remains available. */
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <div
        className="login-card credential-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="credential-title"
        ref={dialogRef}
      >
        <header className="credential-dialog-heading">
          <h2 id="credential-title">一次性凭证</h2>
          <DialogCloseButton ref={closeRef} onClick={onClose} />
        </header>
        <p>请立即复制并安全交付。关闭后无法再次查看，系统不会保存此凭证。</p>
        <code className="credential-token">{credential.token}</code>
        <p>过期时间：{credential.expiresAt}</p>
        <div className="table-actions">
          <button
            className="button button-secondary"
            type="button"
            onClick={() => void copy()}
          >
            复制凭证
          </button>
          <button
            className="button button-primary"
            type="button"
            onClick={onClose}
          >
            我已安全保存
          </button>
        </div>
      </div>
    </div>
  );
}
