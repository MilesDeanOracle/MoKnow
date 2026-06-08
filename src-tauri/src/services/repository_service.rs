use std::{
    fs,
    path::{Path, PathBuf},
};

use chrono::{Local, NaiveDate};
use rusqlite::{params, Connection};

use crate::models::{
    AppConfig, FileNode, MarkdownFilePayload, RecentRepositoryPayload, RepositoryPayload,
    SavePayload,
};

fn now_iso() -> String {
    Local::now().to_rfc3339()
}

fn normalize_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn path_from_repository(repository_id: &str) -> PathBuf {
    PathBuf::from(repository_id)
}

fn relative_to_absolute(root_path: &Path, relative_path: &str) -> PathBuf {
    root_path.join(relative_path.replace('/', std::path::MAIN_SEPARATOR_STR))
}

fn remove_path(path: &Path) -> Result<(), String> {
    if path.is_dir() {
        fs::remove_dir_all(path).map_err(|error| format!("删除目录失败：{error}"))
    } else {
        fs::remove_file(path).map_err(|error| format!("删除文件失败：{error}"))
    }
}

fn unique_restore_path(path: &Path) -> PathBuf {
    if !path.exists() {
        return path.to_path_buf();
    }

    let parent = path.parent().unwrap_or_else(|| Path::new(""));
    let stem = path
        .file_stem()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "restored".into());
    let extension = path
        .extension()
        .map(|ext| ext.to_string_lossy().to_string());

    let mut index = 1;
    loop {
        let suffix = if index == 1 {
            "restored".to_string()
        } else {
            format!("restored {index}")
        };
        let file_name = if let Some(extension) = &extension {
            format!("{stem} ({suffix}).{extension}")
        } else {
            format!("{stem} ({suffix})")
        };
        let candidate = parent.join(file_name);
        if !candidate.exists() {
            return candidate;
        }
        index += 1;
    }
}

pub fn validate_entry_name(name: &str) -> Result<(), String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("名称不能为空".into());
    }

    if trimmed.chars().any(|item| {
        matches!(item, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || item.is_control()
    }) {
        return Err("名称不能包含特殊符号".into());
    }

    Ok(())
}

pub fn next_journal_file_name(date: &str, existing: &[String]) -> String {
    let first = format!("{date}.md");
    if !existing.iter().any(|name| name == &first) {
        return first;
    }

    let mut index = 2;
    loop {
        let candidate = format!("{date}-{index}.md");
        if !existing.iter().any(|name| name == &candidate) {
            return candidate;
        }
        index += 1;
    }
}

fn category(id: &str, name: &str, category: &str, is_virtual: bool) -> FileNode {
    FileNode {
        id: id.into(),
        name: name.into(),
        path: name.into(),
        node_type: "category".into(),
        depth: 0,
        children: Vec::new(),
        content_key: None,
        category: Some(category.into()),
        is_favorite: None,
        is_virtual: Some(is_virtual),
        deleted_at: None,
    }
}

pub fn build_default_categories() -> Vec<FileNode> {
    vec![
        category("favorites", "收藏", "favorites", true),
        category("journal", "日记", "journal", false),
        category("documents", "文档", "documents", false),
        category("trash", "trash", "trash", false),
    ]
    .into_iter()
    .map(|mut node| {
        if node.id == "trash" {
            node.name = "回收站".into();
            node.path = "回收站".into();
        }
        node
    })
    .collect()
}

fn app_config_path() -> Result<PathBuf, String> {
    let base = dirs::config_dir().ok_or_else(|| "无法获取系统配置目录".to_string())?;
    Ok(base.join("MoKnow").join("app-config.json"))
}

fn read_app_config() -> AppConfig {
    let Ok(path) = app_config_path() else {
        return AppConfig::default();
    };
    let Ok(raw) = fs::read_to_string(path) else {
        return AppConfig::default();
    };

    serde_json::from_str(&raw).unwrap_or_default()
}

fn write_app_config(config: &AppConfig) -> Result<(), String> {
    let path = app_config_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建应用配置目录失败：{error}"))?;
    }

    let raw = serde_json::to_string_pretty(config)
        .map_err(|error| format!("序列化应用配置失败：{error}"))?;
    fs::write(path, raw).map_err(|error| format!("写入应用配置失败：{error}"))
}

