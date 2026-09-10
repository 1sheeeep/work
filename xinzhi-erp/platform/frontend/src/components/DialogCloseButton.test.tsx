import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DialogCloseButton } from "./DialogCloseButton";

afterEach(cleanup);

describe("DialogCloseButton", () => {
  it("provides an accessible top-right close control", () => {
    const onClick = vi.fn();

    render(<DialogCloseButton onClick={onClick} />);

    const button = screen.getByRole("button", { name: "关闭" });
    expect(button.className).toContain("icon-button");
    expect(button.className).toContain("dialog-close-button");
    expect(button.getAttribute("title")).toBe("关闭");

    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("keeps a busy dialog close control disabled", () => {
    render(<DialogCloseButton disabled />);

    expect(
      (screen.getByRole("button", { name: "关闭" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
