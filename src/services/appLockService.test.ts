import { afterEach, describe, expect, it, vi } from "vitest";
import {
  APP_LOCK_CREDENTIAL_KEY,
  APP_LOCK_STORAGE_KEY,
  createAppLockSettings,
  defaultAppLockSettings,
  loadAppLockSettings,
  resetAppLockPasswordWithRecovery,
  saveAppLockSettings,
  verifyAppLockBiometric,
  verifyAppLockPassword,
  verifyAppLockRecoveryCode,
} from "./appLockService";

describe("appLockService", () => {
  const originalPublicKeyCredential = window.PublicKeyCredential;
  const originalCredentials = navigator.credentials;

  afterEach(() => {
    window.localStorage.removeItem(APP_LOCK_STORAGE_KEY);
    Object.defineProperty(window, "PublicKeyCredential", {
      configurable: true,
      value: originalPublicKeyCredential,
    });
    Object.defineProperty(navigator, "credentials", {
      configurable: true,
      value: originalCredentials,
    });
    vi.restoreAllMocks();
  });

  it("stores new app lock password hashes in the secure credential store", async () => {
    const credentials = new Map<string, string>();
    const credentialStore = {
      saveSecureCredential: vi.fn(async (key: string, secret: string) => {
        credentials.set(key, secret);
      }),
      readSecureCredential: vi.fn(async (key: string) => credentials.get(key) ?? null),
      deleteSecureCredential: vi.fn(async (key: string) => {
        credentials.delete(key);
      }),
    };

    const settings = await createAppLockSettings({
      enabled: true,
      password: "secret",
      lockOnBlur: true,
      idleMinutes: 15,
    }, defaultAppLockSettings, credentialStore);

    expect(settings).toMatchObject({
      enabled: true,
      passwordStorage: "system_credential",
      credentialKey: APP_LOCK_CREDENTIAL_KEY,
    });
    expect(settings.passwordHash).toBeUndefined();
    expect(credentialStore.saveSecureCredential).toHaveBeenCalledWith(APP_LOCK_CREDENTIAL_KEY, expect.stringMatching(/^sha256:|^fallback:/));
    await expect(verifyAppLockPassword(settings, "secret", credentialStore)).resolves.toBe(true);
    await expect(verifyAppLockPassword(settings, "bad", credentialStore)).resolves.toBe(false);
  });

  it("keeps legacy local hashes readable for startup unlock compatibility", async () => {
    const legacySettings = await createAppLockSettings({
      enabled: true,
      password: "legacy",
      lockOnBlur: true,
      idleMinutes: 10,
    });
    saveAppLockSettings(legacySettings);

    const loaded = loadAppLockSettings();

    expect(loaded.passwordStorage).toBe("local_hash");
    expect(loaded.passwordHash).toBeTruthy();
    await expect(verifyAppLockPassword(loaded, "legacy")).resolves.toBe(true);
  });

  it("removes secure credentials when disabling the app lock", async () => {
    const credentialStore = {
      saveSecureCredential: vi.fn(async () => {}),
      readSecureCredential: vi.fn(async () => "sha256:existing"),
      deleteSecureCredential: vi.fn(async () => {}),
    };
    const settings = {
      enabled: true,
      passwordStorage: "system_credential" as const,
      credentialKey: APP_LOCK_CREDENTIAL_KEY,
      salt: "salt",
      lockOnBlur: true,
      idleMinutes: 10,
    };

    const disabled = await createAppLockSettings({
      enabled: false,
      lockOnBlur: true,
      idleMinutes: 10,
    }, settings, credentialStore);

    expect(disabled.enabled).toBe(false);
    expect(credentialStore.deleteSecureCredential).toHaveBeenCalledWith(APP_LOCK_CREDENTIAL_KEY);
  });

  it("uses a recovery code to reset the app lock password", async () => {
    const settings = await createAppLockSettings({
      enabled: true,
      password: "secret",
      recoveryCode: "ABCD-EFGH-IJKL",
      lockOnBlur: true,
      idleMinutes: 10,
    });

    expect(settings.pendingRecoveryCode).toBe("ABCD-EFGH-IJKL");
    await expect(verifyAppLockRecoveryCode(settings, "abcd efgh ijkl")).resolves.toBe(true);

    saveAppLockSettings(settings);
    expect(window.localStorage.getItem(APP_LOCK_STORAGE_KEY)).not.toContain("pendingRecoveryCode");
    expect(window.localStorage.getItem(APP_LOCK_STORAGE_KEY)).not.toContain("ABCD-EFGH-IJKL");

    const resetSettings = await resetAppLockPasswordWithRecovery(settings, "ABCD-EFGH-IJKL", "new-secret");

    await expect(verifyAppLockPassword(resetSettings, "secret")).resolves.toBe(false);
    await expect(verifyAppLockPassword(resetSettings, "new-secret")).resolves.toBe(true);
    expect(resetSettings.pendingRecoveryCode).toBeTruthy();
    await expect(resetAppLockPasswordWithRecovery(settings, "bad-code", "new-secret")).rejects.toThrow("恢复码不正确");
  });

  it("registers and verifies a platform biometric credential", async () => {
    const rawId = new Uint8Array([1, 2, 3, 4]).buffer;
    const createCredential = vi.fn(async () => ({ type: "public-key", rawId }));
    const getCredential = vi.fn(async () => ({ type: "public-key", rawId }));

    Object.defineProperty(window, "PublicKeyCredential", {
      configurable: true,
      value: {
        isUserVerifyingPlatformAuthenticatorAvailable: vi.fn(async () => true),
      },
    });
    Object.defineProperty(navigator, "credentials", {
      configurable: true,
      value: {
        create: createCredential,
        get: getCredential,
      },
    });

    const settings = await createAppLockSettings({
      enabled: true,
      password: "secret",
      biometricEnabled: true,
      lockOnBlur: true,
      idleMinutes: 10,
    });

    expect(settings.biometricEnabled).toBe(true);
    expect(settings.biometricCredentialId).toBe("AQIDBA");
    expect(createCredential).toHaveBeenCalledWith(expect.objectContaining({
      publicKey: expect.objectContaining({
        authenticatorSelection: expect.objectContaining({
          authenticatorAttachment: "platform",
          userVerification: "required",
        }),
      }),
    }));

    await expect(verifyAppLockBiometric(settings)).resolves.toBe(true);
    expect(getCredential).toHaveBeenCalledWith(expect.objectContaining({
      publicKey: expect.objectContaining({
        userVerification: "required",
      }),
    }));
  });
});
