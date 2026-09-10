import { type FormEvent, useRef, useState } from "react";
import { ApiError } from "../api/client";
import {
  MAXIMUM_PASSWORD_LENGTH,
  PASSWORD_POLICY_MESSAGE,
  meetsPasswordPolicy,
} from "../auth/passwordPolicy";
import { DialogActions, IamDialog } from "../pages/iam/Dialog";

export type PasswordSubmission = {
  currentPassword?: string;
  newPassword: string;
};

type PasswordDialogProps = {
  accountName: string;
  description: string;
  requireCurrentPassword: boolean;
  submitLabel: string;
  title: string;
  onClose: () => void;
  onSubmit: (submission: PasswordSubmission) => Promise<void>;
  onSuccess: () => void;
};

function safePasswordMessage(error: unknown, requiresCurrentPassword: boolean) {
  if (error instanceof ApiError) {
    if (error.status === 400)
      return PASSWORD_POLICY_MESSAGE;
    if (error.status === 401)
      return requiresCurrentPassword
        ? "当前密码不正确，或账号当前不可用。"
        : "登录状态已失效，请重新登录后重试。";
    if (error.status === 403)
      return "当前账号没有执行此操作的权限。";
    if (error.status === 404)
      return "目标账号不存在或当前无权访问。";
    if (error.status === 409)
      return "账号状态已变化，请刷新列表后重试。";
  }
  return "密码操作未完成，请稍后重试。";
}

export function PasswordDialog({
  accountName,
  description,
  requireCurrentPassword,
  submitLabel,
  title,
  onClose,
  onSubmit,
  onSuccess,
}: PasswordDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);
  const currentPasswordRef = useRef<HTMLInputElement>(null);
  const newPasswordRef = useRef<HTMLInputElement>(null);
  const confirmPasswordRef = useRef<HTMLInputElement>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlight.current) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const currentPassword = String(values.get("currentPassword") ?? "");
    const newPassword = String(values.get("newPassword") ?? "");
    const confirmation = String(values.get("confirmation") ?? "");

    if (requireCurrentPassword && !currentPassword) {
      setError("请输入当前密码。");
      currentPasswordRef.current?.focus();
      return;
    }
    if (!meetsPasswordPolicy(newPassword)) {
      setError(PASSWORD_POLICY_MESSAGE);
      newPasswordRef.current?.focus();
      return;
    }
    if (newPassword !== confirmation) {
      setError("两次输入的新密码不一致。");
      confirmPasswordRef.current?.focus();
      return;
    }

    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        ...(requireCurrentPassword ? { currentPassword } : {}),
        newPassword,
      });
      form.reset();
      onSuccess();
      onClose();
    } catch (caught) {
      setError(safePasswordMessage(caught, requireCurrentPassword));
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  return (
    <IamDialog
      title={title}
      onClose={() => {
        if (!inFlight.current) onClose();
      }}
    >
      <form className="warehouse-dialog-form password-dialog-form" onSubmit={submit}>
        <p className="password-dialog-copy">{description}</p>
        <dl className="password-account">
          <dt>登录账号</dt>
          <dd>{accountName}</dd>
        </dl>
        {requireCurrentPassword && (
          <label>
            当前密码
            <input
              autoComplete="current-password"
              maxLength={128}
              name="currentPassword"
              ref={currentPasswordRef}
              required
              type="password"
            />
          </label>
        )}
        <label>
          新密码
          <input
            autoComplete="new-password"
            maxLength={MAXIMUM_PASSWORD_LENGTH}
            name="newPassword"
            ref={newPasswordRef}
            required
            type="password"
          />
          <small className="password-requirements">密码不能为空。</small>
        </label>
        <label>
          确认新密码
          <input
            autoComplete="new-password"
            maxLength={MAXIMUM_PASSWORD_LENGTH}
            name="confirmation"
            ref={confirmPasswordRef}
            required
            type="password"
          />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <DialogActions
          onClose={onClose}
          submitting={submitting}
          submitLabel={submitLabel}
        />
      </form>
    </IamDialog>
  );
}
