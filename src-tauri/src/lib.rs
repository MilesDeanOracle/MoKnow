mod models;
mod services;

use models::{
    AttachmentPayload, BackupPayload, CommandResult, CredentialStatusPayload,
    CursorPositionPayload, DiaryDateStatusPayload, DiarySettingsPayload, ExportPayload,
    FileChangePayload, FileNode, InboxItemPayload, MarkdownFilePayload, OrganizeViewPayload,
    RecentFilePayload, RepositoryPayload, RestoreBackupPayload, RestorePreviewPayload, SavePayload,
    SearchFiltersPayload, SearchResultPayload, TagSummaryPayload, WorkspaceStatePayload,
};
use serde::Serialize;
use services::credential_service::{normalize_credential_key, CredentialService};
use services::repository_service::{build_default_categories, RepositoryService};

fn ok<T: Serialize>(data: T) -> CommandResult<T> {
    CommandResult {
        success: true,
        data: Some(data),
        message: None,
        error_code: None,
    }
}

fn fail<T: Serialize>(message: String, error_code: &str) -> CommandResult<T> {
    CommandResult {
        success: false,
        data: None,
        message: Some(message),
        error_code: Some(error_code.into()),
    }
}

fn result<T: Serialize>(value: Result<T, String>, error_code: &str) -> CommandResult<T> {
    match value {
        Ok(data) => ok(data),
        Err(message) => fail(message, error_code),
    }
}

#[tauri::command]
async fn get_mock_repository() -> CommandResult<RepositoryPayload> {
    let mut files = build_default_categories();
    files[1].children = vec![FileNode {
        id: "journal-2024".into(),
        name: "2024".into(),
        path: "日记/2024".into(),
        node_type: "directory".into(),
        depth: 1,
        children: vec![FileNode {
            id: "journal-2024-06".into(),
            name: "06".into(),
            path: "日记/2024/06".into(),
            node_type: "directory".into(),
            depth: 2,
            children: vec![FileNode {
                id: "source".into(),
                name: "2024-06-04-日记.md".into(),
                path: "日记/2024/06/2024-06-04-日记.md".into(),
                node_type: "markdown".into(),
                depth: 3,
                children: vec![],
                content_key: Some("source".into()),
                category: None,
                is_favorite: None,
                is_pinned: None,
                is_virtual: None,
                deleted_at: None,
            }],
            content_key: None,
            category: None,
            is_favorite: None,
            is_pinned: None,
            is_virtual: None,
            deleted_at: None,
        }],
        content_key: None,
        category: None,
        is_favorite: None,
        is_pinned: None,
        is_virtual: None,
        deleted_at: None,
    }];
    files[2].children = vec![FileNode {
        id: "project".into(),
        name: "项目".into(),
        path: "文档/项目".into(),
        node_type: "directory".into(),
        depth: 1,
        children: vec![FileNode {
            id: "readme".into(),
            name: "README.md".into(),
            path: "文档/项目/README.md".into(),
            node_type: "markdown".into(),
            depth: 2,
            children: vec![],
            content_key: Some("readme".into()),
            category: None,
            is_favorite: None,
            is_pinned: None,
            is_virtual: None,
            deleted_at: None,
        }],
        content_key: None,
        category: None,
        is_favorite: None,
        is_pinned: None,
        is_virtual: None,
        deleted_at: None,
    }];

    ok(RepositoryPayload {
        id: "daily".into(),
        name: "MoKnow 日记仓库".into(),
        root_path: "E:\\diary\\MoKnow Notes".into(),
        files,
        is_mock: Some(true),
    })
}

#[tauri::command]
async fn create_repository(name: String, base_path: String) -> CommandResult<RepositoryPayload> {
    result(
        RepositoryService::create_repository(name, base_path),
        "CREATE_REPOSITORY_FAILED",
    )
}

#[tauri::command]
async fn open_repository(repository_path: String) -> CommandResult<RepositoryPayload> {
    result(
        RepositoryService::open_repository(repository_path),
        "OPEN_REPOSITORY_FAILED",
    )
}

#[tauri::command]
async fn open_last_repository() -> CommandResult<RepositoryPayload> {
    result(
        RepositoryService::open_last_repository(),
        "OPEN_LAST_REPOSITORY_FAILED",
    )
}

#[tauri::command]
async fn list_recent_repositories() -> CommandResult<Vec<models::RecentRepositoryPayload>> {
    ok(RepositoryService::list_recent_repositories())
}

