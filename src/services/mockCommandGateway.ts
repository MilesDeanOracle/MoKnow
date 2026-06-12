import { mockFiles, mockRepository } from "../data/mockRepository";
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatterService";
import type { CommandGateway } from "./commandGateway";
import type {
  AttachmentResult,
  BackupRepositoryInput,
  BackupResult,
  CommandResult,
  CredentialStatus,
  CursorPosition,
  DiaryDateStatus,
  DiarySettings,
  ExportHtmlToPathInput,
  ExportResult,
  FavoriteTargetKind,
  FileChangeStatus,
  FileNode,
  InboxItem,
  MarkdownFile,
  OrganizeView,
  RecentFile,
  RecentRepository,
  Repository,
  RestoreBackupInput,
  RestoreBackupResult,
  RestorePreviewResult,
  RestoreStrategy,
  SaveResult,
  SearchFilters,
  SearchResult,
  TagSummary,
  WorkspaceState,
} from "../types/models";

function cloneRepository(repository: Repository): Repository {
  return JSON.parse(JSON.stringify(repository)) as Repository;
}

let mockClockTick = 0;

function nowIso(): string {
  mockClockTick += 1;
  return new Date(Date.UTC(2026, 5, 4, 8, 0, 0, mockClockTick)).toISOString();
}

function withModifiedAt(file: MarkdownFile): MarkdownFile {
  return { ...file, modifiedAt: file.modifiedAt ?? nowIso() };
}

interface MockFileMetadata {
  lastOpenedAt?: string;
  lastEditedAt?: string;
  isPinned: boolean;
}

function createCategory(id: string, name: string, isVirtual = false): FileNode {
  return {
    id,
    name,
    path: name,
    type: "category",
    depth: 0,
    category: id === "documents" ? "documents" : id === "favorites" ? "favorites" : id === "journal" ? "journal" : "trash",
    isVirtual,
    children: [],
  };
}

function findCategory(repository: Repository, id: string): FileNode {
  const category = repository.files.find((node) => node.id === id);
  if (!category) {
    throw new Error(`缺少分类：${id}`);
  }

  category.children ??= [];
  return category;
}

function upsertDirectoryPath(repository: Repository, directoryPath: string, diaryRoot: string): FileNode {
  const journal = findCategory(repository, "journal");
  const parts = directoryPath.split("/").filter(Boolean);
  if (parts[0] === diaryRoot || parts[0] === journal.name) {
    parts.shift();
  }

  let parent = journal;
  let currentPath = diaryRoot;
  for (const part of parts) {
    currentPath = currentPath ? `${currentPath}/${part}` : part;
    parent.children ??= [];
    let nextNode = parent.children.find((node) => node.path === currentPath);
    if (!nextNode) {
      nextNode = {
        id: currentPath,
        name: part,
        path: currentPath,
        type: "directory",
        depth: depthFromPath(currentPath),
        children: [],
      };
      parent.children.push(nextNode);
    }
    nextNode.children ??= [];
    parent = nextNode;
  }

  return parent;
}

function findNodeByPath(nodes: FileNode[], path: string): FileNode | null {
  for (const node of nodes) {
    if (node.path === path || node.contentKey === path) return node;
    const child = node.children ? findNodeByPath(node.children, path) : null;
    if (child) return child;
  }

  return null;
}

function findParentNode(nodes: FileNode[], childPath: string): FileNode | null {
  for (const node of nodes) {
    if (node.children?.some((child) => child.path === childPath || child.contentKey === childPath)) {
      return node;
    }
    const parent = node.children ? findParentNode(node.children, childPath) : null;
    if (parent) return parent;
  }

  return null;
}

function removeNodeByPath(nodes: FileNode[], path: string): { nodes: FileNode[]; removed: FileNode | null } {
  let removed: FileNode | null = null;
  const nextNodes = nodes
    .map((node) => {
      if (node.path === path || node.contentKey === path) {
        removed = node;
        return null;
      }
      if (node.children) {
        const result = removeNodeByPath(node.children, path);
        if (result.removed) {
          removed = result.removed;
          return { ...node, children: result.nodes };
        }
      }
      return node;
    })
    .filter(Boolean) as FileNode[];

  return { nodes: nextNodes, removed };
}

function updateNodePaths(nodes: FileNode[], oldPath: string, newPath: string): FileNode[] {
  return nodes.map((node) => {
    const path = node.path === oldPath || node.path.startsWith(`${oldPath}/`) ? node.path.replace(oldPath, newPath) : node.path;
    return {
      ...node,
      path,
      name: node.path === oldPath ? newPath.split("/").at(-1) ?? node.name : node.name,
      children: node.children ? updateNodePaths(node.children, oldPath, newPath) : node.children,
    };
  });
}

function updateNodeFavoriteFlag(nodes: FileNode[], path: string, isFavorite: boolean): FileNode[] {
  return nodes.map((node) => ({
    ...node,
    isFavorite: node.path === path || node.contentKey === path ? isFavorite : node.isFavorite,
    children: node.children ? updateNodeFavoriteFlag(node.children, path, isFavorite) : node.children,
  }));
}

