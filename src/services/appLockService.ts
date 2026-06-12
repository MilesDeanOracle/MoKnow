export interface AppLockSettings {
  enabled: boolean;
  passwordHash?: string;
  passwordStorage?: "local_hash" | "system_credential";
  credentialKey?: string;
  salt?: string;
  lockOnBlur: boolean;
  idleMinutes: number;
  biometricEnabled?: boolean;
  biometricCredentialId?: string;
  biometricUserId?: string;
  recoveryCodeHash?: string;
  recoveryCodeCreatedAt?: string;
  pendingRecoveryCode?: string;
}

export interface AppLockSettingsInput {
  enabled: boolean;
  password?: string;
  lockOnBlur: boolean;
  idleMinutes: number;
  biometricEnabled?: boolean;
  resetRecoveryCode?: boolean;
  recoveryCode?: string;
}

export const APP_LOCK_STORAGE_KEY = "moknow:app-lock";
export const APP_LOCK_CREDENTIAL_KEY = "security.app-lock-password-hash";

export interface AppLockCredentialStore {
  saveSecureCredential(key: string, secret: string): Promise<unknown>;
  readSecureCredential(key: string): Promise<string | null>;
  deleteSecureCredential(key: string): Promise<unknown>;
}

export const defaultAppLockSettings: AppLockSettings = {
  enabled: false,
  lockOnBlur: true,
  idleMinutes: 10,
};

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function fromBase64Url(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

function fallbackHash(text: string) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fallback:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

async function digest(text: string) {
  if (globalThis.crypto?.subtle) {
    const encoded = new TextEncoder().encode(text);
    const digestBytes = await globalThis.crypto.subtle.digest("SHA-256", encoded);
    return `sha256:${toHex(new Uint8Array(digestBytes))}`;
  }

  return fallbackHash(text);
}

function createSalt() {
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
    return toHex(bytes);
  }

  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

function createRandomBytes(length: number) {
  const bytes = new Uint8Array(length);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  }

  for (let index = 0; index < length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

function normalizeIdleMinutes(value: number) {
  if (!Number.isFinite(value)) return defaultAppLockSettings.idleMinutes;
  return Math.min(Math.max(value, 1), 240);
}

function normalizeRecoveryCode(code: string) {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/gu, "");
}

export function createAppLockRecoveryCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = createRandomBytes(12);
  const characters = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]);
  return [
    characters.slice(0, 4).join(""),
    characters.slice(4, 8).join(""),
    characters.slice(8, 12).join(""),
  ].join("-");
}

async function hashRecoveryCode(salt: string, recoveryCode: string) {
  const normalizedCode = normalizeRecoveryCode(recoveryCode);
  if (!normalizedCode) return undefined;
  return digest(`${salt}:recovery:${normalizedCode}`);
}

function getPublicKeyCredentialApi() {
  return typeof window !== "undefined" ? window.PublicKeyCredential : undefined;
}

export async function isBiometricUnlockAvailable() {
  const publicKeyCredential = getPublicKeyCredentialApi() as (typeof PublicKeyCredential & {
    isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean>;
  }) | undefined;
  if (!publicKeyCredential || !navigator.credentials) return false;
  if (!publicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) return true;
  return publicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
}

export async function registerAppLockBiometricCredential(appName = "MoKnow") {
  if (!(await isBiometricUnlockAvailable())) {
    throw new Error("当前设备或浏览器不支持生物识别 / 设备解锁");
  }

  const userId = createRandomBytes(16);
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: createRandomBytes(32),
      rp: { name: appName },
      user: {
        id: userId,
        name: "moknow-app-lock",
        displayName: "MoKnow 应用锁",
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        residentKey: "preferred",
        userVerification: "required",
      },
      timeout: 60_000,
      attestation: "none",
    },
  });

  if (!credential || credential.type !== "public-key" || !("rawId" in credential)) {
    throw new Error("生物识别注册未完成");
  }

  return {
    biometricCredentialId: toBase64Url(new Uint8Array((credential as PublicKeyCredential).rawId)),
    biometricUserId: toBase64Url(userId),
  };
}

