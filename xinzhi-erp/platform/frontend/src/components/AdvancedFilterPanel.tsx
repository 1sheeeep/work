import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import { DialogCloseButton } from "./DialogCloseButton";

const focusableSelector = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[href]",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function AdvancedFilterPanel({
  activeCount = 0,
  children,
  className = "",
  actions,
  appliedKey,
}: {
  activeCount?: number;
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
  /** Close only after the owner accepts a new query, never before validation. */
  appliedKey?: string;
}) {
  const [open, setOpen] = useState(false);
  const dialogId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const previousAppliedKey = useRef(appliedKey);

  useEffect(() => {
    if (previousAppliedKey.current !== appliedKey) setOpen(false);
    previousAppliedKey.current = appliedKey;
  }, [appliedKey]);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      openerRef.current?.focus();
    };
  }, [open]);

  const showDialog = () => {
    openerRef.current = triggerRef.current;
    setOpen(true);
  };

  const hideDialog = () => setOpen(false);

  const onDialogKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      hideDialog();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;

    const elements = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector),
    ).filter(element => element.tabIndex >= 0 && !element.closest('[hidden], [inert]') && (element.checkVisibility?.() ?? true));
    if (elements.length === 0) return;
    const first = elements[0];
    const last = elements[elements.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className={`advanced-filter-panel ${className}`.trim()}>
      <button
        aria-controls={dialogId}
        aria-expanded={open}
        className="advanced-filter-trigger"
        onClick={showDialog}
        ref={triggerRef}
        type="button"
      >
        <span className="advanced-filter-summary-title">
          <SlidersHorizontal size={15} aria-hidden="true" />
          高级搜索
        </span>
        {activeCount > 0 && (
          <span className="advanced-filter-count" data-count={activeCount}>
            已设置 {activeCount} 项
          </span>
        )}
        <span className="advanced-filter-summary-state">
          <Search size={14} aria-hidden="true" />
        </span>
      </button>
      <div
        className="advanced-filter-overlay"
        hidden={!open}
        onMouseDown={(event) => {
          if (event.currentTarget === event.target) hideDialog();
        }}
        role="presentation"
      >
        <section
          aria-labelledby={`${dialogId}-title`}
          aria-modal="true"
          className="advanced-filter-dialog"
          id={dialogId}
          onKeyDown={onDialogKeyDown}
          ref={dialogRef}
          role="dialog"
        >
          {open && (
            <header className="advanced-filter-dialog-header">
              <div>
                <h2 id={`${dialogId}-title`}>高级搜索</h2>
                <p>组合筛选当前列表；关闭保留已填条件，点击应用筛选后查询。</p>
              </div>
              {activeCount > 0 && (
                <span className="advanced-filter-count" data-count={activeCount}>
                  已设置 {activeCount} 项
                </span>
              )}
              <DialogCloseButton
                label="关闭高级搜索"
                onClick={hideDialog}
                ref={closeButtonRef}
              />
            </header>
          )}
          <div className="advanced-filter-body">
            <div className="advanced-filter-sections">{children}</div>
          </div>
          {actions && (
            <footer className="advanced-filter-actions">
              <div>{actions}</div>
            </footer>
          )}
        </section>
      </div>
    </div>
  );
}

export function AdvancedFilterSection({
  title,
  description,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`advanced-filter-section ${className}`.trim()}>
      <header>
        <h3>{title}</h3>
        {description && <p>{description}</p>}
      </header>
      {children}
    </section>
  );
}
