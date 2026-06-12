import { useMemo, useState } from "react";
import { parseFrontmatter, stringifyFrontmatter } from "../../services/frontmatterService";
import type { FrontmatterData, FrontmatterValue } from "../../services/frontmatterService";

interface MetadataPanelProps {
  content: string;
  onChange: (content: string) => void;
}

const moodOptions = ["", "calm", "happy", "tired", "anxious", "sad"];
const weatherOptions = ["", "sunny", "cloudy", "rainy", "snowy", "windy"];
const energyOptions = ["", "low", "normal", "high"];
const tagColorStorageKey = "moknow:tag-colors";
const defaultTagColors = ["#4f8ef7", "#56d98e", "#f5c842", "#a78bfa", "#f06b6b"];

function readTagColors(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(tagColorStorageKey) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

function writeTagColors(colors: Record<string, string>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(tagColorStorageKey, JSON.stringify(colors));
}

function valueAsString(value: FrontmatterValue | undefined) {
  if (Array.isArray(value)) return value.join(", ");
  if (value === null || value === undefined) return "";
  return String(value);
}

function tagsAsInput(value: FrontmatterValue | undefined) {
  return Array.isArray(value) ? value.join(", ") : valueAsString(value);
}

export function MetadataPanel({ content, onChange }: MetadataPanelProps) {
  const [newTag, setNewTag] = useState("");
  const [editingTag, setEditingTag] = useState("");
  const [renamingTag, setRenamingTag] = useState("");
  const [selectedTag, setSelectedTag] = useState("");
  const [tagColors, setTagColors] = useState(() => readTagColors());
  const parsed = useMemo(() => parseFrontmatter(content), [content]);
  const data = parsed.data;
  const tags = useMemo(() => {
    if (Array.isArray(data.tags)) return data.tags;
    const value = valueAsString(data.tags);
    return value ? value.split(",").map((item) => item.trim()).filter(Boolean) : [];
  }, [data.tags]);

  const updateMetadata = (key: string, value: FrontmatterValue | undefined) => {
    const nextData: FrontmatterData = { ...data };
    if (value === undefined || value === "" || (Array.isArray(value) && !value.length)) {
      delete nextData[key];
    } else {
      nextData[key] = value;
    }
    onChange(stringifyFrontmatter(nextData, parsed.body));
  };

  const updateTags = (value: string) => {
    const tags = value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    updateMetadata("tags", tags);
  };

  const setTags = (nextTags: string[]) => {
    updateMetadata("tags", Array.from(new Set(nextTags.map((tag) => tag.trim()).filter(Boolean))));
  };

  const addTag = () => {
    if (!newTag.trim()) return;
    setTags([...tags, newTag.trim()]);
    setNewTag("");
  };

  const renameTag = (tag: string) => {
    const nextTag = renamingTag.trim();
    if (!nextTag || nextTag === tag) {
      setEditingTag("");
      setRenamingTag("");
      return;
    }

    const nextColors = { ...tagColors };
    if (nextColors[tag] && !nextColors[nextTag]) nextColors[nextTag] = nextColors[tag];
    delete nextColors[tag];
    setTagColors(nextColors);
    writeTagColors(nextColors);
    setTags(tags.map((item) => (item === tag ? nextTag : item)));
    setEditingTag("");
    setRenamingTag("");
    if (selectedTag === tag) setSelectedTag(nextTag);
  };

  const deleteTag = (tag: string) => {
    setTags(tags.filter((item) => item !== tag));
    if (selectedTag === tag) setSelectedTag("");
  };

  const updateTagColor = (tag: string, color: string) => {
    const nextColors = { ...tagColors, [tag]: color };
    setTagColors(nextColors);
    writeTagColors(nextColors);
  };

  return (
    <section className="metadata-panel" aria-label="日记元数据">
      <div className="metadata-header">
        <div>
          <div className="metadata-title">日记元数据</div>
          <div className="metadata-subtitle">{parsed.hasFrontmatter ? "已连接 frontmatter" : "保存后写入 frontmatter"}</div>
        </div>
      </div>

      <div className="metadata-grid">
        <label>
          <span>日期</span>
          <input aria-label="日期" value={valueAsString(data.date)} placeholder="2026-06-08" onChange={(event) => updateMetadata("date", event.target.value)} />
        </label>
        <label>
          <span>情绪</span>
          <select aria-label="情绪" value={valueAsString(data.mood)} onChange={(event) => updateMetadata("mood", event.target.value)}>
            {moodOptions.map((option) => <option key={option} value={option}>{option || "未填写"}</option>)}
          </select>
        </label>
        <label>
          <span>天气</span>
          <select aria-label="天气" value={valueAsString(data.weather)} onChange={(event) => updateMetadata("weather", event.target.value)}>
            {weatherOptions.map((option) => <option key={option} value={option}>{option || "未填写"}</option>)}
          </select>
        </label>
        <label>
          <span>精力</span>
          <select aria-label="精力" value={valueAsString(data.energy)} onChange={(event) => updateMetadata("energy", event.target.value)}>
            {energyOptions.map((option) => <option key={option} value={option}>{option || "未填写"}</option>)}
          </select>
        </label>
        <label>
          <span>地点</span>
          <input aria-label="地点" value={valueAsString(data.location)} placeholder="可选" onChange={(event) => updateMetadata("location", event.target.value)} />
        </label>
        <label>
          <span>标签</span>
          <input aria-label="标签" value={tagsAsInput(data.tags)} placeholder="工作, 家庭" onChange={(event) => updateTags(event.target.value)} />
        </label>
      </div>

      <label className="metadata-favorite">
        <input
          aria-label="收藏当前日记"
          type="checkbox"
          checked={data.favorite === true}
          onChange={(event) => updateMetadata("favorite", event.target.checked)}
        />
        <span>收藏当前日记</span>
      </label>

      <div className="tag-manager" aria-label="标签管理">
        <div className="tag-manager-header">
          <span>标签管理</span>
          {selectedTag ? <small>正在查看：{selectedTag}</small> : <small>点击标签查看</small>}
        </div>

        <div className="tag-create-row">
          <input
            aria-label="新建标签"
            value={newTag}
            placeholder="新建标签"
            onChange={(event) => setNewTag(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addTag();
              }
            }}
          />
          <button type="button" onClick={addTag}>添加</button>
        </div>

        <div className="tag-list">
          {tags.length ? tags.map((tag, index) => {
            const color = tagColors[tag] ?? defaultTagColors[index % defaultTagColors.length];
            return (
              <div key={tag} className={`tag-row ${selectedTag === tag ? "active" : ""}`}>
                <button
                  type="button"
                  className="tag-pill-btn"
                  aria-label={`查看标签 ${tag}`}
                  onClick={() => setSelectedTag((current) => (current === tag ? "" : tag))}
                >
                  <span className="tag-color-dot" style={{ background: color }} />
                  <span>{tag}</span>
                </button>
                <input aria-label={`${tag} 标签颜色`} className="tag-color-input" type="color" value={color} onChange={(event) => updateTagColor(tag, event.target.value)} />
                {editingTag === tag ? (
                  <>
                    <input
                      aria-label={`${tag} 新标签名`}
                      className="tag-rename-input"
                      value={renamingTag}
                      onChange={(event) => setRenamingTag(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") renameTag(tag);
                      }}
                    />
                    <button type="button" aria-label={`保存标签 ${tag}`} onClick={() => renameTag(tag)}>保存</button>
                  </>
                ) : (
                  <button type="button" aria-label={`编辑标签 ${tag}`} onClick={() => { setEditingTag(tag); setRenamingTag(tag); }}>改名</button>
                )}
                <button type="button" aria-label={`删除标签 ${tag}`} onClick={() => deleteTag(tag)}>删除</button>
              </div>
            );
          }) : <span className="tag-empty">暂无标签</span>}
        </div>
      </div>
    </section>
  );
}
