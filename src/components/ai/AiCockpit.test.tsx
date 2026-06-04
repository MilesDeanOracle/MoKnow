import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AiCockpit } from "./AiCockpit";
import { AiCockpitService } from "../../services/aiCockpitService";

describe("AiCockpit", () => {
  it("adds user and assistant messages when asking a question", async () => {
    render(
      <AiCockpit
        aiService={new AiCockpitService()}
        context={{
          fileName: "2024-06-04-日记.md",
          filePath: "2024 › 06月",
          repositoryName: "MoKnow 日记仓库",
        }}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("问我任何关于你笔记的问题..."), {
      target: { value: "生成摘要" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送 ↑" }));

    expect(screen.getAllByText("生成摘要").length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getAllByText(/2024-06-04-日记\.md/).length).toBeGreaterThan(0));
  });
});
