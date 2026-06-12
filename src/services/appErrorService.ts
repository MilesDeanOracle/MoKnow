import type { CommandResult } from "../types/models";

export type ErrorScenario =
  | "permission"
  | "missing_path"
  | "disk_space"
  | "attachment"
  | "backup"
  | "conflict"
  | "generic";

export class AppError extends Error {
  constructor(
    message: string,
    readonly scenario: ErrorScenario,
    readonly suggestion: string,
    readonly code?: string,
    readonly detail?: string,
  ) {
    super(`${message}\n${suggestion}`);
    this.name = "AppError";
  }
}

export interface ErrorDiagnosticContext {
  operation: string;
  repositoryName?: string;
  repositoryId?: string;
  fileName?: string;
  fileId?: string;
}

export interface ErrorDiagnostic {
  id: string;
  occurredAt: string;
  operation: string;
  message: string;
  scenario: ErrorScenario;
  suggestion: string;
  code?: string;
  detail?: string;
  repositoryName?: string;
  repositoryId?: string;
  fileName?: string;
  fileId?: string;
  userAgent?: string;
}

export const ERROR_DIAGNOSTIC_LOG_STORAGE_KEY = "moknow:error-diagnostics";
export const MAX_ERROR_DIAGNOSTICS = 20;

export interface ErrorDiagnosticFilter {
  scenario?: ErrorScenario | "all";
  query?: string;
}

export type ErrorRecoveryActionId =
  | "retry_save"
  | "open_backup"
  | "open_restore"
  | "retry_export_html"
  | "retry_export_pdf"
  | "open_journal_export"
  | "open_repository_folder";

export interface ErrorRecoveryAction {
  id: ErrorRecoveryActionId;
  label: string;
}

interface ErrorAdvice {
  scenario: ErrorScenario;
  suggestion: string;
}

const adviceByScenario: Record<ErrorScenario, string> = {
  permission: "请检查目标文件或目录的读写权限，或换一个你有权限的仓库位置后重试。",
  missing_path: "请确认文件或目录仍然存在；如果是同步盘，请等待同步完成后重新打开仓库。",
  disk_space: "请释放磁盘空间，或将仓库移动到剩余空间更充足的位置后重试。",
  attachment: "请确认当前笔记所在目录可写，并检查附件文件名是否合法后重试。",
  backup: "请确认备份文件存在、目标位置可写且磁盘空间充足，然后重新执行备份或恢复。",
  conflict: "请先选择保留当前版本、加载外部版本或另存副本，再继续保存。",
  generic: "请稍后重试；如果问题持续出现，请记录当前操作和错误信息以便排查。",
};

const scenarioKeywords: Array<[ErrorScenario, RegExp]> = [
  ["permission", /permission|denied|access is denied|eacces|eperm|权限|拒绝访问|无权/i],
  ["missing_path", /not found|no such file|enoent|不存在|找不到|目录不存在|文件不存在/i],
  ["disk_space", /no space|not enough space|enospc|磁盘空间|空间不足/i],
  ["attachment", /附件|attachment|paste|clipboard|拖拽|复制/i],
  ["backup", /备份|backup|zip/i],
  ["conflict", /conflict|外部修改|冲突/i],
];

function inferScenario(code: string | undefined, message: string): ErrorScenario {
  const source = `${code ?? ""} ${message}`;
  for (const [scenario, pattern] of scenarioKeywords) {
    if (pattern.test(source)) return scenario;
  }
  return "generic";
}

export function buildErrorAdvice(code: string | undefined, message: string): ErrorAdvice {
  const scenario = inferScenario(code, message);
  return {
    scenario,
    suggestion: adviceByScenario[scenario],
  };
}

export function commandResultToError(result: Pick<CommandResult<unknown>, "message" | "errorCode">, fallbackMessage: string): AppError {
  const detail = result.message?.trim();
  const baseMessage = detail || fallbackMessage;
  const advice = buildErrorAdvice(result.errorCode, baseMessage);
  return new AppError(baseMessage, advice.scenario, advice.suggestion, result.errorCode, detail);
}

function plainErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof AppError) return error.detail || error.message.split("\n")[0] || fallbackMessage;
  if (error instanceof Error) return error.message || fallbackMessage;
  if (typeof error === "string" && error.trim()) return error.trim();
  return fallbackMessage;
}

export function createErrorDiagnostic(error: unknown, fallbackMessage: string, context: ErrorDiagnosticContext): ErrorDiagnostic {
  const message = plainErrorMessage(error, fallbackMessage);
  const advice = error instanceof AppError ? { scenario: error.scenario, suggestion: error.suggestion } : buildErrorAdvice(undefined, message);
  const occurredAt = new Date().toISOString();

  return {
    id: `diag-${occurredAt}-${Math.random().toString(36).slice(2, 8)}`,
    occurredAt,
    operation: context.operation,
    message,
    scenario: advice.scenario,
    suggestion: advice.suggestion,
    code: error instanceof AppError ? error.code : undefined,
    detail: error instanceof AppError ? error.detail : error instanceof Error ? error.stack : undefined,
    repositoryName: context.repositoryName,
    repositoryId: context.repositoryId,
    fileName: context.fileName,
    fileId: context.fileId,
    userAgent: typeof navigator === "undefined" ? undefined : navigator.userAgent,
  };
}

