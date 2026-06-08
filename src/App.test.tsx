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

  it("asks users to create a real repository before creating journals from the mock repository", async () => {
    render(<App />);

    await waitFor(() => expect(screen.getByText("2024-06-04-日记.md")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "新增日记" }));

    expect(await screen.findByRole("dialog", { name: "新建仓库" })).toBeInTheDocument();
  });

  it("keeps the workspace mounted while creating a journal in a real repository", async () => {
    render(<App />);

    await waitFor(() => expect(screen.getByText("2024-06-04-日记.md")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "新建仓库" }));
    fireEvent.change(screen.getByPlaceholderText("仓库名称"), { target: { value: "真实仓库" } });
    fireEvent.change(screen.getByPlaceholderText("仓库存放位置"), { target: { value: "D:/Notes" } });
    fireEvent.click(screen.getByRole("button", { name: /创\s*建|创建/ }));

    await waitFor(() => expect(screen.getByText("选择或创建一个 Markdown 文件开始记录")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "新增日记" }));

    expect(screen.queryByText("正在加载 MoKnow 仓库...")).not.toBeInTheDocument();
    expect((await screen.findAllByText("2026-06-04.md")).length).toBeGreaterThan(0);
  });
});
