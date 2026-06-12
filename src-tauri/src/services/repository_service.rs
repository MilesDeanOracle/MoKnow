use std::{
    collections::HashMap,
    fs::{self, File},
    io::{Seek, Write},
    path::{Path, PathBuf},
    process::Command,
};

use chrono::{DateTime, Datelike, Local, NaiveDate};
use rusqlite::{params, params_from_iter, Connection};

use crate::models::{
    AppConfig, AttachmentPayload, BackupPayload, CursorPositionPayload, DiaryDateStatusPayload,
    DiarySettingsPayload, ExportPayload, FileChangePayload, FileNode, InboxItemPayload,
    MarkdownFilePayload, OrganizeViewPayload, RecentFilePayload, RecentRepositoryPayload,
    RepositoryPayload, RestoreBackupPayload, RestorePreviewPayload, SavePayload,
    SearchFiltersPayload, SearchResultPayload, TagSummaryPayload, WorkspaceStatePayload,
    WorkspaceStateRecord,
};

fn now_iso() -> String {
    Local::now().to_rfc3339()
}

fn file_modified_at(path: &Path) -> Option<String> {
    let modified = fs::metadata(path).ok()?.modified().ok()?;
    let datetime: DateTime<Local> = modified.into();
    Some(datetime.to_rfc3339())
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

fn repository_root_for_path(path: &Path) -> Option<PathBuf> {
    let mut current = if path.is_dir() { path } else { path.parent()? };
    loop {
        if current.join(".moknow").join("moknow.db").exists() {
            return Some(current.to_path_buf());
        }
        current = current.parent()?;
    }
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

fn unique_copy_path(path: &Path) -> PathBuf {
    let parent = path.parent().unwrap_or_else(|| Path::new(""));
    let stem = path
        .file_stem()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "未命名".into());
    let extension = path
        .extension()
        .map(|ext| ext.to_string_lossy().to_string())
        .unwrap_or_else(|| "md".into());

    let mut index = 1;
    loop {
        let file_name = if index == 1 {
            format!("{stem} 副本.{extension}")
        } else {
            format!("{stem} 副本 {index}.{extension}")
        };
        let candidate = parent.join(file_name);
        if !candidate.exists() {
            return candidate;
        }
        index += 1;
    }
}

fn unique_export_path(markdown_path: &Path, extension: &str) -> PathBuf {
    let parent = markdown_path.parent().unwrap_or_else(|| Path::new(""));
    let stem = markdown_path
        .file_stem()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "export".into());
    let first = parent.join(format!("{stem}.{extension}"));
    if !first.exists() {
        return first;
    }

    let mut index = 2;
    loop {
        let candidate = parent.join(format!("{stem}-{index}.{extension}"));
        if !candidate.exists() {
            return candidate;
        }
        index += 1;
    }
}

fn unique_html_export_path(markdown_path: &Path) -> PathBuf {
    unique_export_path(markdown_path, "html")
}

fn unique_pdf_export_path(markdown_path: &Path) -> PathBuf {
    unique_export_path(markdown_path, "pdf")
}

fn strip_html_to_text(html: &str) -> String {
    let mut text = String::new();
    let mut in_tag = false;
    let mut entity = String::new();
    let mut in_entity = false;

    for character in html.chars() {
        if in_tag {
            if character == '>' {
                in_tag = false;
                text.push(' ');
            }
            continue;
        }

        if in_entity {
            if character == ';' {
                let decoded = match entity.as_str() {
                    "amp" => '&',
                    "lt" => '<',
                    "gt" => '>',
                    "quot" => '"',
                    "#39" => '\'',
                    "nbsp" => ' ',
                    _ => ' ',
                };
                text.push(decoded);
                entity.clear();
                in_entity = false;
            } else if entity.len() < 12 {
                entity.push(character);
            } else {
                text.push(' ');
                entity.clear();
                in_entity = false;
            }
            continue;
        }

        match character {
            '<' => in_tag = true,
            '&' => in_entity = true,
            _ => text.push(character),
        }
    }

    text.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn pdf_escape_text(text: &str) -> String {
    text.chars()
        .map(|character| match character {
            '(' => "\\(".into(),
            ')' => "\\)".into(),
            '\\' => "\\\\".into(),
            character if character.is_ascii() => character.to_string(),
            _ => "?".into(),
        })
        .collect::<String>()
}

fn wrap_pdf_line(line: &str, max_chars: usize) -> Vec<String> {
    let mut lines = Vec::new();
    let mut current = String::new();

    for word in line.split_whitespace() {
        if !current.is_empty() && current.len() + word.len() + 1 > max_chars {
            lines.push(current);
            current = String::new();
        }
        if !current.is_empty() {
            current.push(' ');
        }
        current.push_str(word);
    }

    if current.is_empty() {
        lines.push(line.chars().take(max_chars).collect());
    } else {
        lines.push(current);
    }

    lines
}

fn render_simple_pdf(title: &str, html: &str) -> Vec<u8> {
    let text = strip_html_to_text(html);
    let mut lines = Vec::new();
    lines.push(title.to_string());
    lines.push(String::new());
    for line in text.lines() {
        lines.extend(wrap_pdf_line(line, 88));
    }

    let mut stream = String::from("BT\n/F1 11 Tf\n50 792 Td\n14 TL\n");
    for (index, line) in lines.iter().take(52).enumerate() {
        if index > 0 {
            stream.push_str("T*\n");
        }
        stream.push_str(&format!("({}) Tj\n", pdf_escape_text(line)));
    }
    stream.push_str("ET\n");

    let objects = vec![
        String::from("<< /Type /Catalog /Pages 2 0 R >>"),
        String::from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
        String::from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>"),
        String::from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
        format!("<< /Length {} >>\nstream\n{}endstream", stream.as_bytes().len(), stream),
    ];

    let mut pdf = String::from("%PDF-1.4\n");
    let mut offsets = Vec::new();
    for (index, object) in objects.iter().enumerate() {
        offsets.push(pdf.as_bytes().len());
        pdf.push_str(&format!("{} 0 obj\n{}\nendobj\n", index + 1, object));
    }
    let xref_offset = pdf.as_bytes().len();
    pdf.push_str("xref\n0 6\n0000000000 65535 f \n");
    for offset in offsets {
        pdf.push_str(&format!("{offset:010} 00000 n \n"));
    }
    pdf.push_str(&format!(
        "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n"
    ));

    pdf.into_bytes()
}

struct ZipEntryMeta {
    name: String,
    crc32: u32,
    size: u32,
    local_header_offset: u32,
}

struct ZipStoredFile {
    name: String,
    bytes: Vec<u8>,
}

fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = 0xffff_ffff_u32;
    for byte in bytes {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            let mask = (crc & 1).wrapping_neg();
            crc = (crc >> 1) ^ (0xedb8_8320 & mask);
        }
    }
    !crc
}

fn read_zip_u16(bytes: &[u8], offset: usize) -> Result<u16, String> {
    let slice = bytes
        .get(offset..offset + 2)
        .ok_or_else(|| "备份文件结构不完整".to_string())?;
    Ok(u16::from_le_bytes([slice[0], slice[1]]))
}

fn read_zip_u32(bytes: &[u8], offset: usize) -> Result<u32, String> {
    let slice = bytes
        .get(offset..offset + 4)
        .ok_or_else(|| "备份文件结构不完整".to_string())?;
    Ok(u32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]]))
}

fn write_u16(writer: &mut File, value: u16) -> Result<(), String> {
    writer
        .write_all(&value.to_le_bytes())
        .map_err(|error| format!("写入备份失败：{error}"))
}

fn write_u32(writer: &mut File, value: u32) -> Result<(), String> {
    writer
        .write_all(&value.to_le_bytes())
        .map_err(|error| format!("写入备份失败：{error}"))
}

fn as_zip_u16(value: usize, label: &str) -> Result<u16, String> {
    u16::try_from(value).map_err(|_| format!("{label} 超出 ZIP 第一版支持范围"))
}

fn as_zip_u32(value: u64, label: &str) -> Result<u32, String> {
    u32::try_from(value).map_err(|_| format!("{label} 超出 ZIP 第一版支持范围"))
}

fn collect_backup_files(
    root_path: &Path,
    directory: &Path,
    files: &mut Vec<(String, PathBuf)>,
    exclude_private_data: bool,
    skipped_private_files: &mut u32,
) -> Result<(), String> {
    let backup_dir = root_path.join(".moknow").join("backups");
    if directory.starts_with(&backup_dir) {
        return Ok(());
    }

    for entry in fs::read_dir(directory).map_err(|error| format!("读取备份目录失败：{error}"))?
    {
        let entry = entry.map_err(|error| format!("读取备份目录项失败：{error}"))?;
        let path = entry.path();
        if path.starts_with(&backup_dir) {
            continue;
        }
        if path.is_dir() {
            collect_backup_files(
                root_path,
                &path,
                files,
                exclude_private_data,
                skipped_private_files,
            )?;
        } else if path.is_file() {
            let relative = path
                .strip_prefix(root_path)
                .map_err(|error| format!("计算备份相对路径失败：{error}"))?;
            let relative_path = normalize_path(relative);
            if exclude_private_data && is_private_backup_path(&relative_path) {
                *skipped_private_files += 1;
                continue;
            }
            files.push((relative_path, path));
        }
    }

    files.sort_by(|left, right| left.0.cmp(&right.0));
    Ok(())
}

fn is_private_backup_path(relative_path: &str) -> bool {
    let lower = relative_path.to_ascii_lowercase();
    let file_name = lower.rsplit('/').next().unwrap_or(&lower);
    if file_name == ".env" || file_name.starts_with(".env.") {
        return true;
    }
    if matches!(
        Path::new(file_name)
            .extension()
            .and_then(|extension| extension.to_str()),
        Some("key" | "pem" | "p12" | "pfx")
    ) {
        return true;
    }
    [
        "api-key",
        "apikey",
        "secret",
        "token",
        "credential",
        "credentials",
        "password",
    ]
    .iter()
    .any(|pattern| file_name.contains(pattern))
}

fn write_zip_store(output_path: &Path, files: &[(String, PathBuf)]) -> Result<(), String> {
    let mut writer =
        File::create(output_path).map_err(|error| format!("创建备份文件失败：{error}"))?;
    let mut entries = Vec::new();

    for (name, path) in files {
        let bytes = fs::read(path).map_err(|error| format!("读取备份文件失败：{error}"))?;
        let name_bytes = name.as_bytes();
        let name_length = as_zip_u16(name_bytes.len(), "备份文件名")?;
        let size = as_zip_u32(bytes.len() as u64, "备份文件大小")?;
        let offset = as_zip_u32(
            writer
                .stream_position()
                .map_err(|error| format!("读取备份写入位置失败：{error}"))?,
            "备份文件偏移",
        )?;
        let crc = crc32(&bytes);

        write_u32(&mut writer, 0x0403_4b50)?;
        write_u16(&mut writer, 20)?;
        write_u16(&mut writer, 0)?;
        write_u16(&mut writer, 0)?;
        write_u16(&mut writer, 0)?;
        write_u16(&mut writer, 33)?;
        write_u32(&mut writer, crc)?;
        write_u32(&mut writer, size)?;
        write_u32(&mut writer, size)?;
        write_u16(&mut writer, name_length)?;
        write_u16(&mut writer, 0)?;
        writer
            .write_all(name_bytes)
            .map_err(|error| format!("写入备份文件名失败：{error}"))?;
        writer
            .write_all(&bytes)
            .map_err(|error| format!("写入备份内容失败：{error}"))?;

        entries.push(ZipEntryMeta {
            name: name.clone(),
            crc32: crc,
            size,
            local_header_offset: offset,
        });
    }

    let central_directory_offset = as_zip_u32(
        writer
            .stream_position()
            .map_err(|error| format!("读取备份目录位置失败：{error}"))?,
        "备份中央目录偏移",
    )?;

    for entry in &entries {
        let name_bytes = entry.name.as_bytes();
        let name_length = as_zip_u16(name_bytes.len(), "备份文件名")?;
        write_u32(&mut writer, 0x0201_4b50)?;
        write_u16(&mut writer, 20)?;
        write_u16(&mut writer, 20)?;
        write_u16(&mut writer, 0)?;
        write_u16(&mut writer, 0)?;
        write_u16(&mut writer, 0)?;
        write_u16(&mut writer, 33)?;
        write_u32(&mut writer, entry.crc32)?;
        write_u32(&mut writer, entry.size)?;
        write_u32(&mut writer, entry.size)?;
        write_u16(&mut writer, name_length)?;
        write_u16(&mut writer, 0)?;
        write_u16(&mut writer, 0)?;
        write_u16(&mut writer, 0)?;
        write_u16(&mut writer, 0)?;
        write_u32(&mut writer, 0)?;
        write_u32(&mut writer, entry.local_header_offset)?;
        writer
            .write_all(name_bytes)
            .map_err(|error| format!("写入备份中央目录失败：{error}"))?;
    }

    let central_directory_end = as_zip_u32(
        writer
            .stream_position()
            .map_err(|error| format!("读取备份目录结束位置失败：{error}"))?,
        "备份中央目录结束位置",
    )?;
    let central_directory_size = central_directory_end - central_directory_offset;
    let entry_count = as_zip_u16(entries.len(), "备份文件数量")?;

    write_u32(&mut writer, 0x0605_4b50)?;
    write_u16(&mut writer, 0)?;
    write_u16(&mut writer, 0)?;
    write_u16(&mut writer, entry_count)?;
    write_u16(&mut writer, entry_count)?;
    write_u32(&mut writer, central_directory_size)?;
    write_u32(&mut writer, central_directory_offset)?;
    write_u16(&mut writer, 0)?;
    writer
        .flush()
        .map_err(|error| format!("刷新备份文件失败：{error}"))
}

fn validate_backup_entry_name(name: &str) -> Result<(), String> {
    if name.trim().is_empty() || name.starts_with('/') || name.contains('\\') {
        return Err(format!("备份文件包含不安全路径：{name}"));
    }
    for part in name.split('/') {
        if part.is_empty() || matches!(part, "." | "..") {
            return Err(format!("备份文件包含不安全路径：{name}"));
        }
    }
    Ok(())
}