#[tauri::command]
async fn list_recent_files(
    repository_id: String,
    list_kind: String,
) -> CommandResult<Vec<RecentFilePayload>> {
    result(
        RepositoryService::list_recent_files(repository_id, list_kind),
        "LIST_RECENT_FILES_FAILED",
    )
}

#[tauri::command]
async fn clear_recent_files(repository_id: String, list_kind: String) -> CommandResult<bool> {
    result(
        RepositoryService::clear_recent_files(repository_id, list_kind),
        "CLEAR_RECENT_FILES_FAILED",
    )
}

#[tauri::command]
async fn list_inbox_entries(repository_id: String) -> CommandResult<Vec<InboxItemPayload>> {
    result(
        RepositoryService::list_inbox_entries(repository_id),
        "LIST_INBOX_ENTRIES_FAILED",
    )
}

#[tauri::command]
async fn append_inbox_entry(
    repository_id: String,
    content: String,
) -> CommandResult<Vec<InboxItemPayload>> {
    result(
        RepositoryService::append_inbox_entry(repository_id, content),
        "APPEND_INBOX_ENTRY_FAILED",
    )
}

#[tauri::command]
async fn clear_inbox_entries(
    repository_id: String,
    entry_ids: Vec<String>,
) -> CommandResult<Vec<InboxItemPayload>> {
    result(
        RepositoryService::clear_inbox_entries(repository_id, entry_ids),
        "CLEAR_INBOX_ENTRIES_FAILED",
    )
}

#[tauri::command]
async fn move_inbox_entries_to_today(
    repository_id: String,
    entry_ids: Vec<String>,
) -> CommandResult<MarkdownFilePayload> {
    result(
        RepositoryService::move_inbox_entries_to_today(repository_id, entry_ids),
        "MOVE_INBOX_ENTRIES_TO_TODAY_FAILED",
    )
}

#[tauri::command]
async fn list_organize_view(repository_id: String) -> CommandResult<OrganizeViewPayload> {
    result(
        RepositoryService::list_organize_view(repository_id),
        "LIST_ORGANIZE_VIEW_FAILED",
    )
}

#[tauri::command]
async fn list_tags(repository_id: String) -> CommandResult<Vec<TagSummaryPayload>> {
    result(
        RepositoryService::list_tags(repository_id),
        "LIST_TAGS_FAILED",
    )
}

#[tauri::command]
async fn set_tag_color(
    repository_id: String,
    tag_name: String,
    color: String,
) -> CommandResult<Vec<TagSummaryPayload>> {
    result(
        RepositoryService::set_tag_color(repository_id, tag_name, color),
        "SET_TAG_COLOR_FAILED",
    )
}

#[tauri::command]
async fn rename_tag(
    repository_id: String,
    old_name: String,
    new_name: String,
) -> CommandResult<Vec<TagSummaryPayload>> {
    result(
        RepositoryService::rename_tag(repository_id, old_name, new_name),
        "RENAME_TAG_FAILED",
    )
}

#[tauri::command]
async fn delete_tag(
    repository_id: String,
    tag_name: String,
) -> CommandResult<Vec<TagSummaryPayload>> {
    result(
        RepositoryService::delete_tag(repository_id, tag_name),
        "DELETE_TAG_FAILED",
    )
}

#[tauri::command]
async fn search_files(
    repository_id: String,
    filters: SearchFiltersPayload,
) -> CommandResult<Vec<SearchResultPayload>> {
    result(
        RepositoryService::search_files(repository_id, filters),
        "SEARCH_FILES_FAILED",
    )
}

#[tauri::command]
async fn get_diary_settings() -> CommandResult<DiarySettingsPayload> {
    ok(RepositoryService::get_diary_settings())
}

#[tauri::command]
async fn save_diary_settings(
    settings: DiarySettingsPayload,
) -> CommandResult<DiarySettingsPayload> {
    result(
        RepositoryService::save_diary_settings(settings),
        "SAVE_DIARY_SETTINGS_FAILED",
    )
}

#[tauri::command]
async fn get_workspace_state(repository_id: String) -> CommandResult<WorkspaceStatePayload> {
    ok(RepositoryService::get_workspace_state(repository_id))
}

#[tauri::command]
async fn save_workspace_state(
    repository_id: String,
    file_id: Option<String>,
    edit_mode: String,
    cursor_position: Option<CursorPositionPayload>,
) -> CommandResult<WorkspaceStatePayload> {
    result(
        RepositoryService::save_workspace_state(repository_id, file_id, edit_mode, cursor_position),
        "SAVE_WORKSPACE_STATE_FAILED",
    )
}

