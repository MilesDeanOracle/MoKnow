import { Fragment, useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Dropdown } from "antd";
import type { MenuProps } from "antd";
import { CalendarDays, Clock3, Eraser, FileText, Folder, FolderOpen, Pencil, Pin, Plus, RotateCcw, Star, Trash2, X } from "lucide-react";
import { DiaryCalendar } from "../calendar/DiaryCalendar";
import type { DiaryDateStatus, RecentFile } from "../../types/models";
import type { FileNode, RecentRepository, Repository } from "../../types/models";

interface RepositoryTreeProps {
  repository: Repository;
  activeFileId: string;
  calendarMonth?: Date;
  calendarStatuses?: DiaryDateStatus[];
  calendarSelectedDate?: string | null;
  calendarLoading?: boolean;
  onSelectFile: (fileId: string) => void;
  onCalendarMonthChange?: (month: Date) => void;
  onOpenCalendarDate?: (date: string) => void;
  onCreateJournal?: () => void;
  onCreateDocument?: () => void;
  onCreateRepository?: () => void;
  onOpenRepository?: (rootPath: string) => void;
  onOpenRecentFile?: (fileId: string) => void;
  onClearRecentFiles?: (listKind: "opened" | "edited") => void;
  onToggleFavorite?: (node: FileNode) => void;
  onTogglePinned?: (node: FileNode) => void;
  onMoveToTrash?: (node: FileNode) => void;
  onRenameEntry?: (node: FileNode) => void;
  onShowInFolder?: (node: FileNode) => void;
  onRestoreTrashEntry?: (node: FileNode) => void;
  onDeleteTrashEntry?: (node: FileNode) => void;
  onClearTrash?: () => void;
  recentOpenedFiles?: RecentFile[];
  recentEditedFiles?: RecentFile[];
  recentRepositories?: RecentRepository[];
  repositorySwitching?: boolean;
}

function flattenNodes(nodes: FileNode[]): FileNode[] {
  return nodes.flatMap((node) => [node, ...(node.children ? flattenNodes(node.children) : [])]);
}

function nodeMatchesFileId(node: FileNode, fileId: string) {
  return node.id === fileId || node.contentKey === fileId;
}

function collectAncestorDirectoryIds(nodes: FileNode[], fileId: string): string[] {
  for (const node of nodes) {
    if (nodeMatchesFileId(node, fileId)) return [];
    if (!node.children?.length) continue;

    const childPath = collectAncestorDirectoryIds(node.children, fileId);
    if (childPath.length || node.children.some((child) => nodeMatchesFileId(child, fileId))) {
      return node.type === "directory" ? [node.id, ...childPath] : childPath;
    }
  }

  return [];
}

function categoryIcon(node: FileNode) {
  if (node.category === "favorites") return <Star size={14} />;
  if (node.category === "journal") return <CalendarDays size={14} />;
  if (node.category === "trash") return <Trash2 size={14} />;
  return <Folder size={14} />;
}

function nodeIcon(node: FileNode) {
  if (node.type === "markdown") return <FileText size={13} />;
  return <Folder size={13} />;
}