fn touch_recent_repository(name: &str, root_path: &Path) -> Result<(), String> {
    let root_path_text = normalize_path(root_path);
    let mut config = read_app_config();
    config
        .recent_repositories
        .retain(|item| item.root_path != root_path_text);
    config.recent_repositories.insert(
        0,
        RecentRepositoryPayload {
            name: name.into(),
            root_path: root_path_text.clone(),
            opened_at: now_iso(),
            missing: None,
        },
    );
    config.last_repository_path = Some(root_path_text);
    write_app_config(&config)
}

fn repository_name_from_path(root_path: &Path) -> String {
    root_path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "MoKnow 仓库".into())
}

fn open_database(root_path: &Path) -> Result<Connection, String> {
    let db_path = root_path.join(".moknow").join("moknow.db");
    let conn = Connection::open(db_path).map_err(|error| format!("打开 SQLite 数据库失败：{error}"))?;
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS repositories (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          root_path TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS file_metadata (
          id TEXT PRIMARY KEY,
          repository_id TEXT NOT NULL,
          relative_path TEXT NOT NULL,
          kind TEXT NOT NULL,
          category TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(repository_id, relative_path)
        );
        CREATE TABLE IF NOT EXISTS favorites (
          id TEXT PRIMARY KEY,
          repository_id TEXT NOT NULL,
          relative_path TEXT NOT NULL,
          target_kind TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE(repository_id, relative_path)
        );
        CREATE TABLE IF NOT EXISTS trash_records (
          id TEXT PRIMARY KEY,
          repository_id TEXT NOT NULL,
          original_relative_path TEXT NOT NULL,
          trash_relative_path TEXT NOT NULL,
          target_kind TEXT NOT NULL,
          deleted_at TEXT NOT NULL,
          restored_at TEXT
        );
        ",
    )
    .map_err(|error| format!("初始化 SQLite 表结构失败：{error}"))?;
    Ok(conn)
}

fn upsert_repository(conn: &Connection, root_path: &Path, name: &str) -> Result<(), String> {
    let now = now_iso();
    conn.execute(
        "INSERT INTO repositories (id, name, root_path, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?4)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, root_path = excluded.root_path, updated_at = excluded.updated_at",
        params![normalize_path(root_path), name, normalize_path(root_path), now],
    )
    .map_err(|error| format!("写入仓库信息失败：{error}"))?;
    Ok(())
}

fn markdown_file(path: &Path, root_path: &Path, depth: u8) -> Result<FileNode, String> {
    let relative = path
        .strip_prefix(root_path)
        .map_err(|error| format!("计算相对路径失败：{error}"))?;
    let relative_path = normalize_path(relative);
    let file_id = normalize_path(path);
    let name = path
        .file_name()
        .ok_or_else(|| "文件名为空".to_string())?
        .to_string_lossy()
        .to_string();

    Ok(FileNode {
        id: file_id.clone(),
        name,
        path: relative_path.clone(),
        node_type: "markdown".into(),
        depth,
        children: Vec::new(),
        content_key: Some(file_id),
        category: None,
        is_favorite: None,
        is_virtual: None,
        deleted_at: None,
    })
}

fn directory_node(path: &Path, root_path: &Path, depth: u8) -> Result<FileNode, String> {
    let relative = path
        .strip_prefix(root_path)
        .map_err(|error| format!("计算相对路径失败：{error}"))?;
    let relative_path = normalize_path(relative);
    let name = path
        .file_name()
        .ok_or_else(|| "目录名为空".to_string())?
        .to_string_lossy()
        .to_string();
    let mut children = read_directory_nodes(path, root_path, depth + 1)?;

    children.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(FileNode {
        id: relative_path.clone(),
        name,
        path: relative_path,
        node_type: "directory".into(),
        depth,
        children,
        content_key: None,
        category: None,
        is_favorite: None,
        is_virtual: None,
        deleted_at: None,
    })
}

