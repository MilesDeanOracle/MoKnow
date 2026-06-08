import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RepositoryTree } from "./RepositoryTree";
import { mockRepository } from "../../data/mockRepository";
import type { RecentRepository } from "../../types/models";

describe("RepositoryTree", () => {
  it("filters and selects markdown files", () => {
    const onSelect = vi.fn();
    render(<RepositoryTree repository={mockRepository} activeFileId="source" onSelectFile={onSelect} />);

    fireEvent.change(screen.getByPlaceholderText("搜索文件..."), { target: { value: "README" } });
    expect(screen.getByText("README.md")).toBeInTheDocument();
    expect(screen.queryByText("2024-06-04-日记.md")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("README.md"));
    expect(onSelect).toHaveBeenCalledWith("readme");
  });

  it("renders the four fixed categories and exposes journal creation", () => {
    const onCreateJournal = vi.fn();
    render(
      <RepositoryTree
        repository={mockRepository}
        activeFileId="source"
        onSelectFile={vi.fn()}
        onCreateJournal={onCreateJournal}
      />,
    );

    const categoryNames = screen.getAllByTestId("repository-category-name").map((node) => node.textContent);
    expect(categoryNames).toEqual(["收藏", "日记", "文档", "回收站"]);

    fireEvent.click(screen.getByRole("button", { name: "新增日记" }));
    expect(onCreateJournal).toHaveBeenCalledTimes(1);
  });

  it("opens recent repositories from the repository selector", () => {
    const onOpenRepository = vi.fn();
    const onCreateRepository = vi.fn();
    const recentRepositories: RecentRepository[] = [
      { name: "工作日记", rootPath: "D:/Notes/工作日记", openedAt: "2026-06-05T00:00:00.000Z" },
      { name: "旧仓库", rootPath: "D:/Missing/旧仓库", openedAt: "2026-06-04T00:00:00.000Z", missing: true },
    ];

    render(
      <RepositoryTree
        repository={mockRepository}
        activeFileId="source"
        onSelectFile={vi.fn()}
        recentRepositories={recentRepositories}
        onOpenRepository={onOpenRepository}
        onCreateRepository={onCreateRepository}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "切换仓库" }));
    fireEvent.click(screen.getByText("工作日记"));

    expect(onOpenRepository).toHaveBeenCalledWith("D:/Notes/工作日记");

    fireEvent.click(screen.getByRole("button", { name: "切换仓库" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "新建仓库" }));

    expect(onCreateRepository).toHaveBeenCalledTimes(1);
  });
});
