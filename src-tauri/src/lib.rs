use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CommandResult<T: Serialize> {
    success: bool,
    data: Option<T>,
    message: Option<String>,
    error_code: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileNode {
    id: String,
    name: String,
    path: String,
    #[serde(rename = "type")]
    node_type: String,
    depth: u8,
    children: Vec<FileNode>,
    content_key: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RepositoryPayload {
    id: String,
    name: String,
    root_path: String,
    files: Vec<FileNode>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MarkdownFilePayload {
    id: String,
    name: String,
    path: String,
    raw: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SavePayload {
    file_id: String,
    saved: bool,
    saved_at: String,
}

fn ok<T: Serialize>(data: T) -> CommandResult<T> {
    CommandResult {
        success: true,
        data: Some(data),
        message: None,
        error_code: None,
    }
}

#[tauri::command]
async fn get_mock_repository() -> CommandResult<RepositoryPayload> {
    ok(RepositoryPayload {
        id: "daily".into(),
        name: "MoKnow 日记仓库".into(),
        root_path: "E:\\diary\\MoKnow Notes".into(),
        files: vec![
            FileNode {
                id: "2024".into(),
                name: "2024".into(),
                path: "2024".into(),
                node_type: "directory".into(),
                depth: 0,
                content_key: None,
                children: vec![FileNode {
                    id: "2024-06".into(),
                    name: "06月".into(),
                    path: "2024/06月".into(),
                    node_type: "directory".into(),
                    depth: 1,
                    content_key: None,
                    children: vec![FileNode {
                        id: "source".into(),
                        name: "2024-06-04-日记.md".into(),
                        path: "2024/06月/2024-06-04-日记.md".into(),
                        node_type: "markdown".into(),
                        depth: 2,
                        content_key: Some("source".into()),
                        children: vec![],
                    }],
                }],
            },
            FileNode {
                id: "project".into(),
                name: "项目".into(),
                path: "项目".into(),
                node_type: "directory".into(),
                depth: 0,
                content_key: None,
                children: vec![FileNode {
                    id: "readme".into(),
                    name: "README.md".into(),
                    path: "项目/README.md".into(),
                    node_type: "markdown".into(),
                    depth: 1,
                    content_key: Some("readme".into()),
                    children: vec![],
                }],
            },
        ],
    })
}

#[tauri::command]
async fn read_markdown_file(file_id: String) -> CommandResult<MarkdownFilePayload> {
    let name = if file_id == "readme" {
        "README.md"
    } else {
        "2024-06-04-日记.md"
    };

    ok(MarkdownFilePayload {
        id: file_id,
        name: name.into(),
        path: "2024 › 06月".into(),
        raw: "# MoKnow\n\n这是 Tauri 命令返回的 mock Markdown 内容。".into(),
    })
}

#[tauri::command]
async fn save_markdown_file(file_id: String, _content: String) -> CommandResult<SavePayload> {
    ok(SavePayload {
        file_id,
        saved: true,
        saved_at: "mock-time".into(),
    })
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_mock_repository,
            read_markdown_file,
            save_markdown_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running MoKnow application");
}
