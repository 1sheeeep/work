import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

type ErpActionButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  label: string;
  tone?: "default" | "danger";
};

export function ErpActionButton({
  label,
  tone = "default",
  className = "",
  ...props
}: ErpActionButtonProps) {
  return (
    <button
      {...props}
      className={`erp-action-button${tone === "danger" ? " is-danger" : ""}${className ? ` ${className}` : ""}`}
    >
      {label}
    </button>
  );
}

/** @deprecated Use ErpActionButton. Kept temporarily so existing pages render readable text actions. */
export function ErpIconButton({ icon: _icon, ...props }: ErpActionButtonProps & { icon: LucideIcon }) {
  return <ErpActionButton {...props} />;
}

export function ErpEmptyState({
  title,
  description,
  action,
  role = "status",
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  role?: "status" | "alert";
}) {
  return (
    <div className="erp-empty-state" role={role}>
      <div className="erp-empty-state-copy">
        <strong>{title}</strong>
        {description ? <span>{description}</span> : null}
      </div>
      {action ? <div className="erp-empty-state-action">{action}</div> : null}
    </div>
  );
}
