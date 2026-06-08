mod models;
mod services;

use models::{CommandResult, FileNode, MarkdownFilePayload, RepositoryPayload, SavePayload};
use serde::Serialize;
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
                is_virtual: None,
                deleted_at: None,
            }],
            content_key: None,
            category: None,
            is_favorite: None,
            is_virtual: None,
            deleted_at: None,
        }],
        content_key: None,
        category: None,
        is_favorite: None,
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
            is_virtual: None,
            deleted_at: None,
        }],
        content_key: None,
        category: None,
        is_favorite: None,
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
    })
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
async fn show_in_folder(_repository_id: String, _relative_path: String) -> CommandResult<bool> {
    ok(true)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_mock_repository,
            create_repository,
            open_repository,
            open_last_repository,
            list_recent_repositories,
            load_repository_tree,
            read_markdown_file,
            save_markdown_file,
            create_journal_entry,
            create_document_directory,
            create_document_file,
            move_to_trash,
            restore_from_trash,
            permanently_delete_trash_entry,
            clear_trash,
            add_favorite,
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