export function RepositoryTree({
  repository,
  activeFileId,
  calendarMonth = new Date(),
  calendarStatuses = [],
  calendarSelectedDate = null,
  calendarLoading = false,
  onSelectFile,
  onCalendarMonthChange = () => undefined,
  onOpenCalendarDate = () => undefined,
  onCreateJournal,
  onCreateDocument,
  onCreateRepository,
  onOpenRepository,
  onOpenRecentFile,
  onClearRecentFiles,
  onToggleFavorite,
  onTogglePinned,
  onMoveToTrash,
  onRenameEntry,
  onShowInFolder,
  onRestoreTrashEntry,
  onDeleteTrashEntry,
  onClearTrash,
  recentOpenedFiles = [],
  recentEditedFiles = [],
  recentRepositories = [],
  repositorySwitching = false,
}: RepositoryTreeProps) {
  const [query, setQuery] = useState("");
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(
    () => new Set(collectAncestorDirectoryIds(repository.files, activeFileId)),
  );
  const flatNodes = useMemo(() => flattenNodes(repository.files), [repository.files]);
  const visibleNodes = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return flatNodes;

    return flatNodes.filter((node) => node.type === "markdown" && node.name.toLowerCase().includes(normalizedQuery));
  }, [flatNodes, query]);
  const normalizedQuery = query.trim();
  useEffect(() => {
    const activeAncestors = collectAncestorDirectoryIds(repository.files, activeFileId);
    if (!activeAncestors.length) return;

    setExpandedNodeIds((current) => {
      const next = new Set(current);
      activeAncestors.forEach((id) => next.add(id));
      return next;
    });
  }, [activeFileId, repository.files]);

  const toggleDirectory = (nodeId: string) => {
    setExpandedNodeIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };
  const repositoryMenuItems: MenuProps["items"] = [
    ...(recentRepositories.length
      ? recentRepositories.map((item) => ({
          key: `repo:${item.rootPath}`,
          label: (
            <span className="recent-repo-item">
              <span className="recent-repo-name">{item.name}</span>
              {item.missing ? <span className="recent-repo-missing">失效</span> : null}
            </span>
          ),
          disabled: Boolean(item.missing),
        }))
      : [{ key: "empty", label: "暂无最近仓库", disabled: true }]),
    { type: "divider" },
    { key: "create", label: "新建仓库" },
  ];
  const handleRepositoryMenuClick: MenuProps["onClick"] = ({ key }) => {
    if (key === "create") {
      onCreateRepository?.();
      return;
    }

    if (key.startsWith("repo:")) {
      onOpenRepository?.(key.replace(/^repo:/, ""));
    }
  };

  const renderRecentSection = (title: string, listKind: "opened" | "edited", files: RecentFile[]) => (
    <section className="recent-file-section">
      <div className="tree-section-label recent-file-label">
        <span className="tree-category-title">
          <Clock3 size={13} />
          <span>{title}</span>
        </span>
        {files.length ? (
          <button className="add-btn" type="button" aria-label={`清空${title}`} onClick={() => onClearRecentFiles?.(listKind)}>
            <Eraser size={12} />
          </button>
        ) : null}
      </div>
      <div className="recent-file-list">
        {files.length ? (
          files.map((file) => (
            <button key={`${listKind}-${file.fileId}`} className="recent-file-item" type="button" onClick={() => onOpenRecentFile?.(file.fileId)}>
              {file.isPinned ? <Pin size={11} fill="currentColor" /> : <FileText size={11} />}
              <span className="recent-file-name">{file.name}</span>
            </button>
          ))
        ) : (
          <span className="recent-file-empty">暂无记录</span>
        )}
      </div>
    </section>
  );

  const renderTreeNode = (node: FileNode) => {
    const isFolder = node.type === "directory";
    const isFile = node.type === "markdown";
    const isActive = node.id === activeFileId || node.contentKey === activeFileId;
    const isTrashEntry = Boolean(node.deletedAt);
    const isExpanded = isFolder && expandedNodeIds.has(node.id);

    const renderTreeAction = (label: string, onClick: () => void, icon: ReactNode, active = false) => (
      <span
        role="button"
        tabIndex={0}
        className={`tree-action ${active ? "active" : ""}`}
        aria-label={label}
        onClick={(event) => {
          event.stopPropagation();
          onClick();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            event.stopPropagation();
            onClick();
          }
        }}
      >
        {icon}
      </span>
    );

    return (
      <Fragment key={node.id}>
      <button
        type="button"
        className={`tree-item tree-indent ${isFolder ? "folder" : ""} ${isActive ? "active" : ""}`}
        style={{ "--depth": node.depth } as CSSProperties}
        aria-expanded={isFolder ? isExpanded : undefined}
        onClick={() => {
          if (isFolder) {
            toggleDirectory(node.id);
            return;
          }
          if (isFile) onSelectFile(node.contentKey ?? node.id);
        }}
      >
        <span className="ti-toggle">{isFolder ? (isExpanded ? "▾" : "▸") : ""}</span>
        <span className="ti-icon">{nodeIcon(node)}</span>
        <span className="ti-name">{node.name}</span>
        {isFolder ? <span className="ti-badge">{node.children?.length ?? 0}</span> : null}
        {node.isPinned ? <Pin className="ti-pinned" size={12} fill="currentColor" /> : null}
        {node.isFavorite ? <Star className="ti-favorite" size={12} fill="currentColor" /> : null}
        {isTrashEntry ? (
          <span className="tree-actions">
            {renderTreeAction(`恢复 ${node.name}`, () => onRestoreTrashEntry?.(node), <RotateCcw size={11} />)}
            {renderTreeAction(`彻底删除 ${node.name}`, () => onDeleteTrashEntry?.(node), <X size={11} />)}
          </span>
        ) : isFile || isFolder ? (
          <span className="tree-actions">
            {renderTreeAction(node.isPinned ? `取消置顶 ${node.name}` : `置顶 ${node.name}`, () => onTogglePinned?.(node), <Pin size={11} />, Boolean(node.isPinned))}
            {renderTreeAction(node.isFavorite ? `取消收藏 ${node.name}` : `收藏 ${node.name}`, () => onToggleFavorite?.(node), <Star size={11} />, Boolean(node.isFavorite))}
            {renderTreeAction(`重命名 ${node.name}`, () => onRenameEntry?.(node), <Pencil size={11} />)}
            {renderTreeAction(`显示位置 ${node.name}`, () => onShowInFolder?.(node), <FolderOpen size={11} />)}
            {renderTreeAction(`移入回收站 ${node.name}`, () => onMoveToTrash?.(node), <Trash2 size={11} />)}
          </span>
        ) : null}
      </button>
      {isExpanded ? node.children?.map(renderTreeNode) : null}
      </Fragment>
    );
  };

  const renderCategory = (category: FileNode) => {
    const canCreateJournal = category.category === "journal";
    const canCreateDocument = category.category === "documents";
    const canClearTrash = category.category === "trash" && Boolean(category.children?.length);

    return (
      <section className="tree-category" key={category.id}>
        <div className="tree-section-label">
          <span className="tree-category-title">
            <span className="tree-category-icon">{categoryIcon(category)}</span>
            <span data-testid="repository-category-name">{category.name}</span>
          </span>
          {canCreateJournal || canCreateDocument || canClearTrash ? (
            <button
              className="add-btn"
              type="button"
              aria-label={canClearTrash ? "清空回收站" : canCreateJournal ? "新增日记" : "新增文档"}
              onClick={canClearTrash ? onClearTrash : canCreateJournal ? onCreateJournal : onCreateDocument}
            >
              {canClearTrash ? <Eraser size={13} /> : <Plus size={13} />}
            </button>
          ) : null}
        </div>
        {(category.children ?? []).map(renderTreeNode)}
      </section>
    );
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <Dropdown
          trigger={["click"]}
          menu={{ items: repositoryMenuItems, onClick: handleRepositoryMenuClick }}
          placement="bottomLeft"
        >
          <button className="repo-selector" type="button" aria-label="切换仓库" disabled={repositorySwitching}>
            <span className="repo-dot" />
            <span className="repo-name">{repository.name}</span>
            <span className="repo-arrow">▾</span>
          </button>
        </Dropdown>
        <label className="sidebar-search">
          <span className="sidebar-search-icon">⌕</span>
          <input placeholder="搜索文件..." value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
      </div>

      <DiaryCalendar
        month={calendarMonth}
        selectedDate={calendarSelectedDate}
        statuses={calendarStatuses}
        loading={calendarLoading}
        onMonthChange={onCalendarMonthChange}
        onOpenDate={onOpenCalendarDate}
      />

      <div className="recent-files-panel">
        {renderRecentSection("最近打开", "opened", recentOpenedFiles)}
        {renderRecentSection("最近编辑", "edited", recentEditedFiles)}
      </div>

      <div className="sidebar-tree" id="fileTree">
        {normalizedQuery ? visibleNodes.map(renderTreeNode) : repository.files.map(renderCategory)}
      </div>

      <div className="sidebar-footer">
        <button className="icon-btn footer-action" type="button" onClick={onCreateRepository}>
          <Plus size={12} /> 新建仓库
        </button>
      </div>
    </aside>
  );
}
