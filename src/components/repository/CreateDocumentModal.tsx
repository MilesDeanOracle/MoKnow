import { Input, Modal, Radio, Space } from "antd";
import { useState } from "react";

export type DocumentCreateKind = "file" | "directory";

interface CreateDocumentModalProps {
  open: boolean;
  loading: boolean;
  parentPath: string;
  onCancel: () => void;
  onSubmit: (kind: DocumentCreateKind, name: string) => void;
}

export function CreateDocumentModal({ open, loading, parentPath, onCancel, onSubmit }: CreateDocumentModalProps) {
  const [kind, setKind] = useState<DocumentCreateKind>("file");
  const [name, setName] = useState("");

  return (
    <Modal
      title="新建文档"
      open={open}
      confirmLoading={loading}
      okText="创建"
      cancelText="取消"
      onCancel={onCancel}
      onOk={() => onSubmit(kind, name.trim())}
    >
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <Radio.Group value={kind} onChange={(event) => setKind(event.target.value as DocumentCreateKind)}>
          <Radio.Button value="file">文件</Radio.Button>
          <Radio.Button value="directory">目录</Radio.Button>
        </Radio.Group>
        <Input value={parentPath} disabled />
        <Input placeholder={kind === "file" ? "文档名称，例如：项目规划.md" : "目录名称"} value={name} onChange={(event) => setName(event.target.value)} />
      </Space>
    </Modal>
  );
}
