import { Button, Input } from "antd";
import { useState } from "react";

interface AppLockOverlayProps {
  biometricEnabled?: boolean;
  error?: string;
  loading: boolean;
  recoveryAvailable?: boolean;
  onBiometricUnlock?: () => void;
  onResetPassword?: (input: { recoveryCode: string; newPassword: string }) => void;
  onUnlock: (password: string) => void;
}

export function AppLockOverlay({
  biometricEnabled,
  error,
  loading,
  recoveryAvailable,
  onBiometricUnlock,
  onResetPassword,
  onUnlock,
}: AppLockOverlayProps) {
  const [password, setPassword] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetError, setResetError] = useState("");

  const submit = () => {
    onUnlock(password);
  };

  const submitReset = () => {
    if (!recoveryCode.trim()) {
      setResetError("请输入恢复码");
      return;
    }
    if (!newPassword.trim()) {
      setResetError("请输入新密码");
      return;
    }
    if (newPassword !== confirmPassword) {
      setResetError("两次输入的新密码不一致");
      return;
    }
    setResetError("");
    onResetPassword?.({ recoveryCode, newPassword });
  };

  return (
    <section className="app-lock-overlay" role="dialog" aria-modal="true" aria-label="MoKnow 已锁定">
      <div className="app-lock-panel">
        <div className="app-lock-mark" aria-hidden="true">锁</div>
        <h2>MoKnow 已锁定</h2>
        <p>输入应用锁密码后继续记录。</p>
        <Input.Password
          aria-label="解锁密码"
          autoFocus
          autoComplete="current-password"
          status={error ? "error" : undefined}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          onPressEnter={submit}
        />
        {error ? <p className="app-lock-error">{error}</p> : null}
        <Button type="primary" block loading={loading} onClick={submit}>
          解锁
        </Button>
        {biometricEnabled ? (
          <Button className="app-lock-secondary-action" block disabled={loading} onClick={onBiometricUnlock}>
            使用生物识别解锁
          </Button>
        ) : null}
        {recoveryAvailable ? (
          <Button className="app-lock-link-action" type="link" block disabled={loading} onClick={() => setResetOpen((current) => !current)}>
            忘记密码？使用恢复码重置
          </Button>
        ) : null}
        {resetOpen ? (
          <div className="app-lock-reset-panel">
            <Input
              aria-label="应用锁恢复码"
              autoComplete="one-time-code"
              placeholder="恢复码"
              value={recoveryCode}
              onChange={(event) => setRecoveryCode(event.target.value)}
            />
            <Input.Password
              aria-label="新的应用锁密码"
              autoComplete="new-password"
              placeholder="新的应用锁密码"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
            <Input.Password
              aria-label="确认新的应用锁密码"
              autoComplete="new-password"
              placeholder="确认新的应用锁密码"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              onPressEnter={submitReset}
            />
            {resetError ? <p className="app-lock-error">{resetError}</p> : null}
            <Button block loading={loading} onClick={submitReset}>
              重置并解锁
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
