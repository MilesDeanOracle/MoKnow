import { Button, Form, Input, InputNumber, Modal, Select, Switch } from "antd";
import { useEffect } from "react";
import type { PluginThemeContribution, UserSettings } from "../../types/models";

type SettingsPluginTheme = PluginThemeContribution & { key: string; pluginId: string; pluginName: string };

interface AppSettingsModalProps {
  open: boolean;
  loading: boolean;
  settings: UserSettings;
  currentRepositoryId?: string;
  currentRepositoryName?: string;
  currentFileId?: string;
  currentFileName?: string;
  pluginThemes?: SettingsPluginTheme[];
  onCancel: () => void;
  onExportSettings: (settings: UserSettings) => void;
  onImportSettingsJson: (json: string) => void;
  onOpenDiarySettings: () => void;
  onOpenLockSettings: () => void;
  onSubmit: (settings: UserSettings) => void;
}

export function AppSettingsModal({
  open,
  loading,
  settings,
  currentRepositoryId,
  currentRepositoryName,
  currentFileId,
  currentFileName,
  pluginThemes = [],
  onCancel,
  onExportSettings,
  onImportSettingsJson,
  onOpenDiarySettings,
  onOpenLockSettings,
  onSubmit,
}: AppSettingsModalProps) {
  const [form] = Form.useForm<UserSettings>();
  const themeOptions = [
    { value: "night", label: "黑夜" },
    { value: "day", label: "白天" },
    { value: "system", label: "跟随系统" },
    { value: "custom", label: "自定义" },
    ...pluginThemes.map((theme) => ({
      value: `plugin:${theme.key}`,
      label: `插件：${theme.title ?? theme.id}（${theme.pluginName}）`,
    })),
  ];
  const scopedThemeOptions = [
    { value: "inherit", label: "继承上级设置" },
    ...themeOptions,
  ];

  useEffect(() => {
    form.setFieldsValue(settings);
  }, [form, open, settings]);

  const readFileText = async (file: File) => {
    if (typeof file.text === "function") {
      return file.text();
    }

    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  };

  const importCssFile = async (file: File | undefined) => {
    if (!file) return;
    form.setFieldValue("customCss", await readFileText(file));
  };

  const importSettingsFile = async (file: File | undefined) => {
    if (!file) return;
    onImportSettingsJson(await readFileText(file));
  };

  return (
    <Modal
      title="设置"
      open={open}
      width={720}
      destroyOnHidden
      confirmLoading={loading}
      okText="保存"
      cancelText="取消"
      onCancel={onCancel}
      onOk={() => void form.submit()}
    >
      <Form form={form} layout="vertical" onFinish={onSubmit}>
        <section className="settings-section">
          <div className="settings-section-heading">
            <h3>外观设置</h3>
            <p>主题会保存到本机，下次启动自动恢复。</p>
          </div>
          <Form.Item name="themePreference" label="主题">
            <Select
              aria-label="主题"
              options={themeOptions}
            />
          </Form.Item>
          <div className="settings-grid">
            <Form.Item name={["customTheme", "mode"]} label="自定义明暗">
              <Select
                aria-label="自定义明暗"
                options={[
                  { value: "dark", label: "暗色" },
                  { value: "light", label: "亮色" },
                  { value: "system", label: "跟随系统" },
                ]}
              />
            </Form.Item>
            <Form.Item name={["customTheme", "primaryColor"]} label="自定义主色">
              <Input aria-label="自定义主色" type="color" />
            </Form.Item>
            <Form.Item name={["customTheme", "borderRadius"]} label="圆角">
              <InputNumber aria-label="圆角" min={2} max={16} precision={0} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name={["customTheme", "fontSize"]} label="字号">
              <InputNumber aria-label="字号" min={12} max={18} precision={0} style={{ width: "100%" }} />
            </Form.Item>
          </div>
          <Form.Item name={["customTheme", "compact"]} label="紧凑模式" valuePropName="checked">
            <Switch aria-label="紧凑模式" />
          </Form.Item>
          <Form.Item name="customCss" label="自定义 CSS">
            <Input.TextArea
              aria-label="自定义 CSS"
              autoSize={{ minRows: 4, maxRows: 8 }}
              placeholder=".editor-shell { font-family: serif; }"
            />
          </Form.Item>
          <div className="settings-button-row">
            <label className="settings-file-button">
              <input
                aria-label="导入 CSS 文件"
                type="file"
                accept=".css,text/css"
                onChange={(event) => void importCssFile(event.target.files?.[0])}
              />
              <span>导入 CSS 文件</span>
            </label>
          </div>
        </section>

        {currentRepositoryId ? (
          <section className="settings-section">
            <div className="settings-section-heading">
              <h3>当前仓库设置</h3>
              <p>{currentRepositoryName ?? "当前仓库"} 的设置会覆盖全局设置。</p>
            </div>
            <Form.Item name={["repositorySettings", currentRepositoryId, "themePreference"]} label="仓库主题" initialValue="inherit">
              <Select aria-label="仓库主题" options={scopedThemeOptions} />
            </Form.Item>
            <Form.Item name={["repositorySettings", currentRepositoryId, "customCss"]} label="仓库 CSS">
              <Input.TextArea
                aria-label="仓库 CSS"
                autoSize={{ minRows: 3, maxRows: 6 }}
                placeholder=".editor-shell { --accent: #1677ff; }"
              />
            </Form.Item>
          </section>
        ) : null}

        {currentFileId ? (
          <section className="settings-section">
            <div className="settings-section-heading">
              <h3>当前文件设置</h3>
              <p>{currentFileName ?? "当前文件"} 的设置会覆盖仓库和全局设置。</p>
            </div>
            <Form.Item name={["fileSettings", currentFileId, "themePreference"]} label="文件主题" initialValue="inherit">
              <Select aria-label="文件主题" options={scopedThemeOptions} />
            </Form.Item>
            <Form.Item name={["fileSettings", currentFileId, "customCss"]} label="文件 CSS">
              <Input.TextArea
                aria-label="文件 CSS"
                autoSize={{ minRows: 3, maxRows: 6 }}
                placeholder=".md-render { line-height: 1.8; }"
              />
            </Form.Item>
          </section>
        ) : null}

        <section className="settings-section">
          <div className="settings-section-heading">
            <h3>设置导入导出</h3>
            <p>可导出本机外观设置和自定义 CSS，也可导入此前导出的 JSON。</p>
          </div>
          <div className="settings-button-row">
            <Button htmlType="button" type="default" onClick={() => onExportSettings(form.getFieldsValue(true) as UserSettings)}>
              导出设置
            </Button>
            <label className="settings-file-button">
              <input
                aria-label="导入设置文件"
                type="file"
                accept=".json,application/json"
                onChange={(event) => void importSettingsFile(event.target.files?.[0])}
              />
              <span>导入设置</span>
            </label>
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section-heading">
            <h3>日记设置</h3>
            <p>路径规则、文件名规则和默认模板仍使用现有日记设置面板。</p>
          </div>
          <Button htmlType="button" type="default" onClick={onOpenDiarySettings}>
            打开日记设置
          </Button>
        </section>

        <section className="settings-section">
          <div className="settings-section-heading">
            <h3>安全设置</h3>
            <p>配置应用锁、自动锁定和本地解锁密码。</p>
          </div>
          <Button htmlType="button" type="default" onClick={onOpenLockSettings}>
            打开应用锁设置
          </Button>
        </section>
      </Form>
    </Modal>
  );
}