fn read_directory_nodes(path: &Path, root_path: &Path, depth: u8) -> Result<Vec<FileNode>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }

    let mut nodes = Vec::new();
    for entry in fs::read_dir(path).map_err(|error| format!("读取目录失败：{error}"))? {
        let entry = entry.map_err(|error| format!("读取目录项失败：{error}"))?;
        let path = entry.path();
        if path.is_dir() {
            nodes.push(directory_node(&path, root_path, depth)?);
        } else if path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("md"))
        {
            nodes.push(markdown_file(&path, root_path, depth)?);
        }
    }

    Ok(nodes)
}

fn read_favorites(conn: &Connection, root_path: &Path) -> Result<Vec<FileNode>, String> {
    let mut statement = conn
        .prepare("SELECT relative_path, target_kind FROM favorites ORDER BY created_at DESC")
        .map_err(|error| format!("读取收藏失败：{error}"))?;
    let rows = statement
        .query_map([], |row| {
            let relative_path: String = row.get(0)?;
            let target_kind: String = row.get(1)?;
            Ok((relative_path, target_kind))
        })
        .map_err(|error| format!("读取收藏失败：{error}"))?;

    let mut nodes = Vec::new();
    for row in rows {
        let (relative_path, target_kind) =
            row.map_err(|error| format!("读取收藏行失败：{error}"))?;
        let path = relative_to_absolute(root_path, &relative_path);
        nodes.push(FileNode {
            id: format!("favorite-{relative_path}"),
            name: path
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| relative_path.clone()),
            path: relative_path.clone(),
            node_type: if target_kind == "directory" {
                "directory"
            } else {
                "markdown"
            }
            .into(),
            depth: 1,
            children: Vec::new(),
            content_key: if target_kind == "directory" {
                None
            } else {
                Some(normalize_path(&path))
            },
            category: None,
            is_favorite: Some(true),
            is_virtual: None,
            deleted_at: None,
        });
    }

    Ok(nodes)
}

fn read_trash_nodes(conn: &Connection, root_path: &Path) -> Result<Vec<FileNode>, String> {
    let mut statement = conn
        .prepare("SELECT id, trash_relative_path, target_kind, deleted_at FROM trash_records WHERE restored_at IS NULL ORDER BY deleted_at DESC")
        .map_err(|error| format!("读取回收站失败：{error}"))?;
    let rows = statement
        .query_map([], |row| {
            let id: String = row.get(0)?;
            let relative_path: String = row.get(1)?;
            let target_kind: String = row.get(2)?;
            let deleted_at: String = row.get(3)?;
            Ok((id, relative_path, target_kind, deleted_at))
        })
        .map_err(|error| format!("读取回收站失败：{error}"))?;

    let mut nodes = Vec::new();
    for row in rows {
        let (id, relative_path, target_kind, deleted_at) =
            row.map_err(|error| format!("读取回收站行失败：{error}"))?;
        let path = root_path.join(&relative_path);
        nodes.push(FileNode {
            id,
            name: path
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| relative_path.clone()),
            path: relative_path.clone(),
            node_type: if target_kind == "directory" {
                "directory"
            } else {
                "markdown"
            }
            .into(),
            depth: 1,
            children: Vec::new(),
            content_key: None,
            category: None,
            is_favorite: None,
            is_virtual: None,
            deleted_at: Some(deleted_at),
        });
    }

    Ok(nodes)
}

/// 设计模式：外观模式。
/// 原因：仓库创建、SQLite 初始化、文件树扫描和收藏/回收站写入跨越多个底层能力，
/// 用一个服务类统一暴露给 Tauri 命令，命令层只负责参数接收和统一返回。
pub struct RepositoryService;

impl RepositoryService {
    pub fn create_repository(name: String, base_path: String) -> Result<RepositoryPayload, String> {
        validate_entry_name(&name)?;
        let root_path = PathBuf::from(base_path).join(&name);
        if root_path.exists() {
            return Err("仓库目录已存在，请更换名称或导入已有仓库".into());
        }

        fs::create_dir_all(root_path.join(".moknow"))
            .map_err(|error| format!("创建仓库内部目录失败：{error}"))?;
        fs::create_dir_all(root_path.join("日记"))
            .map_err(|error| format!("创建日记目录失败：{error}"))?;
        fs::create_dir_all(root_path.join("文档"))
            .map_err(|error| format!("创建文档目录失败：{error}"))?;
        fs::create_dir_all(root_path.join("回收站"))
            .map_err(|error| format!("创建回收站目录失败：{error}"))?;

        let conn = open_database(&root_path)?;
        upsert_repository(&conn, &root_path, &name)?;
        touch_recent_repository(&name, &root_path)?;

        Self::load_repository(&root_path)
    }

