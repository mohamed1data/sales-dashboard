'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { dateTime, num } from '../lib/format';

const BOT = process.env.NEXT_PUBLIC_BOT_USERNAME || '';
const genPassword = () => {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const a = new Uint32Array(10);
  crypto.getRandomValues(a);
  return Array.from(a, (x) => chars[x % chars.length]).join('');
};
const inviteLink = (code) => (BOT ? `https://t.me/${BOT}?start=${code}` : '');
const emptyForm = () => ({ name: '', email: '', password: genPassword(), rep_limit: '5' });

// FOUNDER PANEL: companies (tenants), their rep limit, managers and invite links
export default function Companies() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [limits, setLimits] = useState({});          // tenant_id -> text typed in the limit box
  const [mgr, setMgr] = useState(null);              // {tenant_id,email,password} add-manager form
  const [creds, setCreds] = useState(null);          // {title,email,password} shown once
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('founder_overview');
    if (error) return setErr(error.message);
    setErr(''); setRows(data);
  }, []);
  useEffect(() => { load(); }, [load]);

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(''), 5000); };

  async function callApi(payload) {
    const { data } = await supabase.auth.getSession();
    const token = data.session && data.session.access_token;
    const res = await fetch('/api/companies', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(payload) });
    let j = {};
    try { j = await res.json(); } catch (e) { /* non-JSON error page */ }
    if (!res.ok) throw new Error(j.error || 'حصل خطأ (' + res.status + ')');
    return j;
  }

  async function createCompany(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await callApi({ action: 'create', name: form.name, email: form.email, password: form.password, rep_limit: form.rep_limit });
      setCreds({ title: form.name, email: form.email.trim().toLowerCase(), password: form.password });
      setForm(emptyForm()); setShowForm(false); load();
    } catch (x) { flash(x.message); }
    setBusy(false);
  }
  async function saveLimit(r) {
    const raw = String(limits[r.tenant_id] ?? '').trim();
    const v = raw === '' ? null : Number(raw);
    if (v !== null && (!Number.isInteger(v) || v < 0)) return flash('الحد لازم يكون رقم صحيح (أو فاضي = من غير حد)');
    const { error } = await supabase.from('tenants').update({ rep_limit: v }).eq('id', r.tenant_id);
    if (error) return flash(error.message);
    setLimits((l) => { const n = { ...l }; delete n[r.tenant_id]; return n; });
    flash('✅ اتحدّث الحد'); load();
  }
  async function toggleActive(r) {
    if (!confirm(r.active ? 'إيقاف «' + r.name + '»؟ المدير والمناديب مش هيقدروا يدخلوا ولا يستخدموا البوت.' : 'تفعيل «' + r.name + '»؟')) return;
    const { error } = await supabase.from('tenants').update({ active: !r.active }).eq('id', r.tenant_id);
    if (error) return flash(error.message);
    load();
  }
  async function addManager(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await callApi({ action: 'add_manager', tenant_id: mgr.tenant_id, email: mgr.email, password: mgr.password });
      setCreds({ title: 'مدير جديد', email: mgr.email.trim().toLowerCase(), password: mgr.password });
      setMgr(null); load();
    } catch (x) { flash(x.message); }
    setBusy(false);
  }
  async function resetPassword(email) {
    if (!confirm('تغيير كلمة سر ' + email + ' لكلمة جديدة؟')) return;
    const password = genPassword();
    setBusy(true);
    try { await callApi({ action: 'reset_password', email, password }); setCreds({ title: 'كلمة سر جديدة', email, password }); }
    catch (x) { flash(x.message); }
    setBusy(false);
  }
  const copy = (t) => { navigator.clipboard && navigator.clipboard.writeText(t); flash('تم النسخ ✅'); };
  const siteUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const credsText = creds ? `رابط اللوحة: ${siteUrl}\nالإيميل: ${creds.email}\nكلمة السر: ${creds.password}` : '';

  if (err) return <div className="card err">{err}</div>;
  if (!rows) return <div className="muted">جاري التحميل…</div>;

  return (
    <>
      {msg && <div className="card" style={{ borderColor: 'var(--brand)' }}>{msg}</div>}
      {creds && (
        <div className="card" style={{ borderColor: 'var(--ok)' }}>
          <h2>🔑 {creds.title}</h2>
          <pre style={{ whiteSpace: 'pre-wrap', margin: '0 0 8px', direction: 'ltr', textAlign: 'left' }}>{credsText}</pre>
          <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>كلمة السر بتظهر هنا مرة واحدة بس. انسخها وابعتها للمدير دلوقتي.</div>
          <button className="btn primary" onClick={() => copy(credsText)}>نسخ</button>{' '}
          <button className="btn" onClick={() => setCreds(null)}>إخفاء</button>
        </div>
      )}

      <div className="card">
        <div className="top plain" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>الشركات ({rows.length})</h2>
          <button className="btn primary" onClick={() => setShowForm(!showForm)}>{showForm ? 'إغلاق' : '➕ شركة جديدة'}</button>
        </div>
        {showForm && (
          <form onSubmit={createCompany} className="row formbox">
            <input placeholder="اسم الشركة" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <input placeholder="إيميل المدير" type="email" dir="ltr" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            <input placeholder="كلمة السر (8+)" dir="ltr" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
            <button className="btn" type="button" onClick={() => setForm({ ...form, password: genPassword() })}>🎲 توليد</button>
            <input placeholder="أقصى عدد مناديب (فاضي = من غير حد)" inputMode="numeric" dir="ltr" value={form.rep_limit} onChange={(e) => setForm({ ...form, rep_limit: e.target.value })} />
            <button className="btn primary" disabled={busy}>{busy ? '…' : 'إنشاء الشركة'}</button>
            <div className="muted" style={{ fontSize: 13, flexBasis: '100%' }}>بيتعمل للمدير حساب دخول للوحة، وكل شركة بيانتها (مناديب، عملاء، أصناف، عهدة) منفصلة تمامًا عن باقي الشركات.</div>
          </form>
        )}
      </div>

      {rows.map((r) => {
        const typed = limits[r.tenant_id];
        const link = inviteLink(r.invite_code);
        const full = r.rep_limit != null && Number(r.reps_active) >= r.rep_limit;
        return (
          <div className="card" key={r.tenant_id} style={r.active ? undefined : { opacity: 0.7 }}>
            <h2>
              {r.name}
              {r.is_owner && <span className="chip confirmed" style={{ marginInlineStart: 8 }}>شركتك أنت</span>}
              {!r.active && <span className="chip cancelled" style={{ marginInlineStart: 8 }}>موقوفة</span>}
            </h2>
            <div className="kpis">
              <div className={'kpi' + (full ? ' danger' : '')}><div className="l">المناديب النشطين</div><div className="v">{num(r.reps_active)} / {r.rep_limit == null ? '∞' : num(r.rep_limit)}</div></div>
              <div className="kpi"><div className="l">زيارات مؤكدة (30 يوم)</div><div className="v">{num(r.visits_30d)}</div></div>
              <div className="kpi"><div className="l">آخر نشاط</div><div className="v" style={{ fontSize: 14 }}>{r.last_visit ? dateTime(r.last_visit) : '—'}</div></div>
            </div>
            <div className="row">
              <input style={{ maxWidth: 190 }} placeholder="حد المناديب (فاضي = بلا حد)" inputMode="numeric" dir="ltr"
                value={typed !== undefined ? typed : (r.rep_limit == null ? '' : String(r.rep_limit))}
                onChange={(e) => setLimits({ ...limits, [r.tenant_id]: e.target.value })} />
              <button className="btn ok" onClick={() => saveLimit(r)} disabled={typed === undefined}>حفظ الحد</button>
              {!r.is_owner && <button className={'btn ' + (r.active ? 'bad' : 'ok')} onClick={() => toggleActive(r)}>{r.active ? 'إيقاف الشركة' : 'تفعيل'}</button>}
            </div>
            <div className="muted" style={{ fontSize: 13 }}>
              رابط دعوة المناديب: {link ? <span dir="ltr">{link}</span> : <span dir="ltr">/start {r.invite_code}</span>}{' '}
              <button className="btn" onClick={() => copy(link || '/start ' + r.invite_code)}>نسخ</button>
              {!BOT && <div>ضيف NEXT_PUBLIC_BOT_USERNAME في Vercel عشان يظهر الرابط كامل.</div>}
            </div>
            {!r.is_owner && (
              <div style={{ marginTop: 8 }}>
                <div className="group-title">المديرين</div>
                {(r.managers || []).map((em) => (
                  <div className="row" key={em} style={{ marginBottom: 4 }}>
                    <span dir="ltr">{em}</span>
                    <button className="btn" disabled={busy} onClick={() => resetPassword(em)}>🔁 كلمة سر جديدة</button>
                  </div>
                ))}
                {mgr && mgr.tenant_id === r.tenant_id ? (
                  <form onSubmit={addManager} className="row formbox">
                    <input placeholder="إيميل المدير" type="email" dir="ltr" value={mgr.email} onChange={(e) => setMgr({ ...mgr, email: e.target.value })} required />
                    <input placeholder="كلمة السر" dir="ltr" value={mgr.password} onChange={(e) => setMgr({ ...mgr, password: e.target.value })} required />
                    <button className="btn primary" disabled={busy}>إضافة</button>
                    <button className="btn" type="button" onClick={() => setMgr(null)}>إلغاء</button>
                  </form>
                ) : <button className="btn" onClick={() => setMgr({ tenant_id: r.tenant_id, email: '', password: genPassword() })}>➕ مدير إضافي</button>}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
