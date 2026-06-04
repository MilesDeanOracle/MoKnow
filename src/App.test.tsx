import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("App theme switching", () => {
  it("switches between night and day themes from the titlebar", async () => {
    const { container } = render(<App />);

    await waitFor(() => expect(screen.getByText("2024-06-04-日记.md")).toBeInTheDocument());

    const appRoot = container.querySelector(".app-root");
    expect(appRoot).toHaveAttribute("data-theme", "night");
    expect(screen.getByRole("button", { name: "切换到白天主题" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "切换到白天主题" }));

    expect(appRoot).toHaveAttribute("data-theme", "day");
    expect(screen.getByRole("button", { name: "切换到黑夜主题" })).toBeInTheDocument();
  });
});
