import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RepositoryTree } from "./RepositoryTree";
import { mockRepository } from "../../data/mockRepository";

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
});
