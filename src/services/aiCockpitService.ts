import type { AiContext, AiMessage } from "../types/models";

const responses: Record<string, string> = {
  续写当前日记:
    "好的，这是续写建议：\n\n临睡前又翻了翻今天写的代码，忽然想到了一个优化方案。明天可以把它记在项目规划里，避免细节散落。",
  对当前文档润色:
    "已为你润色当前文档：将工作记录改得更清晰，并保留日记本身的轻松语气。",
  生成摘要:
    "本文摘要：记录了今天围绕 MoKnow 的产品设计、Markdown 编辑器、AI Cockpit 和后续开发计划。",
  查找相关笔记:
    "找到 3 篇相关笔记：项目规划.md、2024-06-03-随笔.md、README.md。",
};

/**
 * 设计模式：外观模式。
 * 原因：AI Cockpit 后续会组合索引、检索、模型调用和来源引用，
 * 组件只需要发送问题并接收统一消息对象。
 */
export class AiCockpitService {
  async sendMessage(question: string, context: AiContext): Promise<AiMessage> {
    const base = responses[question] ?? `收到你的问题：“${question}”。我会基于 ${context.repositoryName} 的索引继续检索。`;

    return {
      id: `assistant-${Date.now()}`,
      role: "assistant",
      content: `${base}\n\n当前上下文：${context.fileName}`,
      sources: [context.fileName, "项目规划.md"],
      createdAt: "刚刚",
    };
  }
}