export function loadAppLockSettings(): AppLockSettings {
  try {
    const raw = window.localStorage.getItem(APP_LOCK_STORAGE_KEY);
    if (!raw) return defaultAppLockSettings;
    const parsed = JSON.parse(raw) as Partial<AppLockSettings>;
    const passwordStorage = parsed.passwordStorage === "system_credential" ? "system_credential" : "local_hash";
    const credentialKey = parsed.credentialKey || (passwordStorage === "system_credential" ? APP_LOCK_CREDENTIAL_KEY : undefined);
    return {
      enabled: Boolean(parsed.enabled && parsed.salt && (parsed.passwordHash || passwordStorage === "system_credential")),
      passwordHash: parsed.passwordHash,
      passwordStorage,
      credentialKey,
      salt: parsed.salt,
      lockOnBlur: parsed.lockOnBlur ?? defaultAppLockSettings.lockOnBlur,
      idleMinutes: normalizeIdleMinutes(parsed.idleMinutes ?? defaultAppLockSettings.idleMinutes),
      biometricEnabled: Boolean(parsed.biometricEnabled && parsed.biometricCredentialId),
      biometricCredentialId: parsed.biometricCredentialId,
      biometricUserId: parsed.biometricUserId,
      recoveryCodeHash: parsed.recoveryCodeHash,
      recoveryCodeCreatedAt: parsed.recoveryCodeCreatedAt,
    };
  } catch {
    return defaultAppLockSettings;
  }
}

export function saveAppLockSettings(settings: AppLockSettings) {
  const { pendingRecoveryCode: _pendingRecoveryCode, ...persistedSettings } = settings;
  window.localStorage.setItem(APP_LOCK_STORAGE_KEY, JSON.stringify(persistedSettings));
}

async function readStoredPasswordHash(settings: AppLockSettings, credentialStore?: AppLockCredentialStore): Promise<string | undefined> {
  if (settings.passwordStorage === "system_credential") {
    const credentialKey = settings.credentialKey || APP_LOCK_CREDENTIAL_KEY;
    if (credentialStore) {
      const storedHash = await credentialStore.readSecureCredential(credentialKey);
      return storedHash ?? settings.passwordHash;
    }
  }

  return settings.passwordHash;
}

