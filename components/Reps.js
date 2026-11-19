'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { dateTime, dayKey, todayKey, mapsLink, num } from '../lib/format';

const emptyForm = { name: '', telegram_id: '', phone: '' };
const BOT = process.env.NEXT_PUBLIC_BOT_USERNAME || '';
const genPassword = () => {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const a = new Uint32Array(10);
  crypto.getRandomValues(a);
  return Array.from(a, (x) => chars[x % chars.length]).join('');
};

export default function Reps({ tenant }) {
  const [rows, setRows] = useState(null);
  const [requests, setRequests] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [edit, setEdit] = useState({ name: '', phone: '' });
  const [acctId, setAcctId] = useState(null);           // rep whose login form is open
  const [acct, setAcct] = useState({ email: '', password: '' });
  const [creds, setCreds] = useState(null);             // {name,email,password} shown once after create/reset
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 2 * 86400000).toISOString();
    const [r, s, v, q] = await Promise.all([
      supabase.from('reps').select('id,name,telegram_id,phone,active,email,auth_user_id').order('name'),
      supabase.from('rep_sessions').select('rep_id,lat,lng,location_at'),
      supabase.from('visits').select('rep_id,created_at,status').gte('created_at', since).neq('status', 'cancelled').limit(1000),
      supabase.from('rep_requests').select('telegram_id,first_name,last_name,username,last_seen').order('last_seen', { ascending: false }),
    ]);
    const e = r.error || s.error || v.error || q.error;
    if (e) return setErr(e.message);
    const sess = Object.fromEntries(s.data.map((x) => [x.rep_id, x]));
    const t = todayKey();
    setErr('');
    setRequests(q.data);
    setRows(r.data.map((x) => {
      const mine = v.data.filter((y) => y.rep_id === x.id && dayKey(y.created_at) === t);
      return { ...x, sess: sess[x.id], today: mine.filter((y) => y.status === 'confirmed').length, drafts: mine.filter((y) => y.status === 'draft').length };
    }));
  }, []);
  useEffect(() => { load(); }, [load]);

  function flash(m) { setMsg(m); setTimeout(() => setMsg(''), 5000); }

  async function addRep(e) {
    e.preventDefault();
    const tid = Number(String(form.telegram_id).trim());
    if (!form.name.trim()) return flash('اكتب اسم المندوب');
    if (!Number.isInteger(tid) || tid <= 0) return flash('رقم تليجرام لازم يكون أرقام بس');
    const { error } = await supabase.from('reps').insert({ name: form.name.trim(), telegram_id: tid, phone: form.phone.trim() || null });
    if (error) return flash(error.code === '23505' ? 'رقم تليجرام ده مسجّل قبل كده' : error.message);
    await supabase.from('rep_requests').delete().eq('telegram_id', tid);
    setForm(emptyForm); setShowForm(false); flash('✅ تمت إضافة المندوب. يبعت /start للبوت وهيشتغل.');
    load();
  }
  function fromRequest(q) {
    setForm({ name: [q.first_name, q.last_name].filter(Boolean).join(' '), telegram_id: String(q.telegram_id), phone: '' });
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  async function dismiss(q) {
    if (!confirm('تجاهل الطلب ده؟')) return;
    await supabase.from('rep_requests').delete().eq('telegram_id', q.telegram_id);
    load();
  }
  async function toggleActive(r) {
    if (!confirm(r.active ? 'إيقاف ' + r.name + '؟ مش هيقدر يستخدم البوت ولا اللوحة.' : 'تفعيل ' + r.name + '؟')) return;
    const { error } = await supabase.from('reps').update({ active: !r.active }).eq('id', r.id);
    if (error) return flash(error.message);
    load();
  }
  async function saveEdit(r) {
    if (!edit.name.trim()) return flash('الاسم مطلوب');
    const { error } = await supabase.from('reps').update({ name: edit.name.trim(), phone: edit.phone.trim() || null }).eq('id', r.id);
    if (error) return flash(error.message);
    setEditId(null); load();
  }

  // ----- login accounts (server route, needs SUPABASE_SECRET_KEY in Vercel) -----
  async function callAccount(payload) {
    const { data } = await supabase.auth.getSession();
    const token = data.session && data.session.access_token;
    const res = await fetch('/api/rep-account', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(payload) });
    let j = {};
    try { j = await res.json(); } catch (e) { /* non-JSON error page */ }
    if (!res.ok) throw new Error(j.error || 'حصل خطأ (' + res.status + ')');
    return j;
  }
  async function createAccount(r) {
    setBusy(true);
    try {
      await callAccount({ action: 'create', rep_id: r.id, email: acct.email, password: acct.password });
      setCreds({ name: r.name, email: acct.email.trim().toLowerCase(), password: acct.password });
      setAcctId(null); setAcct({ email: '', password: '' }); load();
    } catch (e) { flash(e.message); }
    setBusy(false);
  }
  async function resetPassword(r) {
    const pw = genPassword();
    if (!confirm('تغيير كلمة سر ' + r.name + ' لكلمة جديدة؟')) return;
    setBusy(true);
    try {
      await callAccount({ action: 'reset', rep_id: r.id, password: pw });
      setCreds({ name: r.name, email: r.email, password: pw });
    } catch (e) { flash(e.message); }
    setBusy(false);
  }
  async function removeAccount(r) {
    if (!confirm('حذف حساب دخول ' + r.name + ' من اللوحة؟ (المندوب نفسه والبوت مش هيتأثروا)')) return;
    setBusy(true);
    try { await callAccount({ action: 'remove', rep_id: r.id }); flash('تم حذف الحساب'); load(); } catch (e) { flash(e.message); }
    setBusy(false);
  }
  async function deleteRep(r) {
    setBusy(true);
    try {
      const count = async (table) => (await supabase.from(table).select('id', { count: 'exact', head: true }).eq('rep_id', r.id)).count || 0;
      const [v, st, c] = await Promise.all([count('visits'), count('stock_issues'), count('collections')]);
      const lines = [
        'حذف «' + r.name + '» نهائيًا؟', '',
        'هيتمسح: المندوب ورقم تليجرام بتاعه' + (r.auth_user_id ? ' وحساب دخوله' : '') + '.',
        v + st + c > 0 ? 'سجلاته (' + v + ' زيارة، ' + st + ' فاتورة، ' + c + ' تحصيل) هتفضل في النظام باسم «مندوب محذوف» عشان حسابات العملاء ما تتغيرش.' : 'مفيش له أي سجلات.',
        '', 'مينفعش التراجع.',
      ];
      if (!confirm(lines.join('\n'))) { setBusy(false); return; }
      const typed = prompt('للتأكيد اكتب اسم المندوب بالظبط:\n' + r.name);
      if (typed === null) { setBusy(false); return; }
      if (typed.trim() !== r.name.trim()) { flash('الاسم غير مطابق، اتلغى الحذف'); setBusy(false); return; }
      await callAccount({ action: 'delete', rep_id: r.id });
      flash('🗑 تم حذف المندوب نهائيًا');
      load();
    } catch (e) { flash(e.message); }
    setBusy(false);
  }
  const siteUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const credsText = creds ? `رابط اللوحة: ${siteUrl}\nالإيميل: ${creds.email}\nكلمة السر: ${creds.password}` : '';

  if (err) return <div className="card err">{err}</div>;
  if (!rows) return <div className="muted">جاري التحميل…</div>;
  const activeCount = rows.filter((x) => x.active).length;
  const limit = tenant && tenant.rep_limit != null ? tenant.rep_limit : null;
  const full = limit !== null && activeCount >= limit;
  const code = tenant && tenant.invite_code;
  const invite = code ? (BOT ? `https://t.me/${BOT}?start=${code}` : '/start ' + code) : '';

  return (
    <>
      {msg && <div className="card" style={{ borderColor: 'var(--brand)' }}>{msg}</div>}

      {creds && (
        <div className="card" style={{ borderColor: 'var(--ok)' }}>
          <h2>🔑 بيانات دخول {creds.name}</h2>
          <pre style={{ whiteSpace: 'pre-wrap', margin: '0 0 8px', direction: 'ltr', textAlign: 'left' }}>{credsText}</pre>
          <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>كلمة السر بتظهر هنا مرة واحدة بس. انسخها وابعتها للمندوب دلوقتي.</div>
          <button className="btn primary" onClick={() => { navigator.clipboard && navigator.clipboard.writeText(credsText); flash('تم النسخ ✅'); }}>نسخ</button>{' '}
          <button className="btn" onClick={() => setCreds(null)}>إخفاء</button>
        </div>
      )}

      {invite && (
        <div className="card">
          <h2>🔗 رابط دعوة المناديب</h2>
          <div className="muted" style={{ fontSize: 13, marginBottom: 6 }}>ابعته للمندوب الجديد: لما يفتحه ويدوس Start بيظهر طلبه هنا وتضيفه بضغطة.{!BOT && ' (ضيف NEXT_PUBLIC_BOT_USERNAME في Vercel عشان يبقى رابط كامل)'}</div>
          <pre style={{ whiteSpace: 'pre-wrap', margin: '0 0 8px', direction: 'ltr', textAlign: 'left' }}>{invite}</pre>
          <button className="btn" onClick={() => { navigator.clipboard && navigator.clipboard.writeText(invite); flash('تم النسخ ✅'); }}>نسخ</button>
        </div>
      )}

      {requests.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--warn)' }}>
          <h2>🔔 طلبات انضمام ({requests.length})</h2>
          <div className="muted" style={{ fontSize: 13, marginBottom: 6 }}>ناس بعتوا للبوت وهو مش مسجّلهم. دوس «إضافة» لو ده مندوب عندك.</div>
          {requests.map((q) => (
            <div className="visit" key={q.telegram_id} style={{ cursor: 'default' }}>
              <div className="head">
                <div>
                  <b>{[q.first_name, q.last_name].filter(Boolean).join(' ') || 'بدون اسم'}</b>{q.username && <span className="muted"> @{q.username}</span>}
                  <div className="muted" style={{ fontSize: 13 }}><span dir="ltr">{q.telegram_id}</span> · {dateTime(q.last_seen)}</div>
                </div>
                <div style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn ok" onClick={() => fromRequest(q)}>إضافة</button>{' '}
                  <button className="btn bad" onClick={() => dismiss(q)}>تجاهل</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="top plain" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>المناديب{limit !== null ? ` (${activeCount}/${limit})` : ''}</h2>
          <button className="btn primary" disabled={full && !showForm} onClick={() => setShowForm(!showForm)}>{showForm ? 'إغلاق' : '➕ إضافة مندوب'}</button>
        </div>
        {full && <div className="card" style={{ borderColor: 'var(--warn)' }}>وصلت للحد الأقصى من المناديب ({limit}). لو عايز تزوّد كلّم المؤسس.</div>}

        {showForm && (
          <form onSubmit={addRep} className="row formbox">
            <input placeholder="اسم المندوب" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <input placeholder="رقم تليجرام (ID)" inputMode="numeric" dir="ltr" value={form.telegram_id} onChange={(e) => setForm({ ...form, telegram_id: e.target.value })} required />
            <input placeholder="تليفون (اختياري)" dir="ltr" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <button className="btn primary">حفظ</button>
            <div className="muted" style={{ fontSize: 13, flexBasis: '100%' }}>المندوب يبعت /start للبوت، فيظهر طلبه فوق وتضيفه بضغطة، أو خد رقمه منه واكتبه هنا.</div>
          </form>
        )}

        <table className="table stack">
          <thead><tr><th>المندوب</th><th>رقم تليجرام</th><th>النهارده</th><th>غير مؤكدة</th><th>آخر موقع</th><th>حساب الدخول</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td data-label="">
                  {editId === r.id ? (
                    <div className="row" style={{ marginBottom: 0 }}>
                      <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
                      <input placeholder="تليفون" dir="ltr" value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} />
                    </div>
                  ) : (
                    <><b>{r.name}</b>{!r.active && <span className="chip cancelled" style={{ marginInlineStart: 6 }}>موقوف</span>}{r.phone && <div className="muted" style={{ fontSize: 13 }} dir="ltr">{r.phone}</div>}</>
                  )}
                </td>
                <td data-label="رقم تليجرام" dir="ltr" style={{ textAlign: 'right' }}>{r.telegram_id}</td>
                <td data-label="النهارده">{num(r.today)}</td>
                <td data-label="غير مؤكدة">{r.drafts > 0 ? <span className="chip draft">{r.drafts}</span> : '0'}</td>
                <td data-label="آخر موقع">
                  {r.sess && r.sess.location_at ? (
                    <>{dateTime(r.sess.location_at)} {mapsLink(r.sess.lat, r.sess.lng) && <a className="iconlink" href={mapsLink(r.sess.lat, r.sess.lng)} target="_blank" rel="noreferrer">📍</a>}</>
                  ) : <span className="muted">—</span>}
                </td>
                <td data-label="حساب الدخول">
                  {r.auth_user_id ? (
                    <div>
                      <div dir="ltr" style={{ textAlign: 'right', fontSize: 13, overflowWrap: 'anywhere' }}>{r.email}</div>
                      <button className="btn" disabled={busy} onClick={() => resetPassword(r)}>🔁 كلمة سر جديدة</button>{' '}
                      <button className="btn bad" disabled={busy} onClick={() => removeAccount(r)}>حذف</button>
                    </div>
                  ) : acctId === r.id ? (
                    <div className="row" style={{ marginBottom: 0 }}>
                      <input placeholder="إيميل المندوب" type="email" dir="ltr" value={acct.email} onChange={(e) => setAcct({ ...acct, email: e.target.value })} />
                      <input placeholder="كلمة السر (8+)" dir="ltr" value={acct.password} onChange={(e) => setAcct({ ...acct, password: e.target.value })} />
                      <button className="btn" type="button" onClick={() => setAcct({ ...acct, password: genPassword() })}>🎲 توليد</button>
                      <button className="btn primary" disabled={busy} onClick={() => createAccount(r)}>{busy ? '…' : 'إنشاء'}</button>
                      <button className="btn" onClick={() => setAcctId(null)}>إلغاء</button>
                    </div>
                  ) : (
                    <button className="btn" onClick={() => { setAcctId(r.id); setAcct({ email: '', password: genPassword() }); }}>➕ إنشاء حساب</button>
                  )}
                </td>
                <td data-label="" style={{ whiteSpace: 'nowrap' }}>
                  {editId === r.id ? (
                    <><button className="btn ok" onClick={() => saveEdit(r)}>حفظ</button> <button className="btn" onClick={() => setEditId(null)}>إلغاء</button></>
                  ) : (
                    <><button className="btn" onClick={() => { setEditId(r.id); setEdit({ name: r.name, phone: r.phone || '' }); }}>تعديل</button>{' '}
                      <button className={'btn ' + (r.active ? 'bad' : 'ok')} onClick={() => toggleActive(r)}>{r.active ? 'إيقاف' : 'تفعيل'}</button>{' '}
                      <button className="btn bad" disabled={busy} onClick={() => deleteRep(r)}>🗑 حذف نهائي</button></>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div className="muted">مفيش مناديب لسه. دوس «إضافة مندوب».</div>}
      </div>
    </>
  );
}
