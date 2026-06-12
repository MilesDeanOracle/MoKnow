import { useState } from "react";
import type { SearchFilters, SearchResult, TagSummary } from "../../types/models";

interface SearchPanelProps {
  filters: SearchFilters;
  history: string[];
  loading: boolean;
  results: SearchResult[];
  tags: TagSummary[];
  onFiltersChange: (filters: SearchFilters) => void;
  onOpenResult: (fileId: string) => void;
  onDeleteTag: (tag: string) => void;
  onRenameTag: (oldName: string, newName: string) => void;
  onRunSearch: () => void;
  onSelectHistory: (query: string) => void;
  onSelectTag: (tag: string) => void;
  onSetTagColor: (tag: string, color: string) => void;
}

const fallbackTagColor = "#4f8ef7";

function resultMeta(result: SearchResult) {
  const parts = [result.diaryDate, result.tags.length ? result.tags.join(", ") : ""].filter(Boolean);
  return parts.join(" · ");
}

export function SearchPanel({
  filters,
  history,
  loading,
  results,
  tags,
  onFiltersChange,
  onOpenResult,
  onDeleteTag,
  onRenameTag,
  onRunSearch,
  onSelectHistory,
  onSelectTag,
  onSetTagColor,
}: SearchPanelProps) {
  const [editingTag, setEditingTag] = useState("");
  const [tagNameDraft, setTagNameDraft] = useState("");

  const startRename = (tag: string) => {
    setEditingTag(tag);
    setTagNameDraft(tag);
  };

  const saveRename = (tag: string) => {
    if (tagNameDraft.trim()) onRenameTag(tag, tagNameDraft.trim());
    setEditingTag("");
    setTagNameDraft("");
  };

  return (
    <section className="search-panel" aria-label="全库检索">
      <div className="search-panel-header">
        <div>
          <div className="search-panel-title">全库检索</div>
          <div className="search-panel-subtitle">{results.length ? `${results.length} 条结果` : "关键词、日期和标签筛选"}</div>
        </div>
        <button type="button" onClick={onRunSearch} disabled={loading}>{loading ? "搜索中" : "搜索"}</button>
      </div>

      <div className="search-controls">
        <input
          aria-label="全库关键词"
          value={filters.query ?? ""}
          placeholder="搜索标题、路径、正文..."
          onChange={(event) => onFiltersChange({ ...filters, query: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Enter") onRunSearch();
          }}
        />
        <div className="search-filter-row">
          <input
            aria-label="搜索开始日期"
            type="date"
            value={filters.dateFrom ?? ""}
            onChange={(event) => onFiltersChange({ ...filters, dateFrom: event.target.value })}
          />
          <input
            aria-label="搜索结束日期"
            type="date"
            value={filters.dateTo ?? ""}
            onChange={(event) => onFiltersChange({ ...filters, dateTo: event.target.value })}
          />
        </div>
        <select
          aria-label="搜索文件类型"
          value={filters.fileType ?? "all"}
          onChange={(event) => onFiltersChange({ ...filters, fileType: event.target.value as SearchFilters["fileType"] })}
        >
          <option value="all">全部 Markdown</option>
          <option value="journal">只看日记</option>
          <option value="document">只看文档</option>
        </select>
      </div>

      <div className="global-tag-list" aria-label="全库标签">
        {tags.length ? tags.map((tag) => (
          <div key={tag.name} className={`global-tag-row ${filters.tag === tag.name ? "active" : ""}`}>
            <button
              type="button"
              className="global-tag-filter"
              aria-label={`按标签查看 ${tag.name}`}
              onClick={() => onSelectTag(tag.name)}
            >
              <span className="global-tag-dot" style={{ background: tag.color ?? fallbackTagColor }} />
              <span>{tag.name}</span>
              <small>{tag.count}</small>
            </button>
            <input aria-label={`${tag.name} 全局标签颜色`} type="color" value={tag.color ?? fallbackTagColor} onChange={(event) => onSetTagColor(tag.name, event.target.value)} />
            {editingTag === tag.name ? (
              <>
                <input
                  aria-label={`${tag.name} 全局新标签名`}
                  value={tagNameDraft}
                  onChange={(event) => setTagNameDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") saveRename(tag.name);
                  }}
                />
                <button type="button" aria-label={`保存全局标签 ${tag.name}`} onClick={() => saveRename(tag.name)}>保存</button>
              </>
            ) : (
              <button type="button" aria-label={`编辑全局标签 ${tag.name}`} onClick={() => startRename(tag.name)}>改名</button>
            )}
            <button type="button" aria-label={`删除全局标签 ${tag.name}`} onClick={() => onDeleteTag(tag.name)}>删除</button>
          </div>
        )) : <span className="search-empty">暂无标签</span>}
      </div>

      {filters.tag ? (
        <button type="button" className="clear-tag-filter" onClick={() => onFiltersChange({ ...filters, tag: undefined })}>
          清除标签筛选：{filters.tag}
        </button>
      ) : null}

      {history.length ? (
        <div className="search-history" aria-label="搜索历史">
          {history.map((query) => (
            <button key={query} type="button" onClick={() => onSelectHistory(query)}>{query}</button>
          ))}
        </div>
      ) : null}

      <div className="search-results" aria-label="搜索结果">
        {results.length ? results.map((result) => (
          <button key={result.fileId} type="button" className="search-result" onClick={() => onOpenResult(result.fileId)}>
            <span className="search-result-name">{result.name}</span>
            <span className="search-result-path">{result.relativePath}</span>
            {resultMeta(result) ? <span className="search-result-meta">{resultMeta(result)}</span> : null}
            <span className="search-result-snippet" dangerouslySetInnerHTML={{ __html: result.highlightedSnippet || result.snippet }} />
          </button>
        )) : <span className="search-empty">{loading ? "正在搜索..." : "暂无搜索结果"}</span>}
      </div>
    </section>
  );
}
