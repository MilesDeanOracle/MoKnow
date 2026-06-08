import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { Dropdown } from "antd";
import type { MenuProps } from "antd";
import { CalendarDays, FileText, Folder, Plus, Star, Trash2 } from "lucide-react";
import type { FileNode, RecentRepository, Repository } from "../../types/models";

interface RepositoryTreeProps {
  repository: Repository;
  activeFileId: string;
  onSelectFile: (fileId: string) => void;
  onCreateJournal?: () => void;
  onCreateDocument?: () => void;
  onCreateRepository?: () => void;
  onOpenRepository?: (rootPath: string) => void;
  recentRepositories?: RecentRepository[];
  repositorySwitching?: boolean;
}

function flattenNodes(nodes: FileNode[]): FileNode[] {
  return nodes.flatMap((node) => [node, ...(node.children ? flattenNodes(node.children) : [])]);
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
  onSelectFile,
  onCreateJournal,
  onCreateDocument,
  onCreateRepository,
  onOpenRepository,
  recentRepositories = [],
  repositorySwitching = false,
}: RepositoryTreeProps) {
  const [query, setQuery] = useState("");
  const flatNodes = useMemo(() => flattenNodes(repository.files), [repository.files]);
  const visibleNodes = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return flatNodes;

    return flatNodes.filter((node) => node.type === "markdown" && node.name.toLowerCase().includes(normalizedQuery));
  }, [flatNodes, query]);
  const normalizedQuery = query.trim();
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

  const renderTreeNode = (node: FileNode) => {
    const isFolder = node.type === "directory";
    const isFile = node.type === "markdown";
    const isActive = node.id === activeFileId || node.contentKey === activeFileId;

    return (
      <button
        key={node.id}
        type="button"
        className={`tree-item tree-indent ${isFolder ? "folder" : ""} ${isActive ? "active" : ""}`}
        style={{ "--depth": node.depth } as CSSProperties}
        onClick={() => {
          if (isFile) onSelectFile(node.contentKey ?? node.id);
        }}
      >
        <span className="ti-toggle">{isFolder ? "▾" : ""}</span>
        <span className="ti-icon">{nodeIcon(node)}</span>
        <span className="ti-name">{node.name}</span>
        {isFolder ? <span className="ti-badge">{node.children?.length ?? 0}</span> : null}
        {node.isFavorite ? <Star className="ti-favorite" size={12} fill="currentColor" /> : null}
      </button>
    );
  };

  const renderCategory = (category: FileNode) => {
    const canCreateJournal = category.category === "journal";
    const canCreateDocument = category.category === "documents";

    return (
      <section className="tree-category" key={category.id}>
        <div className="tree-section-label">
          <span className="tree-category-title">
            <span className="tree-category-icon">{categoryIcon(category)}</span>
            <span data-testid="repository-category-name">{category.name}</span>
          </span>
          {canCreateJournal || canCreateDocument ? (
            <button
              className="add-btn"
              type="button"
              aria-label={canCreateJournal ? "新增日记" : "新增文档"}
              onClick={canCreateJournal ? onCreateJournal : onCreateDocument}
            >
              <Plus size={13} />
            </button>
          ) : null}
        </div>
        {(category.children ?? []).flatMap((node) => [renderTreeNode(node), ...(node.children ? flattenNodes(node.children).slice(1).map(renderTreeNode) : [])])}
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
