use keyring::{Entry, Error};

const SERVICE_NAME: &str = "MoKnow";
const KEY_PREFIX: &str = "moknow";

pub fn normalize_credential_key(key: &str) -> Result<String, String> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return Err("凭据键不能为空".into());
    }
    if trimmed.len() > 120 {
        return Err("凭据键不能超过 120 个字符".into());
    }
    if !trimmed.chars().all(|character| {
        character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-' | ':')
    }) {
        return Err("凭据键只能包含英文字母、数字、点、下划线、中划线或冒号".into());
    }

    Ok(format!("{KEY_PREFIX}:{trimmed}"))
}

fn credential_entry(key: &str) -> Result<Entry, String> {
    let account = normalize_credential_key(key)?;
    Entry::new(SERVICE_NAME, &account).map_err(|error| format!("无法连接系统凭据管理器：{error}"))
}

pub struct CredentialService;

impl CredentialService {
    pub fn save(key: String, secret: String) -> Result<bool, String> {
        if secret.is_empty() {
            return Err("凭据内容不能为空".into());
        }
        credential_entry(&key)?
            .set_password(&secret)
            .map_err(|error| format!("保存系统凭据失败：{error}"))?;
        Ok(true)
    }

    pub fn read(key: String) -> Result<Option<String>, String> {
        match credential_entry(&key)?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(Error::NoEntry) => Ok(None),
            Err(error) => Err(format!("读取系统凭据失败：{error}")),
        }
    }

    pub fn delete(key: String) -> Result<bool, String> {
        match credential_entry(&key)?.delete_credential() {
            Ok(()) => Ok(true),
            Err(Error::NoEntry) => Ok(false),
            Err(error) => Err(format!("删除系统凭据失败：{error}")),
        }
    }

    pub fn exists(key: String) -> Result<bool, String> {
        Self::read(key).map(|secret| secret.is_some())
    }
}

#[cfg(test)]
mod tests {
    use super::normalize_credential_key;

    #[test]
    fn credential_keys_are_namespaced_and_validated() {
        assert_eq!(
            normalize_credential_key("ai.openai-api-key").unwrap(),
            "moknow:ai.openai-api-key"
        );
        assert!(normalize_credential_key("  ").is_err());
        assert!(normalize_credential_key("ai key").is_err());
    }
}
