import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EditorWorkspace } from "./EditorWorkspace";
import { MarkdownService } from "../../services/markdownService";
import type { MarkdownFile } from "../../types/models";

const file: MarkdownFile = {
  id: "source",
  name: "2024-06-04-日记.md",
  path: "2024 › 06月",
  raw: "# 今日\n\n## 计划\n\n- [ ] 写测试",
};

describe("EditorWorkspace", () => {
  it("switches between source split and wysiwyg modes", () => {
    render(<EditorWorkspace file={file} markdownService={new MarkdownService()} onDirtyChange={() => undefined} />);

    expect(screen.getByTestId("editor-source")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "双视图" }));
    const splitEditor = screen.getByTestId("editor-split");
    expect(splitEditor).toBeVisible();
    expect(within(splitEditor).getAllByText(/计划/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "所见即所得" }));
    expect(screen.getByTestId("editor-wysiwyg")).toBeVisible();
  });
});