fn read_zip_store(bytes: &[u8]) -> Result<Vec<ZipStoredFile>, String> {
    let mut offset = 0usize;
    let mut files = Vec::new();

    while offset + 4 <= bytes.len() {
        let signature = read_zip_u32(bytes, offset)?;
        if signature == 0x0201_4b50 || signature == 0x0605_4b50 {
            break;
        }
        if signature != 0x0403_4b50 {
            return Err("备份文件不是有效 ZIP 文件".into());
        }
        if offset + 30 > bytes.len() {
            return Err("备份文件结构不完整".into());
        }

        let flags = read_zip_u16(bytes, offset + 6)?;
        let method = read_zip_u16(bytes, offset + 8)?;
        let expected_crc = read_zip_u32(bytes, offset + 14)?;
        let compressed_size = read_zip_u32(bytes, offset + 18)? as usize;
        let uncompressed_size = read_zip_u32(bytes, offset + 22)? as usize;
        let name_length = read_zip_u16(bytes, offset + 26)? as usize;
        let extra_length = read_zip_u16(bytes, offset + 28)? as usize;
        if flags & 0x08 != 0 {
            return Err("暂不支持带数据描述符的备份 ZIP".into());
        }
        if method != 0 {
            return Err("暂不支持压缩格式的备份 ZIP，请使用 MoKnow 生成的备份文件".into());
        }
        if compressed_size != uncompressed_size {
            return Err("备份文件大小信息不一致".into());
        }

        let name_start = offset + 30;
        let name_end = name_start + name_length;
        let data_start = name_end + extra_length;
        let data_end = data_start + compressed_size;
        if data_end > bytes.len() {
            return Err("备份文件内容不完整".into());
        }

        let name = String::from_utf8(bytes[name_start..name_end].to_vec())
            .map_err(|_| "备份文件包含非 UTF-8 路径".to_string())?;
        validate_backup_entry_name(&name)?;
        let file_bytes = bytes[data_start..data_end].to_vec();
        if crc32(&file_bytes) != expected_crc {
            return Err(format!("备份文件校验失败：{name}"));
        }
        if !name.ends_with('/') {
            files.push(ZipStoredFile {
                name,
                bytes: file_bytes,
            });
        }

        offset = data_end;
    }

    if files.is_empty() {
        return Err("备份文件没有可恢复内容".into());
    }
    if !files.iter().any(|file| file.name == ".moknow/moknow.db") {
        return Err("备份文件不是有效 MoKnow 仓库备份".into());
    }

    Ok(files)
}

fn latest_backup_path(root_path: &Path) -> Result<PathBuf, String> {
    let backup_dir = root_path.join(".moknow").join("backups");
    if !backup_dir.exists() {
        return Err("当前仓库没有备份目录".into());
    }

    let mut latest: Option<(std::time::SystemTime, PathBuf)> = None;
    for entry in fs::read_dir(&backup_dir).map_err(|error| format!("读取备份目录失败：{error}"))?
    {
        let entry = entry.map_err(|error| format!("读取备份目录项失败：{error}"))?;
        let path = entry.path();
        if !path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("zip"))
        {
            continue;
        }
        let modified = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .map_err(|error| format!("读取备份文件信息失败：{error}"))?;
        if latest
            .as_ref()
            .is_none_or(|(current_modified, _)| modified > *current_modified)
        {
            latest = Some((modified, path));
        }
    }

    latest
        .map(|(_, path)| path)
        .ok_or_else(|| "当前仓库没有可恢复的 zip 备份".into())
}

fn selected_backup_path(root_path: &Path, backup_path: Option<String>) -> Result<PathBuf, String> {
    if let Some(path) = backup_path.filter(|path| !path.trim().is_empty()) {
        let path = PathBuf::from(path.trim());
        if !path.exists() {
            return Err("选择的备份文件不存在".into());
        }
        if !path.is_file() {
            return Err("选择的备份路径不是文件".into());
        }
        if !path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("zip"))
        {
            return Err("请选择 zip 备份文件".into());
        }
        Ok(path)
    } else {
        latest_backup_path(root_path)
    }
}

fn collect_current_restore_files(
    root_path: &Path,
    directory: &Path,
    files: &mut HashMap<String, Vec<u8>>,
) -> Result<(), String> {
    let backup_dir = root_path.join(".moknow").join("backups");
    if directory.starts_with(&backup_dir) {
        return Ok(());
    }

    for entry in fs::read_dir(directory).map_err(|error| format!("读取仓库目录失败：{error}"))?
    {
        let entry = entry.map_err(|error| format!("读取仓库目录项失败：{error}"))?;
        let path = entry.path();
        if path.starts_with(&backup_dir) {
            continue;
        }
        if path.is_dir() {
            collect_current_restore_files(root_path, &path, files)?;
        } else if path.is_file() {
            let relative = path
                .strip_prefix(root_path)
                .map_err(|error| format!("计算恢复相对路径失败：{error}"))?;
            let bytes = fs::read(&path).map_err(|error| format!("读取仓库文件失败：{error}"))?;
            files.insert(normalize_path(relative), bytes);
        }
    }

    Ok(())
}

fn sample_paths(paths: Vec<String>) -> Vec<String> {
    paths.into_iter().take(8).collect()
}

fn clear_repository_for_restore(root_path: &Path) -> Result<(), String> {
    for entry in fs::read_dir(root_path).map_err(|error| format!("读取仓库目录失败：{error}"))?
    {
        let entry = entry.map_err(|error| format!("读取仓库目录项失败：{error}"))?;
        let path = entry.path();
        if entry.file_name().to_string_lossy() == ".moknow" && path.is_dir() {
            for child in
                fs::read_dir(&path).map_err(|error| format!("读取仓库配置目录失败：{error}"))?
            {
                let child = child.map_err(|error| format!("读取仓库配置目录项失败：{error}"))?;
                if child.file_name().to_string_lossy() == "backups" {
                    continue;
                }
                remove_path(&child.path())?;
            }
        } else {
            remove_path(&path)?;
        }
    }

    Ok(())
}

fn restore_zip_entries(root_path: &Path, files: Vec<ZipStoredFile>) -> Result<u32, String> {
    clear_repository_for_restore(root_path)?;
    let mut restored_files = 0u32;

    for file in files {
        if file.name.starts_with(".moknow/backups/") {
            continue;
        }
        let target = relative_to_absolute(root_path, &file.name);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|error| format!("创建恢复目录失败：{error}"))?;
        }
        fs::write(&target, file.bytes).map_err(|error| format!("写入恢复文件失败：{error}"))?;
        restored_files += 1;
    }

    Ok(restored_files)
}

fn restore_zip_entries_merge_keep_current(
    root_path: &Path,
    files: Vec<ZipStoredFile>,
) -> Result<(u32, u32), String> {
    let mut restored_files = 0u32;
    let mut skipped_conflicting_files = 0u32;
    for file in files {
        if file.name.starts_with(".moknow/backups/") {
            continue;
        }
        let destination = root_path.join(&file.name);
        if destination.exists() {
            skipped_conflicting_files += 1;
            continue;
        }
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(|error| format!("创建恢复目录失败：{error}"))?;
        }
        fs::write(&destination, file.bytes)
            .map_err(|error| format!("恢复备份文件失败：{error}"))?;
        restored_files += 1;
    }

    Ok((restored_files, skipped_conflicting_files))
}

fn safe_attachment_name(name: &str) -> String {
    let trimmed = name.trim();
    let fallback = if trimmed.is_empty() {
        "image.png"
    } else {
        trimmed
    };
    let sanitized = fallback
        .chars()
        .map(|item| {
            if matches!(item, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
                || item.is_control()
                || item.is_whitespace()
            {
                '-'
            } else {
                item
            }
        })
        .collect::<String>();
    if Path::new(&sanitized).extension().is_some() {
        sanitized
    } else {
        format!("{sanitized}.png")
    }
}

#[derive(Default)]
struct FrontmatterMetadata {
    diary_date: Option<String>,
    mood: Option<String>,
    tags: Vec<String>,
    weather: Option<String>,
    location: Option<String>,
    energy: Option<String>,
    favorite: Option<bool>,
}

fn unquote_frontmatter_value(value: &str) -> String {
    let trimmed = value.trim();
    if (trimmed.starts_with('"') && trimmed.ends_with('"'))
        || (trimmed.starts_with('\'') && trimmed.ends_with('\''))
    {
        trimmed[1..trimmed.len().saturating_sub(1)].to_string()
    } else {
        trimmed.to_string()
    }
}

fn parse_frontmatter_tags(value: &str) -> Vec<String> {
    let trimmed = value.trim();
    if trimmed.starts_with('[') && trimmed.ends_with(']') {
        return trimmed[1..trimmed.len().saturating_sub(1)]
            .split(',')
            .map(unquote_frontmatter_value)
            .filter(|item| !item.is_empty())
            .collect();
    }

    let single = unquote_frontmatter_value(trimmed);
    if single.is_empty() {
        Vec::new()
    } else {
        vec![single]
    }
}

fn parse_frontmatter_metadata(markdown: &str) -> FrontmatterMetadata {
    let normalized = markdown.trim_start_matches('\u{feff}');
    let mut lines = normalized.lines();
    if lines.next().map(str::trim) != Some("---") {
        return FrontmatterMetadata::default();
    }

    let mut values = HashMap::new();
    for line in lines {
        if line.trim() == "---" {
            break;
        }
        if line.trim().is_empty() || line.trim_start().starts_with('#') {
            continue;
        }
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        values.insert(key.trim().to_string(), value.trim().to_string());
    }

    FrontmatterMetadata {
        diary_date: values
            .get("date")
            .map(|value| unquote_frontmatter_value(value)),
        mood: values
            .get("mood")
            .map(|value| unquote_frontmatter_value(value)),
        tags: values
            .get("tags")
            .map(|value| parse_frontmatter_tags(value))
            .unwrap_or_default(),
        weather: values
            .get("weather")
            .map(|value| unquote_frontmatter_value(value)),
        location: values
            .get("location")
            .map(|value| unquote_frontmatter_value(value)),
        energy: values
            .get("energy")
            .map(|value| unquote_frontmatter_value(value)),
        favorite: values
            .get("favorite")
            .map(|value| matches!(value.trim(), "true" | "1")),
    }
}

fn markdown_body(markdown: &str) -> String {
    let normalized = markdown.trim_start_matches('\u{feff}');
    let mut lines = normalized.lines();
    if lines.next().map(str::trim) != Some("---") {
        return markdown.to_string();
    }

    let mut found_end = false;
    let mut body = Vec::new();
    for line in lines {
        if !found_end {
            if line.trim() == "---" {
                found_end = true;
            }
            continue;
        }
        body.push(line);
    }

    if found_end {
        body.join("\n")
    } else {
        markdown.to_string()
    }
}

fn normalize_text_for_search(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn escape_html(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn highlighted_snippet(snippet: &str, query: &str) -> String {
    if query.trim().is_empty() {
        return escape_html(snippet);
    }

    let mut cursor = 0;
    let mut output = String::new();
    for (start, matched) in snippet.match_indices(query) {
        let end = start + query.len();
        output.push_str(&escape_html(&snippet[cursor..start]));
        output.push_str("<mark>");
        output.push_str(&escape_html(matched));
        output.push_str("</mark>");
        cursor = end;
    }
    output.push_str(&escape_html(&snippet[cursor..]));
    output
}

fn build_search_snippet(markdown: &str, query: &str) -> (String, String) {
    let body = normalize_text_for_search(&markdown_body(markdown));
    if body.is_empty() {
        return (String::new(), String::new());
    }

    let lower_body = body.to_lowercase();
    let lower_query = query.to_lowercase();
    let start = if !query.trim().is_empty() {
        lower_body
            .find(&lower_query)
            .map(|index| index.saturating_sub(36))
            .unwrap_or(0)
    } else {
        0
    };
    let snippet = body.chars().skip(start).take(120).collect::<String>();
    let highlighted = highlighted_snippet(&snippet, query);
    (snippet, highlighted)
}

fn markdown_title(markdown: &str, fallback: &str) -> String {
    markdown_body(markdown)
        .lines()
        .find_map(|line| {
            let trimmed = line.trim();
            trimmed
                .strip_prefix("# ")
                .map(str::trim)
                .filter(|title| !title.is_empty())
                .map(str::to_string)
        })
        .unwrap_or_else(|| fallback.to_string())
}

fn inbox_relative_path() -> &'static str {
    "Inbox/inbox.md"
}

fn inbox_file_path(root_path: &Path) -> PathBuf {
    relative_to_absolute(root_path, inbox_relative_path())
}

fn ensure_inbox_file(root_path: &Path) -> Result<PathBuf, String> {
    let path = inbox_file_path(root_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建收件箱目录失败：{error}"))?;
    }
    if !path.exists() {
        fs::write(&path, "# Inbox\n\n").map_err(|error| format!("创建收件箱失败：{error}"))?;
    }
    Ok(path)
}

fn render_inbox_entry(item: &InboxItemPayload) -> String {
    format!(
        "<!-- inbox:{} -->\n时间：{}\n\n{}\n<!-- /inbox -->\n",
        item.id,
        item.created_at,
        item.content.trim()
    )
}

fn parse_inbox_entries(markdown: &str) -> Vec<InboxItemPayload> {
    let mut items = Vec::new();
    let mut current_id: Option<String> = None;
    let mut current_created_at: Option<String> = None;
    let mut body_lines: Vec<String> = Vec::new();

    for line in markdown.lines() {
        let trimmed = line.trim();
        if let Some(id) = trimmed
            .strip_prefix("<!-- inbox:")
            .and_then(|value| value.strip_suffix(" -->"))
        {
            current_id = Some(id.trim().to_string());
            current_created_at = None;
            body_lines.clear();
            continue;
        }

        if trimmed == "<!-- /inbox -->" {
            if let (Some(id), Some(created_at)) = (current_id.take(), current_created_at.take()) {
                let content = body_lines.join("\n").trim().to_string();
                if !content.is_empty() {
                    items.push(InboxItemPayload {
                        id,
                        created_at,
                        content,
                    });
                }
            }
            body_lines.clear();
            continue;
        }

        if current_id.is_some() {
            if current_created_at.is_none() {
                if let Some(created_at) = line.strip_prefix("时间：") {
                    current_created_at = Some(created_at.trim().to_string());
                }
                continue;
            }
            body_lines.push(line.to_string());
        }
    }

    items
}

fn render_inbox_file(items: &[InboxItemPayload]) -> String {
    let mut output = "# Inbox\n\n".to_string();
    for item in items {
        output.push_str(&render_inbox_entry(item));
        output.push('\n');
    }
    output
}

fn read_inbox_entries(root_path: &Path) -> Result<Vec<InboxItemPayload>, String> {
    let path = ensure_inbox_file(root_path)?;
    let raw = fs::read_to_string(&path).map_err(|error| format!("读取收件箱失败：{error}"))?;
    Ok(parse_inbox_entries(&raw))
}

fn write_inbox_entries(root_path: &Path, items: &[InboxItemPayload]) -> Result<(), String> {
    let path = ensure_inbox_file(root_path)?;
    let raw = render_inbox_file(items);
    fs::write(&path, &raw).map_err(|error| format!("写入收件箱失败：{error}"))?;
    touch_file_metadata_for_path(&path, false, true)?;
    sync_frontmatter_metadata_for_path(&path, &raw)?;
    Ok(())
}

fn format_inbox_items_for_diary(items: &[InboxItemPayload]) -> String {
    let mut output = format!("\n\n## 收件箱整理 {}\n\n", Local::now().format("%H:%M"));
    for item in items {
        let content = item
            .content
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .collect::<Vec<_>>()
            .join("\n  ");
        output.push_str(&format!("- {}：{}\n", item.created_at, content));
    }
    output
}

fn recent_file_payload_for_relative(
    conn: &Connection,
    root_path: &Path,
    relative_path: &str,
) -> Result<Option<RecentFilePayload>, String> {
    let file_path = relative_to_absolute(root_path, relative_path);
    if !file_path.exists() {
        return Ok(None);
    }

    let metadata = conn
        .query_row(
            "SELECT last_opened_at, last_edited_at, is_pinned
             FROM file_metadata
             WHERE repository_id = ?1 AND relative_path = ?2",
            params![normalize_path(root_path), relative_path],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, i64>(2)? != 0,
                ))
            },
        )
        .ok();
    let (last_opened_at, last_edited_at, is_pinned) = metadata.unwrap_or((None, None, false));

    Ok(Some(RecentFilePayload {
        file_id: normalize_path(&file_path),
        name: file_path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| relative_path.to_string()),
        relative_path: relative_path.to_string(),
        last_opened_at,
        last_edited_at,
        is_pinned,
    }))
}