export async function createAppLockSettings(
  input: AppLockSettingsInput,
  previous: AppLockSettings = loadAppLockSettings(),
  credentialStore?: AppLockCredentialStore,
): Promise<AppLockSettings> {
  const enabled = Boolean(input.enabled);
  const password = input.password?.trim();

  if (!enabled) {
    if (previous.passwordStorage === "system_credential" && credentialStore) {
      await credentialStore.deleteSecureCredential(previous.credentialKey || APP_LOCK_CREDENTIAL_KEY);
    }
    return {
      enabled: false,
      lockOnBlur: input.lockOnBlur,
      idleMinutes: normalizeIdleMinutes(input.idleMinutes),
    };
  }

  const salt = enabled && password ? createSalt() : previous.salt;
  const passwordHash = enabled && password && salt
    ? await digest(`${salt}:${password}`)
    : await readStoredPasswordHash(previous, credentialStore);

  if (!salt || !passwordHash) {
    return {
      enabled: false,
      lockOnBlur: input.lockOnBlur,
      idleMinutes: normalizeIdleMinutes(input.idleMinutes),
    };
  }

  const biometricSettings = input.biometricEnabled
    ? previous.biometricEnabled && previous.biometricCredentialId
      ? {
          biometricEnabled: true,
          biometricCredentialId: previous.biometricCredentialId,
          biometricUserId: previous.biometricUserId,
        }
      : {
          biometricEnabled: true,
          ...(await registerAppLockBiometricCredential()),
        }
    : {
        biometricEnabled: false,
        biometricCredentialId: undefined,
        biometricUserId: undefined,
      };

  const shouldResetRecoveryCode = Boolean(
    input.resetRecoveryCode
      || input.recoveryCode
      || !previous.enabled
      || !previous.recoveryCodeHash,
  );
  const pendingRecoveryCode = shouldResetRecoveryCode ? input.recoveryCode?.trim() || createAppLockRecoveryCode() : undefined;
  const recoveryCodeHash = pendingRecoveryCode
    ? await hashRecoveryCode(salt, pendingRecoveryCode)
    : previous.recoveryCodeHash;
  const recoveryCodeCreatedAt = pendingRecoveryCode
    ? new Date().toISOString()
    : previous.recoveryCodeCreatedAt;

  if (!password && previous.passwordStorage === "system_credential") {
    return {
      enabled: true,
      passwordStorage: "system_credential",
      credentialKey: previous.credentialKey || APP_LOCK_CREDENTIAL_KEY,
      salt,
      lockOnBlur: input.lockOnBlur,
      idleMinutes: normalizeIdleMinutes(input.idleMinutes),
      ...biometricSettings,
      recoveryCodeHash,
      recoveryCodeCreatedAt,
      pendingRecoveryCode,
    };
  }

  if (password && credentialStore) {
    await credentialStore.saveSecureCredential(APP_LOCK_CREDENTIAL_KEY, passwordHash);
    return {
      enabled: true,
      passwordStorage: "system_credential",
      credentialKey: APP_LOCK_CREDENTIAL_KEY,
      salt,
      lockOnBlur: input.lockOnBlur,
      idleMinutes: normalizeIdleMinutes(input.idleMinutes),
      ...biometricSettings,
      recoveryCodeHash,
      recoveryCodeCreatedAt,
      pendingRecoveryCode,
    };
  }

  return {
    enabled: true,
    passwordHash,
    passwordStorage: previous.passwordStorage ?? "local_hash",
    credentialKey: previous.credentialKey,
    salt,
    lockOnBlur: input.lockOnBlur,
    idleMinutes: normalizeIdleMinutes(input.idleMinutes),
    ...biometricSettings,
    recoveryCodeHash,
    recoveryCodeCreatedAt,
    pendingRecoveryCode,
  };
}

export async function verifyAppLockPassword(settings: AppLockSettings, password: string, credentialStore?: AppLockCredentialStore) {
  if (!settings.enabled || !settings.salt) return true;
  const storedPasswordHash = await readStoredPasswordHash(settings, credentialStore);
  if (!storedPasswordHash) return false;
  const passwordHash = await digest(`${settings.salt}:${password}`);
  return passwordHash === storedPasswordHash;
}

export async function verifyAppLockRecoveryCode(settings: AppLockSettings, recoveryCode: string) {
  if (!settings.enabled || !settings.salt || !settings.recoveryCodeHash) return false;
  const recoveryCodeHash = await hashRecoveryCode(settings.salt, recoveryCode);
  return Boolean(recoveryCodeHash && recoveryCodeHash === settings.recoveryCodeHash);
}

export async function resetAppLockPasswordWithRecovery(
  settings: AppLockSettings,
  recoveryCode: string,
  newPassword: string,
  credentialStore?: AppLockCredentialStore,
) {
  const recovered = await verifyAppLockRecoveryCode(settings, recoveryCode);
  if (!recovered) {
    throw new Error("恢复码不正确");
  }

  return createAppLockSettings({
    enabled: true,
    password: newPassword,
    lockOnBlur: settings.lockOnBlur,
    idleMinutes: settings.idleMinutes,
    biometricEnabled: settings.biometricEnabled,
    resetRecoveryCode: true,
  }, settings, credentialStore);
}

export async function verifyAppLockBiometric(settings: AppLockSettings) {
  if (!settings.enabled || !settings.biometricEnabled || !settings.biometricCredentialId) return false;
  if (!(await isBiometricUnlockAvailable())) return false;

  const credential = await navigator.credentials.get({
    publicKey: {
      challenge: createRandomBytes(32),
      allowCredentials: [{
        id: fromBase64Url(settings.biometricCredentialId),
        type: "public-key",
      }],
      userVerification: "required",
      timeout: 60_000,
    },
  });

  return Boolean(credential && credential.type === "public-key");
}