    pub fn open_repository(repository_path: String) -> Result<RepositoryPayload, String> {
        let root_path = PathBuf::from(repository_path);
        if !root_path.join(".moknow").join("moknow.db").exists() {
            return Err("目标目录不是有效的 MoKnow 仓库".into());
        }

        let name = repository_name_from_path(&root_path);
        let conn = open_database(&root_path)?;
        upsert_repository(&conn, &root_path, &name)?;
        touch_recent_repository(&name, &root_path)?;
        Self::load_repository(&root_path)
    }

    pub fn open_last_repository() -> Result<RepositoryPayload, String> {
        let config = read_app_config();
        let path = config
            .last_repository_path
            .ok_or_else(|| "没有上次打开的仓库".to_string())?;
        Self::open_repository(path)
    }

    pub fn list_recent_repositories() -> Vec<RecentRepositoryPayload> {
        read_app_config()
            .recent_repositories
            .into_iter()
            .map(|mut item| {
                item.missing = Some(!PathBuf::from(&item.root_path).exists());
                item
            })
            .collect()
    }

    pub fn load_repository(root_path: &Path) -> Result<RepositoryPayload, String> {
        let conn = open_database(root_path)?;
        let name = repository_name_from_path(root_path);
        let mut files = build_default_categories();
        files[0].children = read_favorites(&conn, root_path)?;
        files[1].children = read_directory_nodes(&root_path.join("日记"), root_path, 1)?;
        files[2].children = read_directory_nodes(&root_path.join("文档"), root_path, 1)?;
        files[3].children = read_trash_nodes(&conn, root_path)?;

        Ok(RepositoryPayload {
            id: normalize_path(root_path),
            name,
            root_path: normalize_path(root_path),
            files,
            is_mock: Some(false),
        })
    }