fn fts_query(query: &str) -> String {
    query
        .split_whitespace()
        .map(|token| format!("\"{}\"", token.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" ")
}

fn validate_tag_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("标签名不能为空".into());
    }
    if trimmed.contains([',', '[', ']', '\n', '\r']) {
        return Err("标签名不能包含逗号、方括号或换行".into());
    }
    Ok(trimmed.to_string())
}

fn validate_tag_color(color: &str) -> Result<String, String> {
    let trimmed = color.trim();
    let valid = trimmed.len() == 7
        && trimmed.starts_with('#')
        && trimmed.chars().skip(1).all(|item| item.is_ascii_hexdigit());
    if valid {
        Ok(trimmed.to_string())
    } else {
        Err("标签颜色必须是 #RRGGBB 格式".into())
    }
}

fn default_tag_color(name: &str) -> String {
    const COLORS: [&str; 6] = [
        "#4f8ef7", "#56d98e", "#f5c842", "#a78bfa", "#f06b6b", "#36cfc9",
    ];
    let index = name.bytes().fold(0_usize, |sum, item| sum + item as usize) % COLORS.len();
    COLORS[index].into()
}

fn stringify_frontmatter_tags(tags: &[String]) -> String {
    tags.iter()
        .map(|tag| {
            if tag
                .chars()
                .all(|item| item.is_alphanumeric() || matches!(item, '-' | '_' | '/'))
            {
                tag.clone()
            } else {
                format!("\"{}\"", tag.replace('"', "\\\""))
            }
        })
        .collect::<Vec<_>>()
        .join(", ")
}

fn update_frontmatter_tags(markdown: &str, tags: &[String]) -> String {
    let mut lines = markdown.lines().map(str::to_string).collect::<Vec<_>>();
    if lines.first().map(|line| line.trim()) != Some("---") {
        return markdown.to_string();
    }

    let Some(end_index) = lines.iter().enumerate().skip(1).find_map(|(index, line)| {
        if line.trim() == "---" {
            Some(index)
        } else {
            None
        }
    }) else {
        return markdown.to_string();
    };

    let mut tag_line_index = None;
    for (index, line) in lines.iter().enumerate().take(end_index).skip(1) {
        if line.trim_start().starts_with("tags:") {
            tag_line_index = Some(index);
            break;
        }
    }

    if tags.is_empty() {
        if let Some(index) = tag_line_index {
            lines.remove(index);
        }
    } else {
        let next_line = format!("tags: [{}]", stringify_frontmatter_tags(tags));
        if let Some(index) = tag_line_index {
            lines[index] = next_line;
        } else {
            lines.insert(end_index, next_line);
        }
    }

    let mut output = lines.join("\n");
    if markdown.ends_with('\n') {
        output.push('\n');
    }
    output
}

fn scan_markdown_files(
    root_path: &Path,
    directory: &Path,
    files: &mut Vec<PathBuf>,
) -> Result<(), String> {
    if !directory.exists() {
        return Ok(());
    }

    for entry in fs::read_dir(directory).map_err(|error| format!("读取搜索目录失败：{error}"))?
    {
        let entry = entry.map_err(|error| format!("读取搜索目录项失败：{error}"))?;
        let path = entry.path();
        if path.starts_with(root_path.join(".moknow")) || path.starts_with(root_path.join("回收站"))
        {
            continue;
        }
        if path.is_dir() {
            scan_markdown_files(root_path, &path, files)?;
        } else if path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("md"))
        {
            files.push(path);
        }
    }

    Ok(())
}

fn repository_markdown_files(root_path: &Path) -> Result<Vec<PathBuf>, String> {
    let mut files = Vec::new();
    let diary_root = current_diary_root();
    scan_markdown_files(root_path, &root_path.join(diary_root), &mut files)?;
    scan_markdown_files(root_path, &root_path.join("文档"), &mut files)?;
    files.sort();
    Ok(files)
}

fn unique_attachment_path(directory: &Path, file_name: &str) -> PathBuf {
    let candidate = directory.join(file_name);
    if !candidate.exists() {
        return candidate;
    }

    let path = Path::new(file_name);
    let stem = path
        .file_stem()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "image".into());
    let extension = path
        .extension()
        .map(|ext| ext.to_string_lossy().to_string())
        .unwrap_or_else(|| "png".into());
    let mut index = 2;
    loop {
        let next = directory.join(format!("{stem}-{index}.{extension}"));
        if !next.exists() {
            return next;
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

fn weekday_name(date: NaiveDate) -> &'static str {
    match date.weekday().number_from_monday() {
        1 => "星期一",
        2 => "星期二",
        3 => "星期三",
        4 => "星期四",
        5 => "星期五",
        6 => "星期六",
        _ => "星期日",
    }
}

fn replace_date_tokens(pattern: &str, date: NaiveDate, settings: &DiarySettingsPayload) -> String {
    let year = date.format("%Y").to_string();
    let month = date.format("%m").to_string();
    let day = date.format("%d").to_string();
    let date_text = date.format("%Y-%m-%d").to_string();
    let root = settings.diary_root.trim_matches('/').trim_matches('\\');

    pattern
        .replace("{diaryRoot}", root)
        .replace("{YYYY-MM-DD}", &date_text)
        .replace("{YYYY}", &year)
        .replace("{MM}", &month)
        .replace("{DD}", &day)
        .replace("{{date}}", &date_text)
        .replace("{{weekday}}", weekday_name(date))
        .replace("{{year}}", &year)
        .replace("{{month}}", &month)
        .replace("{{day}}", &day)
}

pub fn render_diary_template(template: &str, date: NaiveDate) -> String {
    let settings = DiarySettingsPayload::default();
    let time_text = Local::now().format("%H:%M").to_string();
    replace_date_tokens(template, date, &settings).replace("{{time}}", &time_text)
}

fn today_diary_relative_path(
    settings: &DiarySettingsPayload,
    date: NaiveDate,
) -> Result<String, String> {
    let path_pattern = if settings.diary_path_pattern.trim().is_empty() {
        DiarySettingsPayload::default().diary_path_pattern
    } else {
        settings.diary_path_pattern.clone()
    };
    let file_pattern = if settings.diary_file_name_pattern.trim().is_empty() {
        DiarySettingsPayload::default().diary_file_name_pattern
    } else {
        settings.diary_file_name_pattern.clone()
    };
    let dir = replace_date_tokens(&path_pattern, date, settings);
    let file = replace_date_tokens(&file_pattern, date, settings);
    let relative_path = format!("{dir}/{file}")
        .replace('\\', "/")
        .trim_matches('/')
        .to_string();

    if relative_path
        .split('/')
        .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err("日记路径规则包含无效路径片段".into());
    }

    Ok(relative_path)
}

fn parse_diary_date(date: &str) -> Result<NaiveDate, String> {
    NaiveDate::parse_from_str(date, "%Y-%m-%d").map_err(|_| "日期格式应为 YYYY-MM-DD".to_string())
}

fn days_in_month(year: i32, month: u32) -> Result<u32, String> {
    let first_day =
        NaiveDate::from_ymd_opt(year, month, 1).ok_or_else(|| "年月不合法".to_string())?;
    let next_month = if month == 12 {
        NaiveDate::from_ymd_opt(year + 1, 1, 1)
    } else {
        NaiveDate::from_ymd_opt(year, month + 1, 1)
    }
    .ok_or_else(|| "年月不合法".to_string())?;

    Ok((next_month - first_day).num_days() as u32)
}

fn validate_diary_settings(settings: &DiarySettingsPayload) -> Result<(), String> {
    if settings.diary_root.trim().is_empty() {
        return Err("日记根目录不能为空".into());
    }
    if settings.diary_path_pattern.trim().is_empty() {
        return Err("日记路径规则不能为空".into());
    }
    if settings.diary_file_name_pattern.trim().is_empty() {
        return Err("日记文件名规则不能为空".into());
    }
    if settings.diary_template.trim().is_empty() {
        return Err("日记模板不能为空".into());
    }
    if settings
        .diary_root
        .split(['/', '\\'])
        .any(|part| part == "." || part == "..")
    {
        return Err("日记根目录不能包含相对跳转路径".into());
    }

    today_diary_relative_path(settings, Local::now().date_naive()).map(|_| ())
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
        is_pinned: None,
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
    let conn =
        Connection::open(db_path).map_err(|error| format!("打开 SQLite 数据库失败：{error}"))?;
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
        CREATE TABLE IF NOT EXISTS tags (
          id TEXT PRIMARY KEY,
          repository_id TEXT NOT NULL,
          name TEXT NOT NULL,
          color TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(repository_id, name)
        );
        CREATE TABLE IF NOT EXISTS file_tags (
          repository_id TEXT NOT NULL,
          relative_path TEXT NOT NULL,
          tag_name TEXT NOT NULL,
          PRIMARY KEY (repository_id, relative_path, tag_name)
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS file_fts USING fts5(
          repository_id UNINDEXED,
          relative_path UNINDEXED,
          file_id UNINDEXED,
          title,
          content,
          tags,
          diary_date UNINDEXED,
          category UNINDEXED
        );
        ",
    )
    .map_err(|error| format!("初始化 SQLite 表结构失败：{error}"))?;
    ensure_file_metadata_columns(&conn)?;
    Ok(conn)
}

fn ensure_file_metadata_columns(conn: &Connection) -> Result<(), String> {
    let mut statement = conn
        .prepare("PRAGMA table_info(file_metadata)")
        .map_err(|error| format!("读取文件元数据结构失败：{error}"))?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("读取文件元数据结构失败：{error}"))?
        .filter_map(|row| row.ok())
        .collect::<Vec<_>>();

    let has_column = |name: &str| columns.iter().any(|column| column == name);
    if !has_column("is_pinned") {
        conn.execute(
            "ALTER TABLE file_metadata ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0",
            [],
        )
        .map_err(|error| format!("迁移置顶字段失败：{error}"))?;
    }
    if !has_column("last_opened_at") {
        conn.execute(
            "ALTER TABLE file_metadata ADD COLUMN last_opened_at TEXT",
            [],
        )
        .map_err(|error| format!("迁移最近打开字段失败：{error}"))?;
    }
    if !has_column("last_edited_at") {
        conn.execute(
            "ALTER TABLE file_metadata ADD COLUMN last_edited_at TEXT",
            [],
        )
        .map_err(|error| format!("迁移最近编辑字段失败：{error}"))?;
    }
    if !has_column("diary_date") {
        conn.execute("ALTER TABLE file_metadata ADD COLUMN diary_date TEXT", [])
            .map_err(|error| format!("迁移日记日期字段失败：{error}"))?;
    }
    if !has_column("mood") {
        conn.execute("ALTER TABLE file_metadata ADD COLUMN mood TEXT", [])
            .map_err(|error| format!("迁移情绪字段失败：{error}"))?;
    }
    if !has_column("tags") {
        conn.execute("ALTER TABLE file_metadata ADD COLUMN tags TEXT", [])
            .map_err(|error| format!("迁移标签字段失败：{error}"))?;
    }
    if !has_column("weather") {
        conn.execute("ALTER TABLE file_metadata ADD COLUMN weather TEXT", [])
            .map_err(|error| format!("迁移天气字段失败：{error}"))?;
    }
    if !has_column("location") {
        conn.execute("ALTER TABLE file_metadata ADD COLUMN location TEXT", [])
            .map_err(|error| format!("迁移地点字段失败：{error}"))?;
    }
    if !has_column("energy") {
        conn.execute("ALTER TABLE file_metadata ADD COLUMN energy TEXT", [])
            .map_err(|error| format!("迁移精力字段失败：{error}"))?;
    }
    if !has_column("favorite") {
        conn.execute("ALTER TABLE file_metadata ADD COLUMN favorite INTEGER", [])
            .map_err(|error| format!("迁移元数据收藏字段失败：{error}"))?;
    }

    Ok(())
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

fn current_diary_root() -> String {
    let settings = read_app_config().diary_settings;
    if settings.diary_root.trim().is_empty() {
        DiarySettingsPayload::default().diary_root
    } else {
        settings.diary_root
    }
}

fn category_for_relative_path(relative_path: &str) -> String {
    let diary_root = current_diary_root();
    if relative_path == diary_root || relative_path.starts_with(&format!("{diary_root}/")) {
        "journal".into()
    } else if relative_path == "回收站" || relative_path.starts_with("回收站/") {
        "trash".into()
    } else {
        "documents".into()
    }
}

fn touch_file_metadata(
    conn: &Connection,
    root_path: &Path,
    relative_path: &str,
    kind: &str,
    opened: bool,
    edited: bool,
) -> Result<(), String> {
    let now = now_iso();
    let repository_id = normalize_path(root_path);
    let category = category_for_relative_path(relative_path);
    let last_opened_at = opened.then_some(now.as_str());
    let last_edited_at = edited.then_some(now.as_str());

    conn.execute(
        "INSERT INTO file_metadata (
            id, repository_id, relative_path, kind, category, created_at, updated_at,
            is_pinned, last_opened_at, last_edited_at
         )
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, 0, ?7, ?8)
         ON CONFLICT(repository_id, relative_path) DO UPDATE SET
            kind = excluded.kind,
            category = excluded.category,
            updated_at = excluded.updated_at,
            last_opened_at = COALESCE(excluded.last_opened_at, file_metadata.last_opened_at),
            last_edited_at = COALESCE(excluded.last_edited_at, file_metadata.last_edited_at)",
        params![
            format!("{repository_id}:{relative_path}"),
            repository_id,
            relative_path,
            kind,
            category,
            now,
            last_opened_at,
            last_edited_at,
        ],
    )
    .map_err(|error| format!("写入文件元数据失败：{error}"))?;
    Ok(())
}

fn touch_file_metadata_for_path(
    file_path: &Path,
    opened: bool,
    edited: bool,
) -> Result<(), String> {
    let Some(root_path) = repository_root_for_path(file_path) else {
        return Ok(());
    };
    let relative_path = normalize_path(
        file_path
            .strip_prefix(&root_path)
            .map_err(|error| format!("计算文件相对路径失败：{error}"))?,
    );
    let conn = open_database(&root_path)?;
    touch_file_metadata(
        &conn,
        &root_path,
        &relative_path,
        "markdown",
        opened,
        edited,
    )
}

