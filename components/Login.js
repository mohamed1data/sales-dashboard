'use client';

import { useState } from 'react';
import { supabase, APP_NAME, CONFIGURED } from '../lib/supabase';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      const m = String(error.message || '');
      if (/fetch|network|failed/i.test(m) || error.status === 0) setErr('مش قادر أتصل بـ Supabase. راجع المتغيرات في Vercel وبعدها اعمل Redeploy.');
      else if (/confirm/i.test(m)) setErr('الإيميل لسه مش مؤكد. فعّل Auto Confirm للمستخدم في Supabase.');
      else setErr('الإيميل أو كلمة السر غلط (' + m + ')');
    }
    setBusy(false);
  }

  return (
    <div className="center">
      <form className="card login" onSubmit={submit}>
        <h2>{APP_NAME}</h2>
        {!CONFIGURED && <div className="err">⚠️ متغيرات Supabase مش واصلة للتطبيق (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY). ضيفهم في Vercel واعمل Redeploy.</div>}
        <input type="email" placeholder="الإيميل" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
        <input type="password" placeholder="كلمة السر" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
        {err && <div className="err">{err}</div>}
        <button className="btn primary" style={{ width: '100%' }} disabled={busy}>{busy ? '…' : 'دخول'}</button>
      </form>
    </div>
  );
}
