import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CredentialDialog } from "./CredentialDialog";

function DialogHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>打开凭证</button>
      {open && (
        <CredentialDialog
          credential={{ token: "one-time", expiresAt: "2026-07-30T00:00:00Z" }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
afterEach(() => cleanup());
describe("CredentialDialog", () => {
  it("cycles Tab in both directions, closes on Escape, and restores invoking focus", () => {
    render(<DialogHarness />);
    const trigger = screen.getByRole("button", { name: "打开凭证" });
    trigger.focus();
    fireEvent.click(trigger);
    const close = screen.getByRole("button", { name: "关闭" });
    const confirmed = screen.getByRole("button", { name: "我已安全保存" });
    expect(document.activeElement).toBe(close);
    confirmed.focus();
    fireEvent.keyDown(confirmed, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(confirmed);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
  it("keeps the dialog usable when clipboard access fails without persisting the token", async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    render(<DialogHarness />);
    fireEvent.click(screen.getByRole("button", { name: "打开凭证" }));
    fireEvent.click(screen.getByRole("button", { name: "复制凭证" }));
    expect(screen.getByRole("dialog").textContent).toContain("one-time");
    expect(
      window.sessionStorage.getItem("xz-erp.platform-admin.credentials") ?? "",
    ).not.toContain("one-time");
    expect(
      window.localStorage.getItem("xz-erp.platform-admin.credentials"),
    ).toBeNull();
  });
});