fn sync_tag_tables(
    conn: &Connection,
    root_path: &Path,
    relative_path: &str,
    tags: &[String],
) -> Result<(), String> {
    let repository_id = normalize_path(root_path);
    let now = now_iso();
    conn.execute(
        "DELETE FROM file_tags WHERE repository_id = ?1 AND relative_path = ?2",
        params![repository_id, relative_path],
    )
    .map_err(|error| format!("清理文件标签关联失败：{error}"))?;

    for tag in tags {
        let tag_name = validate_tag_name(tag)?;
        conn.execute(
            "INSERT INTO tags (id, repository_id, name, color, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)
             ON CONFLICT(repository_id, name) DO UPDATE SET updated_at = excluded.updated_at",
            params![
                format!("{}:{}", repository_id, tag_name),
                repository_id,
                tag_name,
                default_tag_color(tag),
                now,
            ],
        )
        .map_err(|error| format!("写入标签失败：{error}"))?;
        conn.execute(
            "INSERT OR IGNORE INTO file_tags (repository_id, relative_path, tag_name)
             VALUES (?1, ?2, ?3)",
            params![normalize_path(root_path), relative_path, tag],
        )
        .map_err(|error| format!("写入文件标签关联失败：{error}"))?;
    }

    Ok(())
}

fn sync_search_index(
    conn: &Connection,
    root_path: &Path,
    relative_path: &str,
    file_path: &Path,
    content: &str,
    metadata: &FrontmatterMetadata,
) -> Result<(), String> {
    let repository_id = normalize_path(root_path);
    let file_id = normalize_path(file_path);
    let fallback_title = file_path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| relative_path.to_string());
    let heading_title = markdown_title(content, &fallback_title);
    let title = if heading_title == fallback_title {
        heading_title
    } else {
        format!("{fallback_title} {heading_title}")
    };
    let body = markdown_body(content);
    let tags = metadata.tags.join(" ");
    let category = category_for_relative_path(relative_path);

    conn.execute(
        "DELETE FROM file_fts WHERE repository_id = ?1 AND relative_path = ?2",
        params![repository_id, relative_path],
    )
    .map_err(|error| format!("清理全文索引失败：{error}"))?;
    conn.execute(
        "INSERT INTO file_fts (repository_id, relative_path, file_id, title, content, tags, diary_date, category)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            normalize_path(root_path),
            relative_path,
            file_id,
            title,
            body,
            tags,
            metadata.diary_date.as_deref(),
            category,
        ],
    )
    .map_err(|error| format!("写入全文索引失败：{error}"))?;

    Ok(())
}

fn sync_frontmatter_metadata_for_path(file_path: &Path, content: &str) -> Result<(), String> {
    let Some(root_path) = repository_root_for_path(file_path) else {
        return Ok(());
    };
    let relative_path = normalize_path(
        file_path
            .strip_prefix(&root_path)
            .map_err(|error| format!("计算文件相对路径失败：{error}"))?,
    );
    let metadata = parse_frontmatter_metadata(content);
    let tag_names = metadata.tags.clone();
    let tags = if metadata.tags.is_empty() {
        None
    } else {
        Some(
            serde_json::to_string(&metadata.tags)
                .map_err(|error| format!("序列化 frontmatter 标签失败：{error}"))?,
        )
    };
    let favorite = metadata
        .favorite
        .map(|value| if value { 1_i64 } else { 0_i64 });
    let now = now_iso();
    let conn = open_database(&root_path)?;

    touch_file_metadata(&conn, &root_path, &relative_path, "markdown", false, false)?;
    conn.execute(
        "UPDATE file_metadata
         SET diary_date = ?1,
             mood = ?2,
             tags = ?3,
             weather = ?4,
             location = ?5,
             energy = ?6,
             favorite = ?7,
             updated_at = ?8
         WHERE repository_id = ?9 AND relative_path = ?10",
        params![
            metadata.diary_date.as_deref(),
            metadata.mood.as_deref(),
            tags,
            metadata.weather.as_deref(),
            metadata.location.as_deref(),
            metadata.energy.as_deref(),
            favorite,
            now,
            normalize_path(&root_path),
            relative_path,
        ],
    )
    .map_err(|error| format!("同步 frontmatter 元数据失败：{error}"))?;
    sync_tag_tables(&conn, &root_path, &relative_path, &tag_names)?;
    sync_search_index(
        &conn,
        &root_path,
        &relative_path,
        file_path,
        content,
        &metadata,
    )?;
    Ok(())
}

fn sync_repository_indexes(root_path: &Path) -> Result<(), String> {
    let conn = open_database(root_path)?;
    let repository_id = normalize_path(root_path);
    conn.execute(
        "DELETE FROM file_fts WHERE repository_id = ?1",
        params![repository_id],
    )
    .map_err(|error| format!("清理全文索引失败：{error}"))?;
    conn.execute(
        "DELETE FROM file_tags WHERE repository_id = ?1",
        params![normalize_path(root_path)],
    )
    .map_err(|error| format!("清理文件标签索引失败：{error}"))?;

    for file_path in repository_markdown_files(root_path)? {
        let content =
            fs::read_to_string(&file_path).map_err(|error| format!("读取索引文件失败：{error}"))?;
        sync_frontmatter_metadata_for_path(&file_path, &content)?;
    }

    Ok(())
}

fn is_file_pinned(
    conn: &Connection,
    root_path: &Path,
    relative_path: &str,
) -> Result<bool, String> {
    let mut statement = conn
        .prepare(
            "SELECT is_pinned FROM file_metadata WHERE repository_id = ?1 AND relative_path = ?2",
        )
        .map_err(|error| format!("读取置顶状态失败：{error}"))?;
    let mut rows = statement
        .query(params![normalize_path(root_path), relative_path])
        .map_err(|error| format!("读取置顶状态失败：{error}"))?;
    if let Some(row) = rows
        .next()
        .map_err(|error| format!("读取置顶状态失败：{error}"))?
    {
        let value: i64 = row
            .get(0)
            .map_err(|error| format!("读取置顶状态失败：{error}"))?;
        Ok(value != 0)
    } else {
        Ok(false)
    }
}

fn is_file_favorite(
    conn: &Connection,
    root_path: &Path,
    relative_path: &str,
) -> Result<bool, String> {
    let mut statement = conn
        .prepare("SELECT 1 FROM favorites WHERE repository_id = ?1 AND relative_path = ?2 LIMIT 1")
        .map_err(|error| format!("读取收藏状态失败：{error}"))?;
    let mut rows = statement
        .query(params![normalize_path(root_path), relative_path])
        .map_err(|error| format!("读取收藏状态失败：{error}"))?;
    Ok(rows
        .next()
        .map_err(|error| format!("读取收藏状态失败：{error}"))?
        .is_some())
}

fn markdown_file(
    conn: &Connection,
    path: &Path,
    root_path: &Path,
    depth: u8,
) -> Result<FileNode, String> {
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

    let is_pinned = is_file_pinned(conn, root_path, &relative_path)?;
    let is_favorite = is_file_favorite(conn, root_path, &relative_path)?;

    Ok(FileNode {
        id: file_id.clone(),
        name,
        path: relative_path.clone(),
        node_type: "markdown".into(),
        depth,
        children: Vec::new(),
        content_key: Some(file_id),
        category: None,
        is_favorite: Some(is_favorite),
        is_pinned: Some(is_pinned),
        is_virtual: None,
        deleted_at: None,
    })
}

fn directory_node(
    conn: &Connection,
    path: &Path,
    root_path: &Path,
    depth: u8,
) -> Result<FileNode, String> {
    let relative = path
        .strip_prefix(root_path)
        .map_err(|error| format!("计算相对路径失败：{error}"))?;
    let relative_path = normalize_path(relative);
    let name = path
        .file_name()
        .ok_or_else(|| "目录名为空".to_string())?
        .to_string_lossy()
        .to_string();
    let mut children = read_directory_nodes(conn, path, root_path, depth + 1)?;
    let is_pinned = is_file_pinned(conn, root_path, &relative_path)?;
    let is_favorite = is_file_favorite(conn, root_path, &relative_path)?;

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
        is_favorite: Some(is_favorite),
        is_pinned: Some(is_pinned),
        is_virtual: None,
        deleted_at: None,
    })
}

