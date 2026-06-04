import { useState } from "react";
import type { AiContext, AiMessage } from "../../types/models";
import type { AiCockpitService } from "../../services/aiCockpitService";

interface AiCockpitProps {
  aiService: AiCockpitService;
  context: AiContext;
}

const initialMessages: AiMessage[] = [
  {
    id: "welcome",
    role: "assistant",
    content: "你好！我已加载 MoKnow 日记仓库的文件索引。你可以让我总结最近日记、续写当前文件、查找相关笔记或润色内容。",
    createdAt: "刚刚",
  },
  {
    id: "sample-user",
    role: "user",
    content: "总结一下我最近一个月的日记",
    createdAt: "10:32",
  },
  {
    id: "sample-assistant",
    role: "assistant",
    content: "根据 5月到6月 的日记，你最近的记录集中在 MoKnow 项目推进、写作习惯和月末复盘。整体情绪积极，近期有更多反思型记录。",
    sources: ["05-31-月末复盘.md", "05-15-旅行记录.md", "06-01-月初总结.md"],
    createdAt: "10:32",
  },
];

export function AiCockpit({ aiService, context }: AiCockpitProps) {
  const [messages, setMessages] = useState<AiMessage[]>(initialMessages);
  const [question, setQuestion] = useState("");
  const [thinking, setThinking] = useState(false);

  const send = async (nextQuestion: string) => {
    const trimmed = nextQuestion.trim();
    if (!trimmed) return;

    const userMessage: AiMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: trimmed,
      createdAt: "刚刚",
    };

    setMessages((current) => [...current, userMessage]);
    setQuestion("");
    setThinking(true);

    const assistantMessage = await aiService.sendMessage(trimmed, context);
    setMessages((current) => [...current, assistantMessage]);
    setThinking(false);
  };

  return (
    <aside className="ai-panel" id="aiPanel">
      <div className="ai-header">
        <div className="ai-icon">✦</div>
        <div>
          <div className="ai-title">AI Cockpit</div>
          <div className="ai-subtitle">可访问仓库全部文件</div>
        </div>
        <button className="icon-btn ai-close" type="button">✕</button>
      </div>

      <div className="ai-context-pills">
        <button className="pill active" type="button">当前文件</button>
        <button className="pill inactive" type="button">06月全部</button>
        <button className="pill inactive" type="button">全仓库</button>
      </div>

      <div className="ai-messages" id="aiMessages">
        {messages.map((message) => (
          <div key={message.id} className={`ai-msg ${message.role === "user" ? "user" : "assistant"}`}>
            <div className="ai-msg-bubble">
              {message.content.split("\n").map((line, index) => (
                <span key={`${message.id}-${index}`}>
                  {line}
                  {index < message.content.split("\n").length - 1 ? <br /> : null}
                </span>
              ))}
            </div>
            {message.sources?.length ? (
              <div className="ai-source-refs">
                {message.sources.map((source) => (
                  <span className="source-ref" key={source}>📄 {source}</span>
                ))}
              </div>
            ) : null}
            <div className="ai-msg-meta">{message.role === "user" ? "你" : "AI Cockpit"} · {message.createdAt}</div>
          </div>
        ))}

        {thinking ? (
          <div className="ai-msg assistant">
            <div className="ai-thinking-box">
              <div className="ai-thinking"><span /><span /><span /></div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="ai-quick-actions">
        {["续写当前日记", "对当前文档润色", "生成摘要", "查找相关笔记"].map((action) => (
          <button key={action} className="quick-action" type="button" onClick={() => send(action)}>
            {action.replace("当前文档", "").replace("当前", "")}
          </button>
        ))}
      </div>

      <form
        className="ai-input-area"
        onSubmit={(event) => {
          event.preventDefault();
          void send(question);
        }}
      >
        <div className="ai-input-box">
          <textarea
            id="aiInput"
            placeholder="问我任何关于你笔记的问题..."
            rows={2}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send(question);
              }
            }}
          />
          <div className="ai-input-footer">
            <span className="ai-input-hint">Enter 发送 · Shift+Enter 换行</span>
            <button className="ai-send-btn" type="submit">发送 ↑</button>
          </div>
        </div>
      </form>
    </aside>
  );
}