#[tauri::command]
async fn load_repository_tree(repository_id: String) -> CommandResult<RepositoryPayload> {
    result(
        RepositoryService::load_repository(&std::path::PathBuf::from(repository_id)),
        "LOAD_REPOSITORY_TREE_FAILED",
    )
}

#[tauri::command]
async fn read_markdown_file(file_id: String) -> CommandResult<MarkdownFilePayload> {
    if std::path::PathBuf::from(&file_id).exists() {
        return result(
            RepositoryService::read_markdown_file(file_id),
            "READ_MARKDOWN_FAILED",
        );
    }

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
        modified_at: None,
    })
}

#[tauri::command]
async fn check_file_changed(
    file_id: String,
    known_modified_at: Option<String>,
) -> CommandResult<FileChangePayload> {
    if std::path::PathBuf::from(&file_id).exists() {
        return result(
            RepositoryService::check_file_changed(file_id, known_modified_at),
            "CHECK_FILE_CHANGED_FAILED",
        );
    }

    ok(FileChangePayload {
        file_id,
        changed: false,
        current_modified_at: known_modified_at.clone(),
        known_modified_at,
    })
}

#[tauri::command]
async fn save_markdown_file(file_id: String, _content: String) -> CommandResult<SavePayload> {
    if std::path::PathBuf::from(&file_id).exists() {
        return result(
            RepositoryService::save_markdown_file(file_id, _content),
            "SAVE_MARKDOWN_FAILED",
        );
    }

    ok(SavePayload {
        file_id,
        saved: true,
        saved_at: "mock-time".into(),
        modified_at: None,
    })
}

#[tauri::command]
async fn save_markdown_file_as_copy(
    file_id: String,
    content: String,
) -> CommandResult<MarkdownFilePayload> {
    if std::path::PathBuf::from(&file_id).exists() {
        return result(
            RepositoryService::save_markdown_file_as_copy(file_id, content),
            "SAVE_MARKDOWN_COPY_FAILED",
        );
    }

    ok(MarkdownFilePayload {
        id: format!("{file_id}-copy"),
        name: "副本.md".into(),
        path: "2024 › 06月".into(),
        raw: content,
        modified_at: None,
    })
}

#[tauri::command]
async fn save_attachment(
    markdown_file_id: String,
    file_name: String,
    bytes: Vec<u8>,
) -> CommandResult<AttachmentPayload> {
    result(
        RepositoryService::save_attachment(markdown_file_id, file_name, bytes),
        "SAVE_ATTACHMENT_FAILED",
    )
}

#[tauri::command]
async fn backup_repository(
    repository_id: String,
    output_path: Option<String>,
    exclude_private_data: Option<bool>,
) -> CommandResult<BackupPayload> {
    result(
        RepositoryService::backup_repository(repository_id, output_path, exclude_private_data),
        "BACKUP_REPOSITORY_FAILED",
    )
}

#[tauri::command]
async fn restore_latest_backup(repository_id: String) -> CommandResult<RestoreBackupPayload> {
    result(
        RepositoryService::restore_latest_backup(repository_id),
        "RESTORE_BACKUP_FAILED",
    )
}

#[tauri::command]
async fn preview_restore_backup(
    repository_id: String,
    backup_path: Option<String>,
) -> CommandResult<RestorePreviewPayload> {
    result(
        RepositoryService::preview_restore_backup(repository_id, backup_path),
        "PREVIEW_RESTORE_BACKUP_FAILED",
    )
}

#[tauri::command]
async fn restore_backup(
    repository_id: String,
    backup_path: Option<String>,
    strategy: Option<String>,
) -> CommandResult<RestoreBackupPayload> {
    result(
        RepositoryService::restore_backup(repository_id, backup_path, strategy),
        "RESTORE_BACKUP_FAILED",
    )
}

#[tauri::command]
async fn export_markdown_html(file_id: String, html: String) -> CommandResult<ExportPayload> {
    result(
        RepositoryService::export_markdown_html(file_id, html),
        "EXPORT_MARKDOWN_HTML_FAILED",
    )
}

#[tauri::command]
async fn export_markdown_pdf(
    file_id: String,
    html: String,
    title: String,
) -> CommandResult<ExportPayload> {
    result(
        RepositoryService::export_markdown_pdf(file_id, html, title),
        "EXPORT_MARKDOWN_PDF_FAILED",
    )
}

