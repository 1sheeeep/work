import { ReactNode } from "react";

export function Panel(props: { title: string; icon: ReactNode; className?: string; children: ReactNode }) {
  return <section className={`platform-panel ${props.className || ""}`}><header className="panel-title">{props.icon}<h2>{props.title}</h2></header>{props.children}</section>;
}

export function NavButton(props: { active: boolean; icon: ReactNode; label: string; attention?: boolean; disabled?: boolean; onClick: () => void }) {
  const label = `${props.label}${props.attention ? "，有待处理工单" : ""}`;
  return <button type="button" className={`nav-button ${props.active ? "active" : ""}`} disabled={props.disabled} onClick={props.onClick} title={label} aria-label={label}>{props.icon}<span>{props.label}</span>{props.attention ? <i className="nav-attention-dot" aria-hidden="true" /> : null}</button>;
}

export function Badge(props: { tone: "blue" | "green" | "warning" | "danger" | "muted"; children: ReactNode }) {
  return <span className={`platform-badge ${props.tone}`}>{props.children}</span>;
}

export function Empty(props: { text: string }) {
  return <div className="platform-empty">{props.text}</div>;
}
