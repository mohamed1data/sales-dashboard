'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { money, num, dateTime, dayKey, todayKey, monthStartKey, mapsLink, unitAr } from '../lib/format';

export default function RepToday({ rep }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      const since = new Date(Date.now() - 32 * 86400000).toISOString();
      const [v, p, c, s] = await Promise.all([
        supabase.from('visits').select('id,created_at,status,visit_items(line_total)').neq('status', 'cancelled').gte('created_at', since).limit(1000),
        supabase.from('payments').select('amount,created_at').gte('created_at', since).limit(1000),
        supabase.from('collections').select('id,due_at,amount_due,clients(name,phone,lat,lng)').eq('status', 'pending').order('due_at', { ascending: true }).limit(100),
        supabase.from('rep_stock').select('item,unit,on_hand,on_hand_value'),
      ]);
      const failed = [v, p, c, s].find((x) => x.error);
      if (failed) return setErr(failed.error.message);
      setData({ visits: v.data, payments: p.data, collections: c.data, stock: s.data });
    })();
  }, []);

  const st = useMemo(() => {
    if (!data) return null;
    const t = todayKey(), m = monthStartKey();
    const tot = (x) => (x.visit_items || []).reduce((s, i) => s + Number(i.line_total || 0), 0);
    const conf = data.visits.filter((x) => x.status === 'confirmed');
    const agg = (from) => ({
      visits: conf.filter((x) => dayKey(x.created_at) >= from).length,
      sales: conf.filter((x) => dayKey(x.created_at) >= from).reduce((s, x) => s + tot(x), 0),
      paid: data.payments.filter((x) => dayKey(x.created_at) >= from).reduce((s, x) => s + Number(x.amount), 0),
    });
    const custody = data.stock.reduce((s, x) => s + Number(x.on_hand_value || 0), 0);
    return {
      today: agg(t), month: agg(m), custody,
      drafts: data.visits.filter((x) => x.status === 'draft').length,
      over: data.collections.filter((c) => dayKey(c.due_at) < t),
      todayC: data.collections.filter((c) => dayKey(c.due_at) === t),
      next: data.collections.filter((c) => dayKey(c.due_at) > t).slice(0, 8),
      holding: data.stock.filter((x) => Number(x.on_hand) !== 0),
    };
  }, [data]);

  if (err) return <div className="card err">{err}</div>;
  if (!st) return <div className="muted">جاري التحميل…</div>;

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
        <div className="kpi"><div className="l">زياراتي النهارده</div><div className="v">{num(st.today.visits)}</div></div>
        <div className="kpi"><div className="l">مبيعات النهارده</div><div className="v">{money(st.today.sales)}</div></div>
        <div className="kpi"><div className="l">حصّلت النهارده</div><div className="v">{money(st.today.paid)}</div></div>
        <div className="kpi"><div className="l">مبيعات الشهر</div><div className="v">{money(st.month.sales)}</div></div>
        <div className="kpi"><div className="l">قيمة عهدتي</div><div className="v">{money(st.custody)}</div></div>
        <div className={'kpi' + (st.over.length ? ' danger' : '')}><div className="l">تحصيلات متأخرة</div><div className="v">{num(st.over.length)}</div></div>
      </div>
      {st.drafts > 0 && <div className="card" style={{ borderColor: 'var(--warn)' }}>⏰ عندك {st.drafts} زيارة لسه ما أكدتهاش في البوت.</div>}

      <div className="card">
        <h2>التحصيل</h2>
        {st.over.length + st.todayC.length + st.next.length === 0 && <div className="muted">مفيش تحصيلات منتظرة 🎉</div>}
        {list('متأخرة', 'over', st.over)}
        {list('النهارده', '', st.todayC)}
        {list('الجاية', '', st.next)}
      </div>

      <div className="card">
        <h2>اللي معايا دلوقتي</h2>
        {st.holding.length === 0 ? <div className="muted">مفيش بضاعة مسجّلة معاك.</div> : (
          <table className="table stack"><thead><tr><th>الصنف</th><th>الكمية</th><th>القيمة</th></tr></thead><tbody>
            {st.holding.map((x, k) => (
              <tr key={k}><td data-label="الصنف">{x.item}</td><td data-label="الكمية" className={Number(x.on_hand) < 0 ? 'neg' : ''}>{num(x.on_hand)} {unitAr(x.unit)}</td><td data-label="القيمة">{money(x.on_hand_value)}</td></tr>
            ))}
          </tbody></table>
        )}
      </div>
    </>
  );
}
