import { X } from "lucide-react";
import {
  forwardRef,
  type ButtonHTMLAttributes,
} from "react";

type DialogCloseButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-label" | "children" | "type"
> & {
  label?: string;
};

export const DialogCloseButton = forwardRef<
  HTMLButtonElement,
  DialogCloseButtonProps
>(function DialogCloseButton(
  { className, label = "关闭", title, ...props },
  ref,
) {
  return (
    <button
      {...props}
      ref={ref}
      aria-label={label}
      className={["icon-button", "dialog-close-button", className]
        .filter(Boolean)
        .join(" ")}
      data-dialog-close
      title={title ?? label}
      type="button"
    >
      <X aria-hidden="true" size={18} strokeWidth={2} />
    </button>
  );
});
