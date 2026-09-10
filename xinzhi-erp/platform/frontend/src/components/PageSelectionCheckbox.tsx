import { type InputHTMLAttributes, useEffect, useRef } from "react";

/** The header reports selection on this page, including a partial selection. */
export function PageSelectionCheckbox({ selectedCount, totalCount, ...props }:
  Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "checked" | "defaultChecked"> & {
    selectedCount: number;
    totalCount: number;
  }) {
  const ref = useRef<HTMLInputElement>(null);
  const mixed = selectedCount > 0 && selectedCount < totalCount;
  useEffect(() => { if (ref.current) ref.current.indeterminate = mixed; }, [mixed]);
  return <input {...props} ref={ref} type="checkbox" checked={totalCount > 0 && selectedCount === totalCount} aria-checked={mixed ? "mixed" : totalCount > 0 && selectedCount === totalCount} />;
}
