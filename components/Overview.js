'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { money, num, shortDay } from '../lib/format';

// Aggregation happens in PostgreSQL (dashboard_overview RPC), rather than downloading
// raw visits to the browser. This stays accurate beyond the old 1,000-row limit.
export default function Overview() {
  const [range, setRange] = useState('today');
  const [stats, setStats] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let live = true;
    setStats(null); setErr('');
    supabase.rpc('dashboard_overview', { p_range: range }).then(({ data, error }) => {
      if (!live) return;
      if (error) return setErr(error.message);
      setStats(data);
    });
    return () => { live = false; };
  }, [range]);

  if (err) return <div className="card err">حصل خطأ في تحميل البيانات: {err}</div>;
  if (!stats) return <div className="muted">جاري التحميل…</div>;

  const days = (stats.days || []).map((d) => ({ ...d, val: Number(d.val || 0), label: shortDay(d.k + 'T12:00:00Z') }));
  const byRep = stats.byRep || [];
  const max = Math.max(...days.map((d) => d.val), 1);

  return (
    <>
      <div className="row">
        {[['today', 'النهارده'], ['week', 'آخر 7 أيام'], ['month', 'الشهر ده']].map(([k, l]) => (
          <button key={k} className={'btn' + (range === k ? ' primary' : '')} onClick={() => setRange(k)}>{l}</button>
        ))}
      </div>
      <div className="kpis">
        <div className="kpi"><div className="l">عدد الزيارات المؤكدة</div><div className="v">{num(stats.visits)}</div></div>
        <div className="kpi"><div className="l">المبيعات</div><div className="v">{money(stats.sales)}</div></div>
        <div className="kpi"><div className="l">المحصّل</div><div className="v">{money(stats.collected)}</div></div>
        <div className="kpi"><div className="l">مديونيات العملاء (الكل)</div><div className="v">{money(stats.outstanding)}</div></div>
        <div className="kpi"><div className="l">تحصيلات منتظرة</div><div className="v">{num(stats.pending)}</div></div>
        <div className={'kpi' + (Number(stats.overdue) ? ' danger' : '')}><div className="l">متأخرة</div><div className="v">{num(stats.overdue)}</div></div>
        <div className="kpi"><div className="l">زيارات غير مؤكدة</div><div className="v">{num(stats.drafts)}</div></div>
      </div>

      <div className="card">
        <h2>مبيعات آخر 14 يوم</h2>
        <div className="barwrap">
          <div className="bars">
            {days.map((d) => (
              <div key={d.k} className="bar" style={{ height: (d.val / max) * 100 + '%' }} title={d.k + ' — ' + money(d.val)}>
                <span>{d.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <h2>أداء المناديب</h2>
        {byRep.length === 0 ? <div className="muted">مفيش زيارات مؤكدة في الفترة دي.</div> : (
          <div className="scroll"><table className="table">
            <thead><tr><th>المندوب</th><th>الزيارات</th><th>المبيعات</th></tr></thead>
            <tbody>{byRep.map((s, i) => <tr key={(s.name || '—') + i}><td>{s.name || '—'}</td><td>{num(s.visits)}</td><td>{money(s.sales)}</td></tr>)}</tbody>
          </table></div>
        )}
      </div>
    </>
  );
}
