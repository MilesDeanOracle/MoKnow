import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RepositoryTree } from "./RepositoryTree";
import { mockRepository } from "../../data/mockRepository";
import type { RecentRepository, Repository } from "../../types/models";

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

  it("lazily renders collapsed folder children while keeping search complete", () => {
    render(<RepositoryTree repository={mockRepository} activeFileId="source" onSelectFile={vi.fn()} />);

    expect(screen.getByText("项目")).toBeInTheDocument();
    expect(screen.queryByText("README.md")).not.toBeInTheDocument();

    const projectFolder = screen.getByText("项目").closest("button");
    expect(projectFolder).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(projectFolder as HTMLButtonElement);
    expect(screen.getByText("README.md")).toBeInTheDocument();
    expect(projectFolder).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(projectFolder as HTMLButtonElement);
    expect(screen.queryByText("README.md")).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("搜索文件..."), { target: { value: "README" } });
    expect(screen.getByText("README.md")).toBeInTheDocument();
  });

  it("renders diary calendar status and opens selected dates", () => {
    const onOpenCalendarDate = vi.fn();
    const onCalendarMonthChange = vi.fn();
    render(
      <RepositoryTree
        repository={mockRepository}
        activeFileId="source"
        calendarMonth={new Date(2026, 5, 1)}
        calendarSelectedDate="2026-06-12"
        calendarStatuses={[{ date: "2026-06-12", exists: true, path: "日记/2026/06/2026-06-12.md" }]}
        onSelectFile={vi.fn()}
        onCalendarMonthChange={onCalendarMonthChange}
        onOpenCalendarDate={onOpenCalendarDate}
      />,
    );

    expect(screen.getByText("2026年06月")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2026-06-12 已写" })).toHaveClass("written");

    fireEvent.click(screen.getByRole("button", { name: "2026-06-12 已写" }));
    expect(onOpenCalendarDate).toHaveBeenCalledWith("2026-06-12");

    fireEvent.click(screen.getByRole("button", { name: "下个月" }));
    expect(onCalendarMonthChange).toHaveBeenCalledWith(new Date(2026, 6, 1));
  });

  it("renders recent files and exposes pin and favorite actions", () => {
    const onOpenRecentFile = vi.fn();
    const onClearRecentFiles = vi.fn();
    const onTogglePinned = vi.fn();
    const onToggleFavorite = vi.fn();

    render(
      <RepositoryTree
        repository={mockRepository}
        activeFileId="source"
        recentOpenedFiles={[{ fileId: "source", name: "2024-06-04-日记.md", relativePath: "日记/2024/06/2024-06-04-日记.md", isPinned: true }]}
        recentEditedFiles={[{ fileId: "readme", name: "README.md", relativePath: "文档/项目/README.md", isPinned: false }]}
        onSelectFile={vi.fn()}
        onOpenRecentFile={onOpenRecentFile}
        onClearRecentFiles={onClearRecentFiles}
        onTogglePinned={onTogglePinned}
        onToggleFavorite={onToggleFavorite}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "2024-06-04-日记.md" })[0]);
    expect(onOpenRecentFile).toHaveBeenCalledWith("source");

    fireEvent.click(screen.getByRole("button", { name: "清空最近打开" }));
    expect(onClearRecentFiles).toHaveBeenCalledWith("opened");

    fireEvent.click(screen.getAllByRole("button", { name: /置顶|取消置顶/ })[0]);
    expect(onTogglePinned).toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole("button", { name: /收藏|取消收藏/ })[0]);
    expect(onToggleFavorite).toHaveBeenCalled();
  });

  it("exposes rename show trash and restore actions", () => {
    const repositoryWithTrash: Repository = {
      ...mockRepository,
      files: mockRepository.files.map((category) =>
        category.category === "trash"
          ? {
              ...category,
              children: [
                {
                  id: "trash-1",
                  name: "旧日记.md",
                  path: "回收站/旧日记.md",
                  type: "markdown",
                  depth: 1,
                  deletedAt: "2026-06-04T00:00:00.000Z",
                },
              ],
            }
          : category,
      ),
    };
    const onRenameEntry = vi.fn();
    const onShowInFolder = vi.fn();
    const onMoveToTrash = vi.fn();
    const onRestoreTrashEntry = vi.fn();
    const onDeleteTrashEntry = vi.fn();
    const onClearTrash = vi.fn();

    render(
      <RepositoryTree
        repository={repositoryWithTrash}
        activeFileId="source"
        onSelectFile={vi.fn()}
        onRenameEntry={onRenameEntry}
        onShowInFolder={onShowInFolder}
        onMoveToTrash={onMoveToTrash}
        onRestoreTrashEntry={onRestoreTrashEntry}
        onDeleteTrashEntry={onDeleteTrashEntry}
        onClearTrash={onClearTrash}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: /重命名/ })[0]);
    expect(onRenameEntry).toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole("button", { name: /显示位置/ })[0]);
    expect(onShowInFolder).toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole("button", { name: /移入回收站/ })[0]);
    expect(onMoveToTrash).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "恢复 旧日记.md" }));
    expect(onRestoreTrashEntry).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "彻底删除 旧日记.md" }));
    expect(onDeleteTrashEntry).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "清空回收站" }));
    expect(onClearTrash).toHaveBeenCalledTimes(1);
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
