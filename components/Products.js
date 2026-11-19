'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { money, num, unitAr, dateTime } from '../lib/format';

const UNITS = ['كرتونة', 'علبة', 'باكو', 'قطعة', 'كيس', 'دستة', 'شوال', 'زجاجة', 'كيلو'];
const emptyForm = { id: null, name: '', aliases: '', unit: '', alt: [], default_price: '', min_price: '', cost_price: '', active: true };
const latin = (s) => String(s ?? '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/٫/g, '.').replace(/،/g, ',');
const toNum = (v) => { const t = latin(v).trim(); if (t === '') return null; const n = Number(t); return Number.isFinite(n) ? n : NaN; };

export default function Products() {
  const [rows, setRows] = useState(null);
  const [costs, setCosts] = useState({});
  const [requests, setRequests] = useState([]);
  const [q, setQ] = useState('');
  const [onlyActive, setOnlyActive] = useState(true);
  const [form, setForm] = useState(null);          // null = closed
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    const [p, c, r] = await Promise.all([
      supabase.from('products').select('id,name,aliases,unit,alt_units,default_price,min_price,active').order('name'),
      supabase.from('product_costs').select('product_id,cost_price'),
      supabase.from('product_requests').select('name,last_seen').order('last_seen', { ascending: false }),
    ]);
    if (p.error) return setErr(p.error.message + ' — شغّل catalog.sql في Supabase لو لسه ما اتشغّلش.');
    setErr('');
    setRows(p.data);
    setCosts(Object.fromEntries((c.data || []).map((x) => [x.product_id, x.cost_price])));
    setRequests(r.error ? [] : r.data);
  }, []);
  useEffect(() => { load(); }, [load]);

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(''), 6000); };

  const shown = useMemo(() => (rows || []).filter((r) => (!onlyActive || r.active) && (!q || (r.name + ' ' + (r.aliases || []).join(' ')).includes(q))), [rows, q, onlyActive]);

  function openNew(name = '') { setForm({ ...emptyForm, name }); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  function openEdit(r) {
    setForm({ id: r.id, name: r.name, aliases: (r.aliases || []).join('، '), unit: r.unit || '',
      alt: (r.alt_units || []).map((a) => ({ name: a.name, factor: String(a.factor) })),
      default_price: r.default_price ?? '', min_price: r.min_price ?? '', cost_price: costs[r.id] ?? '', active: r.active });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function save(e) {
    e.preventDefault();
    const name = form.name.trim(), unit = form.unit.trim();
    if (!name) return flash('اكتب اسم الصنف');
    if (!unit) return flash('اكتب الوحدة الأساسية (الوحدة اللي بيتحسب بيها المخزون)');
    const alt = form.alt.filter((a) => a.name.trim()).map((a) => ({ name: a.name.trim(), factor: toNum(a.factor) }));
    if (alt.some((a) => !(a.factor > 0))) return flash('معامل التحويل لازم يكون رقم أكبر من صفر (مثلًا الكرتونة = 24)');
    const dp = toNum(form.default_price), mp = toNum(form.min_price), cp = toNum(form.cost_price);
    if ([dp, mp, cp].some((v) => Number.isNaN(v) || (v !== null && v < 0))) return flash('الأسعار لازم تكون أرقام');
    if (dp !== null && mp !== null && mp > dp) return flash('أقل سعر مسموح لازم يكون أقل من أو يساوي سعر البيع');
    const aliases = Array.from(new Set(latin(form.aliases).split(/[,\n]/).map((x) => x.trim()).filter(Boolean)));
    const body = { name, aliases, unit, alt_units: alt, default_price: dp, min_price: mp, active: form.active };
    setBusy(true);
    let id = form.id, error;
    if (id) ({ error } = await supabase.from('products').update(body).eq('id', id));
    else { const r = await supabase.from('products').insert(body).select('id').single(); error = r.error; id = r.data && r.data.id; }
    if (error) { setBusy(false); return flash(error.code === '23505' ? 'في صنف بنفس الاسم بالفعل' : error.message); }
    if (cp !== null) await supabase.from('product_costs').upsert({ product_id: id, cost_price: cp });
    else await supabase.from('product_costs').delete().eq('product_id', id);
    if (!form.id) await supabase.from('product_requests').delete().ilike('name', name);
    setBusy(false); setForm(null); flash('✅ تم الحفظ'); load();
  }

  async function toggle(r) {
    const { error } = await supabase.from('products').update({ active: !r.active }).eq('id', r.id);
    if (error) return flash(error.message);
    load();
  }
  async function remove(r) {
    if (!confirm('حذف «' + r.name + '» نهائيًا؟')) return;
    const { error } = await supabase.from('products').delete().eq('id', r.id);
    if (error) return flash(error.code === '23503' ? 'الصنف ده مستخدم في زيارات أو فواتير قديمة، فمينفعش يتحذف. اقفله (إيقاف) بدل الحذف.' : error.message);
    flash('🗑 اتحذف'); load();
  }
  async function dismiss(name) {
    await supabase.from('product_requests').delete().eq('name', name);
    load();
  }

  // paste from Excel: name | unit | list price | min price | cost price | aliases (a|b|c)
  const parsed = useMemo(() => {
    const lines = importText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const existing = new Set((rows || []).map((r) => r.name.trim().toLowerCase()));
    const out = [], skipped = [], bad = [];
    for (const l of lines) {
      const c = latin(l).split(/\t|;|,(?=[^,]*$)|\|\|/).length > 1 ? l.split(/\t|;/) : l.split(',');
      const cols = c.map((x) => latin(x).trim());
      const name = (c[0] || '').trim();
      if (!name || /^(name|الصنف|اسم)/i.test(name)) continue;
      const unit = (c[1] || '').trim();
      const [dp, mp, cp] = [cols[2], cols[3], cols[4]].map((x) => (x === undefined || x === '' ? null : Number(x)));
      if (!unit || [dp, mp, cp].some((v) => v !== null && !Number.isFinite(v))) { bad.push(name); continue; }
      if (existing.has(name.toLowerCase())) { skipped.push(name); continue; }
      existing.add(name.toLowerCase());
      out.push({ name, unit, default_price: dp, min_price: mp, cost: cp, aliases: (c[5] || '').split('|').map((x) => x.trim()).filter(Boolean) });
    }
    return { out, skipped, bad };
  }, [importText, rows]);

  async function doImport() {
    if (!parsed.out.length) return;
    setBusy(true);
    const { data, error } = await supabase.from('products').insert(parsed.out.map((p) => ({ name: p.name, unit: p.unit, default_price: p.default_price, min_price: p.min_price, aliases: p.aliases, alt_units: [], active: true }))).select('id,name');
    if (error) { setBusy(false); return flash(error.message); }
    const costRows = (data || []).map((d) => ({ d, p: parsed.out.find((x) => x.name === d.name) })).filter((x) => x.p && x.p.cost !== null).map((x) => ({ product_id: x.d.id, cost_price: x.p.cost }));
    if (costRows.length) await supabase.from('product_costs').upsert(costRows);
    setBusy(false); setImportOpen(false); setImportText('');
    flash('✅ اتضاف ' + parsed.out.length + ' صنف' + (parsed.skipped.length ? ' (واتخطّى ' + parsed.skipped.length + ' موجودين)' : ''));
    load();
  }

  if (err) return <div className="card err">{err}</div>;
  if (!rows) return <div className="muted">جاري التحميل…</div>;

  return (
    <>
      {msg && <div className="card" style={{ borderColor: 'var(--brand)' }}>{msg}</div>}

      <div className="card">
        <b>🏷️ قايمة الأصناف هي مرجع البوت.</b>
        <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
          كل فويس أو رسالة أو فاتورة بيراجعها البوت على القايمة دي قبل ما يبعت الملخص: بيتأكد إن الصنف موجود، ويحوّل الوحدات (كرتونة ← باكو)، ويحذّر لو السعر أقل من أقل سعر أو بعيد عن سعر القايمة، أو لو المندوب بيبيع أكتر من اللي معاه.
        </div>
      </div>

      {requests.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--warn)' }}>
          <h2>🔔 أصناف المناديب قالوها ومش في القايمة ({requests.length})</h2>
          {requests.map((r) => (
            <div className="visit" key={r.name} style={{ cursor: 'default' }}>
              <div className="head">
                <div><b>{r.name}</b><div className="muted" style={{ fontSize: 13 }}>{dateTime(r.last_seen)}</div></div>
                <div style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn ok" onClick={() => openNew(r.name)}>إضافة للقايمة</button>{' '}
                  <button className="btn bad" onClick={() => dismiss(r.name)}>تجاهل</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {form && (
        <form className="card" onSubmit={save}>
          <h2>{form.id ? 'تعديل صنف' : '➕ صنف جديد'}</h2>
          <div className="row">
            <input placeholder="اسم الصنف (مثال: شيبسي كبير)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <input placeholder="أسماء تانية بيقولها المندوبين (فاصلة بينهم)" value={form.aliases} onChange={(e) => setForm({ ...form, aliases: e.target.value })} />
          </div>
          <div className="row">
            <input list="unit-list" placeholder="الوحدة الأساسية (مثال: باكو)" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} required />
            <datalist id="unit-list">{UNITS.map((u) => <option key={u} value={u} />)}</datalist>
            <span className="muted" style={{ fontSize: 13 }}>دي الوحدة اللي المخزون والأسعار بتتحسب بيها.</span>
          </div>

          <div className="muted" style={{ fontSize: 13, marginBottom: 6 }}>وحدات تانية بتتباع بيها (اختياري): كل وحدة = كام وحدة أساسية</div>
          {form.alt.map((a, i) => (
            <div className="row" key={i}>
              <input list="unit-list" placeholder="الوحدة (مثال: كرتونة)" value={a.name} onChange={(e) => setForm({ ...form, alt: form.alt.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)) })} />
              <input placeholder={'= كام ' + (form.unit || 'وحدة أساسية')} inputMode="decimal" dir="ltr" value={a.factor} onChange={(e) => setForm({ ...form, alt: form.alt.map((x, k) => (k === i ? { ...x, factor: e.target.value } : x)) })} />
              <button type="button" className="btn bad" onClick={() => setForm({ ...form, alt: form.alt.filter((_, k) => k !== i) })}>حذف</button>
            </div>
          ))}
          <div className="row"><button type="button" className="btn" onClick={() => setForm({ ...form, alt: [...form.alt, { name: '', factor: '' }] })}>➕ وحدة تانية</button></div>

          <div className="muted" style={{ fontSize: 13, marginBottom: 6 }}>الأسعار (للوحدة الأساسية){form.unit ? ': ' + form.unit : ''}</div>
          <div className="row">
            <input placeholder="سعر البيع" inputMode="decimal" dir="ltr" value={form.default_price} onChange={(e) => setForm({ ...form, default_price: e.target.value })} />
            <input placeholder="أقل سعر مسموح" inputMode="decimal" dir="ltr" value={form.min_price} onChange={(e) => setForm({ ...form, min_price: e.target.value })} />
            <input placeholder="سعر المصنع (سري، المناديب ما يشوفوهوش)" inputMode="decimal" dir="ltr" value={form.cost_price} onChange={(e) => setForm({ ...form, cost_price: e.target.value })} />
          </div>
          <div className="row">
            <label><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> نشط (البوت بيتعرّف عليه)</label>
          </div>
          <div className="row">
            <button className="btn primary" disabled={busy}>{busy ? '…' : 'حفظ'}</button>
            <button type="button" className="btn" onClick={() => setForm(null)}>إلغاء</button>
          </div>
        </form>
      )}

      {importOpen && (
        <div className="card">
          <h2>📋 استيراد من إكسل</h2>
          <div className="muted" style={{ fontSize: 13, marginBottom: 6 }}>
            انسخ الصفوف من إكسل والصقها هنا. كل صف: <b>الاسم | الوحدة | سعر البيع | أقل سعر | سعر المصنع | أسماء تانية (بينهم |)</b>. الأعمدة بعد الوحدة اختيارية. الوحدات التانية (كرتونة = 24) بتتضاف بعد كده من «تعديل».
          </div>
          <textarea className="bigtext" rows={6} placeholder={'شيبسي كبير\tباكو\t5\t4.5\t3.5\tشيبسي|شيبس\nبسكويت شوكولاتة\tعلبة\t12'} value={importText} onChange={(e) => setImportText(e.target.value)} />
          <div className="muted" style={{ fontSize: 13 }}>
            هيتضاف: <b>{parsed.out.length}</b>{parsed.skipped.length > 0 && <> · موجودين بالفعل (هيتخطّوا): {parsed.skipped.length}</>}{parsed.bad.length > 0 && <span className="neg"> · صفوف فيها مشكلة (وحدة ناقصة أو سعر مش رقم): {parsed.bad.slice(0, 3).join('، ')}</span>}
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn primary" disabled={busy || !parsed.out.length} onClick={doImport}>{busy ? '…' : 'استيراد ' + parsed.out.length + ' صنف'}</button>
            <button className="btn" onClick={() => { setImportOpen(false); setImportText(''); }}>إلغاء</button>
          </div>
        </div>
      )}

      <div className="card">
        <div className="top plain" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>الأصناف ({rows.length})</h2>
          <div>
            <button className="btn" onClick={() => setImportOpen(!importOpen)}>📋 استيراد</button>{' '}
            <button className="btn primary" onClick={() => openNew()}>➕ صنف</button>
          </div>
        </div>
        <div className="row">
          <input placeholder="بحث بالاسم" value={q} onChange={(e) => setQ(e.target.value)} />
          <label><input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} /> النشطة بس</label>
        </div>
        <table className="table stack">
          <thead><tr><th>الصنف</th><th>الوحدة</th><th>سعر البيع</th><th>أقل سعر</th><th>سعر المصنع</th><th></th></tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} style={r.active ? undefined : { opacity: 0.55 }}>
                <td data-label="">
                  <b>{r.name}</b>{!r.active && <span className="chip cancelled" style={{ marginInlineStart: 6 }}>موقوف</span>}
                  {(r.aliases || []).length > 0 && <div className="muted" style={{ fontSize: 12 }}>{r.aliases.join('، ')}</div>}
                </td>
                <td data-label="الوحدة">
                  {unitAr(r.unit)}
                  {(r.alt_units || []).map((a) => <div key={a.name} className="muted" style={{ fontSize: 12 }}>{a.name} = {num(a.factor)} {unitAr(r.unit)}</div>)}
                </td>
                <td data-label="سعر البيع">{r.default_price != null ? money(r.default_price) : <span className="muted">—</span>}</td>
                <td data-label="أقل سعر">{r.min_price != null ? money(r.min_price) : <span className="muted">—</span>}</td>
                <td data-label="سعر المصنع">{costs[r.id] != null ? money(costs[r.id]) : <span className="muted">—</span>}</td>
                <td data-label="" style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn" onClick={() => openEdit(r)}>تعديل</button>{' '}
                  <button className={'btn ' + (r.active ? 'bad' : 'ok')} onClick={() => toggle(r)}>{r.active ? 'إيقاف' : 'تفعيل'}</button>{' '}
                  <button className="btn bad" onClick={() => remove(r)}>🗑</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <div className="muted">مفيش أصناف. دوس «➕ صنف» أو «📋 استيراد».</div>}
      </div>
    </>
  );
}
