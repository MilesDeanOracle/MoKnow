import { Button, Input, Modal, Switch } from "antd";
import type { PluginRegistryItem } from "../../types/models";
import type { OfficialPluginCatalogItem } from "../../services/pluginService";
import { getPluginPermissionLabel } from "../../services/pluginService";

interface PluginManagerModalProps {
  manifestDraft: string;
  open: boolean;
  officialPlugins?: OfficialPluginCatalogItem[];
  plugins: PluginRegistryItem[];
  onCancel: () => void;
  onInstallOfficialPlugin?: (pluginId: string) => void;
  onManifestDraftChange: (value: string) => void;
  onInstallManifest: () => void;
  onRemovePlugin: (pluginId: string) => void;
  onTogglePlugin: (pluginId: string, enabled: boolean) => void;
}

export function PluginManagerModal({
  manifestDraft,
  open,
  officialPlugins = [],
  plugins,
  onCancel,
  onInstallOfficialPlugin,
  onInstallManifest,
  onManifestDraftChange,
  onRemovePlugin,
  onTogglePlugin,
}: PluginManagerModalProps) {
  return (
    <Modal
      title="插件管理"
      open={open}
      width={760}
      footer={[
        <Button key="close" type="primary" onClick={onCancel}>关闭</Button>,
      ]}
      onCancel={onCancel}
    >
      {officialPlugins.length ? (
        <section className="plugin-manager-section">
          <div className="plugin-manager-heading">
            <h3>官方插件</h3>
            <p>选择内置官方插件安装到本机注册表。</p>
          </div>
          <div className="plugin-official-grid">
            {officialPlugins.map((plugin) => {
              const installed = plugins.some((item) => item.manifest.id === plugin.manifest.id);
              return (
                <article className="plugin-official-card" key={plugin.manifest.id}>
                  <div>
                    <strong>{plugin.manifest.name}</strong>
                    <span>{plugin.category} · v{plugin.manifest.version}</span>
                  </div>
                  {plugin.manifest.description ? <p>{plugin.manifest.description}</p> : null}
                  <div className="plugin-contributes">
                    {plugin.manifest.contributes?.commands?.length ? <small>命令 {plugin.manifest.contributes.commands.length}</small> : null}
                    {plugin.manifest.contributes?.sidebars?.length ? <small>侧边栏 {plugin.manifest.contributes.sidebars.length}</small> : null}
                    {plugin.manifest.contributes?.markdownRenderers?.length ? <small>Markdown 扩展 {plugin.manifest.contributes.markdownRenderers.length}</small> : null}
                    {plugin.manifest.contributes?.aiTools?.length ? <small>AI 工具 {plugin.manifest.contributes.aiTools.length}</small> : null}
                    {plugin.manifest.contributes?.themes?.length ? <small>主题 {plugin.manifest.contributes.themes.length}</small> : null}
                  </div>
                  <Button
                    size="small"
                    type="default"
                    disabled={installed}
                    onClick={() => onInstallOfficialPlugin?.(plugin.manifest.id)}
                  >
                    {installed ? "已安装" : "安装官方插件"}
                  </Button>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="plugin-manager-section">
        <div className="plugin-manager-heading">
          <h3>安装 Manifest</h3>
          <p>粘贴插件 manifest JSON 后安装到本机注册表。</p>
        </div>
        <Input.TextArea
          aria-label="插件 Manifest JSON"
          autoSize={{ minRows: 5, maxRows: 8 }}
          placeholder='{"id":"moknow.example","name":"示例插件","version":"0.1.0","permissions":["command"]}'
          value={manifestDraft}
          onChange={(event) => onManifestDraftChange(event.target.value)}
        />
        <Button type="default" onClick={onInstallManifest}>安装 Manifest</Button>
      </section>

      <section className="plugin-manager-section">
        <div className="plugin-manager-heading">
          <h3>插件注册表</h3>
          <p>启用插件时会先按 manifest 权限创建受限 PluginContext。</p>
        </div>
        <div className="plugin-registry-list">
          {plugins.length ? plugins.map((plugin) => (
            <article className={`plugin-registry-item ${plugin.status}`} key={plugin.manifest.id}>
              <div className="plugin-registry-title">
                <div>
                  <strong>{plugin.manifest.name}</strong>
                  <span>{plugin.manifest.id} · v{plugin.manifest.version}</span>
                </div>
                <Switch
                  aria-label={`${plugin.manifest.name} 启用状态`}
                  checked={plugin.status === "enabled"}
                  checkedChildren="启用"
                  unCheckedChildren="停用"
                  onChange={(checked) => onTogglePlugin(plugin.manifest.id, checked)}
                />
              </div>
              {plugin.manifest.description ? <p>{plugin.manifest.description}</p> : null}
              <div className="plugin-permissions" aria-label={`${plugin.manifest.name} 权限`}>
                {plugin.manifest.permissions.length ? plugin.manifest.permissions.map((permission) => (
                  <span key={permission}>{getPluginPermissionLabel(permission)}</span>
                )) : <span>无敏感权限</span>}
              </div>
              <div className="plugin-contributes">
                {plugin.manifest.contributes?.commands?.length ? <small>命令 {plugin.manifest.contributes.commands.length}</small> : null}
                {plugin.manifest.contributes?.sidebars?.length ? <small>侧边栏 {plugin.manifest.contributes.sidebars.length}</small> : null}
                {plugin.manifest.contributes?.markdownRenderers?.length ? <small>Markdown 扩展 {plugin.manifest.contributes.markdownRenderers.length}</small> : null}
                {plugin.manifest.contributes?.aiTools?.length ? <small>AI 工具 {plugin.manifest.contributes.aiTools.length}</small> : null}
                {plugin.manifest.contributes?.themes?.length ? <small>主题 {plugin.manifest.contributes.themes.length}</small> : null}
              </div>
              {plugin.status === "failed" && plugin.error ? <p className="plugin-error">启动失败：{plugin.error}</p> : null}
              <div className="plugin-registry-actions">
                <Button size="small" danger onClick={() => onRemovePlugin(plugin.manifest.id)}>移除</Button>
              </div>
            </article>
          )) : <p className="empty-note">暂无已安装插件</p>}
        </div>
      </section>
    </Modal>
  );
}