fn read_directory_nodes(
    conn: &Connection,
    path: &Path,
    root_path: &Path,
    depth: u8,
) -> Result<Vec<FileNode>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }

    let mut nodes = Vec::new();
    for entry in fs::read_dir(path).map_err(|error| format!("读取目录失败：{error}"))? {
        let entry = entry.map_err(|error| format!("读取目录项失败：{error}"))?;
        let path = entry.path();
        if path.is_dir() {
            nodes.push(directory_node(conn, &path, root_path, depth)?);
        } else if path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("md"))
        {
            nodes.push(markdown_file(conn, &path, root_path, depth)?);
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
            is_pinned: None,
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
            is_pinned: None,
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

    pub fn get_diary_settings() -> DiarySettingsPayload {
        read_app_config().diary_settings
    }

    pub fn save_diary_settings(
        settings: DiarySettingsPayload,
    ) -> Result<DiarySettingsPayload, String> {
        validate_diary_settings(&settings)?;
        let mut config = read_app_config();
        config.diary_settings = settings.clone();
        write_app_config(&config)?;
        Ok(settings)
    }

    pub fn get_workspace_state(repository_id: String) -> WorkspaceStatePayload {
        let config = read_app_config();
        let state = config
            .workspace_states
            .get(&repository_id)
            .cloned()
            .unwrap_or_default();

        WorkspaceStatePayload::from_config(repository_id, config.diary_settings, state)
    }

    pub fn save_workspace_state(
        repository_id: String,
        file_id: Option<String>,
        edit_mode: String,
        cursor_position: Option<CursorPositionPayload>,
    ) -> Result<WorkspaceStatePayload, String> {
        if !matches!(edit_mode.as_str(), "source" | "split" | "wysiwyg") {
            return Err("未知编辑模式".into());
        }
        if let Some(cursor) = &cursor_position {
            if cursor.line == 0 || cursor.column == 0 {
                return Err("光标位置必须从第 1 行第 1 列开始".into());
            }
        }

        let mut config = read_app_config();
        let state = WorkspaceStateRecord {
            last_opened_file: file_id,
            last_edit_mode: Some(edit_mode),
            last_cursor_position: cursor_position,
        };
        config
            .workspace_states
            .insert(repository_id.clone(), state.clone());
        write_app_config(&config)?;

        Ok(WorkspaceStatePayload::from_config(
            repository_id,
            config.diary_settings,
            state,
        ))
    }

    pub fn load_repository(root_path: &Path) -> Result<RepositoryPayload, String> {
        let conn = open_database(root_path)?;
        let name = repository_name_from_path(root_path);
        let mut files = build_default_categories();
        let settings = read_app_config().diary_settings;
        let diary_root = if settings.diary_root.trim().is_empty() {
            DiarySettingsPayload::default().diary_root
        } else {
            settings.diary_root
        };
        files[0].children = read_favorites(&conn, root_path)?;
        files[1].children = read_directory_nodes(&conn, &root_path.join(diary_root), root_path, 1)?;
        files[2].children = read_directory_nodes(&conn, &root_path.join("文档"), root_path, 1)?;
        files[3].children = read_trash_nodes(&conn, root_path)?;

        Ok(RepositoryPayload {
            id: normalize_path(root_path),
            name,
            root_path: normalize_path(root_path),
            files,
            is_mock: Some(false),
        })
    }

    pub fn list_diary_month_status(
        repository_id: String,
        year: i32,
        month: u32,
    ) -> Result<Vec<DiaryDateStatusPayload>, String> {
        let root_path = path_from_repository(&repository_id);
        if !root_path.join(".moknow").join("moknow.db").exists() {
            return Err("请先新建或打开一个真实仓库".into());
        }

        let settings = read_app_config().diary_settings;
        let days = days_in_month(year, month)?;
        let mut statuses = Vec::with_capacity(days as usize);

        for day in 1..=days {
            let date = NaiveDate::from_ymd_opt(year, month, day)
                .ok_or_else(|| "日期不合法".to_string())?;
            let relative_path = today_diary_relative_path(&settings, date)?;
            let file_path = relative_to_absolute(&root_path, &relative_path);
            statuses.push(DiaryDateStatusPayload {
                date: date.format("%Y-%m-%d").to_string(),
                exists: file_path.exists(),
                path: relative_path,
            });
        }

        Ok(statuses)
    }

    pub fn open_journal_by_date(
        repository_id: String,
        date: String,
    ) -> Result<MarkdownFilePayload, String> {
        let root_path = path_from_repository(&repository_id);
        if !root_path.join(".moknow").join("moknow.db").exists() {
            return Err("请先新建或打开一个真实仓库".into());
        }

        let settings = read_app_config().diary_settings;
        let diary_date = parse_diary_date(&date)?;
        let relative_path = today_diary_relative_path(&settings, diary_date)?;
        let file_path = relative_to_absolute(&root_path, &relative_path);

        if file_path.exists() {
            return Self::read_markdown_file(normalize_path(&file_path));
        }

        if let Some(parent) = file_path.parent() {
            fs::create_dir_all(parent).map_err(|error| format!("创建日记目录失败：{error}"))?;
        }

        let template = if settings.diary_template.trim().is_empty() {
            DiarySettingsPayload::default().diary_template
        } else {
            settings.diary_template
        };
        let raw = render_diary_template(&template, diary_date);
        fs::write(&file_path, &raw).map_err(|error| format!("写入日记失败：{error}"))?;
        touch_file_metadata_for_path(&file_path, true, false)?;

        Ok(MarkdownFilePayload {
            id: normalize_path(&file_path),
            name: file_path
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| "日记.md".into()),
            path: normalize_path(&file_path),
            raw,
            modified_at: file_modified_at(&file_path),
        })
    }

    pub fn open_today_journal(repository_id: String) -> Result<MarkdownFilePayload, String> {
        Self::open_journal_by_date(
            repository_id,
            Local::now().date_naive().format("%Y-%m-%d").to_string(),
        )
    }

    pub fn read_markdown_file(file_id: String) -> Result<MarkdownFilePayload, String> {
        let path = PathBuf::from(&file_id);
        let raw = fs::read_to_string(&path)
            .map_err(|error| format!("读取 Markdown 文件失败：{error}"))?;
        touch_file_metadata_for_path(&path, true, false)?;
        Ok(MarkdownFilePayload {
            id: file_id.clone(),
            name: path
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| file_id.clone()),
            path: file_id,
            raw,
            modified_at: file_modified_at(&path),
        })
    }

    pub fn check_file_changed(
        file_id: String,
        known_modified_at: Option<String>,
    ) -> Result<FileChangePayload, String> {
        let path = PathBuf::from(&file_id);
        if !path.exists() {
            return Err("文件不存在，无法检查外部修改".into());
        }
        let current_modified_at = file_modified_at(&path);
        let changed = known_modified_at
            .as_ref()
            .zip(current_modified_at.as_ref())
            .map(|(known, current)| known != current)
            .unwrap_or(false);
        Ok(FileChangePayload {
            file_id,
            changed,
            current_modified_at,
            known_modified_at,
        })
    }

    pub fn save_markdown_file(file_id: String, content: String) -> Result<SavePayload, String> {
        let path = PathBuf::from(&file_id);
        fs::write(&path, &content).map_err(|error| format!("保存 Markdown 文件失败：{error}"))?;
        touch_file_metadata_for_path(&path, false, true)?;
        sync_frontmatter_metadata_for_path(&path, &content)?;
        Ok(SavePayload {
            file_id,
            saved: true,
            saved_at: now_iso(),
            modified_at: file_modified_at(&path),
        })
    }

    pub fn save_markdown_file_as_copy(
        file_id: String,
        content: String,
    ) -> Result<MarkdownFilePayload, String> {
        let source_path = PathBuf::from(&file_id);
        if !source_path.exists() {
            return Err("原文件不存在，无法另存副本".into());
        }
        let copy_path = unique_copy_path(&source_path);
        fs::write(&copy_path, &content).map_err(|error| format!("另存副本失败：{error}"))?;
        touch_file_metadata_for_path(&copy_path, true, true)?;
        sync_frontmatter_metadata_for_path(&copy_path, &content)?;
        let copy_id = normalize_path(&copy_path);
        Ok(MarkdownFilePayload {
            id: copy_id.clone(),
            name: copy_path
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| "副本.md".into()),
            path: copy_id,
            raw: fs::read_to_string(&copy_path)
                .map_err(|error| format!("读取副本失败：{error}"))?,
            modified_at: file_modified_at(&copy_path),
        })
    }

    pub fn save_attachment(
        markdown_file_id: String,
        file_name: String,
        bytes: Vec<u8>,
    ) -> Result<AttachmentPayload, String> {
        if bytes.is_empty() {
            return Err("附件内容为空".into());
        }

        let markdown_path = PathBuf::from(&markdown_file_id);
        if !markdown_path.exists() {
            return Err("当前 Markdown 文件不存在，无法保存附件".into());
        }

        let parent = markdown_path
            .parent()
            .ok_or_else(|| "当前 Markdown 文件没有父目录".to_string())?;
        let stem = markdown_path
            .file_stem()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| "note".into());
        let attachment_dir = parent.join("assets").join(&stem);
        fs::create_dir_all(&attachment_dir)
            .map_err(|error| format!("创建附件目录失败：{error}"))?;

        let safe_name = safe_attachment_name(&file_name);
        let target = unique_attachment_path(&attachment_dir, &safe_name);
        fs::write(&target, bytes).map_err(|error| format!("保存附件失败：{error}"))?;

        let target_name = target
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| safe_name.clone());
        let relative_path = format!("assets/{stem}/{target_name}");
        Ok(AttachmentPayload {
            file_name: target_name.clone(),
            absolute_path: normalize_path(&target),
            markdown_text: format!("![{target_name}]({relative_path})"),
            relative_path,
        })
    }

    pub fn backup_repository(
        repository_id: String,
        output_path: Option<String>,
        exclude_private_data: Option<bool>,
    ) -> Result<BackupPayload, String> {
        let root_path = path_from_repository(&repository_id);
        if !root_path.join(".moknow").join("moknow.db").exists() {
            return Err("请先新建或打开一个真实仓库".into());
        }

        let created_at = now_iso();
        let timestamp = Local::now().format("%Y%m%d-%H%M%S").to_string();
        let repository_name = repository_name_from_path(&root_path)
            .chars()
            .map(|item| {
                if matches!(item, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
                    || item.is_control()
                {
                    '-'
                } else {
                    item
                }
            })
            .collect::<String>();
        let file_name = format!("{repository_name}-backup-{timestamp}.zip");
        let backup_path = if let Some(path) = output_path.filter(|path| !path.trim().is_empty()) {
            let mut selected_path = PathBuf::from(path.trim());
            if selected_path.is_dir() {
                selected_path = selected_path.join(&file_name);
            }
            if !selected_path
                .extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("zip"))
            {
                selected_path.set_extension("zip");
            }
            selected_path
        } else {
            root_path.join(".moknow").join("backups").join(&file_name)
        };
        if let Some(parent) = backup_path.parent() {
            fs::create_dir_all(parent).map_err(|error| format!("创建备份目录失败：{error}"))?;
        }

        let mut files = Vec::new();
        let mut skipped_private_files = 0u32;
        collect_backup_files(
            &root_path,
            &root_path,
            &mut files,
            exclude_private_data.unwrap_or(false),
            &mut skipped_private_files,
        )?;
        if files.is_empty() {
            return Err("仓库没有可备份文件".into());
        }
        write_zip_store(&backup_path, &files)?;
        let size_bytes = fs::metadata(&backup_path)
            .map_err(|error| format!("读取备份文件信息失败：{error}"))?
            .len();

        Ok(BackupPayload {
            file_name: backup_path
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or(file_name),
            absolute_path: normalize_path(&backup_path),
            included_files: files.len() as u32,
            skipped_private_files,
            size_bytes,
            created_at,
        })
    }

    pub fn preview_restore_backup(
        repository_id: String,
        backup_path: Option<String>,
    ) -> Result<RestorePreviewPayload, String> {
        let root_path = path_from_repository(&repository_id);
        if !root_path.join(".moknow").join("moknow.db").exists() {
            return Err("请先新建或打开一个真实仓库".into());
        }

        let backup_path = selected_backup_path(&root_path, backup_path)?;
        let backup_bytes =
            fs::read(&backup_path).map_err(|error| format!("读取备份文件失败：{error}"))?;
        let backup_entries = read_zip_store(&backup_bytes)?;
        let mut current_files = HashMap::new();
        collect_current_restore_files(&root_path, &root_path, &mut current_files)?;
        let mut backup_files = HashMap::new();
        for file in backup_entries {
            if file.name.starts_with(".moknow/backups/") {
                continue;
            }
            backup_files.insert(file.name, file.bytes);
        }

        let mut added = Vec::new();
        let mut modified = Vec::new();
        let mut unchanged_files = 0u32;
        for (name, bytes) in &backup_files {
            match current_files.get(name) {
                None => added.push(name.clone()),
                Some(current_bytes) if current_bytes == bytes => unchanged_files += 1,
                Some(_) => modified.push(name.clone()),
            }
        }
        let mut deleted = current_files
            .keys()
            .filter(|name| !backup_files.contains_key(*name))
            .cloned()
            .collect::<Vec<_>>();
        added.sort();
        modified.sort();
        deleted.sort();

        let backup_file_name = backup_path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| "backup.zip".into());

        Ok(RestorePreviewPayload {
            backup_file_name,
            backup_path: normalize_path(&backup_path),
            total_backup_files: backup_files.len() as u32,
            added_files: added.len() as u32,
            modified_files: modified.len() as u32,
            unchanged_files,
            deleted_files: deleted.len() as u32,
            sample_added: sample_paths(added),
            sample_modified: sample_paths(modified),
            sample_deleted: sample_paths(deleted),
        })
    }

    pub fn restore_backup(
        repository_id: String,
        backup_path: Option<String>,
        strategy: Option<String>,
    ) -> Result<RestoreBackupPayload, String> {
        let root_path = path_from_repository(&repository_id);
        if !root_path.join(".moknow").join("moknow.db").exists() {
            return Err("请先新建或打开一个真实仓库".into());
        }

        let backup_path = selected_backup_path(&root_path, backup_path)?;
        let backup_bytes =
            fs::read(&backup_path).map_err(|error| format!("读取备份文件失败：{error}"))?;
        let backup_entries = read_zip_store(&backup_bytes)?;
        let strategy = strategy.unwrap_or_else(|| "replace".into());
        let (restored_files, skipped_conflicting_files) = match strategy.as_str() {
            "replace" => (restore_zip_entries(&root_path, backup_entries)?, 0),
            "merge_keep_current" => {
                restore_zip_entries_merge_keep_current(&root_path, backup_entries)?
            }
            _ => return Err("未知恢复策略".into()),
        };
        let repository = Self::load_repository(&root_path)?;
        let backup_file_name = backup_path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| "backup.zip".into());

        Ok(RestoreBackupPayload {
            repository,
            backup_file_name,
            backup_path: normalize_path(&backup_path),
            restored_files,
            skipped_conflicting_files,
            strategy,
            restored_at: now_iso(),
        })
    }

    pub fn restore_latest_backup(repository_id: String) -> Result<RestoreBackupPayload, String> {
        Self::restore_backup(repository_id, None, Some("replace".into()))
    }

    pub fn export_markdown_html(file_id: String, html: String) -> Result<ExportPayload, String> {
        let markdown_path = PathBuf::from(&file_id);
        if !markdown_path.exists() {
            return Err("当前 Markdown 文件不存在，无法导出 HTML".into());
        }
        if !markdown_path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
        {
            return Err("只能导出 Markdown 文件为 HTML".into());
        }
        if html.trim().is_empty() {
            return Err("导出内容不能为空".into());
        }

        let export_path = unique_html_export_path(&markdown_path);
        fs::write(&export_path, html).map_err(|error| format!("导出 HTML 失败：{error}"))?;
        let size_bytes = fs::metadata(&export_path)
            .map_err(|error| format!("读取导出文件信息失败：{error}"))?
            .len();
        let file_name = export_path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| "export.html".into());

        Ok(ExportPayload {
            file_name,
            absolute_path: normalize_path(&export_path),
            size_bytes,
            created_at: now_iso(),
        })
    }

    pub fn export_markdown_pdf(
        file_id: String,
        html: String,
        title: String,
    ) -> Result<ExportPayload, String> {
        let markdown_path = PathBuf::from(&file_id);
        if !markdown_path.exists() {
            return Err("当前 Markdown 文件不存在，无法导出 PDF".into());
        }
        if !markdown_path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
        {
            return Err("只能导出 Markdown 文件为 PDF".into());
        }
        if html.trim().is_empty() {
            return Err("导出内容不能为空".into());
        }

        let export_path = unique_pdf_export_path(&markdown_path);
        let pdf = render_simple_pdf(&title, &html);
        fs::write(&export_path, pdf).map_err(|error| format!("导出 PDF 失败：{error}"))?;
        let size_bytes = fs::metadata(&export_path)
            .map_err(|error| format!("读取导出文件信息失败：{error}"))?
            .len();
        let file_name = export_path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| "export.pdf".into());

        Ok(ExportPayload {
            file_name,
            absolute_path: normalize_path(&export_path),
            size_bytes,
            created_at: now_iso(),
        })
    }

    pub fn export_html_to_path(output_path: String, html: String) -> Result<ExportPayload, String> {
        if html.trim().is_empty() {
            return Err("导出内容不能为空".into());
        }

        let mut export_path = PathBuf::from(output_path.trim());
        if export_path.as_os_str().is_empty() {
            return Err("请选择导出位置".into());
        }
        if !export_path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("html"))
        {
            export_path.set_extension("html");
        }
        if let Some(parent) = export_path.parent() {
            if !parent.as_os_str().is_empty() {
                fs::create_dir_all(parent).map_err(|error| format!("创建导出目录失败：{error}"))?;
            }
        }

        fs::write(&export_path, html).map_err(|error| format!("导出 HTML 失败：{error}"))?;
        let size_bytes = fs::metadata(&export_path)
            .map_err(|error| format!("读取导出文件信息失败：{error}"))?
            .len();
        let file_name = export_path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| "moknow-export.html".into());

        Ok(ExportPayload {
            file_name,
            absolute_path: normalize_path(&export_path),
            size_bytes,
            created_at: now_iso(),
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
        let settings = read_app_config().diary_settings;
        let template = if settings.diary_template.trim().is_empty() {
            DiarySettingsPayload::default().diary_template
        } else {
            settings.diary_template
        };
        let raw = render_diary_template(&template, today);
        fs::write(&file_path, &raw).map_err(|error| format!("写入日记失败：{error}"))?;
        touch_file_metadata_for_path(&file_path, true, false)?;

        Ok(MarkdownFilePayload {
            id: normalize_path(&file_path),
            name: file_name,
            path: normalize_path(&file_path),
            raw,
            modified_at: file_modified_at(&file_path),
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
        let conn = open_database(&root_path)?;
        directory_node(&conn, &target, &root_path, 1)
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
        touch_file_metadata_for_path(&target, true, false)?;
        Ok(MarkdownFilePayload {
            id: normalize_path(&target),
            name: file_name,
            path: normalize_path(&target),
            raw,
            modified_at: file_modified_at(&target),
        })
    }

    pub fn list_recent_files(
        repository_id: String,
        list_kind: String,
    ) -> Result<Vec<RecentFilePayload>, String> {
        let root_path = path_from_repository(&repository_id);
        let conn = open_database(&root_path)?;
        let (timestamp_column, order_column) = match list_kind.as_str() {
            "edited" => ("last_edited_at", "last_edited_at"),
            "opened" => ("last_opened_at", "last_opened_at"),
            _ => return Err("最近文件类型只支持 opened 或 edited".into()),
        };
        let sql = format!(
            "SELECT relative_path, last_opened_at, last_edited_at, is_pinned
             FROM file_metadata
             WHERE repository_id = ?1 AND kind = 'markdown' AND {timestamp_column} IS NOT NULL
             ORDER BY is_pinned DESC, {order_column} DESC
             LIMIT 10"
        );
        let mut statement = conn
            .prepare(&sql)
            .map_err(|error| format!("读取最近文件失败：{error}"))?;
        let rows = statement
            .query_map(params![normalize_path(&root_path)], |row| {
                let relative_path: String = row.get(0)?;
                let last_opened_at: Option<String> = row.get(1)?;
                let last_edited_at: Option<String> = row.get(2)?;
                let is_pinned: i64 = row.get(3)?;
                Ok((
                    relative_path,
                    last_opened_at,
                    last_edited_at,
                    is_pinned != 0,
                ))
            })
            .map_err(|error| format!("读取最近文件失败：{error}"))?;

        let mut files = Vec::new();
        for row in rows {
            let (relative_path, last_opened_at, last_edited_at, is_pinned) =
                row.map_err(|error| format!("读取最近文件行失败：{error}"))?;
            let file_path = relative_to_absolute(&root_path, &relative_path);
            if !file_path.exists() {
                continue;
            }
            files.push(RecentFilePayload {
                file_id: normalize_path(&file_path),
                name: file_path
                    .file_name()
                    .map(|name| name.to_string_lossy().to_string())
                    .unwrap_or_else(|| relative_path.clone()),
                relative_path,
                last_opened_at,
                last_edited_at,
                is_pinned,
            });
        }

        Ok(files)
    }

    pub fn clear_recent_files(repository_id: String, list_kind: String) -> Result<bool, String> {
        let root_path = path_from_repository(&repository_id);
        let conn = open_database(&root_path)?;
        let sql = match list_kind.as_str() {
            "opened" => "UPDATE file_metadata SET last_opened_at = NULL WHERE repository_id = ?1",
            "edited" => "UPDATE file_metadata SET last_edited_at = NULL WHERE repository_id = ?1",
            "all" => "UPDATE file_metadata SET last_opened_at = NULL, last_edited_at = NULL WHERE repository_id = ?1",
            _ => return Err("清空最近文件类型只支持 opened、edited 或 all".into()),
        };
        conn.execute(sql, params![normalize_path(&root_path)])
            .map_err(|error| format!("清空最近文件失败：{error}"))?;
        Ok(true)
    }

    pub fn list_inbox_entries(repository_id: String) -> Result<Vec<InboxItemPayload>, String> {
        let root_path = path_from_repository(&repository_id);
        if !root_path.join(".moknow").join("moknow.db").exists() {
            return Err("请先新建或打开一个真实仓库".into());
        }

        read_inbox_entries(&root_path)
    }

    pub fn append_inbox_entry(
        repository_id: String,
        content: String,
    ) -> Result<Vec<InboxItemPayload>, String> {
        let root_path = path_from_repository(&repository_id);
        if !root_path.join(".moknow").join("moknow.db").exists() {
            return Err("请先新建或打开一个真实仓库".into());
        }
        let content = content.trim();
        if content.is_empty() {
            return Err("快速记录内容不能为空".into());
        }

        let mut items = read_inbox_entries(&root_path)?;
        let created_at = now_iso();
        items.insert(
            0,
            InboxItemPayload {
                id: format!("inbox-{}", Local::now().timestamp_millis()),
                created_at,
                content: content.to_string(),
            },
        );
        write_inbox_entries(&root_path, &items)?;
        Ok(items)
    }

    pub fn clear_inbox_entries(
        repository_id: String,
        entry_ids: Vec<String>,
    ) -> Result<Vec<InboxItemPayload>, String> {
        let root_path = path_from_repository(&repository_id);
        if !root_path.join(".moknow").join("moknow.db").exists() {
            return Err("请先新建或打开一个真实仓库".into());
        }

        let mut items = read_inbox_entries(&root_path)?;
        if entry_ids.is_empty() {
            items.clear();
        } else {
            items.retain(|item| !entry_ids.iter().any(|id| id == &item.id));
        }
        write_inbox_entries(&root_path, &items)?;
        Ok(items)
    }

    pub fn move_inbox_entries_to_today(
        repository_id: String,
        entry_ids: Vec<String>,
    ) -> Result<MarkdownFilePayload, String> {
        let root_path = path_from_repository(&repository_id);
        if !root_path.join(".moknow").join("moknow.db").exists() {
            return Err("请先新建或打开一个真实仓库".into());
        }
        if entry_ids.is_empty() {
            return Err("请选择要整理到今日日记的收件箱内容".into());
        }

        let items = read_inbox_entries(&root_path)?;
        let selected = items
            .iter()
            .filter(|item| entry_ids.iter().any(|id| id == &item.id))
            .cloned()
            .collect::<Vec<_>>();
        if selected.is_empty() {
            return Err("没有找到要整理的收件箱内容".into());
        }

        let mut today = Self::open_today_journal(repository_id.clone())?;
        today.raw.push_str(&format_inbox_items_for_diary(&selected));
        fs::write(&today.id, &today.raw).map_err(|error| format!("整理到今日日记失败：{error}"))?;
        let today_path = PathBuf::from(&today.id);
        touch_file_metadata_for_path(&today_path, true, true)?;
        sync_frontmatter_metadata_for_path(&today_path, &today.raw)?;

        let remaining = items
            .into_iter()
            .filter(|item| !entry_ids.iter().any(|id| id == &item.id))
            .collect::<Vec<_>>();
        write_inbox_entries(&root_path, &remaining)?;
        today.modified_at = file_modified_at(&today_path);
        Ok(today)
    }

    pub fn list_organize_view(repository_id: String) -> Result<OrganizeViewPayload, String> {
        let root_path = path_from_repository(&repository_id);
        if !root_path.join(".moknow").join("moknow.db").exists() {
            return Err("请先新建或打开一个真实仓库".into());
        }

        sync_repository_indexes(&root_path)?;
        let conn = open_database(&root_path)?;
        let inbox = read_inbox_entries(&root_path)?;
        let mut untagged_journals = Vec::new();
        let diary_root = current_diary_root();
        for file_path in repository_markdown_files(&root_path)? {
            let relative_path = normalize_path(
                file_path
                    .strip_prefix(&root_path)
                    .map_err(|error| format!("计算整理视图路径失败：{error}"))?,
            );
            if relative_path != diary_root && !relative_path.starts_with(&format!("{diary_root}/"))
            {
                continue;
            }
            let content = fs::read_to_string(&file_path)
                .map_err(|error| format!("读取无标签日记失败：{error}"))?;
            let metadata = parse_frontmatter_metadata(&content);
            if !metadata.tags.is_empty() {
                continue;
            }
            let (snippet, highlighted_snippet) = build_search_snippet(&content, "");
            untagged_journals.push(SearchResultPayload {
                file_id: normalize_path(&file_path),
                name: file_path
                    .file_name()
                    .map(|name| name.to_string_lossy().to_string())
                    .unwrap_or_else(|| relative_path.clone()),
                relative_path,
                snippet,
                highlighted_snippet,
                diary_date: metadata.diary_date,
                tags: metadata.tags,
                score: 0,
            });
        }
        untagged_journals.sort_by(|left, right| right.relative_path.cmp(&left.relative_path));
        untagged_journals.truncate(10);

        let mut favorites = Vec::new();
        let mut statement = conn
            .prepare(
                "SELECT relative_path
                 FROM favorites
                 WHERE repository_id = ?1 AND target_kind = 'markdown'
                 ORDER BY created_at DESC
                 LIMIT 10",
            )
            .map_err(|error| format!("读取收藏日记失败：{error}"))?;
        let rows = statement
            .query_map(params![normalize_path(&root_path)], |row| {
                row.get::<_, String>(0)
            })
            .map_err(|error| format!("读取收藏日记失败：{error}"))?;
        for row in rows {
            let relative_path = row.map_err(|error| format!("读取收藏日记行失败：{error}"))?;
            if let Some(payload) =
                recent_file_payload_for_relative(&conn, &root_path, &relative_path)?
            {
                favorites.push(payload);
            }
        }

        Ok(OrganizeViewPayload {
            inbox,
            untagged_journals,
            recent_edited: Self::list_recent_files(repository_id, "edited".into())?,
            favorites,
        })
    }

    pub fn list_tags(repository_id: String) -> Result<Vec<TagSummaryPayload>, String> {
        let root_path = path_from_repository(&repository_id);
        sync_repository_indexes(&root_path)?;

        let conn = open_database(&root_path)?;
        let mut statement = conn
            .prepare(
                "SELECT tags.name, tags.color, COUNT(file_tags.relative_path) AS usage_count
                 FROM tags
                 LEFT JOIN file_tags
                   ON file_tags.repository_id = tags.repository_id
                  AND file_tags.tag_name = tags.name
                 WHERE tags.repository_id = ?1
                 GROUP BY tags.name, tags.color
                 ORDER BY usage_count DESC, tags.name ASC",
            )
            .map_err(|error| format!("读取标签列表失败：{error}"))?;
        let rows = statement
            .query_map(params![normalize_path(&root_path)], |row| {
                Ok(TagSummaryPayload {
                    name: row.get(0)?,
                    color: Some(row.get(1)?),
                    count: row.get::<_, i64>(2)? as u32,
                })
            })
            .map_err(|error| format!("读取标签列表失败：{error}"))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("读取标签列表行失败：{error}"))
    }

    pub fn set_tag_color(
        repository_id: String,
        tag_name: String,
        color: String,
    ) -> Result<Vec<TagSummaryPayload>, String> {
        let root_path = path_from_repository(&repository_id);
        let tag_name = validate_tag_name(&tag_name)?;
        let color = validate_tag_color(&color)?;
        let conn = open_database(&root_path)?;
        let repository_id_value = normalize_path(&root_path);
        conn.execute(
            "INSERT INTO tags (id, repository_id, name, color, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)
             ON CONFLICT(repository_id, name) DO UPDATE SET color = excluded.color, updated_at = excluded.updated_at",
            params![
                format!("{}:{}", repository_id_value, tag_name),
                repository_id_value,
                tag_name,
                color,
                now_iso(),
            ],
        )
        .map_err(|error| format!("更新标签颜色失败：{error}"))?;
        Self::list_tags(normalize_path(&root_path))
    }

    pub fn rename_tag(
        repository_id: String,
        old_name: String,
        new_name: String,
    ) -> Result<Vec<TagSummaryPayload>, String> {
        let root_path = path_from_repository(&repository_id);
        let old_name = validate_tag_name(&old_name)?;
        let new_name = validate_tag_name(&new_name)?;
        if old_name == new_name {
            return Self::list_tags(normalize_path(&root_path));
        }

        let conn = open_database(&root_path)?;
        let repository_id_value = normalize_path(&root_path);
        let old_color = conn
            .query_row(
                "SELECT color FROM tags WHERE repository_id = ?1 AND name = ?2",
                params![repository_id_value, old_name],
                |row| row.get::<_, String>(0),
            )
            .ok();
        let new_color = conn
            .query_row(
                "SELECT color FROM tags WHERE repository_id = ?1 AND name = ?2",
                params![normalize_path(&root_path), new_name],
                |row| row.get::<_, String>(0),
            )
            .ok();

        for file_path in repository_markdown_files(&root_path)? {
            let content = fs::read_to_string(&file_path)
                .map_err(|error| format!("读取标签文件失败：{error}"))?;
            let metadata = parse_frontmatter_metadata(&content);
            if !metadata.tags.iter().any(|tag| tag == &old_name) {
                sync_frontmatter_metadata_for_path(&file_path, &content)?;
                continue;
            }

            let mapped_tags = metadata
                .tags
                .into_iter()
                .map(|tag| {
                    if tag == old_name {
                        new_name.clone()
                    } else {
                        tag
                    }
                })
                .collect::<Vec<_>>();
            let mut next_tags = Vec::new();
            for tag in mapped_tags {
                if !next_tags.contains(&tag) {
                    next_tags.push(tag);
                }
            }
            let next_content = update_frontmatter_tags(&content, &next_tags);
            fs::write(&file_path, &next_content)
                .map_err(|error| format!("写入标签改名失败：{error}"))?;
            sync_frontmatter_metadata_for_path(&file_path, &next_content)?;
        }

        let conn = open_database(&root_path)?;
        conn.execute(
            "DELETE FROM tags WHERE repository_id = ?1 AND name = ?2",
            params![normalize_path(&root_path), old_name],
        )
        .map_err(|error| format!("清理旧标签失败：{error}"))?;
        if let (Some(color), None) = (old_color, new_color) {
            let repository_id_value = normalize_path(&root_path);
            conn.execute(
                "INSERT INTO tags (id, repository_id, name, color, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?5)
                 ON CONFLICT(repository_id, name) DO UPDATE SET color = excluded.color, updated_at = excluded.updated_at",
                params![
                    format!("{}:{}", repository_id_value, new_name),
                    repository_id_value,
                    new_name,
                    color,
                    now_iso(),
                ],
            )
            .map_err(|error| format!("保留标签颜色失败：{error}"))?;
        }

        Self::list_tags(normalize_path(&root_path))
    }

    pub fn delete_tag(
        repository_id: String,
        tag_name: String,
    ) -> Result<Vec<TagSummaryPayload>, String> {
        let root_path = path_from_repository(&repository_id);
        let tag_name = validate_tag_name(&tag_name)?;

        for file_path in repository_markdown_files(&root_path)? {
            let content = fs::read_to_string(&file_path)
                .map_err(|error| format!("读取标签文件失败：{error}"))?;
            let metadata = parse_frontmatter_metadata(&content);
            if !metadata.tags.iter().any(|tag| tag == &tag_name) {
                sync_frontmatter_metadata_for_path(&file_path, &content)?;
                continue;
            }

            let next_tags = metadata
                .tags
                .into_iter()
                .filter(|tag| tag != &tag_name)
                .collect::<Vec<_>>();
            let next_content = update_frontmatter_tags(&content, &next_tags);
            fs::write(&file_path, &next_content)
                .map_err(|error| format!("写入标签删除失败：{error}"))?;
            sync_frontmatter_metadata_for_path(&file_path, &next_content)?;
        }

        let conn = open_database(&root_path)?;
        conn.execute(
            "DELETE FROM tags WHERE repository_id = ?1 AND name = ?2",
            params![normalize_path(&root_path), tag_name],
        )
        .map_err(|error| format!("删除标签失败：{error}"))?;
        conn.execute(
            "DELETE FROM file_tags WHERE repository_id = ?1 AND tag_name = ?2",
            params![normalize_path(&root_path), tag_name],
        )
        .map_err(|error| format!("清理标签关联失败：{error}"))?;

        Self::list_tags(normalize_path(&root_path))
    }

    pub fn search_files(
        repository_id: String,
        filters: SearchFiltersPayload,
    ) -> Result<Vec<SearchResultPayload>, String> {
        let root_path = path_from_repository(&repository_id);
        sync_repository_indexes(&root_path)?;

        let query = filters.query.unwrap_or_default().trim().to_string();
        let tag_filter = filters.tag.filter(|value| !value.trim().is_empty());
        let date_from = filters.date_from.filter(|value| !value.trim().is_empty());
        let date_to = filters.date_to.filter(|value| !value.trim().is_empty());
        let file_type = filters.file_type.unwrap_or_else(|| "all".into());
        let conn = open_database(&root_path)?;
        let mut bind_values = Vec::new();
        let mut sql = if query.is_empty() {
            bind_values.push(normalize_path(&root_path));
            "SELECT file_id, relative_path, title, content, tags, diary_date, category, 0.0 AS rank
             FROM file_fts
             WHERE repository_id = ?"
                .to_string()
        } else {
            bind_values.push(fts_query(&query));
            bind_values.push(normalize_path(&root_path));
            "SELECT file_id, relative_path, title, content, tags, diary_date, category, bm25(file_fts) AS rank
             FROM file_fts
             WHERE file_fts MATCH ? AND repository_id = ?"
                .to_string()
        };

        if file_type != "all" {
            sql.push_str(" AND category = ?");
            bind_values.push(file_type);
        }
        if let Some(from) = date_from {
            sql.push_str(" AND COALESCE(diary_date, '') >= ?");
            bind_values.push(from);
        }
        if let Some(to) = date_to {
            sql.push_str(" AND COALESCE(diary_date, '9999-99-99') <= ?");
            bind_values.push(to);
        }
        if let Some(tag) = tag_filter {
            sql.push_str(
                " AND EXISTS (
                    SELECT 1 FROM file_tags
                    WHERE file_tags.repository_id = file_fts.repository_id
                      AND file_tags.relative_path = file_fts.relative_path
                      AND file_tags.tag_name = ?
                  )",
            );
            bind_values.push(tag);
        }

        sql.push_str(" ORDER BY rank ASC, diary_date DESC, relative_path ASC LIMIT 50");

        let mut statement = conn
            .prepare(&sql)
            .map_err(|error| format!("搜索索引失败：{error}"))?;
        let rows = statement
            .query_map(params_from_iter(bind_values.iter()), |row| {
                let file_id: String = row.get(0)?;
                let relative_path: String = row.get(1)?;
                let _title: String = row.get(2)?;
                let content: String = row.get(3)?;
                let tag_text: String = row.get(4)?;
                let diary_date: Option<String> = row.get(5)?;
                let rank: f64 = row.get(7)?;
                let (snippet, highlighted_snippet) = build_search_snippet(&content, &query);
                Ok(SearchResultPayload {
                    file_id,
                    name: Path::new(&relative_path)
                        .file_name()
                        .map(|name| name.to_string_lossy().to_string())
                        .unwrap_or_else(|| relative_path.clone()),
                    relative_path,
                    snippet,
                    highlighted_snippet,
                    diary_date,
                    tags: tag_text
                        .split_whitespace()
                        .map(str::to_string)
                        .collect::<Vec<_>>(),
                    score: if rank < 0.0 {
                        (-rank * 1000.0) as u32
                    } else {
                        0
                    },
                })
            })
            .map_err(|error| format!("搜索索引失败：{error}"))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("读取搜索结果失败：{error}"))
    }

    pub fn set_file_pinned(
        repository_id: String,
        relative_path: String,
        pinned: bool,
    ) -> Result<RepositoryPayload, String> {
        let root_path = path_from_repository(&repository_id);
        let target = relative_to_absolute(&root_path, &relative_path);
        if !target.exists() {
            return Err("要置顶的文件不存在".into());
        }

        let conn = open_database(&root_path)?;
        let kind = if target.is_dir() {
            "directory"
        } else {
            "markdown"
        };
        touch_file_metadata(&conn, &root_path, &relative_path, kind, false, false)?;
        conn.execute(
            "UPDATE file_metadata SET is_pinned = ?1, updated_at = ?2 WHERE repository_id = ?3 AND relative_path = ?4",
            params![if pinned { 1 } else { 0 }, now_iso(), normalize_path(&root_path), relative_path],
        )
        .map_err(|error| format!("更新置顶状态失败：{error}"))?;

        Self::load_repository(&root_path)
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

    pub fn show_in_folder(repository_id: String, relative_path: String) -> Result<bool, String> {
        let root_path = path_from_repository(&repository_id);
        let target = relative_to_absolute(&root_path, &relative_path);
        if !target.exists() {
            return Err("要显示的文件或目录不存在".into());
        }

        #[cfg(target_os = "macos")]
        let status = Command::new("open")
            .arg("-R")
            .arg(&target)
            .status()
            .map_err(|error| format!("打开系统文件夹失败：{error}"))?;

        #[cfg(target_os = "windows")]
        let status = Command::new("explorer")
            .arg(format!("/select,{}", target.to_string_lossy()))
            .status()
            .map_err(|error| format!("打开系统文件夹失败：{error}"))?;

        #[cfg(all(unix, not(target_os = "macos")))]
        let status = Command::new("xdg-open")
            .arg(target.parent().unwrap_or(&target))
            .status()
            .map_err(|error| format!("打开系统文件夹失败：{error}"))?;

        if status.success() {
            Ok(true)
        } else {
            Err("打开系统文件夹失败".into())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static TEMP_REPOSITORY_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn temp_repository_root() -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        let counter = TEMP_REPOSITORY_COUNTER.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!("moknow-save-test-{nanos}-{counter}"))
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
    fn diary_template_replaces_date_and_weekday_tokens() {
        let date = NaiveDate::from_ymd_opt(2026, 6, 8).expect("valid date");

        let rendered =
            render_diary_template("# {{date}} {{weekday}}\n{{year}}/{{month}}/{{day}}", date);

        assert_eq!(rendered, "# 2026-06-08 星期一\n2026/06/08");
    }

    #[test]
    fn open_today_journal_creates_missing_file_without_duplicates() {
        let root_path = temp_repository_root();
        fs::create_dir_all(root_path.join(".moknow")).expect("create database directory");
        fs::create_dir_all(root_path.join("日记")).expect("create journal directory");
        fs::create_dir_all(root_path.join("文档")).expect("create document directory");
        fs::create_dir_all(root_path.join("回收站")).expect("create trash directory");
        open_database(&root_path).expect("initialize database");

        let repository_id = normalize_path(&root_path);
        let first =
            RepositoryService::open_today_journal(repository_id.clone()).expect("open today");
        let second = RepositoryService::open_today_journal(repository_id).expect("reopen today");

        assert_eq!(first.id, second.id);
        assert!(PathBuf::from(&first.id).exists());
        assert!(first.raw.contains("## 明天要做"));

        fs::remove_dir_all(root_path).expect("cleanup temp repository");
    }

    #[test]
    fn inbox_entries_can_be_added_moved_to_today_and_cleared() {
        let root_path = temp_repository_root();
        fs::create_dir_all(root_path.join(".moknow")).expect("create database directory");
        fs::create_dir_all(root_path.join("日记")).expect("create journal directory");
        fs::create_dir_all(root_path.join("文档")).expect("create document directory");
        fs::create_dir_all(root_path.join("回收站")).expect("create trash directory");
        open_database(&root_path).expect("initialize database");

        let repository_id = normalize_path(&root_path);
        let entries =
            RepositoryService::append_inbox_entry(repository_id.clone(), "临时灵感\n第二行".into())
                .expect("append inbox entry");

        assert_eq!(entries.len(), 1);
        assert!(root_path.join("Inbox").join("inbox.md").exists());
        assert_eq!(
            RepositoryService::list_inbox_entries(repository_id.clone())
                .expect("list inbox entries")[0]
                .content,
            "临时灵感\n第二行"
        );

        let today = RepositoryService::move_inbox_entries_to_today(
            repository_id.clone(),
            vec![entries[0].id.clone()],
        )
        .expect("move inbox to today");

        assert!(today.raw.contains("## 收件箱整理"));
        assert!(today.raw.contains("临时灵感"));
        assert!(RepositoryService::list_inbox_entries(repository_id.clone())
            .expect("list inbox after move")
            .is_empty());

        RepositoryService::append_inbox_entry(repository_id.clone(), "稍后清空".into())
            .expect("append second inbox entry");
        let cleared = RepositoryService::clear_inbox_entries(repository_id, Vec::new())
            .expect("clear all inbox entries");

        assert!(cleared.is_empty());

        fs::remove_dir_all(root_path).expect("cleanup temp repository");
    }

    #[test]
    fn loaded_markdown_nodes_use_writable_file_ids() {
        let root_path = temp_repository_root();
        let file_name = "2026-06-05.md";
        let file_path = root_path
            .join("日记")
            .join("2026")
            .join("06")
            .join(file_name);
        fs::create_dir_all(root_path.join(".moknow")).expect("create database directory");
        fs::create_dir_all(
            file_path
                .parent()
                .expect("markdown file should have parent"),
        )
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
    fn markdown_modified_time_supports_external_change_checks() {
        let root_path = temp_repository_root();
        let file_path = root_path.join("文档").join("保存可靠性.md");
        fs::create_dir_all(root_path.join(".moknow")).expect("create database directory");
        fs::create_dir_all(
            file_path
                .parent()
                .expect("markdown file should have parent"),
        )
        .expect("create document directory");
        fs::write(&file_path, "# before\n").expect("write initial markdown");
        open_database(&root_path).expect("initialize database");

        let file_id = normalize_path(&file_path);
        let first = RepositoryService::read_markdown_file(file_id.clone()).expect("read markdown");
        let unchanged =
            RepositoryService::check_file_changed(file_id.clone(), first.modified_at.clone())
                .expect("check unchanged markdown");
        std::thread::sleep(std::time::Duration::from_millis(20));
        RepositoryService::save_markdown_file(file_id.clone(), "# after\n".into())
            .expect("save markdown");
        let changed = RepositoryService::check_file_changed(file_id, first.modified_at.clone())
            .expect("check changed markdown");

        assert!(first.modified_at.is_some());
        assert!(!unchanged.changed);
        assert!(changed.changed);

        fs::remove_dir_all(root_path).expect("cleanup temp repository");
    }

    #[test]
    fn save_markdown_file_as_copy_keeps_original_file() {
        let root_path = temp_repository_root();
        let file_path = root_path.join("文档").join("冲突处理.md");
        fs::create_dir_all(root_path.join(".moknow")).expect("create database directory");
        fs::create_dir_all(
            file_path
                .parent()
                .expect("markdown file should have parent"),
        )
        .expect("create document directory");
        fs::write(&file_path, "# original\n").expect("write initial markdown");
        open_database(&root_path).expect("initialize database");

        let copy = RepositoryService::save_markdown_file_as_copy(
            normalize_path(&file_path),
            "# current draft\n".into(),
        )
        .expect("save markdown copy");
        let original = fs::read_to_string(&file_path).expect("read original file");

        assert_eq!(original, "# original\n");
        assert!(copy.name.contains("副本"));
        assert_eq!(copy.raw, "# current draft\n");
        assert!(PathBuf::from(copy.id).exists());

        fs::remove_dir_all(root_path).expect("cleanup temp repository");
    }

    #[test]
    fn save_markdown_file_syncs_frontmatter_metadata_to_sqlite() {
        let root_path = temp_repository_root();
        let file_path = root_path
            .join("日记")
            .join("2026")
            .join("06")
            .join("2026-06-08.md");
        fs::create_dir_all(root_path.join(".moknow")).expect("create database directory");
        fs::create_dir_all(
            file_path
                .parent()
                .expect("markdown file should have parent"),
        )
        .expect("create journal directory");
        fs::write(&file_path, "# before\n").expect("write initial markdown");
        open_database(&root_path).expect("initialize database");

        RepositoryService::save_markdown_file(
            normalize_path(&file_path),
            "---
date: 2026-06-08
mood: calm
tags: [工作, 家庭]
weather: cloudy
location: 上海 家里
energy: high
favorite: true
---

# after
"
            .into(),
        )
        .expect("save markdown with frontmatter");

        let conn = open_database(&root_path).expect("open database");
        let row = conn
            .query_row(
                "SELECT diary_date, mood, tags, weather, location, energy, favorite
                 FROM file_metadata
                 WHERE repository_id = ?1 AND relative_path = ?2",
                params![normalize_path(&root_path), "日记/2026/06/2026-06-08.md"],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, Option<String>>(3)?,
                        row.get::<_, Option<String>>(4)?,
                        row.get::<_, Option<String>>(5)?,
                        row.get::<_, Option<i64>>(6)?,
                    ))
                },
            )
            .expect("read synced metadata");

        assert_eq!(row.0.as_deref(), Some("2026-06-08"));
        assert_eq!(row.1.as_deref(), Some("calm"));
        assert_eq!(row.2.as_deref(), Some("[\"工作\",\"家庭\"]"));
        assert_eq!(row.3.as_deref(), Some("cloudy"));
        assert_eq!(row.4.as_deref(), Some("上海 家里"));
        assert_eq!(row.5.as_deref(), Some("high"));
        assert_eq!(row.6, Some(1));

        fs::remove_dir_all(root_path).expect("cleanup temp repository");
    }

    #[test]
    fn list_tags_and_search_files_read_repository_frontmatter() {
        let root_path = temp_repository_root();
        let journal_path = root_path
            .join("日记")
            .join("2026")
            .join("06")
            .join("2026-06-08.md");
        let document_path = root_path.join("文档").join("项目规划.md");
        fs::create_dir_all(root_path.join(".moknow")).expect("create database directory");
        fs::create_dir_all(
            journal_path
                .parent()
                .expect("journal file should have parent"),
        )
        .expect("create journal directory");
        fs::create_dir_all(
            document_path
                .parent()
                .expect("document file should have parent"),
        )
        .expect("create document directory");
        fs::write(
            &journal_path,
            "---
date: 2026-06-08
tags: [工作, 家庭]
---

# 今天的工作

继续推进 MoKnow 搜索功能。
",
        )
        .expect("write journal");
        fs::write(
            &document_path,
            "---
tags: [项目]
---

# 项目规划

搜索和标签整理。
",
        )
        .expect("write document");
        open_database(&root_path).expect("initialize database");

        let repository_id = normalize_path(&root_path);
        let tags = RepositoryService::list_tags(repository_id.clone()).expect("list tags");
        let work_tag = tags
            .iter()
            .find(|tag| tag.name == "工作")
            .expect("find work tag");

        assert_eq!(work_tag.count, 1);

        let results = RepositoryService::search_files(
            repository_id,
            SearchFiltersPayload {
                query: Some("MoKnow".into()),
                tag: Some("工作".into()),
                date_from: Some("2026-06-01".into()),
                date_to: Some("2026-06-30".into()),
                file_type: Some("journal".into()),
            },
        )
        .expect("search files");

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "2026-06-08.md");
        assert_eq!(
            results[0].tags,
            vec!["工作".to_string(), "家庭".to_string()]
        );
        assert!(results[0]
            .highlighted_snippet
            .contains("<mark>MoKnow</mark>"));

        fs::remove_dir_all(root_path).expect("cleanup temp repository");
    }

    #[test]
    fn global_tag_maintenance_rewrites_markdown_frontmatter() {
        let root_path = temp_repository_root();
        let journal_path = root_path
            .join("日记")
            .join("2026")
            .join("06")
            .join("2026-06-09.md");
        fs::create_dir_all(root_path.join(".moknow")).expect("create database directory");
        fs::create_dir_all(
            journal_path
                .parent()
                .expect("journal file should have parent"),
        )
        .expect("create journal directory");
        fs::write(
            &journal_path,
            "---
date: 2026-06-09
tags: [工作, 家庭]
---

# 今天
",
        )
        .expect("write journal");
        open_database(&root_path).expect("initialize database");

        let repository_id = normalize_path(&root_path);
        RepositoryService::list_tags(repository_id.clone()).expect("sync tags");
        let colored = RepositoryService::set_tag_color(
            repository_id.clone(),
            "工作".into(),
            "#56d98e".into(),
        )
        .expect("set tag color");
        let work = colored
            .iter()
            .find(|tag| tag.name == "工作")
            .expect("find colored tag");
        assert_eq!(work.color.as_deref(), Some("#56d98e"));

        let renamed =
            RepositoryService::rename_tag(repository_id.clone(), "工作".into(), "项目".into())
                .expect("rename tag");
        let project = renamed
            .iter()
            .find(|tag| tag.name == "项目")
            .expect("find renamed tag");
        assert_eq!(project.count, 1);
        assert_eq!(project.color.as_deref(), Some("#56d98e"));
        assert!(!renamed.iter().any(|tag| tag.name == "工作"));

        let after_rename = fs::read_to_string(&journal_path).expect("read renamed markdown");
        assert!(after_rename.contains("tags: [项目, 家庭]"));

        let deleted =
            RepositoryService::delete_tag(repository_id, "家庭".into()).expect("delete tag");
        assert!(!deleted.iter().any(|tag| tag.name == "家庭"));
        let after_delete = fs::read_to_string(&journal_path).expect("read markdown after delete");
        assert!(after_delete.contains("tags: [项目]"));

        fs::remove_dir_all(root_path).expect("cleanup temp repository");
    }

    #[test]
    fn save_markdown_file_updates_fts_index_incrementally() {
        let root_path = temp_repository_root();
        let file_path = root_path.join("文档").join("搜索索引.md");
        fs::create_dir_all(root_path.join(".moknow")).expect("create database directory");
        fs::create_dir_all(
            file_path
                .parent()
                .expect("markdown file should have parent"),
        )
        .expect("create document directory");
        fs::write(&file_path, "# before\n").expect("write markdown");
        open_database(&root_path).expect("initialize database");

        RepositoryService::save_markdown_file(
            normalize_path(&file_path),
            "---
tags: [搜索]
---

# 搜索索引

AlphaUniqueToken
"
            .into(),
        )
        .expect("save indexed markdown");

        let conn = open_database(&root_path).expect("open database");
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM file_fts WHERE file_fts MATCH ?1 AND repository_id = ?2",
                params![fts_query("AlphaUniqueToken"), normalize_path(&root_path)],
                |row| row.get(0),
            )
            .expect("query fts index");
        assert_eq!(count, 1);

        fs::remove_dir_all(root_path).expect("cleanup temp repository");
    }

    #[test]
    fn save_attachment_writes_to_stable_assets_directory() {
        let root_path = temp_repository_root();
        let file_path = root_path
            .join("日记")
            .join("2026")
            .join("06")
            .join("2026-06-08.md");
        fs::create_dir_all(root_path.join(".moknow")).expect("create database directory");
        fs::create_dir_all(
            file_path
                .parent()
                .expect("markdown file should have parent"),
        )
        .expect("create journal directory");
        fs::write(&file_path, "# journal\n").expect("write markdown");
        open_database(&root_path).expect("initialize database");

        let attachment = RepositoryService::save_attachment(
            normalize_path(&file_path),
            "today photo.png".into(),
            vec![1, 2, 3],
        )
        .expect("save attachment");

        assert_eq!(attachment.file_name, "today-photo.png");
        assert_eq!(
            attachment.relative_path,
            "assets/2026-06-08/today-photo.png"
        );
        assert_eq!(
            attachment.markdown_text,
            "![today-photo.png](assets/2026-06-08/today-photo.png)"
        );
        assert_eq!(
            fs::read(PathBuf::from(attachment.absolute_path)).expect("read attachment"),
            vec![1, 2, 3]
        );

        fs::remove_dir_all(root_path).expect("cleanup temp repository");
    }

    #[test]
    fn backup_repository_writes_zip_without_nested_backups() {
        let root_path = temp_repository_root();
        let journal_path = root_path
            .join("日记")
            .join("2026")
            .join("06")
            .join("2026-06-08.md");
        let document_path = root_path.join("文档").join("项目.md");
        let old_backup_path = root_path.join(".moknow").join("backups").join("old.zip");
        fs::create_dir_all(
            journal_path
                .parent()
                .expect("journal file should have parent"),
        )
        .expect("create journal directory");
        fs::create_dir_all(
            document_path
                .parent()
                .expect("document file should have parent"),
        )
        .expect("create document directory");
        fs::create_dir_all(
            old_backup_path
                .parent()
                .expect("old backup should have parent"),
        )
        .expect("create old backup directory");
        fs::write(&journal_path, "# 日记\n").expect("write journal");
        fs::write(&document_path, "# 项目\n").expect("write document");
        fs::write(&old_backup_path, b"old").expect("write old backup");
        let conn = open_database(&root_path).expect("initialize database");
        drop(conn);

        let backup = RepositoryService::backup_repository(normalize_path(&root_path), None, None)
            .expect("backup repository");
        let backup_path = PathBuf::from(&backup.absolute_path);
        let bytes = fs::read(&backup_path).expect("read backup zip");
        let zip_text = String::from_utf8_lossy(&bytes);

        assert!(backup.file_name.ends_with(".zip"));
        assert!(backup.size_bytes > 0);
        assert!(backup.included_files >= 3);
        assert_eq!(backup.skipped_private_files, 0);
        assert_eq!(&bytes[0..4], &[0x50, 0x4b, 0x03, 0x04]);
        assert!(zip_text.contains("日记/2026/06/2026-06-08.md"));
        assert!(zip_text.contains("文档/项目.md"));
        assert!(zip_text.contains(".moknow/moknow.db"));
        assert!(!zip_text.contains(".moknow/backups/old.zip"));

        fs::remove_dir_all(root_path).expect("cleanup temp repository");
    }

    #[test]
    fn backup_repository_writes_selected_path_and_filters_private_files() {
        let root_path = temp_repository_root();
        let journal_path = root_path
            .join("日记")
            .join("2026")
            .join("06")
            .join("2026-06-09.md");
        fs::create_dir_all(
            journal_path
                .parent()
                .expect("journal file should have parent"),
        )
        .expect("create journal directory");
        fs::write(&journal_path, "# 可备份日记\n").expect("write journal");
        fs::write(root_path.join(".env"), "OPENAI_API_KEY=secret").expect("write env");
        fs::write(root_path.join("api-key.pem"), "secret").expect("write key");
        fs::create_dir_all(root_path.join(".moknow")).expect("create database directory");
        let conn = open_database(&root_path).expect("initialize database");
        drop(conn);

        let selected_path = root_path.join("导出").join("隐私备份");
        let backup = RepositoryService::backup_repository(
            normalize_path(&root_path),
            Some(normalize_path(&selected_path)),
            Some(true),
        )
        .expect("backup repository");
        let backup_path = PathBuf::from(&backup.absolute_path);
        let bytes = fs::read(&backup_path).expect("read backup zip");
        let zip_text = String::from_utf8_lossy(&bytes);

        assert_eq!(backup_path, selected_path.with_extension("zip"));
        assert_eq!(backup.file_name, "隐私备份.zip");
        assert_eq!(backup.skipped_private_files, 2);
        assert!(zip_text.contains("日记/2026/06/2026-06-09.md"));
        assert!(zip_text.contains(".moknow/moknow.db"));
        assert!(!zip_text.contains(".env"));
        assert!(!zip_text.contains("api-key.pem"));

        fs::remove_dir_all(root_path).expect("cleanup temp repository");
    }

    #[test]
    fn restore_latest_backup_overwrites_repository_and_preserves_backups() {
        let root_path = temp_repository_root();
        let journal_path = root_path
            .join("日记")
            .join("2026")
            .join("06")
            .join("2026-06-08.md");
        let document_path = root_path.join("文档").join("项目.md");
        fs::create_dir_all(
            journal_path
                .parent()
                .expect("journal file should have parent"),
        )
        .expect("create journal directory");
        fs::create_dir_all(
            document_path
                .parent()
                .expect("document file should have parent"),
        )
        .expect("create document directory");
        fs::create_dir_all(root_path.join(".moknow")).expect("create database directory");
        fs::write(&journal_path, "# 原始日记\n").expect("write journal");
        fs::write(&document_path, "# 原始项目\n").expect("write document");
        let conn = open_database(&root_path).expect("initialize database");
        drop(conn);

        let backup = RepositoryService::backup_repository(normalize_path(&root_path), None, None)
            .expect("backup repository");
        let backup_path = PathBuf::from(&backup.absolute_path);
        fs::write(&journal_path, "# 被破坏的日记\n").expect("overwrite journal");
        fs::remove_file(&document_path).expect("remove document");
        fs::write(root_path.join("临时.md"), "# 不应保留\n").expect("write extra file");

        let restored = RepositoryService::restore_latest_backup(normalize_path(&root_path))
            .expect("restore repository");

        assert_eq!(restored.backup_file_name, backup.file_name);
        assert_eq!(restored.strategy, "replace");
        assert_eq!(restored.skipped_conflicting_files, 0);
        assert!(restored.restored_files >= 3);
        assert_eq!(
            fs::read_to_string(&journal_path).expect("read restored journal"),
            "# 原始日记\n"
        );
        assert_eq!(
            fs::read_to_string(&document_path).expect("read restored document"),
            "# 原始项目\n"
        );
        assert!(!root_path.join("临时.md").exists());
        assert!(backup_path.exists());
        assert!(restored
            .repository
            .files
            .iter()
            .any(|node| node.id == "journal"));

        fs::remove_dir_all(root_path).expect("cleanup temp repository");
    }

    #[test]
    fn preview_and_merge_restore_selected_backup_keeps_current_conflicts() {
        let root_path = temp_repository_root();
        let journal_path = root_path
            .join("日记")
            .join("2026")
            .join("06")
            .join("2026-06-10.md");
        let document_path = root_path.join("文档").join("项目.md");
        fs::create_dir_all(
            journal_path
                .parent()
                .expect("journal file should have parent"),
        )
        .expect("create journal directory");
        fs::create_dir_all(
            document_path
                .parent()
                .expect("document file should have parent"),
        )
        .expect("create document directory");
        fs::create_dir_all(root_path.join(".moknow")).expect("create database directory");
        fs::write(&journal_path, "# 备份日记\n").expect("write journal");
        fs::write(&document_path, "# 备份项目\n").expect("write document");
        let conn = open_database(&root_path).expect("initialize database");
        drop(conn);

        let selected_path = root_path.join("导出").join("可选恢复.zip");
        let backup = RepositoryService::backup_repository(
            normalize_path(&root_path),
            Some(normalize_path(&selected_path)),
            Some(false),
        )
        .expect("backup repository");

        fs::write(&journal_path, "# 当前日记\n").expect("modify journal");
        fs::remove_file(&document_path).expect("remove document");
        fs::write(root_path.join("临时.md"), "# 当前临时\n").expect("write extra file");

        let preview = RepositoryService::preview_restore_backup(
            normalize_path(&root_path),
            Some(backup.absolute_path.clone()),
        )
        .expect("preview restore");

        assert_eq!(preview.backup_file_name, "可选恢复.zip");
        assert!(preview.modified_files >= 1);
        assert!(preview.added_files >= 1);
        assert!(preview.deleted_files >= 1);
        assert!(preview
            .sample_modified
            .contains(&"日记/2026/06/2026-06-10.md".to_string()));

        let restored = RepositoryService::restore_backup(
            normalize_path(&root_path),
            Some(backup.absolute_path),
            Some("merge_keep_current".into()),
        )
        .expect("restore selected backup");

        assert_eq!(restored.strategy, "merge_keep_current");
        assert!(restored.skipped_conflicting_files >= 2);
        assert_eq!(
            fs::read_to_string(&journal_path).expect("read current journal"),
            "# 当前日记\n"
        );
        assert_eq!(
            fs::read_to_string(&document_path).expect("read restored document"),
            "# 备份项目\n"
        );
        assert!(root_path.join("临时.md").exists());

        fs::remove_dir_all(root_path).expect("cleanup temp repository");
    }

    #[test]
    fn export_markdown_html_writes_html_next_to_source() {
        let root_path = temp_repository_root();
        let file_path = root_path.join("文档").join("导出.md");
        fs::create_dir_all(root_path.join(".moknow")).expect("create database directory");
        fs::create_dir_all(
            file_path
                .parent()
                .expect("markdown file should have parent"),
        )
        .expect("create document directory");
        fs::write(&file_path, "# 导出\n").expect("write markdown");
        open_database(&root_path).expect("initialize database");

        let exported = RepositoryService::export_markdown_html(
            normalize_path(&file_path),
            "<!doctype html><html><body><h1>导出</h1></body></html>".into(),
        )
        .expect("export html");
        let exported_path = PathBuf::from(&exported.absolute_path);

        assert_eq!(exported.file_name, "导出.html");
        assert!(exported.size_bytes > 0);
        assert_eq!(
            fs::read_to_string(&exported_path).expect("read exported html"),
            "<!doctype html><html><body><h1>导出</h1></body></html>"
        );

        let second = RepositoryService::export_markdown_html(
            normalize_path(&file_path),
            "<!doctype html><html><body>second</body></html>".into(),
        )
        .expect("export second html");
        assert_eq!(second.file_name, "导出-2.html");

        fs::remove_dir_all(root_path).expect("cleanup temp repository");
    }

    #[test]
    fn export_html_to_path_writes_selected_html_file() {
        let root_path = temp_repository_root();
        let output_path = root_path.join("exports").join("六月合集");

        let exported = RepositoryService::export_html_to_path(
            normalize_path(&output_path),
            "<!doctype html><html><body>month</body></html>".into(),
        )
        .expect("export selected html");
        let exported_path = PathBuf::from(&exported.absolute_path);

        assert_eq!(exported.file_name, "六月合集.html");
        assert!(exported.size_bytes > 0);
        assert_eq!(
            fs::read_to_string(&exported_path).expect("read exported html"),
            "<!doctype html><html><body>month</body></html>"
        );

        fs::remove_dir_all(root_path).expect("cleanup temp repository");
    }

    #[test]
    fn export_markdown_pdf_writes_pdf_next_to_source() {
        let root_path = temp_repository_root();
        let file_path = root_path.join("文档").join("导出 PDF.md");
        fs::create_dir_all(root_path.join(".moknow")).expect("create database directory");
        fs::create_dir_all(
            file_path
                .parent()
                .expect("markdown file should have parent"),
        )
        .expect("create document directory");
        fs::write(&file_path, "# PDF Export\n").expect("write markdown");
        open_database(&root_path).expect("initialize database");

        let exported = RepositoryService::export_markdown_pdf(
            normalize_path(&file_path),
            "<!doctype html><html><body><h1>PDF Export</h1><p>Hello PDF</p></body></html>".into(),
            "PDF Export.md".into(),
        )
        .expect("export pdf");
        let exported_path = PathBuf::from(&exported.absolute_path);
        let exported_bytes = fs::read(&exported_path).expect("read exported pdf");

        assert_eq!(exported.file_name, "导出 PDF.pdf");
        assert!(exported.size_bytes > 0);
        assert!(exported_bytes.starts_with(b"%PDF-1.4"));
        assert!(String::from_utf8_lossy(&exported_bytes).contains("Hello PDF"));

        let second = RepositoryService::export_markdown_pdf(
            normalize_path(&file_path),
            "<!doctype html><html><body>second</body></html>".into(),
            "PDF Export.md".into(),
        )
        .expect("export second pdf");
        assert_eq!(second.file_name, "导出 PDF-2.pdf");

        fs::remove_dir_all(root_path).expect("cleanup temp repository");
    }

    #[test]
    fn repository_database_is_readable_as_plain_sqlite() {
        let root_path = temp_repository_root();
        fs::create_dir_all(root_path.join(".moknow")).expect("create database directory");

        let conn = open_database(&root_path).expect("initialize repository database");
        drop(conn);

        let plain_conn = rusqlite::Connection::open(root_path.join(".moknow").join("moknow.db"))
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