function depthFromPath(path: string): number {
  return path.split("/").filter(Boolean).length;
}

function collectMarkdownNodes(nodes: FileNode[]): FileNode[] {
  return nodes.flatMap((node) => {
    const self = node.type === "markdown" ? [node] : [];
    return [...self, ...(node.children ? collectMarkdownNodes(node.children) : [])];
  });
}

function fileTags(raw: string): string[] {
  const value = parseFrontmatter(raw).data.tags;
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((tag) => tag.trim()).filter(Boolean);
  return [];
}

function fileDate(raw: string): string | undefined {
  const value = parseFrontmatter(raw).data.date;
  return value ? String(value) : undefined;
}

function pathDate(path: string): string | undefined {
  return path.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function searchSnippet(raw: string, query: string) {
  const body = parseFrontmatter(raw).body.replace(/\s+/g, " ").trim();
  if (!query.trim()) {
    const snippet = body.slice(0, 96);
    return { snippet, highlightedSnippet: snippet };
  }

  const lowerBody = body.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const index = lowerBody.indexOf(lowerQuery);
  const start = index > -1 ? Math.max(0, index - 36) : 0;
  const snippet = body.slice(start, start + 120);
  const highlightedSnippet = snippet.replace(new RegExp(escapeRegExp(query), "gi"), (match) => `<mark>${match}</mark>`);
  return { snippet, highlightedSnippet };
}

const defaultDiaryTemplate = "# {{date}} {{weekday}}\n\n## 今天发生了什么\n\n## 情绪\n\n## 想法\n\n## 明天要做\n";

const weekdayNames = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];

function dateParts(date: string) {
  const [year, month, day] = date.split("-");
  const dateValue = new Date(`${date}T00:00:00`);
  return {
    date,
    weekday: weekdayNames[dateValue.getDay()] ?? "",
    YYYY: year,
    YY: year.slice(-2),
    MM: month,
    DD: day,
  };
}

function replaceDiaryTokens(pattern: string, settings: DiarySettings, date: string): string {
  const parts = dateParts(date);
  return pattern
    .replaceAll("{diaryRoot}", settings.diaryRoot)
    .replaceAll("{YYYY-MM-DD}", parts.date)
    .replaceAll("{YYYY}", parts.YYYY)
    .replaceAll("{YY}", parts.YY)
    .replaceAll("{MM}", parts.MM)
    .replaceAll("{DD}", parts.DD)
    .replaceAll("{{date}}", parts.date)
    .replaceAll("{{weekday}}", parts.weekday);
}

function defaultDiaryRaw(settings: DiarySettings, date: string): string {
  return replaceDiaryTokens(settings.diaryTemplate, settings, date);
}

function journalPathForDate(settings: DiarySettings, date: string): { directoryPath: string; fileName: string; path: string } {
  const directoryPath = replaceDiaryTokens(settings.diaryPathPattern, settings, date).replace(/\\/g, "/").replace(/\/$/, "");
  const fileName = replaceDiaryTokens(settings.diaryFileNamePattern, settings, date);
  return { directoryPath, fileName, path: `${directoryPath}/${fileName}` };
}

function nextMockJournalFileName(repository: Repository, settings: DiarySettings): { fileName: string; path: string; parent: FileNode } {
  const today = journalPathForDate(settings, "2026-06-04");
  const parent = upsertDirectoryPath(repository, today.directoryPath, settings.diaryRoot);
  const existing = new Set((parent.children ?? []).map((node) => node.name));
  if (!existing.has(today.fileName)) return { fileName: today.fileName, path: today.path, parent };

  let index = 2;
  const dotIndex = today.fileName.lastIndexOf(".");
  const baseName = dotIndex > -1 ? today.fileName.slice(0, dotIndex) : today.fileName;
  const extension = dotIndex > -1 ? today.fileName.slice(dotIndex) : "";
  while (existing.has(`${baseName}-${index}${extension}`)) {
    index += 1;
  }

  return {
    fileName: `${baseName}-${index}${extension}`,
    path: `${today.directoryPath}/${baseName}-${index}${extension}`,
    parent,
  };
}

function openMockJournalForDate(repository: Repository, settings: DiarySettings, date: string): MarkdownFile {
  const { directoryPath, fileName: name, path } = journalPathForDate(settings, date);
  const existing = mockFiles[path];
  const parent = upsertDirectoryPath(repository, directoryPath, settings.diaryRoot);
  parent.children ??= [];
  if (!parent.children.some((node) => node.path === path || node.contentKey === path)) {
    parent.children.push({
      id: path,
      name,
      path,
      type: "markdown",
      depth: depthFromPath(path),
      contentKey: path,
    });
  }
  if (existing) return existing;

  const file: MarkdownFile = {
    id: path,
    name,
    path,
    raw: defaultDiaryRaw(settings, date),
    modifiedAt: nowIso(),
  };
  mockFiles[path] = file;
  return file;
}

