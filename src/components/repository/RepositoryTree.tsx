import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { FileNode, Repository } from "../../types/models";

interface RepositoryTreeProps {
  repository: Repository;
  activeFileId: string;
  onSelectFile: (fileId: string) => void;
}

function flattenNodes(nodes: FileNode[]): FileNode[] {
  return nodes.flatMap((node) => [node, ...(node.children ? flattenNodes(node.children) : [])]);
}

export function RepositoryTree({ repository, activeFileId, onSelectFile }: RepositoryTreeProps) {
  const [query, setQuery] = useState("");
  const flatNodes = useMemo(() => flattenNodes(repository.files), [repository.files]);
  const visibleNodes = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return flatNodes;

    return flatNodes.filter((node) => node.type !== "directory" && node.name.toLowerCase().includes(normalizedQuery));
  }, [flatNodes, query]);

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <button className="repo-selector" type="button" aria-label="切换仓库">
          <span className="repo-dot" />
          <span className="repo-name">{repository.name}</span>
          <span className="repo-arrow">▾</span>
        </button>
        <label className="sidebar-search">
          <span className="sidebar-search-icon">⌕</span>
          <input placeholder="搜索文件..." value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
      </div>

      <div className="sidebar-tree" id="fileTree">
        <div className="tree-section-label">
          <span>日记</span>
          <button className="add-btn" type="button" aria-label="新建日记">+</button>
        </div>

        {visibleNodes.map((node) => {
          const isFolder = node.type === "directory";
          const isActive = node.id === activeFileId;

          return (
            <button
              key={node.id}
              type="button"
              className={`tree-item tree-indent ${isFolder ? "folder" : ""} ${isActive ? "active" : ""}`}
              style={{ "--depth": node.depth } as CSSProperties}
              onClick={() => {
                if (!isFolder) onSelectFile(node.contentKey ?? node.id);
              }}
            >
              <span className="ti-toggle">{isFolder ? "▾" : ""}</span>
              <span className="ti-icon">{isFolder ? "📂" : "📄"}</span>
              <span className="ti-name">{node.name}</span>
              {isFolder ? <span className="ti-badge">{node.children?.length ?? 0}</span> : null}
            </button>
          );
        })}
      </div>

      <div className="sidebar-footer">
        <button className="icon-btn footer-action" type="button">＋ 新建仓库</button>
      </div>
    </aside>
  );
}
