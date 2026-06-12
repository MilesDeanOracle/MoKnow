import { Form, Input, Modal, Switch } from "antd";
import { useEffect } from "react";
import type { DiarySettings } from "../../types/models";

interface DiarySettingsModalProps {
  open: boolean;
  loading: boolean;
  settings: DiarySettings | null;
  onCancel: () => void;
  onSubmit: (settings: DiarySettings) => void;
}

export function DiarySettingsModal({ open, loading, settings, onCancel, onSubmit }: DiarySettingsModalProps) {
  const [form] = Form.useForm<DiarySettings>();

  useEffect(() => {
    if (settings) {
      form.setFieldsValue(settings);
    }
  }, [form, settings]);

  return (
    <Modal
      title="日记设置"
      open={open}
      confirmLoading={loading}
      okText="保存"
      cancelText="取消"
      onCancel={onCancel}
      onOk={() => void form.submit()}
    >
      <Form form={form} layout="vertical" onFinish={onSubmit} initialValues={settings ?? undefined}>
        <Form.Item name="autoOpenToday" label="启动时打开今天日记" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item name="diaryRoot" label="日记根目录" rules={[{ required: true, message: "请输入日记根目录" }]}>
          <Input placeholder="日记" />
        </Form.Item>
        <Form.Item name="diaryPathPattern" label="路径规则" rules={[{ required: true, message: "请输入路径规则" }]}>
          <Input placeholder="{diaryRoot}/{YYYY}/{MM}" />
        </Form.Item>
        <Form.Item name="diaryFileNamePattern" label="文件名规则" rules={[{ required: true, message: "请输入文件名规则" }]}>
          <Input placeholder="{YYYY-MM-DD}.md" />
        </Form.Item>
        <Form.Item name="diaryTemplate" label="日记模板" rules={[{ required: true, message: "请输入日记模板" }]}>
          <Input.TextArea autoSize={{ minRows: 8, maxRows: 14 }} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
