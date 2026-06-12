import { Checkbox, Form, Input, InputNumber, Modal } from "antd";
import { useEffect } from "react";
import type { AppLockSettings, AppLockSettingsInput } from "../../services/appLockService";

interface AppLockSettingsModalProps {
  open: boolean;
  loading: boolean;
  settings: AppLockSettings;
  onCancel: () => void;
  onSubmit: (settings: AppLockSettingsInput) => void;
}

interface AppLockFormValues {
  enabled: boolean;
  password?: string;
  confirmPassword?: string;
  lockOnBlur: boolean;
  idleMinutes: number;
  biometricEnabled: boolean;
  resetRecoveryCode: boolean;
}

export function AppLockSettingsModal({ open, loading, settings, onCancel, onSubmit }: AppLockSettingsModalProps) {
  const [form] = Form.useForm<AppLockFormValues>();
  const enabled = Form.useWatch("enabled", form);

  useEffect(() => {
    form.setFieldsValue({
      enabled: settings.enabled,
      password: "",
      confirmPassword: "",
      lockOnBlur: settings.lockOnBlur,
      idleMinutes: settings.idleMinutes,
      biometricEnabled: Boolean(settings.biometricEnabled),
      resetRecoveryCode: false,
    });
  }, [form, settings, open]);

  return (
    <Modal
      title="应用锁设置"
      open={open}
      confirmLoading={loading}
      okText="保存"
      cancelText="取消"
      onCancel={onCancel}
      onOk={() => void form.submit()}
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={(values) => onSubmit({
          enabled: values.enabled,
          password: values.password,
          lockOnBlur: values.lockOnBlur,
          idleMinutes: values.idleMinutes,
          biometricEnabled: values.biometricEnabled,
          resetRecoveryCode: values.resetRecoveryCode,
        })}
      >
        <Form.Item name="enabled" valuePropName="checked">
          <Checkbox aria-label="启用应用锁">启用应用锁</Checkbox>
        </Form.Item>

        <Form.Item
          name="password"
          label={settings.enabled ? "新解锁密码" : "解锁密码"}
          extra={settings.enabled ? "留空则继续使用当前密码；设置新密码后会迁移到系统凭据。" : "密码只写入系统凭据中的哈希，不保存明文。"}
          rules={[
            {
              validator: async (_, value?: string) => {
                if (!enabled) return;
                if (!settings.enabled && !value?.trim()) {
                  throw new Error("请设置解锁密码");
                }
              },
            },
          ]}
        >
          <Input.Password autoComplete="new-password" placeholder={settings.enabled ? "不修改则留空" : "输入解锁密码"} />
        </Form.Item>

        <Form.Item
          name="confirmPassword"
          label="确认密码"
          dependencies={["password", "enabled"]}
          rules={[
            {
              validator: async (_, value?: string) => {
                if (!enabled) return;
                const password = form.getFieldValue("password")?.trim();
                if (!password) return;
                if (value !== password) {
                  throw new Error("两次输入的密码不一致");
                }
              },
            },
          ]}
        >
          <Input.Password autoComplete="new-password" placeholder="再次输入密码" />
        </Form.Item>

        <Form.Item name="lockOnBlur" valuePropName="checked">
          <Checkbox aria-label="最小化或离开窗口后自动锁定">最小化或离开窗口后自动锁定</Checkbox>
        </Form.Item>

        <Form.Item name="idleMinutes" label="空闲自动锁定时间（分钟）" rules={[{ required: true, message: "请输入空闲锁定时间" }]}>
          <InputNumber min={1} max={240} precision={0} style={{ width: "100%" }} />
        </Form.Item>

        <Form.Item name="biometricEnabled" valuePropName="checked" extra="使用系统支持的平台认证器，例如 Touch ID、Windows Hello、Face ID 或设备 PIN。">
          <Checkbox aria-label="启用生物识别解锁" disabled={!enabled}>启用生物识别解锁</Checkbox>
        </Form.Item>

        <Form.Item
          name="resetRecoveryCode"
          valuePropName="checked"
          extra={settings.recoveryCodeCreatedAt ? `当前恢复码创建于 ${new Date(settings.recoveryCodeCreatedAt).toLocaleString()}。重新生成后旧恢复码会失效。` : "首次启用应用锁会生成一次性恢复码，请保存到安全位置。"}
        >
          <Checkbox aria-label="重新生成恢复码" disabled={!enabled || !settings.enabled}>重新生成恢复码</Checkbox>
        </Form.Item>
      </Form>
    </Modal>
  );
}