#[tauri::command]
async fn export_html_to_path(output_path: String, html: String) -> CommandResult<ExportPayload> {
    result(
        RepositoryService::export_html_to_path(output_path, html),
        "EXPORT_HTML_TO_PATH_FAILED",
    )
}

#[tauri::command]
async fn save_secure_credential(
    key: String,
    secret: String,
) -> CommandResult<CredentialStatusPayload> {
    let normalized_key = normalize_credential_key(&key);
    match CredentialService::save(key.clone(), secret) {
        Ok(_) => ok(CredentialStatusPayload {
            key: normalized_key.unwrap_or(key),
            exists: true,
            storage: "system-keychain".into(),
        }),
        Err(message) => fail(message, "SAVE_SECURE_CREDENTIAL_FAILED"),
    }
}

#[tauri::command]
async fn read_secure_credential(key: String) -> CommandResult<Option<String>> {
    result(
        CredentialService::read(key),
        "READ_SECURE_CREDENTIAL_FAILED",
    )
}

#[tauri::command]
async fn delete_secure_credential(key: String) -> CommandResult<CredentialStatusPayload> {
    let normalized_key = normalize_credential_key(&key);
    match CredentialService::delete(key.clone()) {
        Ok(_) => ok(CredentialStatusPayload {
            key: normalized_key.unwrap_or(key),
            exists: false,
            storage: "system-keychain".into(),
        }),
        Err(message) => fail(message, "DELETE_SECURE_CREDENTIAL_FAILED"),
    }
}

#[tauri::command]
async fn get_secure_credential_status(key: String) -> CommandResult<CredentialStatusPayload> {
    let normalized_key = normalize_credential_key(&key);
    match CredentialService::exists(key.clone()) {
        Ok(exists) => ok(CredentialStatusPayload {
            key: normalized_key.unwrap_or(key),
            exists,
            storage: "system-keychain".into(),
        }),
        Err(message) => fail(message, "GET_SECURE_CREDENTIAL_STATUS_FAILED"),
    }
}

#[tauri::command]
async fn open_today_journal(repository_id: String) -> CommandResult<MarkdownFilePayload> {
    result(
        RepositoryService::open_today_journal(repository_id),
        "OPEN_TODAY_JOURNAL_FAILED",
    )
}

#[tauri::command]
async fn open_journal_by_date(
    repository_id: String,
    date: String,
) -> CommandResult<MarkdownFilePayload> {
    result(
        RepositoryService::open_journal_by_date(repository_id, date),
        "OPEN_JOURNAL_BY_DATE_FAILED",
    )
}

#[tauri::command]
async fn list_diary_month_status(
    repository_id: String,
    year: i32,
    month: u32,
) -> CommandResult<Vec<DiaryDateStatusPayload>> {
    result(
        RepositoryService::list_diary_month_status(repository_id, year, month),
        "LIST_DIARY_MONTH_STATUS_FAILED",
    )
}

#[tauri::command]
async fn create_journal_entry(repository_id: String) -> CommandResult<MarkdownFilePayload> {
    result(
        RepositoryService::create_journal_entry(repository_id),
        "CREATE_JOURNAL_FAILED",
    )
}

#[tauri::command]
async fn create_document_directory(
    repository_id: String,
    parent_path: String,
    name: String,
) -> CommandResult<FileNode> {
    result(
        RepositoryService::create_document_directory(repository_id, parent_path, name),
        "CREATE_DOCUMENT_DIRECTORY_FAILED",
    )
}

#[tauri::command]
async fn create_document_file(
    repository_id: String,
    parent_path: String,
    name: String,
) -> CommandResult<MarkdownFilePayload> {
    result(
        RepositoryService::create_document_file(repository_id, parent_path, name),
        "CREATE_DOCUMENT_FILE_FAILED",
    )
}

#[tauri::command]
async fn move_to_trash(
    repository_id: String,
    relative_path: String,
) -> CommandResult<RepositoryPayload> {
    result(
        RepositoryService::move_to_trash(repository_id, relative_path),
        "MOVE_TO_TRASH_FAILED",
    )
}

#[tauri::command]
async fn restore_from_trash(
    repository_id: String,
    trash_record_id: String,
    strategy: String,
) -> CommandResult<RepositoryPayload> {
    result(
        RepositoryService::restore_from_trash(repository_id, trash_record_id, strategy),
        "RESTORE_FROM_TRASH_FAILED",
    )
}