    pub fn read_markdown_file(file_id: String) -> Result<MarkdownFilePayload, String> {
        let path = PathBuf::from(&file_id);
        let raw = fs::read_to_string(&path)
            .map_err(|error| format!("读取 Markdown 文件失败：{error}"))?;
        Ok(MarkdownFilePayload {
            id: file_id.clone(),
            name: path
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| file_id.clone()),
            path: file_id,
            raw,
        })
    }

    pub fn save_markdown_file(file_id: String, content: String) -> Result<SavePayload, String> {
        fs::write(&file_id, content).map_err(|error| format!("保存 Markdown 文件失败：{error}"))?;
        Ok(SavePayload {
            file_id,
            saved: true,
            saved_at: now_iso(),
        })
    }

    pub fn create_journal_entry(repository_id: String) -> Result<MarkdownFilePayload, String> {
        let root_path = path_from_repository(&repository_id);
        if !root_path.join(".moknow").join("moknow.db").exists() {
            return Err("请先新建或打开一个真实仓库".into());
        }

        let _conn = open_database(&root_path)?;
        let today: NaiveDate = Local::now().date_naive();
        let year = today.format("%Y").to_string();
        let month = today.format("%m").to_string();
        let date = today.format("%Y-%m-%d").to_string();
        let month_dir = root_path.join("日记").join(&year).join(&month);
        fs::create_dir_all(&month_dir).map_err(|error| format!("创建日记目录失败：{error}"))?;

        let existing = fs::read_dir(&month_dir)
            .map_err(|error| format!("读取日记目录失败：{error}"))?
            .filter_map(|entry| entry.ok())
            .filter_map(|entry| entry.file_name().into_string().ok())
            .collect::<Vec<_>>();
        let file_name = next_journal_file_name(&date, &existing);
        let file_path = month_dir.join(&file_name);
        let raw = format!("# {date}\n\n## 今日记录\n");
        fs::write(&file_path, &raw).map_err(|error| format!("写入日记失败：{error}"))?;

        Ok(MarkdownFilePayload {
            id: normalize_path(&file_path),
            name: file_name,
            path: normalize_path(&file_path),
            raw,
        })
    }

    pub fn create_document_directory(
        repository_id: String,
        parent_path: String,
        name: String,
    ) -> Result<FileNode, String> {
        validate_entry_name(&name)?;
        let root_path = path_from_repository(&repository_id);
        let target = relative_to_absolute(&root_path, &parent_path).join(name.trim());
        if target.exists() {
            return Err("同路径下已存在同名目录或文件".into());
        }

        fs::create_dir_all(&target).map_err(|error| format!("创建文档目录失败：{error}"))?;
        directory_node(&target, &root_path, 1)
    }

    pub fn create_document_file(
        repository_id: String,
        parent_path: String,
        name: String,
    ) -> Result<MarkdownFilePayload, String> {
        validate_entry_name(&name)?;
        let root_path = path_from_repository(&repository_id);
        let file_name = if name.ends_with(".md") {
            name.trim().to_string()
        } else if Path::new(&name).extension().is_some() {
            return Err("第一版文档分类只允许创建 .md 文件".into());
        } else {
            format!("{}.md", name.trim())
        };
        let target = relative_to_absolute(&root_path, &parent_path).join(&file_name);
        if target.exists() {
            return Err("同路径下已存在同名目录或文件".into());
        }

        let raw = format!("# {}\n", file_name.trim_end_matches(".md"));
        fs::write(&target, &raw).map_err(|error| format!("创建文档失败：{error}"))?;
        Ok(MarkdownFilePayload {
            id: normalize_path(&target),
            name: file_name,
            path: normalize_path(&target),
            raw,
        })
    }

    pub fn add_favorite(
        repository_id: String,
        relative_path: String,
        target_kind: String,
    ) -> Result<RepositoryPayload, String> {
        let root_path = path_from_repository(&repository_id);
        let conn = open_database(&root_path)?;
        let now = now_iso();
        conn.execute(
            "INSERT OR IGNORE INTO favorites (id, repository_id, relative_path, target_kind, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                format!("{}:{}", normalize_path(&root_path), relative_path),
                normalize_path(&root_path),
                relative_path,
                target_kind,
                now
            ],
        )
        .map_err(|error| format!("写入收藏失败：{error}"))?;
        Self::load_repository(&root_path)
    }

    pub fn remove_favorite(
        repository_id: String,
        relative_path: String,
    ) -> Result<RepositoryPayload, String> {
        let root_path = path_from_repository(&repository_id);
        let conn = open_database(&root_path)?;
        conn.execute(
            "DELETE FROM favorites WHERE repository_id = ?1 AND relative_path = ?2",
            params![normalize_path(&root_path), relative_path],
        )
        .map_err(|error| format!("删除收藏失败：{error}"))?;
        Self::load_repository(&root_path)
    }

    pub fn rename_entry(
        repository_id: String,
        relative_path: String,
        new_name: String,
    ) -> Result<RepositoryPayload, String> {
        validate_entry_name(&new_name)?;
        let root_path = path_from_repository(&repository_id);
        let source = relative_to_absolute(&root_path, &relative_path);
        if !source.exists() {
            return Err("要重命名的文件或目录不存在".into());
        }

        let mut final_name = new_name.trim().to_string();
        if source.is_file()
            && source
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("md"))
            && !final_name.ends_with(".md")
        {
            final_name.push_str(".md");
        }
        let target = source
            .parent()
            .ok_or_else(|| "无法获取父目录".to_string())?
            .join(final_name);
        if target.exists() {
            return Err("同路径下已存在同名目录或文件".into());
        }

        fs::rename(&source, &target).map_err(|error| format!("重命名失败：{error}"))?;
        let conn = open_database(&root_path)?;
        let new_relative = normalize_path(
            target
                .strip_prefix(&root_path)
                .map_err(|error| format!("计算新路径失败：{error}"))?,
        );
        let old_prefix = format!("{relative_path}/");
        let new_prefix = format!("{new_relative}/");
        let mut statement = conn
            .prepare("SELECT relative_path FROM favorites WHERE repository_id = ?1")
            .map_err(|error| format!("读取收藏失败：{error}"))?;
        let rows = statement
            .query_map(params![normalize_path(&root_path)], |row| {
                row.get::<_, String>(0)
            })
            .map_err(|error| format!("读取收藏失败：{error}"))?;
        let favorite_paths = rows.filter_map(|row| row.ok()).collect::<Vec<_>>();
        for favorite_path in favorite_paths {
            if favorite_path == relative_path || favorite_path.starts_with(&old_prefix) {
                let updated_path = if favorite_path == relative_path {
                    new_relative.clone()
                } else {
                    favorite_path.replacen(&old_prefix, &new_prefix, 1)
                };
                conn.execute(
                    "UPDATE favorites SET relative_path = ?1, id = ?2 WHERE repository_id = ?3 AND relative_path = ?4",
                    params![
                        updated_path,
                        format!("{}:{}", normalize_path(&root_path), updated_path),
                        normalize_path(&root_path),
                        favorite_path
                    ],
                )
                .map_err(|error| format!("同步收藏路径失败：{error}"))?;
            }
        }

        Self::load_repository(&root_path)
    }

    pub fn move_to_trash(
        repository_id: String,
        relative_path: String,
    ) -> Result<RepositoryPayload, String> {
        let root_path = path_from_repository(&repository_id);
        let source = relative_to_absolute(&root_path, &relative_path);
        if !source.exists() {
            return Err("要移入回收站的文件或目录不存在".into());
        }

        let file_name = source
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .ok_or_else(|| "文件名为空".to_string())?;
        let stamp = Local::now().format("%Y-%m-%d_%H%M%S").to_string();
        let trash_relative = format!("回收站/{}_{}", stamp, file_name);
        let target = relative_to_absolute(&root_path, &trash_relative);
        fs::rename(&source, &target).map_err(|error| format!("移入回收站失败：{error}"))?;

        let conn = open_database(&root_path)?;
        let now = now_iso();
        conn.execute(
            "INSERT INTO trash_records (id, repository_id, original_relative_path, trash_relative_path, target_kind, deleted_at, restored_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL)",
            params![
                format!("trash:{}:{}", normalize_path(&root_path), now),
                normalize_path(&root_path),
                relative_path,
                trash_relative,
                if target.is_dir() { "directory" } else { "markdown" },
                now
            ],
        )
        .map_err(|error| format!("写入回收站记录失败：{error}"))?;
        Self::load_repository(&root_path)
    }

    pub fn restore_from_trash(
        repository_id: String,
        trash_record_id: String,
        strategy: String,
    ) -> Result<RepositoryPayload, String> {
        let root_path = path_from_repository(&repository_id);
        let conn = open_database(&root_path)?;
        let (original_relative, trash_relative): (String, String) = conn
            .query_row(
                "SELECT original_relative_path, trash_relative_path FROM trash_records WHERE id = ?1 AND restored_at IS NULL",
                params![trash_record_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|error| format!("读取回收站记录失败：{error}"))?;
        let trash_path = relative_to_absolute(&root_path, &trash_relative);
        let original_path = relative_to_absolute(&root_path, &original_relative);
        let restore_path = if original_path.exists() {
            match strategy.as_str() {
                "abort" => return Err("原路径已存在同名文件或目录".into()),
                "overwrite" => {
                    remove_path(&original_path)?;
                    original_path
                }
                "rename" => unique_restore_path(&original_path),
                _ => return Err("未知恢复策略".into()),
            }
        } else {
            original_path
        };
        if let Some(parent) = restore_path.parent() {
            fs::create_dir_all(parent).map_err(|error| format!("创建恢复目录失败：{error}"))?;
        }
        fs::rename(&trash_path, &restore_path)
            .map_err(|error| format!("恢复回收站条目失败：{error}"))?;
        conn.execute(
            "UPDATE trash_records SET restored_at = ?1 WHERE id = ?2",
            params![now_iso(), trash_record_id],
        )
        .map_err(|error| format!("更新回收站记录失败：{error}"))?;
        Self::load_repository(&root_path)
    }

    pub fn permanently_delete_trash_entry(
        repository_id: String,
        trash_record_id: String,
    ) -> Result<RepositoryPayload, String> {
        let root_path = path_from_repository(&repository_id);
        let conn = open_database(&root_path)?;
        let trash_relative: String = conn
            .query_row(
                "SELECT trash_relative_path FROM trash_records WHERE id = ?1 AND restored_at IS NULL",
                params![trash_record_id],
                |row| row.get(0),
            )
            .map_err(|error| format!("读取回收站记录失败：{error}"))?;
        let trash_path = relative_to_absolute(&root_path, &trash_relative);
        if trash_path.exists() {
            remove_path(&trash_path)?;
        }
        conn.execute(
            "DELETE FROM trash_records WHERE id = ?1",
            params![trash_record_id],
        )
        .map_err(|error| format!("删除回收站记录失败：{error}"))?;
        Self::load_repository(&root_path)
    }

    pub fn clear_trash(repository_id: String) -> Result<RepositoryPayload, String> {
        let root_path = path_from_repository(&repository_id);
        let conn = open_database(&root_path)?;
        let mut statement = conn
            .prepare("SELECT id, trash_relative_path FROM trash_records WHERE restored_at IS NULL")
            .map_err(|error| format!("读取回收站失败：{error}"))?;
        let rows = statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|error| format!("读取回收站失败：{error}"))?
            .filter_map(|row| row.ok())
            .collect::<Vec<_>>();
        let mut failed = Vec::new();
        for (id, trash_relative) in rows {
            let trash_path = relative_to_absolute(&root_path, &trash_relative);
            if trash_path.exists() {
                if let Err(error) = remove_path(&trash_path) {
                    failed.push(error);
                    continue;
                }
            }
            conn.execute("DELETE FROM trash_records WHERE id = ?1", params![id])
                .map_err(|error| format!("删除回收站记录失败：{error}"))?;
        }
        if !failed.is_empty() {
            return Err(format!("部分回收站条目删除失败：{}", failed.join("；")));
        }
        Self::load_repository(&root_path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_repository_root() -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("moknow-save-test-{nanos}"))
    }

    fn find_markdown_node<'a>(nodes: &'a [FileNode], name: &str) -> Option<&'a FileNode> {
        for node in nodes {
            if node.name == name && node.node_type == "markdown" {
                return Some(node);
            }

            if let Some(child) = find_markdown_node(&node.children, name) {
                return Some(child);
            }
        }

        None
    }

    #[test]
    fn loaded_markdown_nodes_use_writable_file_ids() {
        let root_path = temp_repository_root();
        let file_name = "2026-06-05.md";
        let file_path = root_path.join("日记").join("2026").join("06").join(file_name);
        fs::create_dir_all(root_path.join(".moknow")).expect("create database directory");
        fs::create_dir_all(file_path.parent().expect("markdown file should have parent"))
            .expect("create journal directory");
        fs::write(&file_path, "# before\n").expect("write initial markdown");

        let repository = RepositoryService::load_repository(&root_path).expect("load repository");
        let node = find_markdown_node(&repository.files, file_name).expect("find markdown node");
        let file_id = node
            .content_key
            .clone()
            .expect("markdown node should expose content key");

        assert_eq!(file_id, normalize_path(&file_path));
        RepositoryService::save_markdown_file(file_id.clone(), "# after\n".into())
            .expect("save markdown by node file id");
        let reread = RepositoryService::read_markdown_file(file_id).expect("read saved markdown");

        assert_eq!(reread.raw, "# after\n");

        fs::remove_dir_all(root_path).expect("cleanup temp repository");
    }

    #[test]
    fn repository_database_is_readable_as_plain_sqlite() {
        let root_path = temp_repository_root();
        fs::create_dir_all(root_path.join(".moknow")).expect("create database directory");

        let conn = open_database(&root_path).expect("initialize repository database");
        drop(conn);

        let plain_conn =
            rusqlite::Connection::open(root_path.join(".moknow").join("moknow.db"))
                .expect("open repository database as plain sqlite");
        let table_name: String = plain_conn
            .query_row(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'repositories'",
                [],
                |row| row.get(0),
            )
            .expect("read repositories table from plain sqlite database");

        assert_eq!(table_name, "repositories");
        drop(plain_conn);

        fs::remove_dir_all(root_path).expect("cleanup temp repository");
    }
}
