'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { money, num, mapsLink } from '../lib/format';

export default function Clients({ mine = false }) {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const [onlyDebt, setOnlyDebt] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      const [b, c] = await Promise.all([
        mine ? supabase.rpc('rep_client_balances') : supabase.from('client_balances').select('client_id,name,total_sales,total_paid,balance'),
        supabase.from('clients').select('id,phone,type,lat,lng'),
      ]);
      if (b.error || c.error) return setErr((b.error || c.error).message);
      const info = Object.fromEntries(c.data.map((x) => [x.id, x]));
      setRows(b.data.map((x) => ({ ...x, ...(info[x.client_id] || {}) })).sort((x, y) => Number(y.balance) - Number(x.balance)));
    })();
  }, []);

  const shown = useMemo(() => (rows || []).filter((r) => (!q || r.name.includes(q)) && (!onlyDebt || Number(r.balance) > 0)), [rows, q, onlyDebt]);

  if (err) return <div className="card err">{err}</div>;
  if (!rows) return <div className="muted">جاري التحميل…</div>;
  const debt = shown.reduce((s, r) => s + Math.max(Number(r.balance), 0), 0);

  return (
    <div className="card">
      <div className="row">
        <input placeholder="بحث باسم العميل" value={q} onChange={(e) => setQ(e.target.value)} />
        <label><input type="checkbox" checked={onlyDebt} onChange={(e) => setOnlyDebt(e.target.checked)} /> اللي عليهم مديونية بس</label>
        <span className="muted">إجمالي المديونية: <b>{money(debt)}</b></span>
      </div>
      <div className="scroll"><table className="table stack">
        <thead><tr><th>العميل</th><th>المبيعات</th><th>المدفوع</th><th>المديونية</th><th></th></tr></thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.client_id}>
              <td data-label=""><b>{r.name}</b>{r.type && <div className="muted" style={{ fontSize: 13 }}>{r.type}</div>}</td>
              <td data-label="المبيعات">{num(r.total_sales)}</td>
              <td data-label="المدفوع">{num(r.total_paid)}</td>
              <td data-label="المديونية" className={Number(r.balance) > 0 ? 'neg' : ''}>{num(r.balance)}</td>
              <td data-label="">
                {r.phone && <a href={'tel:' + r.phone}>📞</a>}{' '}
                {mapsLink(r.lat, r.lng) && <a href={mapsLink(r.lat, r.lng)} target="_blank" rel="noreferrer">📍</a>}
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
      {shown.length === 0 && <div className="muted">مفيش عملاء.</div>}
    </div>
  );
}