export function serializeErrorDiagnostic(diagnostic: ErrorDiagnostic): string {
  const lines = [
    "MoKnow 错误诊断",
    `时间：${diagnostic.occurredAt}`,
    `操作：${diagnostic.operation}`,
    `场景：${diagnostic.scenario}`,
    diagnostic.code ? `错误码：${diagnostic.code}` : null,
    `错误：${diagnostic.message}`,
    `建议：${diagnostic.suggestion}`,
    diagnostic.repositoryName ? `仓库：${diagnostic.repositoryName}` : null,
    diagnostic.repositoryId ? `仓库路径：${diagnostic.repositoryId}` : null,
    diagnostic.fileName ? `文件：${diagnostic.fileName}` : null,
    diagnostic.fileId ? `文件路径：${diagnostic.fileId}` : null,
    diagnostic.userAgent ? `环境：${diagnostic.userAgent}` : null,
    diagnostic.detail ? `详情：${diagnostic.detail}` : null,
  ];

  return lines.filter((line): line is string => Boolean(line)).join("\n");
}

export function serializeErrorDiagnosticLog(diagnostics: ErrorDiagnostic[]): string {
  const header = [
    "MoKnow 错误日志",
    `导出时间：${new Date().toISOString()}`,
    `记录数量：${diagnostics.length}`,
  ];
  const body = diagnostics.map((diagnostic, index) => [
    `#${index + 1}`,
    serializeErrorDiagnostic(diagnostic),
  ].join("\n"));

  return [...header, ...body].join("\n\n");
}

export function filterErrorDiagnostics(diagnostics: ErrorDiagnostic[], filter: ErrorDiagnosticFilter): ErrorDiagnostic[] {
  const scenario = filter.scenario ?? "all";
  const query = filter.query?.trim().toLowerCase() ?? "";

  return diagnostics.filter((diagnostic) => {
    if (scenario !== "all" && diagnostic.scenario !== scenario) return false;
    if (!query) return true;

    const searchable = [
      diagnostic.operation,
      diagnostic.message,
      diagnostic.suggestion,
      diagnostic.code,
      diagnostic.detail,
      diagnostic.repositoryName,
      diagnostic.repositoryId,
      diagnostic.fileName,
      diagnostic.fileId,
    ].filter(Boolean).join(" ").toLowerCase();

    return searchable.includes(query);
  });
}

export function getErrorRecoveryActions(diagnostic: ErrorDiagnostic): ErrorRecoveryAction[] {
  const actions: ErrorRecoveryAction[] = [];
  const add = (action: ErrorRecoveryAction) => {
    if (!actions.some((item) => item.id === action.id)) {
      actions.push(action);
    }
  };

  if (/保存当前文件/.test(diagnostic.operation)) {
    add({ id: "retry_save", label: "重试保存" });
  }
  if (/备份/.test(diagnostic.operation)) {
    add({ id: "open_backup", label: "重新备份" });
  }
  if (/恢复/.test(diagnostic.operation)) {
    add({ id: "open_restore", label: "重新恢复" });
  }
  if (/导出当前文件为 HTML/.test(diagnostic.operation)) {
    add({ id: "retry_export_html", label: "重试导出 HTML" });
  }
  if (/导出当前文件为 PDF/.test(diagnostic.operation)) {
    add({ id: "retry_export_pdf", label: "重试导出 PDF" });
  }
  if (/导出日记合集/.test(diagnostic.operation)) {
    add({ id: "open_journal_export", label: "重新打开合集导出" });
  }
  if (
    diagnostic.repositoryId &&
    ["permission", "missing_path", "disk_space", "backup"].includes(diagnostic.scenario)
  ) {
    add({ id: "open_repository_folder", label: "打开仓库位置" });
  }

  return actions;
}

function isDiagnostic(value: unknown): value is ErrorDiagnostic {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ErrorDiagnostic>;
  return Boolean(item.id && item.occurredAt && item.operation && item.message && item.scenario && item.suggestion);
}

export function loadErrorDiagnostics(storage: Storage = window.localStorage): ErrorDiagnostic[] {
  try {
    const raw = storage.getItem(ERROR_DIAGNOSTIC_LOG_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isDiagnostic).slice(0, MAX_ERROR_DIAGNOSTICS);
  } catch {
    return [];
  }
}

export function saveErrorDiagnostics(diagnostics: ErrorDiagnostic[], storage: Storage = window.localStorage): ErrorDiagnostic[] {
  const nextDiagnostics = diagnostics.filter(isDiagnostic).slice(0, MAX_ERROR_DIAGNOSTICS);
  storage.setItem(ERROR_DIAGNOSTIC_LOG_STORAGE_KEY, JSON.stringify(nextDiagnostics));
  return nextDiagnostics;
}

export function appendErrorDiagnostic(diagnostic: ErrorDiagnostic, storage: Storage = window.localStorage): ErrorDiagnostic[] {
  return saveErrorDiagnostics([diagnostic, ...loadErrorDiagnostics(storage)], storage);
}

export function clearErrorDiagnostics(storage: Storage = window.localStorage): void {
  storage.removeItem(ERROR_DIAGNOSTIC_LOG_STORAGE_KEY);
}
