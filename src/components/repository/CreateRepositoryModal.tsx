import { Button, Input, Modal, Space } from "antd";
import { FolderOpen } from "lucide-react";
import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";

interface CreateRepositoryModalProps {
  open: boolean;
  loading: boolean;
  onCancel: () => void;
  onSubmit: (name: string, basePath: string) => void;
}

export function CreateRepositoryModal({ open: visible, loading, onCancel, onSubmit }: CreateRepositoryModalProps) {
  const [name, setName] = useState("");
  const [basePath, setBasePath] = useState("");

  const chooseDirectory = async () => {
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
      return;
    }

    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      setBasePath(selected);
    }
  };

  return (
    <Modal
      title="新建仓库"
      open={visible}
      confirmLoading={loading}
      okText="创建"
      cancelText="取消"
      onCancel={onCancel}
      onOk={() => onSubmit(name.trim(), basePath.trim())}
    >
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <Input placeholder="仓库名称" value={name} onChange={(event) => setName(event.target.value)} />
        <Space.Compact style={{ width: "100%" }}>
          <Input placeholder="仓库存放位置" value={basePath} onChange={(event) => setBasePath(event.target.value)} />
          <Button icon={<FolderOpen size={14} />} onClick={() => void chooseDirectory()} />
        </Space.Compact>
      </Space>
    </Modal>
  );
}
