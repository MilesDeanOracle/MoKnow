import { afterEach, describe, expect, it } from "vitest";
import {
  AppError,
  ERROR_DIAGNOSTIC_LOG_STORAGE_KEY,
  MAX_ERROR_DIAGNOSTICS,
  appendErrorDiagnostic,
  clearErrorDiagnostics,
  createErrorDiagnostic,
  filterErrorDiagnostics,
  getErrorRecoveryActions,
  loadErrorDiagnostics,
  serializeErrorDiagnostic,
  serializeErrorDiagnosticLog,
} from "./appErrorService";

describe("appErrorService diagnostics", () => {
  afterEach(() => {
    window.localStorage.removeItem(ERROR_DIAGNOSTIC_LOG_STORAGE_KEY);
  });

  it("creates copyable diagnostics with operation and workspace context", () => {
    const error = new AppError(
      "保存 Markdown 文件失败：Permission denied",
      "permission",
      "请检查目标文件或目录的读写权限，或换一个你有权限的仓库位置后重试。",
      "SAVE_MARKDOWN_FILE_FAILED",
      "Permission denied",
    );

    const diagnostic = createErrorDiagnostic(error, "保存文件失败", {
      operation: "保存当前文件",
      repositoryName: "MoKnow 日记仓库",
      repositoryId: "/Users/me/MoKnow",
      fileName: "2026-06-08.md",
      fileId: "/Users/me/MoKnow/日记/2026-06-08.md",
    });
    const text = serializeErrorDiagnostic(diagnostic);

    expect(diagnostic.scenario).toBe("permission");
    expect(diagnostic.operation).toBe("保存当前文件");
    expect(text).toContain("MoKnow 错误诊断");
    expect(text).toContain("操作：保存当前文件");
    expect(text).toContain("错误码：SAVE_MARKDOWN_FILE_FAILED");
    expect(text).toContain("仓库：MoKnow 日记仓库");
    expect(text).toContain("文件：2026-06-08.md");
    expect(text).toContain("建议：请检查目标文件或目录的读写权限");
  });

  it("persists recent diagnostics and clears the log", () => {
    for (let index = 0; index < MAX_ERROR_DIAGNOSTICS + 2; index += 1) {
      appendErrorDiagnostic(createErrorDiagnostic(`错误 ${index}`, "失败", { operation: `操作 ${index}` }));
    }

    const diagnostics = loadErrorDiagnostics();
    expect(diagnostics).toHaveLength(MAX_ERROR_DIAGNOSTICS);
    expect(diagnostics[0].operation).toBe(`操作 ${MAX_ERROR_DIAGNOSTICS + 1}`);

    clearErrorDiagnostics();
    expect(loadErrorDiagnostics()).toEqual([]);
    expect(window.localStorage.getItem(ERROR_DIAGNOSTIC_LOG_STORAGE_KEY)).toBeNull();
  });

  it("filters diagnostics by scenario and query before exporting a log", () => {
    const permissionDiagnostic = createErrorDiagnostic(new AppError(
      "保存失败：Permission denied",
      "permission",
      "请检查目标文件或目录的读写权限，或换一个你有权限的仓库位置后重试。",
      "SAVE_MARKDOWN_FILE_FAILED",
    ), "保存失败", {
      operation: "保存当前文件",
      fileName: "today.md",
    });
    const backupDiagnostic = createErrorDiagnostic(new AppError(
      "备份失败：zip 写入失败",
      "backup",
      "请确认备份文件存在、目标位置可写且磁盘空间充足，然后重新执行备份或恢复。",
      "BACKUP_REPOSITORY_FAILED",
    ), "备份失败", {
      operation: "备份当前仓库",
      fileName: "backup.zip",
    });

    const filtered = filterErrorDiagnostics([permissionDiagnostic, backupDiagnostic], {
      scenario: "permission",
      query: "today",
    });
    const logText = serializeErrorDiagnosticLog(filtered);

    expect(filtered).toEqual([permissionDiagnostic]);
    expect(logText).toContain("MoKnow 错误日志");
    expect(logText).toContain("记录数量：1");
    expect(logText).toContain("保存当前文件");
    expect(logText).not.toContain("备份当前仓库");
  });

  it("suggests operation-level recovery actions", () => {
    const saveDiagnostic = createErrorDiagnostic(new AppError(
      "保存失败：Permission denied",
      "permission",
      "请检查目标文件或目录的读写权限，或换一个你有权限的仓库位置后重试。",
    ), "保存失败", {
      operation: "保存当前文件",
      repositoryId: "/Users/me/MoKnow",
    });
    const exportDiagnostic = createErrorDiagnostic("导出失败", "导出失败", {
      operation: "导出日记合集",
      repositoryId: "/Users/me/MoKnow",
    });
    const pdfDiagnostic = createErrorDiagnostic("导出失败", "导出失败", {
      operation: "导出当前文件为 PDF",
      repositoryId: "/Users/me/MoKnow",
    });

    expect(getErrorRecoveryActions(saveDiagnostic).map((action) => action.id)).toEqual([
      "retry_save",
      "open_repository_folder",
    ]);
    expect(getErrorRecoveryActions(exportDiagnostic)).toEqual([
      { id: "open_journal_export", label: "重新打开合集导出" },
    ]);
    expect(getErrorRecoveryActions(pdfDiagnostic)).toEqual([
      { id: "retry_export_pdf", label: "重试导出 PDF" },
    ]);
  });
});
