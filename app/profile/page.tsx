"use client";
import { type FormEvent, useEffect, useState } from "react";
import PasswordField from "../password-field";

type Profile = { name: string; username: string; employeeNo: string; role: string; mustChangePassword: boolean; recoveryEmail: string | null; recoveryEmailVerifiedAt: string | null };
const roles: Record<string, string> = { admin: "管理员", ceo: "CEO", management: "管理层", employee: "员工", cost_accountant: "核算人员" };
export default function ProfilePage() {
  const [user, setUser] = useState<Profile | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [code, setCode] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailNotice, setEmailNotice] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    void fetch("/api/profile").then(async response => {
      if (response.status === 401) { window.location.assign("/"); return; }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "个人资料加载失败。");
      setUser(data.user); setEmail(data.user.recoveryEmail || "");
    }).catch(() => setError("个人资料加载失败，请刷新重试。"));
  }, []);
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (busy) return;
    setError("");
    if (password !== confirmPassword) { setError("两次新密码输入不一致。"); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword, password, confirmPassword }) });
      if (response.status === 401) { window.location.assign("/"); return; }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "修改密码失败，请重试。");
      setCurrentPassword(""); setPassword(""); setConfirmPassword(""); setSaved(true);
    } catch (error) { setError(error instanceof Error ? error.message : "修改密码失败，请检查网络。"); }
    finally { setBusy(false); }
  };
  const bindEmail = async (event: FormEvent, verifying: boolean) => {
    event.preventDefault(); if (emailBusy) return;
    setError(""); setEmailNotice(""); setEmailBusy(true);
    try {
      const response = await fetch("/api/profile/email", { method: verifying ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(verifying ? { code } : { email, currentPassword: emailPassword }) });
      if (response.status === 401) { window.location.assign("/"); return; }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "邮箱绑定失败，请重试。");
      if (verifying) {
        setUser(user ? { ...user, recoveryEmail: data.recoveryEmail, recoveryEmailVerifiedAt: new Date().toISOString() } : user);
        setEmailSent(false); setCode(""); setEmailPassword(""); setEmailNotice("邮箱已验证，可用于找回密码。");
      } else { setEmailSent(true); setCode(""); setEmailNotice("验证邮件已提交发送，请查收验证码（10 分钟有效）。"); }
    } catch (error) { setError(error instanceof Error ? error.message : "邮箱绑定失败，请检查网络。"); }
    finally { setEmailBusy(false); }
  };
  return <main className="personnelPage profilePage">
    <header className="personnelHeader"><div><a href="/">返回报价系统</a><h1>{user?.mustChangePassword ? "设置你的新密码" : "个人资料"}</h1>{user?.mustChangePassword && <p>初始密码仅用于首次登录，请设置自己的密码后继续使用系统。新密码至少 6 位。</p>}</div>{user?.mustChangePassword && <button type="button" className="outline" onClick={() => { void fetch("/api/auth/logout", { method: "POST" }).then(() => window.location.assign("/")); }}>退出登录</button>}</header>
    {error && <p className="loginError" role="alert">{error}</p>}
    {saved ? <section role="status"><p>密码已修改，请使用新密码重新登录。</p><a className="primary" href="/">返回登录</a></section> : user ? <>
      <dl className="profileDetails"><div><dt>姓名</dt><dd>{user.name}</dd></div><div><dt>工号</dt><dd>{user.employeeNo || "未填写"}</dd></div><div><dt>用户名</dt><dd>{user.username}</dd></div><div><dt>角色</dt><dd>{roles[user.role] || user.role}</dd></div></dl>
      {!user.mustChangePassword && <section aria-label="找回密码邮箱">
        <h2>邮箱</h2><p>{user.recoveryEmail || "未绑定邮箱"} · {user.recoveryEmailVerifiedAt ? "已验证" : "待验证"}</p>
        <form className="accountEdit" onSubmit={event => void bindEmail(event, false)}>
          <label>找回密码邮箱<input type="email" required autoComplete="email" maxLength={254} value={email} onChange={event => { setEmail(event.target.value); setEmailSent(false); setCode(""); }} /></label>
          <PasswordField id="email-current-password" label="原密码（用于确认本人操作）" value={emailPassword} onChange={setEmailPassword} autoComplete="current-password" required />
          <button className="outline" type="submit" disabled={emailBusy}>{emailBusy ? "处理中…" : emailSent ? "重新发送验证码" : "发送邮箱验证码"}</button>
        </form>
        {emailSent && <form className="accountEdit" onSubmit={event => void bindEmail(event, true)}>
          <label>邮箱验证码<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={event => setCode(event.target.value)} /></label>
          <button className="primary" type="submit" disabled={emailBusy}>{emailBusy ? "验证中…" : "验证并绑定邮箱"}</button>
        </form>}
        {emailNotice && <p role="status">{emailNotice}</p>}
      </section>}
      <form className="accountEdit" onSubmit={event => void save(event)}>
        <h2>修改密码</h2><p>新密码至少 6 位，修改后需要重新登录。</p>
        <PasswordField id="profile-current-password" label="原密码" value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" required />
        <PasswordField id="profile-password" label="新密码" value={password} onChange={setPassword} autoComplete="new-password" minLength={6} required />
        <PasswordField id="profile-confirm-password" label="确认新密码" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" minLength={6} required />
        <button className="primary" type="submit" disabled={busy}>{busy ? "保存中…" : "保存新密码"}</button>
      </form>
    </> : !error && <p role="status">正在加载个人资料…</p>}
  </main>;
}
