import { mockFiles, mockRepository } from "../data/mockRepository";
import type { CommandGateway } from "./commandGateway";
import type {
  CommandResult,
  FavoriteTargetKind,
  FileNode,
  MarkdownFile,
  RecentRepository,
  Repository,
  RestoreStrategy,
  SaveResult,
} from "../types/models";

function cloneRepository(repository: Repository): Repository {
  return JSON.parse(JSON.stringify(repository)) as Repository;
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

function upsertYearMonth(repository: Repository, year: string, month: string): FileNode {
  const journal = findCategory(repository, "journal");
  let yearNode = journal.children?.find((node) => node.name === year);
  if (!yearNode) {
    yearNode = { id: `journal-${year}`, name: year, path: `日记/${year}`, type: "directory", depth: 1, children: [] };
    journal.children?.push(yearNode);
  }

  yearNode.children ??= [];
  let monthNode = yearNode.children.find((node) => node.name === month);
  if (!monthNode) {
    monthNode = { id: `journal-${year}-${month}`, name: month, path: `日记/${year}/${month}`, type: "directory", depth: 2, children: [] };
    yearNode.children.push(monthNode);
  }

  monthNode.children ??= [];
  return monthNode;
}

function findNodeByPath(nodes: FileNode[], path: string): FileNode | null {
  for (const node of nodes) {
    if (node.path === path) return node;
    const child = node.children ? findNodeByPath(node.children, path) : null;
    if (child) return child;
  }

  return null;
}

function depthFromPath(path: string): number {
  return path.split("/").filter(Boolean).length;
}

export function createMockCommandGateway(): CommandGateway {
  let repository = cloneRepository(mockRepository);
  let journalCounter = 0;
  const recentRepositories: RecentRepository[] = [
    { name: repository.name, rootPath: repository.rootPath, openedAt: "2026-06-04T00:00:00.000Z" },
  ];

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

    async loadRepositoryTree(): Promise<CommandResult<Repository>> {
      return { success: true, data: cloneRepository(repository) };
    },

    async readMarkdownFile(fileId: string): Promise<CommandResult<MarkdownFile>> {
      const file = mockFiles[fileId] ?? mockFiles.source;
      return { success: true, data: file };
    },

    async saveMarkdownFile(fileId: string, content: string): Promise<CommandResult<SaveResult>> {
      if (mockFiles[fileId]) {
        mockFiles[fileId] = { ...mockFiles[fileId], raw: content };
      }

      return {
        success: true,
        data: {
          fileId,
          saved: true,
          savedAt: new Date().toISOString(),
        },
      };
    },

    async createJournalEntry(): Promise<CommandResult<MarkdownFile>> {
      journalCounter += 1;
      const suffix = journalCounter === 1 ? "" : `-${journalCounter}`;
      const name = `2026-06-04${suffix}.md`;
      const path = `日记/2026/06/${name}`;
      const id = path;
      const file: MarkdownFile = {
        id,
        name,
        path,
        raw: "# 2026-06-04\n\n## 今日记录\n",
      };
      mockFiles[id] = file;
      upsertYearMonth(repository, "2026", "06").children?.push({
        id,
        name,
        path,
        type: "markdown",
        depth: 3,
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
      const file: MarkdownFile = { id: path, name: fileName, path, raw: `# ${fileName.replace(/\.md$/, "")}\n` };
      mockFiles[path] = file;
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

    async moveToTrash(): Promise<CommandResult<Repository>> {
      return { success: true, data: cloneRepository(repository) };
    },

    async restoreFromTrash(_repositoryId: string, _trashRecordId: string, _strategy: RestoreStrategy): Promise<CommandResult<Repository>> {
      return { success: true, data: cloneRepository(repository) };
    },

    async permanentlyDeleteTrashEntry(): Promise<CommandResult<Repository>> {
      return { success: true, data: cloneRepository(repository) };
    },

    async clearTrash(): Promise<CommandResult<Repository>> {
      findCategory(repository, "trash").children = [];
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

      return { success: true, data: cloneRepository(repository) };
    },

    async removeFavorite(_repositoryId: string, relativePath: string): Promise<CommandResult<Repository>> {
      const favorites = findCategory(repository, "favorites");
      favorites.children = favorites.children?.filter((node) => node.path !== relativePath) ?? [];
      return { success: true, data: cloneRepository(repository) };
    },

    async renameEntry(_repositoryId: string, relativePath: string, newName: string): Promise<CommandResult<Repository>> {
      const parentPath = relativePath.includes("/") ? relativePath.slice(0, relativePath.lastIndexOf("/")) : "";
      const renamedPath = parentPath ? `${parentPath}/${newName}` : newName;
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
