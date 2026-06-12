/// <reference types="vite/client" />

declare module "katex/dist/katex.min.js" {
  interface KatexRuntime {
    renderToString(content: string, options: {
      displayMode: boolean;
      output: "html";
      throwOnError: boolean;
      trust: boolean;
    }): string;
  }

  const katex: KatexRuntime;
  export default katex;
}

interface Window {
  __moknowNotifTimer?: number;
  __moknowLockTimer?: number;
}
