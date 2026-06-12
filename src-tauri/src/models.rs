use std::collections::HashMap;

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
    pub is_pinned: Option<bool>,
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
    pub modified_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiaryDateStatusPayload {
    pub date: String,
    pub exists: bool,
    pub path: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentFilePayload {
    pub file_id: String,
    pub name: String,
    pub relative_path: String,
    pub last_opened_at: Option<String>,
    pub last_edited_at: Option<String>,
    pub is_pinned: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagSummaryPayload {
    pub name: String,
    pub color: Option<String>,
    pub count: u32,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchFiltersPayload {
    pub query: Option<String>,
    pub tag: Option<String>,
    pub date_from: Option<String>,
    pub date_to: Option<String>,
    pub file_type: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResultPayload {
    pub file_id: String,
    pub name: String,
    pub relative_path: String,
    pub snippet: String,
    pub highlighted_snippet: String,
    pub diary_date: Option<String>,
    pub tags: Vec<String>,
    pub score: u32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxItemPayload {
    pub id: String,
    pub created_at: String,
    pub content: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizeViewPayload {
    pub inbox: Vec<InboxItemPayload>,
    pub untagged_journals: Vec<SearchResultPayload>,
    pub recent_edited: Vec<RecentFilePayload>,
    pub favorites: Vec<RecentFilePayload>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavePayload {
    pub file_id: String,
    pub saved: bool,
    pub saved_at: String,
    pub modified_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChangePayload {
    pub file_id: String,
    pub changed: bool,
    pub current_modified_at: Option<String>,
    pub known_modified_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentPayload {
    pub file_name: String,
    pub absolute_path: String,
    pub relative_path: String,
    pub markdown_text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupPayload {
    pub file_name: String,
    pub absolute_path: String,
    pub included_files: u32,
    pub skipped_private_files: u32,
    pub size_bytes: u64,
    pub created_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreBackupPayload {
    pub repository: RepositoryPayload,
    pub backup_file_name: String,
    pub backup_path: String,
    pub restored_files: u32,
    pub skipped_conflicting_files: u32,
    pub strategy: String,
    pub restored_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestorePreviewPayload {
    pub backup_file_name: String,
    pub backup_path: String,
    pub total_backup_files: u32,
    pub added_files: u32,
    pub modified_files: u32,
    pub unchanged_files: u32,
    pub deleted_files: u32,
    pub sample_added: Vec<String>,
    pub sample_modified: Vec<String>,
    pub sample_deleted: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportPayload {
    pub file_name: String,
    pub absolute_path: String,
    pub size_bytes: u64,
    pub created_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialStatusPayload {
    pub key: String,
    pub exists: bool,
    pub storage: String,
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
    #[serde(default)]
    pub diary_settings: DiarySettingsPayload,
    #[serde(default)]
    pub workspace_states: HashMap<String, WorkspaceStateRecord>,
    pub recent_repositories: Vec<RecentRepositoryPayload>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiarySettingsPayload {
    pub auto_open_today: bool,
    pub diary_root: String,
    pub diary_path_pattern: String,
    pub diary_file_name_pattern: String,
    pub diary_template: String,
}

impl Default for DiarySettingsPayload {
    fn default() -> Self {
        Self {
            auto_open_today: true,
            diary_root: "日记".into(),
            diary_path_pattern: "{diaryRoot}/{YYYY}/{MM}".into(),
            diary_file_name_pattern: "{YYYY-MM-DD}.md".into(),
            diary_template:
                "# {{date}} {{weekday}}\n\n## 今天发生了什么\n\n## 情绪\n\n## 想法\n\n## 明天要做\n"
                    .into(),
        }
    }
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceStateRecord {
    pub last_opened_file: Option<String>,
    pub last_edit_mode: Option<String>,
    pub last_cursor_position: Option<CursorPositionPayload>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorPositionPayload {
    pub line: u32,
    pub column: u32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceStatePayload {
    pub repository_id: String,
    pub auto_open_today: bool,
    pub diary_root: String,
    pub diary_path_pattern: String,
    pub diary_file_name_pattern: String,
    pub diary_template: String,
    pub last_opened_file: Option<String>,
    pub last_edit_mode: Option<String>,
    pub last_cursor_position: Option<CursorPositionPayload>,
}

impl WorkspaceStatePayload {
    pub fn from_config(
        repository_id: String,
        settings: DiarySettingsPayload,
        state: WorkspaceStateRecord,
    ) -> Self {
        Self {
            repository_id,
            auto_open_today: settings.auto_open_today,
            diary_root: settings.diary_root,
            diary_path_pattern: settings.diary_path_pattern,
            diary_file_name_pattern: settings.diary_file_name_pattern,
            diary_template: settings.diary_template,
            last_opened_file: state.last_opened_file,
            last_edit_mode: state.last_edit_mode,
            last_cursor_position: state.last_cursor_position,
        }
    }
}
