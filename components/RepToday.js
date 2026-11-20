'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { money, num, dateTime, mapsLink, unitAr } from '../lib/format';

// A single tenant-checked RPC replaces the previous four simultaneous queries.
// The function returns only the authenticated rep's aggregates and lists.
export default function RepToday({ rep }) {
  const [st, setSt] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let live = true;
    supabase.rpc('rep_today').then(({ data, error }) => {
      if (!live) return;
      if (error) return setErr(error.message);
      setSt(data);
    });
    return () => { live = false; };
  }, [rep.id]);

  if (err) return <div className="card err">{err}</div>;
  if (!st) return <div className="muted">جاري التحميل…</div>;

  const over = st.over || [];
  const todayC = st.todayC || [];
  const next = st.next || [];
  const holding = st.holding || [];
  const list = (title, cls, rows) => rows.length > 0 && (
    <div key={title}>
      <div className={'group-title ' + cls}>{title} ({rows.length})</div>
      {rows.map((c) => (
        <div className="visit" key={c.id} style={{ cursor: 'default' }}>
          <div className="head">
            <div><b>{c.clients && c.clients.name}</b><div className="muted" style={{ fontSize: 13 }}>{dateTime(c.due_at)}</div></div>
            <div style={{ textAlign: 'left' }}>
              <div>{c.amount_due ? money(c.amount_due) : '—'}</div>
              <div>
                {c.clients && c.clients.phone && <a className="iconlink" href={'tel:' + c.clients.phone}>📞</a>}{' '}
                {c.clients && mapsLink(c.clients.lat, c.clients.lng) && <a className="iconlink" href={mapsLink(c.clients.lat, c.clients.lng)} target="_blank" rel="noreferrer">📍</a>}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <>
      <div className="kpis">
        <div className="kpi"><div className="l">زياراتي النهارده</div><div className="v">{num(st.today && st.today.visits)}</div></div>
        <div className="kpi"><div className="l">مبيعات النهارده</div><div className="v">{money(st.today && st.today.sales)}</div></div>
        <div className="kpi"><div className="l">حصّلت النهارده</div><div className="v">{money(st.today && st.today.paid)}</div></div>
        <div className="kpi"><div className="l">مبيعات الشهر</div><div className="v">{money(st.month && st.month.sales)}</div></div>
        <div className="kpi"><div className="l">قيمة عهدتي</div><div className="v">{money(st.custody)}</div></div>
        <div className={'kpi' + (over.length ? ' danger' : '')}><div className="l">تحصيلات متأخرة</div><div className="v">{num(over.length)}</div></div>
      </div>
      {Number(st.drafts) > 0 && <div className="card" style={{ borderColor: 'var(--warn)' }}>⏰ عندك {st.drafts} زيارة لسه ما أكدتهاش في البوت.</div>}

      <div className="card">
        <h2>التحصيل</h2>
        {over.length + todayC.length + next.length === 0 && <div className="muted">مفيش تحصيلات منتظرة 🎉</div>}
        {list('متأخرة', 'over', over)}
        {list('النهارده', '', todayC)}
        {list('الجاية', '', next)}
      </div>

      <div className="card">
        <h2>اللي معايا دلوقتي</h2>
        {holding.length === 0 ? <div className="muted">مفيش بضاعة مسجّلة معاك.</div> : (
          <table className="table stack"><thead><tr><th>الصنف</th><th>الكمية</th><th>القيمة</th></tr></thead><tbody>
            {holding.map((x, k) => (
              <tr key={k}><td data-label="الصنف">{x.item}</td><td data-label="الكمية" className={Number(x.on_hand) < 0 ? 'neg' : ''}>{num(x.on_hand)} {unitAr(x.unit)}</td><td data-label="القيمة">{money(x.on_hand_value)}</td></tr>
            ))}
          </tbody></table>
        )}
      </div>
    </>
  );
}
