'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { money, num, unitAr } from '../lib/format';

// price list for reps: only what a rep may know (no factory price: it lives in a manager-only table)
export default function RepPrices() {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    supabase.from('products').select('id,name,aliases,unit,alt_units,default_price,min_price').eq('active', true).order('name').then(({ data, error }) => {
      if (error) return setErr(error.message);
      setRows(data);
    });
  }, []);
  const shown = useMemo(() => (rows || []).filter((r) => !q || (r.name + ' ' + (r.aliases || []).join(' ')).includes(q)), [rows, q]);
  if (err) return <div className="card err">{err}</div>;
  if (!rows) return <div className="muted">جاري التحميل…</div>;
  return (
    <div className="card">
      <div className="row"><input placeholder="بحث بالاسم" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <table className="table stack">
        <thead><tr><th>الصنف</th><th>الوحدة</th><th>السعر</th><th>أقل سعر</th></tr></thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.id}>
              <td data-label=""><b>{r.name}</b></td>
              <td data-label="الوحدة">{unitAr(r.unit)}{(r.alt_units || []).map((a) => <div key={a.name} className="muted" style={{ fontSize: 12 }}>{a.name} = {num(a.factor)} {unitAr(r.unit)}</div>)}</td>
              <td data-label="السعر">{r.default_price != null ? money(r.default_price) : '—'}</td>
              <td data-label="أقل سعر">{r.min_price != null ? money(r.min_price) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {shown.length === 0 && <div className="muted">مفيش أصناف.</div>}
    </div>
  );
}
