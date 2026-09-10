import { Languages } from "lucide-react";
import { type Language, type T } from "../features/shared/types";

export function LanguageSelect(props: { value: Language; onChange: (value: Language) => void; t: T }) {
  return (
    <label className="language-select" title={props.t.language}>
      <Languages size={16} />
      <select value={props.value} onChange={(event) => props.onChange(event.target.value as Language)} aria-label={props.t.language}>
        <option value="zh">{props.t.chinese}</option>
        <option value="en">{props.t.english}</option>
      </select>
    </label>
  );
}

