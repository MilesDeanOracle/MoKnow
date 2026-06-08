use serde::{Deserialize, Serialize};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandResult<T: Serialize> {
    pub success: bool,
    pub data: Option<T>,
    pub message: Option<String>,
    pub error_code: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileNode {
    pub id: String,
    pub name: String,
    pub path: String,
    #[serde(rename = "type")]
    pub node_type: String,
    pub depth: u8,
    pub children: Vec<FileNode>,
    pub content_key: Option<String>,
    pub category: Option<String>,
    pub is_favorite: Option<bool>,
    pub is_virtual: Option<bool>,
    pub deleted_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryPayload {
    pub id: String,
    pub name: String,
    pub root_path: String,
    pub files: Vec<FileNode>,
    pub is_mock: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownFilePayload {
    pub id: String,
    pub name: String,
    pub path: String,
    pub raw: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavePayload {
    pub file_id: String,
    pub saved: bool,
    pub saved_at: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentRepositoryPayload {
    pub name: String,
    pub root_path: String,
    pub opened_at: String,
    pub missing: Option<bool>,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub last_repository_path: Option<String>,
    pub recent_repositories: Vec<RecentRepositoryPayload>,
}
