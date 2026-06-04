import { App as AntdApp, ConfigProvider, Spin } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { AiCockpit } from "./components/ai/AiCockpit";
import { EditorWorkspace } from "./components/editor/EditorWorkspace";
import { StatusBar } from "./components/layout/StatusBar";
import { TitleBar } from "./components/layout/TitleBar";
import { RepositoryTree } from "./components/repository/RepositoryTree";
import { createMockCommandGateway } from "./services/mockCommandGateway";
import { AiCockpitService } from "./services/aiCockpitService";
import { MarkdownService } from "./services/markdownService";
import { RepositoryService } from "./services/repositoryService";
import { ThemeService } from "./services/themeService";
import type { MarkdownFile, Repository, ThemeName } from "./types/models";
import "./styles/app.css";

export default function App() {
  const repositoryService = useMemo(() => new RepositoryService(createMockCommandGateway()), []);
  const markdownService = useMemo(() => new MarkdownService(), []);
  const aiService = useMemo(() => new AiCockpitService(), []);
  const themeService = useMemo(() => new ThemeService(), []);

  const [themeName, setThemeName] = useState<ThemeName>("night");
  const [repository, setRepository] = useState<Repository | null>(null);
  const [currentFile, setCurrentFile] = useState<MarkdownFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [draft, setDraft] = useState("");
  const [notification, setNotification] = useState("文件已保存 ✓");
  const [showNotification, setShowNotification] = useState(false);
  const themeResult = useMemo(() => themeService.build(themeService.getPreset(themeName)), [themeName, themeService]);

  const notify = useCallback((message: string) => {
    setNotification(message);
    setShowNotification(true);
    window.clearTimeout(window.__moknowNotifTimer);
    window.__moknowNotifTimer = window.setTimeout(() => setShowNotification(false), 1800);
  }, []);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const nextRepository = await repositoryService.loadRepository();
      const nextFile = await repositoryService.readFile("source");
      setRepository(nextRepository);
      setCurrentFile(nextFile);
      setDraft(nextFile.raw);
      setLoading(false);
    };

    void load();
  }, [repositoryService]);

  const selectFile = async (fileId: string) => {
    const nextFile = await repositoryService.readFile(fileId);
    setCurrentFile(nextFile);
    setDraft(nextFile.raw);
    setDirty(false);
  };

  const save = async () => {
    if (!currentFile) return;
    await repositoryService.saveFile(currentFile.id, draft);
    setDirty(false);
    notify("文件已保存 ✓");
  };

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [save]);

  const wordCount = draft.replace(/\s/g, "").length;

  return (
    <ConfigProvider theme={themeResult.antdTheme}>
      <AntdApp>
          <div className="app-root" data-theme={themeName} style={themeResult.cssVars as CSSProperties}>
          <div className={`notif ${showNotification ? "" : "hidden"}`} id="notif">{notification}</div>
          <TitleBar
            dirty={dirty}
            themeName={themeName}
            onNotify={notify}
            onToggleTheme={() => {
              setThemeName((current) => (current === "night" ? "day" : "night"));
              notify(themeName === "night" ? "已切换到白天主题" : "已切换到黑夜主题");
            }}
          />

          <main className="layout">
            {loading || !repository || !currentFile ? (
              <div className="loading-mask">
                <Spin description="正在加载 MoKnow 仓库..." />
              </div>
            ) : (
              <>
                <RepositoryTree repository={repository} activeFileId={currentFile.id} onSelectFile={(fileId) => void selectFile(fileId)} />
                <EditorWorkspace
                  file={currentFile}
                  markdownService={markdownService}
                  onDirtyChange={(nextDirty, content) => {
                    setDirty(nextDirty);
                    setDraft(content);
                  }}
                />
                <AiCockpit
                  aiService={aiService}
                  context={{
                    fileName: currentFile.name,
                    filePath: currentFile.path,
                    repositoryName: repository.name,
                  }}
                />
              </>
            )}
          </main>

          <StatusBar modeLabel="代码模式" repositoryName={repository?.name ?? "MoKnow 日记仓库"} wordCount={wordCount} dirty={dirty} />
        </div>
      </AntdApp>
    </ConfigProvider>
  );
}