export function createMockCommandGateway(): CommandGateway {
  let repository = cloneRepository(mockRepository);
  const workspaceStates = new Map<string, WorkspaceState>();
  const fileMetadata = new Map<string, MockFileMetadata>();
  let mockInboxItems: InboxItem[] = [];
  const trashRecords = new Map<string, { originalPath: string; node: FileNode }>();
  const recentRepositories: RecentRepository[] = [
    { name: repository.name, rootPath: repository.rootPath, openedAt: "2026-06-04T00:00:00.000Z" },
  ];
  let diarySettings: DiarySettings = {
    autoOpenToday: true,
    diaryRoot: "日记",
    diaryPathPattern: "{diaryRoot}/{YYYY}/{MM}",
    diaryFileNamePattern: "{YYYY-MM-DD}.md",
    diaryTemplate: defaultDiaryTemplate,
  };
  const tagColors = new Map<string, string>();
  const secureCredentials = new Map<string, string>();
  const defaultWorkspaceState = (repositoryId: string): WorkspaceState => ({
    repositoryId,
    ...diarySettings,
    autoOpenToday: repositoryId !== "daily" && diarySettings.autoOpenToday,
    lastEditMode: "source",
  });

  const touchFile = (fileId: string, event: "opened" | "edited") => {
    const metadata = fileMetadata.get(fileId) ?? { isPinned: false };
    if (event === "opened") metadata.lastOpenedAt = new Date().toISOString();
    if (event === "edited") metadata.lastEditedAt = new Date().toISOString();
    fileMetadata.set(fileId, metadata);
  };

  const updatePinnedFlag = (nodes: FileNode[], path: string, pinned: boolean): FileNode[] =>
    nodes.map((node) => ({
      ...node,
      isPinned: node.path === path || node.contentKey === path ? pinned : node.isPinned,
      children: node.children ? updatePinnedFlag(node.children, path, pinned) : node.children,
    }));

  const recentFiles = (listKind: "opened" | "edited"): RecentFile[] =>
    [...fileMetadata.entries()]
      .filter(([, metadata]) => (listKind === "opened" ? metadata.lastOpenedAt : metadata.lastEditedAt))
      .sort((left, right) => {
        const pinnedDelta = Number(right[1].isPinned) - Number(left[1].isPinned);
        if (pinnedDelta) return pinnedDelta;
        const leftTime = listKind === "opened" ? left[1].lastOpenedAt : left[1].lastEditedAt;
        const rightTime = listKind === "opened" ? right[1].lastOpenedAt : right[1].lastEditedAt;
        return String(rightTime).localeCompare(String(leftTime));
      })
      .slice(0, 10)
      .map(([fileId, metadata]) => ({
        fileId,
        name: fileId.split("/").at(-1) ?? fileId,
        relativePath: fileId,
        lastOpenedAt: metadata.lastOpenedAt,
        lastEditedAt: metadata.lastEditedAt,
        isPinned: metadata.isPinned,
      }));

  return {
    async getMockRepository(): Promise<CommandResult<Repository>> {
      return { success: true, data: cloneRepository(repository) };
    },

    async createRepository(name: string, basePath: string): Promise<CommandResult<Repository>> {
      const normalizedBasePath = basePath.replace(/\\/g, "/").replace(/\/$/, "");
      repository = {
        id: `${normalizedBasePath}/${name}`,
        name,
        rootPath: `${normalizedBasePath}/${name}`,
        files: [
          createCategory("favorites", "收藏", true),
          createCategory("journal", "日记"),
          createCategory("documents", "文档"),
          createCategory("trash", "回收站"),
        ],
      };
      recentRepositories.unshift({ name, rootPath: repository.rootPath, openedAt: new Date().toISOString() });
      return { success: true, data: cloneRepository(repository) };
    },

    async openRepository(): Promise<CommandResult<Repository>> {
      return { success: true, data: cloneRepository(repository) };
    },

    async openLastRepository(): Promise<CommandResult<Repository>> {
      return { success: true, data: cloneRepository(repository) };
    },

    async listRecentRepositories(): Promise<CommandResult<RecentRepository[]>> {
      return { success: true, data: [...recentRepositories] };
    },

    async listRecentFiles(_repositoryId: string, listKind: string): Promise<CommandResult<RecentFile[]>> {
      if (listKind !== "opened" && listKind !== "edited") {
        return { success: false, message: "最近文件类型无效" };
      }
      return { success: true, data: recentFiles(listKind) };
    },

    async clearRecentFiles(_repositoryId: string, listKind: string): Promise<CommandResult<boolean>> {
      for (const [fileId, metadata] of fileMetadata.entries()) {
        if (listKind === "opened" || listKind === "all") metadata.lastOpenedAt = undefined;
        if (listKind === "edited" || listKind === "all") metadata.lastEditedAt = undefined;
        fileMetadata.set(fileId, metadata);
      }
      return { success: true, data: true };
    },

    async listInboxEntries(): Promise<CommandResult<InboxItem[]>> {
      return { success: true, data: [...mockInboxItems] };
    },

    async appendInboxEntry(_repositoryId: string, content: string): Promise<CommandResult<InboxItem[]>> {
      const trimmed = content.trim();
      if (!trimmed) return { success: false, message: "快速记录内容不能为空" };
      mockInboxItems = [
        {
          id: `mock-inbox-${mockClockTick + 1}`,
          createdAt: nowIso(),
          content: trimmed,
        },
        ...mockInboxItems,
      ];
      return { success: true, data: [...mockInboxItems] };
    },

    async clearInboxEntries(_repositoryId: string, entryIds: string[]): Promise<CommandResult<InboxItem[]>> {
      mockInboxItems = entryIds.length
        ? mockInboxItems.filter((item) => !entryIds.includes(item.id))
        : [];
      return { success: true, data: [...mockInboxItems] };
    },

    async moveInboxEntriesToToday(_repositoryId: string, entryIds: string[]): Promise<CommandResult<MarkdownFile>> {
      const selected = mockInboxItems.filter((item) => entryIds.includes(item.id));
      if (!selected.length) return { success: false, message: "请选择要整理到今日日记的收件箱内容" };
      const today = openMockJournalForDate(repository, diarySettings, "2026-06-04");
      today.raw = `${today.raw.trimEnd()}\n\n## 收件箱整理\n\n${selected
        .map((item) => `- ${item.createdAt}：${item.content.replace(/\n/g, "\n  ")}`)
        .join("\n")}\n`;
      today.modifiedAt = nowIso();
      mockFiles[today.id] = today;
      touchFile(today.id, "opened");
      touchFile(today.id, "edited");
      mockInboxItems = mockInboxItems.filter((item) => !entryIds.includes(item.id));
      return { success: true, data: { ...today } };
    },

    async listOrganizeView(_repositoryId: string): Promise<CommandResult<OrganizeView>> {
      const markdownNodes = collectMarkdownNodes(repository.files);
      const untaggedJournals = markdownNodes
        .filter((node) => node.path.startsWith(diarySettings.diaryRoot))
        .map((node) => {
          const file = mockFiles[node.contentKey ?? node.path];
          if (!file || fileTags(file.raw).length) return null;
          const snippet = searchSnippet(file.raw, "");
          return {
            fileId: node.contentKey ?? node.path,
            name: node.name,
            relativePath: node.path,
            snippet: snippet.snippet,
            highlightedSnippet: snippet.highlightedSnippet,
            diaryDate: fileDate(file.raw) ?? pathDate(node.path),
            tags: [],
            score: 0,
          } satisfies SearchResult;
        })
        .filter(Boolean) as SearchResult[];
      const favoriteNodes = collectMarkdownNodes(findCategory(repository, "favorites").children ?? []);
      const favorites = favoriteNodes.map((node) => ({
        fileId: node.contentKey ?? node.path,
        name: node.name,
        relativePath: node.path,
        lastOpenedAt: fileMetadata.get(node.contentKey ?? node.path)?.lastOpenedAt,
        lastEditedAt: fileMetadata.get(node.contentKey ?? node.path)?.lastEditedAt,
        isPinned: fileMetadata.get(node.contentKey ?? node.path)?.isPinned ?? false,
      }));
      return {
        success: true,
        data: {
          inbox: [...mockInboxItems],
          untaggedJournals,
          recentEdited: recentFiles("edited"),
          favorites,
        },
      };
    },

    async listTags(): Promise<CommandResult<TagSummary[]>> {
      const counts = new Map<string, number>();
      for (const node of collectMarkdownNodes(repository.files)) {
        const raw = mockFiles[node.contentKey ?? node.path]?.raw ?? "";
        for (const tag of fileTags(raw)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }

      return {
        success: true,
        data: [...new Set([...counts.keys(), ...tagColors.keys()])]
          .map((name) => [name, counts.get(name) ?? 0] as const)
          .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "zh-Hans-CN"))
          .map(([name, count]) => ({ name, color: tagColors.get(name), count })),
      };
    },

    async setTagColor(_repositoryId: string, tagName: string, color: string): Promise<CommandResult<TagSummary[]>> {
      tagColors.set(tagName, color);
      return this.listTags(_repositoryId);
    },

    async renameTag(_repositoryId: string, oldName: string, newName: string): Promise<CommandResult<TagSummary[]>> {
      for (const file of Object.values(mockFiles)) {
        const parsed = parseFrontmatter(file.raw);
        const tags = fileTags(file.raw);
        if (!tags.includes(oldName)) continue;
        const nextTags = Array.from(new Set(tags.map((tag) => (tag === oldName ? newName : tag))));
        file.raw = stringifyFrontmatter({ ...parsed.data, tags: nextTags }, parsed.body);
      }
      if (tagColors.has(oldName) && !tagColors.has(newName)) {
        tagColors.set(newName, tagColors.get(oldName) ?? "#4f8ef7");
      }
      tagColors.delete(oldName);
      return this.listTags(_repositoryId);
    },

    async deleteTag(_repositoryId: string, tagName: string): Promise<CommandResult<TagSummary[]>> {
      for (const file of Object.values(mockFiles)) {
        const parsed = parseFrontmatter(file.raw);
        const tags = fileTags(file.raw);
        if (!tags.includes(tagName)) continue;
        file.raw = stringifyFrontmatter({ ...parsed.data, tags: tags.filter((tag) => tag !== tagName) }, parsed.body);
      }
      tagColors.delete(tagName);
      return this.listTags(_repositoryId);
    },

    async searchFiles(_repositoryId: string, filters: SearchFilters): Promise<CommandResult<SearchResult[]>> {
      const query = filters.query?.trim() ?? "";
      const results = collectMarkdownNodes(repository.files)
        .map((node) => {
          const file = mockFiles[node.contentKey ?? node.path];
          if (!file) return null;
          const tags = fileTags(file.raw);
          const diaryDate = fileDate(file.raw) ?? pathDate(node.path);
          const category = node.path.startsWith(diarySettings.diaryRoot) ? "journal" : "document";
          const searchable = `${node.name}\n${node.path}\n${parseFrontmatter(file.raw).body}\n${tags.join(" ")}`.toLowerCase();

          if (filters.fileType && filters.fileType !== "all" && filters.fileType !== category) return null;
          if (filters.tag && !tags.includes(filters.tag)) return null;
          if (filters.dateFrom && (!diaryDate || diaryDate < filters.dateFrom)) return null;
          if (filters.dateTo && (!diaryDate || diaryDate > filters.dateTo)) return null;
          if (query && !searchable.includes(query.toLowerCase())) return null;

          const { snippet, highlightedSnippet } = searchSnippet(file.raw, query);
          const score = (query && node.name.toLowerCase().includes(query.toLowerCase()) ? 30 : 0) + tags.length;
          return {
            fileId: file.id,
            name: file.name,
            relativePath: node.path,
            snippet,
            highlightedSnippet,
            diaryDate,
            tags,
            score,
          };
        })
        .filter(Boolean)
        .sort((left, right) => (right?.score ?? 0) - (left?.score ?? 0) || String(right?.diaryDate ?? "").localeCompare(String(left?.diaryDate ?? "")))
        .slice(0, 50) as SearchResult[];

      return { success: true, data: results };
    },

    async getDiarySettings(): Promise<CommandResult<DiarySettings>> {
      return { success: true, data: { ...diarySettings } };
    },

    async saveDiarySettings(settings: DiarySettings): Promise<CommandResult<DiarySettings>> {
      if (!settings.diaryRoot.trim() || !settings.diaryPathPattern.trim() || !settings.diaryFileNamePattern.trim() || !settings.diaryTemplate.trim()) {
        return { success: false, message: "日记设置不能为空" };
      }

      diarySettings = { ...settings };
      return { success: true, data: { ...diarySettings } };
    },

    async getWorkspaceState(repositoryId: string): Promise<CommandResult<WorkspaceState>> {
      return { success: true, data: workspaceStates.get(repositoryId) ?? defaultWorkspaceState(repositoryId) };
    },

    async saveWorkspaceState(repositoryId: string, fileId: string | null, editMode: string, cursorPosition?: CursorPosition | null): Promise<CommandResult<WorkspaceState>> {
      const state: WorkspaceState = {
        ...(workspaceStates.get(repositoryId) ?? defaultWorkspaceState(repositoryId)),
        lastOpenedFile: fileId ?? undefined,
        lastEditMode: editMode as WorkspaceState["lastEditMode"],
        lastCursorPosition: cursorPosition ?? undefined,
      };
      workspaceStates.set(repositoryId, state);
      return { success: true, data: state };
    },

    async loadRepositoryTree(): Promise<CommandResult<Repository>> {
      return { success: true, data: cloneRepository(repository) };
    },

    async readMarkdownFile(fileId: string): Promise<CommandResult<MarkdownFile>> {
      const file = withModifiedAt(mockFiles[fileId] ?? mockFiles.source);
      mockFiles[file.id] = file;
      touchFile(file.id, "opened");
      return { success: true, data: file };
    },

    async checkFileChanged(fileId: string, knownModifiedAt?: string | null): Promise<CommandResult<FileChangeStatus>> {
      const file = withModifiedAt(mockFiles[fileId] ?? mockFiles.source);
      mockFiles[file.id] = file;
      return {
        success: true,
        data: {
          fileId,
          changed: Boolean(knownModifiedAt && file.modifiedAt && knownModifiedAt !== file.modifiedAt),
          currentModifiedAt: file.modifiedAt,
          knownModifiedAt: knownModifiedAt ?? undefined,
        },
      };
    },

    async saveMarkdownFile(fileId: string, content: string): Promise<CommandResult<SaveResult>> {
      const modifiedAt = nowIso();
      if (mockFiles[fileId]) {
        mockFiles[fileId] = { ...mockFiles[fileId], raw: content, modifiedAt };
      }
      touchFile(fileId, "edited");

      return {
        success: true,
        data: {
          fileId,
          saved: true,
          savedAt: modifiedAt,
          modifiedAt,
        },
      };
    },

    async saveMarkdownFileAsCopy(fileId: string, content: string): Promise<CommandResult<MarkdownFile>> {
      const sourceFile = withModifiedAt(mockFiles[fileId] ?? mockFiles.source);
      const sourceNode = findNodeByPath(repository.files, fileId);
      const sourceName = sourceNode?.name ?? sourceFile.name;
      const dotIndex = sourceName.lastIndexOf(".");
      const stem = dotIndex > -1 ? sourceName.slice(0, dotIndex) : sourceName;
      const extension = dotIndex > -1 ? sourceName.slice(dotIndex) : ".md";
      const parent = sourceNode ? findParentNode(repository.files, sourceNode.path) : null;
      const existingNames = new Set((parent?.children ?? []).map((node) => node.name));
      let index = 1;
      let copyName = `${stem} 副本${extension}`;
      while (existingNames.has(copyName)) {
        index += 1;
        copyName = `${stem} 副本 ${index}${extension}`;
      }
      const parentPath = sourceNode?.path.includes("/") ? sourceNode.path.slice(0, sourceNode.path.lastIndexOf("/")) : sourceFile.path;
      const copyPath = parentPath ? `${parentPath}/${copyName}` : copyName;
      const modifiedAt = nowIso();
      const file: MarkdownFile = {
        id: copyPath,
        name: copyName,
        path: copyPath,
        raw: content,
        modifiedAt,
      };
      mockFiles[copyPath] = file;
      touchFile(copyPath, "edited");
      parent?.children?.push({
        id: copyPath,
        name: copyName,
        path: copyPath,
        type: "markdown",
        depth: depthFromPath(copyPath),
        contentKey: copyPath,
      });

      return { success: true, data: file };
    },

    async saveAttachment(markdownFileId: string, fileName: string): Promise<CommandResult<AttachmentResult>> {
      const safeName = fileName.replace(/[\\/:*?"<>|\s]+/g, "-") || "image.png";
      const markdownStem = markdownFileId.split("/").at(-1)?.replace(/\.md$/i, "") || markdownFileId;
      const relativePath = `assets/${markdownStem}/${safeName}`;
      return {
        success: true,
        data: {
          fileName: safeName,
          absolutePath: relativePath,
          relativePath,
          markdownText: `![${safeName}](${relativePath})`,
        },
      };
    },

    async backupRepository(_repositoryId: string, input: BackupRepositoryInput = {}): Promise<CommandResult<BackupResult>> {
      const createdAt = nowIso();
      const outputPath = input.outputPath?.trim();
      const fileName = outputPath?.split(/[\\/]/).at(-1) || `MoKnow-backup-${createdAt.slice(0, 10)}.zip`;
      return {
        success: true,
        data: {
          fileName: fileName.endsWith(".zip") ? fileName : `${fileName}.zip`,
          absolutePath: outputPath ? (outputPath.endsWith(".zip") ? outputPath : `${outputPath}.zip`) : `${repository.rootPath}/.moknow/backups/MoKnow-backup-${createdAt.slice(0, 10)}.zip`,
          includedFiles: collectMarkdownNodes(repository.files).length,
          skippedPrivateFiles: input.excludePrivateData ? 1 : 0,
          sizeBytes: 4096,
          createdAt,
        },
      };
    },

    async restoreLatestBackup(_repositoryId: string): Promise<CommandResult<RestoreBackupResult>> {
      const restoredAt = nowIso();
      const backupFileName = `MoKnow-backup-${restoredAt.slice(0, 10)}.zip`;
      return {
        success: true,
        data: {
          repository: cloneRepository(repository),
          backupFileName,
          backupPath: `${repository.rootPath}/.moknow/backups/${backupFileName}`,
          restoredFiles: collectMarkdownNodes(repository.files).length,
          skippedConflictingFiles: 0,
          strategy: "replace",
          restoredAt,
        },
      };
    },

    async previewRestoreBackup(_repositoryId: string, backupPath?: string): Promise<CommandResult<RestorePreviewResult>> {
      const backupFileName = backupPath?.split(/[\\/]/).at(-1) || "MoKnow-backup-latest.zip";
      return {
        success: true,
        data: {
          backupFileName,
          backupPath: backupPath || `${repository.rootPath}/.moknow/backups/${backupFileName}`,
          totalBackupFiles: collectMarkdownNodes(repository.files).length,
          addedFiles: 1,
          modifiedFiles: 1,
          unchangedFiles: 2,
          deletedFiles: 1,
          sampleAdded: ["日记/2026/06/2026-06-09.md"],
          sampleModified: ["文档/项目.md"],
          sampleDeleted: ["临时.md"],
        },
      };
    },

    async restoreBackup(_repositoryId: string, input: RestoreBackupInput = {}): Promise<CommandResult<RestoreBackupResult>> {
      const restoredAt = nowIso();
      const backupFileName = input.backupPath?.split(/[\\/]/).at(-1) || `MoKnow-backup-${restoredAt.slice(0, 10)}.zip`;
      return {
        success: true,
        data: {
          repository: cloneRepository(repository),
          backupFileName,
          backupPath: input.backupPath || `${repository.rootPath}/.moknow/backups/${backupFileName}`,
          restoredFiles: input.strategy === "merge_keep_current" ? 1 : collectMarkdownNodes(repository.files).length,
          skippedConflictingFiles: input.strategy === "merge_keep_current" ? 2 : 0,
          strategy: input.strategy ?? "replace",
          restoredAt,
        },
      };
    },

    async exportMarkdownHtml(fileId: string, html: string): Promise<CommandResult<ExportResult>> {
      const sourceFile = mockFiles[fileId] ?? mockFiles.source;
      const createdAt = nowIso();
      const fileName = `${sourceFile.name.replace(/\.md$/i, "")}.html`;
      return {
        success: true,
        data: {
          fileName,
          absolutePath: `${sourceFile.path.replace(/[^/]+$/, fileName)}`,
          sizeBytes: new Blob([html]).size,
          createdAt,
        },
      };
    },

    async exportMarkdownPdf(fileId: string, html: string, title: string): Promise<CommandResult<ExportResult>> {
      const sourceFile = mockFiles[fileId] ?? mockFiles.source;
      const createdAt = nowIso();
      const fileName = `${sourceFile.name.replace(/\.md$/i, "")}.pdf`;
      return {
        success: true,
        data: {
          fileName,
          absolutePath: `${sourceFile.path.replace(/[^/]+$/, fileName)}`,
          sizeBytes: new Blob([`%PDF-1.4\n${title}\n${html}`]).size,
          createdAt,
        },
      };
    },

    async exportHtmlToPath(input: ExportHtmlToPathInput): Promise<CommandResult<ExportResult>> {
      const createdAt = nowIso();
      const normalizedPath = input.outputPath.endsWith(".html") ? input.outputPath : `${input.outputPath}.html`;
      const fileName = normalizedPath.split(/[\\/]/).at(-1) || "moknow-export.html";
      return {
        success: true,
        data: {
          fileName,
          absolutePath: normalizedPath,
          sizeBytes: new Blob([input.html]).size,
          createdAt,
        },
      };
    },

    async saveSecureCredential(key: string, secret: string): Promise<CommandResult<CredentialStatus>> {
      if (!key.trim()) return { success: false, message: "凭据键不能为空" };
      if (!secret) return { success: false, message: "凭据内容不能为空" };
      secureCredentials.set(key, secret);
      return {
        success: true,
        data: {
          key,
          exists: true,
          storage: "mock-secure-store",
        },
      };
    },

    async readSecureCredential(key: string): Promise<CommandResult<string | null>> {
      return { success: true, data: secureCredentials.get(key) ?? null };
    },

    async deleteSecureCredential(key: string): Promise<CommandResult<CredentialStatus>> {
      secureCredentials.delete(key);
      return {
        success: true,
        data: {
          key,
          exists: false,
          storage: "mock-secure-store",
        },
      };
    },

    async getSecureCredentialStatus(key: string): Promise<CommandResult<CredentialStatus>> {
      return {
        success: true,
        data: {
          key,
          exists: secureCredentials.has(key),
          storage: "mock-secure-store",
        },
      };
    },

    async openTodayJournal(): Promise<CommandResult<MarkdownFile>> {
      const file = openMockJournalForDate(repository, diarySettings, "2026-06-04");
      touchFile(file.id, "opened");
      return { success: true, data: file };
    },

    async openJournalByDate(_repositoryId: string, date: string): Promise<CommandResult<MarkdownFile>> {
      const file = openMockJournalForDate(repository, diarySettings, date);
      touchFile(file.id, "opened");
      return { success: true, data: file };
    },

    async listDiaryMonthStatus(_repositoryId: string, year: number, month: number): Promise<CommandResult<DiaryDateStatus[]>> {
      const daysInMonth = new Date(year, month, 0).getDate();
      const statuses = Array.from({ length: daysInMonth }, (_, index) => {
        const date = `${year}-${String(month).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}`;
        const path = journalPathForDate(diarySettings, date).path;
        return { date, exists: Boolean(mockFiles[path]), path };
      });
      return { success: true, data: statuses };
    },

    async createJournalEntry(): Promise<CommandResult<MarkdownFile>> {
      const { fileName: name, path, parent } = nextMockJournalFileName(repository, diarySettings);
      const id = path;
      const file: MarkdownFile = {
        id,
        name,
        path,
        raw: defaultDiaryRaw(diarySettings, "2026-06-04"),
        modifiedAt: nowIso(),
      };
      mockFiles[id] = file;
      touchFile(id, "opened");
      parent.children?.push({
        id,
        name,
        path,
        type: "markdown",
        depth: depthFromPath(path),
        contentKey: id,
      });

      return { success: true, data: file };
    },

    async createDocumentDirectory(_repositoryId: string, parentPath: string, name: string): Promise<CommandResult<FileNode>> {
      const node: FileNode = {
        id: `${parentPath}/${name}`,
        name,
        path: `${parentPath}/${name}`,
        type: "directory",
        depth: depthFromPath(`${parentPath}/${name}`),
        children: [],
      };
      const parent = findNodeByPath(repository.files, parentPath) ?? findCategory(repository, "documents");
      parent.children ??= [];
      parent.children.push(node);
      return { success: true, data: node };
    },

    async createDocumentFile(_repositoryId: string, parentPath: string, name: string): Promise<CommandResult<MarkdownFile>> {
      const fileName = name.endsWith(".md") ? name : `${name}.md`;
      const path = `${parentPath}/${fileName}`;
      const file: MarkdownFile = { id: path, name: fileName, path, raw: `# ${fileName.replace(/\.md$/, "")}\n`, modifiedAt: nowIso() };
      mockFiles[path] = file;
      touchFile(path, "opened");
      const parent = findNodeByPath(repository.files, parentPath) ?? findCategory(repository, "documents");
      parent.children ??= [];
      parent.children.push({
        id: path,
        name: fileName,
        path,
        type: "markdown",
        depth: depthFromPath(path),
        contentKey: path,
      });
      return { success: true, data: file };
    },

    async moveToTrash(_repositoryId: string, relativePath: string): Promise<CommandResult<Repository>> {
      const result = removeNodeByPath(repository.files, relativePath);
      if (!result.removed) {
        return { success: false, message: "要移入回收站的文件或目录不存在" };
      }

      repository = { ...repository, files: result.nodes };
      const trashId = `trash-${Date.now()}`;
      trashRecords.set(trashId, { originalPath: relativePath, node: result.removed });
      findCategory(repository, "trash").children?.push({
        ...result.removed,
        id: trashId,
        path: `回收站/${trashId}-${result.removed.name}`,
        depth: 1,
        deletedAt: new Date().toISOString(),
      });
      return { success: true, data: cloneRepository(repository) };
    },

    async restoreFromTrash(_repositoryId: string, trashRecordId: string, _strategy: RestoreStrategy): Promise<CommandResult<Repository>> {
      const record = trashRecords.get(trashRecordId);
      if (!record) return { success: false, message: "回收站记录不存在" };

      const trash = findCategory(repository, "trash");
      trash.children = trash.children?.filter((node) => node.id !== trashRecordId) ?? [];
      trashRecords.delete(trashRecordId);
      const parentPath = record.originalPath.includes("/") ? record.originalPath.slice(0, record.originalPath.lastIndexOf("/")) : "";
      const parent = (parentPath ? findNodeByPath(repository.files, parentPath) : null) ?? findCategory(repository, "documents");
      parent.children ??= [];
      parent.children.push({ ...record.node, path: record.originalPath, deletedAt: undefined });
      return { success: true, data: cloneRepository(repository) };
    },

    async permanentlyDeleteTrashEntry(_repositoryId: string, trashRecordId: string): Promise<CommandResult<Repository>> {
      const trash = findCategory(repository, "trash");
      trash.children = trash.children?.filter((node) => node.id !== trashRecordId) ?? [];
      trashRecords.delete(trashRecordId);
      return { success: true, data: cloneRepository(repository) };
    },

    async clearTrash(): Promise<CommandResult<Repository>> {
      findCategory(repository, "trash").children = [];
      trashRecords.clear();
      return { success: true, data: cloneRepository(repository) };
    },

    async addFavorite(_repositoryId: string, relativePath: string, targetKind: FavoriteTargetKind): Promise<CommandResult<Repository>> {
      const favorites = findCategory(repository, "favorites");
      if (!favorites.children?.some((node) => node.path === relativePath)) {
        favorites.children?.push({
          id: `favorite-${relativePath}`,
          name: relativePath.split("/").at(-1) ?? relativePath,
          path: relativePath,
          type: targetKind === "directory" ? "directory" : "markdown",
          depth: 1,
          contentKey: targetKind === "markdown" ? relativePath : undefined,
          isFavorite: true,
        });
      }
      repository = { ...repository, files: updateNodeFavoriteFlag(repository.files, relativePath, true) };

      return { success: true, data: cloneRepository(repository) };
    },

    async setFilePinned(_repositoryId: string, relativePath: string, pinned: boolean): Promise<CommandResult<Repository>> {
      const metadata = fileMetadata.get(relativePath) ?? { isPinned: false };
      metadata.isPinned = pinned;
      fileMetadata.set(relativePath, metadata);
      repository = { ...repository, files: updatePinnedFlag(repository.files, relativePath, pinned) };
      return { success: true, data: cloneRepository(repository) };
    },

    async removeFavorite(_repositoryId: string, relativePath: string): Promise<CommandResult<Repository>> {
      const favorites = findCategory(repository, "favorites");
      favorites.children = favorites.children?.filter((node) => node.path !== relativePath) ?? [];
      repository = { ...repository, files: updateNodeFavoriteFlag(repository.files, relativePath, false) };
      return { success: true, data: cloneRepository(repository) };
    },

    async renameEntry(_repositoryId: string, relativePath: string, newName: string): Promise<CommandResult<Repository>> {
      const parentPath = relativePath.includes("/") ? relativePath.slice(0, relativePath.lastIndexOf("/")) : "";
      const renamedPath = parentPath ? `${parentPath}/${newName}` : newName;
      repository = { ...repository, files: updateNodePaths(repository.files, relativePath, renamedPath) };
      const favorites = findCategory(repository, "favorites");
      favorites.children =
        favorites.children?.map((node) => {
          if (node.path === relativePath || node.path.startsWith(`${relativePath}/`)) {
            const nextPath = node.path.replace(relativePath, renamedPath);
            return { ...node, path: nextPath, name: nextPath.split("/").at(-1) ?? node.name };
          }

          return node;
        }) ?? [];

      return { success: true, data: cloneRepository(repository) };
    },

    async showInFolder(): Promise<CommandResult<boolean>> {
      return { success: true, data: true };
    },
  };
}