#[tauri::command]
async fn permanently_delete_trash_entry(
    repository_id: String,
    trash_record_id: String,
) -> CommandResult<RepositoryPayload> {
    result(
        RepositoryService::permanently_delete_trash_entry(repository_id, trash_record_id),
        "PERMANENT_DELETE_FAILED",
    )
}

#[tauri::command]
async fn clear_trash(repository_id: String) -> CommandResult<RepositoryPayload> {
    result(
        RepositoryService::clear_trash(repository_id),
        "CLEAR_TRASH_FAILED",
    )
}

#[tauri::command]
async fn add_favorite(
    repository_id: String,
    relative_path: String,
    target_kind: String,
) -> CommandResult<RepositoryPayload> {
    result(
        RepositoryService::add_favorite(repository_id, relative_path, target_kind),
        "ADD_FAVORITE_FAILED",
    )
}

#[tauri::command]
async fn set_file_pinned(
    repository_id: String,
    relative_path: String,
    pinned: bool,
) -> CommandResult<RepositoryPayload> {
    result(
        RepositoryService::set_file_pinned(repository_id, relative_path, pinned),
        "SET_FILE_PINNED_FAILED",
    )
}

#[tauri::command]
async fn remove_favorite(
    repository_id: String,
    relative_path: String,
) -> CommandResult<RepositoryPayload> {
    result(
        RepositoryService::remove_favorite(repository_id, relative_path),
        "REMOVE_FAVORITE_FAILED",
    )
}

#[tauri::command]
async fn rename_entry(
    repository_id: String,
    relative_path: String,
    new_name: String,
) -> CommandResult<RepositoryPayload> {
    result(
        RepositoryService::rename_entry(repository_id, relative_path, new_name),
        "RENAME_ENTRY_FAILED",
    )
}

#[tauri::command]
async fn show_in_folder(repository_id: String, relative_path: String) -> CommandResult<bool> {
    result(
        RepositoryService::show_in_folder(repository_id, relative_path),
        "SHOW_IN_FOLDER_FAILED",
    )
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_mock_repository,
            create_repository,
            open_repository,
            open_last_repository,
            list_recent_repositories,
            list_recent_files,
            clear_recent_files,
            list_inbox_entries,
            append_inbox_entry,
            clear_inbox_entries,
            move_inbox_entries_to_today,
            list_organize_view,
            list_tags,
            set_tag_color,
            rename_tag,
            delete_tag,
            search_files,
            get_diary_settings,
            save_diary_settings,
            get_workspace_state,
            save_workspace_state,
            load_repository_tree,
            read_markdown_file,
            check_file_changed,
            save_markdown_file,
            save_markdown_file_as_copy,
            save_attachment,
            backup_repository,
            restore_latest_backup,
            preview_restore_backup,
            restore_backup,
            export_markdown_html,
            export_markdown_pdf,
            export_html_to_path,
            save_secure_credential,
            read_secure_credential,
            delete_secure_credential,
            get_secure_credential_status,
            open_today_journal,
            open_journal_by_date,
            list_diary_month_status,
            create_journal_entry,
            create_document_directory,
            create_document_file,
            move_to_trash,
            restore_from_trash,
            permanently_delete_trash_entry,
            clear_trash,
            add_favorite,
            set_file_pinned,
            remove_favorite,
            rename_entry,
            show_in_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running MoKnow application");
}

#[cfg(test)]
mod tests {
    use super::services::repository_service::{
        build_default_categories, next_journal_file_name, validate_entry_name,
    };

    #[test]
    fn default_categories_are_fixed_and_favorites_is_virtual() {
        let categories = build_default_categories();

        let names: Vec<_> = categories.iter().map(|node| node.name.as_str()).collect();
        let virtual_flags: Vec<_> = categories.iter().map(|node| node.is_virtual).collect();

        assert_eq!(names, vec!["收藏", "日记", "文档", "回收站"]);
        assert_eq!(
            virtual_flags,
            vec![Some(true), Some(false), Some(false), Some(false)]
        );
    }

    #[test]
    fn journal_file_name_uses_incrementing_suffix_for_same_day_entries() {
        let existing = vec!["2026-06-04.md".to_string(), "2026-06-04-2.md".to_string()];

        let name = next_journal_file_name("2026-06-04", &existing);

        assert_eq!(name, "2026-06-04-3.md");
    }

    #[test]
    fn entry_name_rejects_windows_special_characters() {
        assert!(validate_entry_name("项目规划.md").is_ok());
        assert!(validate_entry_name("坏:name.md").is_err());
    }
}
