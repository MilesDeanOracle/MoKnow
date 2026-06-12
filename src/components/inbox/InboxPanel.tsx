import { useEffect, useState } from "react";
import type { InboxItem, OrganizeView } from "../../types/models";

interface InboxPanelProps {
  loading: boolean;
  view: OrganizeView | null;
  onAddEntry: (content: string) => Promise<void>;
  onClearEntries: (entryIds: string[]) => Promise<void>;
  onMoveToToday: (entryIds: string[]) => Promise<void>;
  onOpenFile: (fileId: string) => void;
  onRefresh: () => void;
}

function compactTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function itemTitle(item: InboxItem) {
  return item.content.split(/\s+/).filter(Boolean).join(" ").slice(0, 54) || "未命名记录";
}

export function InboxPanel({
  loading,
  view,
  onAddEntry,
  onClearEntries,
  onMoveToToday,
  onOpenFile,
  onRefresh,
}: InboxPanelProps) {
  const [draft, setDraft] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const inbox = view?.inbox ?? [];

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => inbox.some((item) => item.id === id)));
  }, [inbox]);

  const toggleSelected = (id: string) => {
    setSelectedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  };

  const addEntry = async () => {
    if (!draft.trim()) return;
    setSubmitting(true);
    try {
      await onAddEntry(draft);
      setDraft("");
    } finally {
      setSubmitting(false);
    }
  };

  const moveSelected = async () => {
    if (!selectedIds.length) return;
    setSubmitting(true);
    try {
      await onMoveToToday(selectedIds);
      setSelectedIds([]);
    } finally {
      setSubmitting(false);
    }
  };

  const clearSelected = async () => {
    setSubmitting(true);
    try {
      await onClearEntries(selectedIds);
      setSelectedIds([]);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="inbox-panel" aria-label="收件箱与整理">
      <div className="inbox-panel-header">
        <div>
          <div className="inbox-panel-title">收件箱与整理</div>
          <div className="inbox-panel-subtitle">{loading ? "正在整理" : `${inbox.length} 条未整理`}</div>
        </div>
        <button type="button" onClick={onRefresh} disabled={loading}>刷新</button>
      </div>

      <div className="quick-capture">
        <textarea
          aria-label="快速记录内容"
          value={draft}
          placeholder="写下临时想法..."
          rows={3}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="button" onClick={() => void addEntry()} disabled={!draft.trim() || submitting}>加入收件箱</button>
      </div>

      <div className="inbox-actions">
        <button type="button" onClick={() => void moveSelected()} disabled={!selectedIds.length || submitting}>整理到今天日记</button>
        <button type="button" onClick={() => void clearSelected()} disabled={(!selectedIds.length && !inbox.length) || submitting}>
          {selectedIds.length ? "清空已选" : "清空收件箱"}
        </button>
      </div>

      <div className="inbox-list" aria-label="未整理内容">
        {inbox.length ? inbox.map((item) => (
          <label key={item.id} className="inbox-item">
            <input
              type="checkbox"
              checked={selectedIds.includes(item.id)}
              onChange={() => toggleSelected(item.id)}
            />
            <span>
              <strong>{itemTitle(item)}</strong>
              <small>{compactTime(item.createdAt)}</small>
            </span>
          </label>
        )) : <span className="inbox-empty">暂无未整理内容</span>}
      </div>

      <div className="organize-grid">
        <div className="organize-section">
          <div className="organize-section-title">无标签日记</div>
          {(view?.untaggedJournals ?? []).length ? view!.untaggedJournals.map((item) => (
            <button key={item.fileId} type="button" onClick={() => onOpenFile(item.fileId)}>
              <span>{item.name}</span>
              <small>{item.diaryDate ?? item.relativePath}</small>
            </button>
          )) : <span>暂无</span>}
        </div>

        <div className="organize-section">
          <div className="organize-section-title">最近修改</div>
          {(view?.recentEdited ?? []).length ? view!.recentEdited.map((item) => (
            <button key={item.fileId} type="button" onClick={() => onOpenFile(item.fileId)}>
              <span>{item.name}</span>
              <small>{item.lastEditedAt ? compactTime(item.lastEditedAt) : item.relativePath}</small>
            </button>
          )) : <span>暂无</span>}
        </div>

        <div className="organize-section">
          <div className="organize-section-title">收藏日记</div>
          {(view?.favorites ?? []).length ? view!.favorites.map((item) => (
            <button key={item.fileId} type="button" onClick={() => onOpenFile(item.fileId)}>
              <span>{item.name}</span>
              <small>{item.relativePath}</small>
            </button>
          )) : <span>暂无</span>}
        </div>
      </div>
    </section>
  );
}
