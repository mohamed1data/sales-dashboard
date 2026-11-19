'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { money, num, dayKey, todayKey, daysAgoKey, monthStartKey, shortDay } from '../lib/format';

export default function Overview() {
  const [range, setRange] = useState('today');
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      const since = new Date(Date.now() - 32 * 86400000).toISOString();
      const [v, p, b, c, d] = await Promise.all([
        supabase.from('visits').select('id,created_at,rep_id,reps(name),visit_items(line_total)').eq('status', 'confirmed').gte('created_at', since).limit(1000),
        supabase.from('payments').select('amount,created_at').gte('created_at', since).limit(1000),
        supabase.from('client_balances').select('balance'),
        supabase.from('collections').select('id,due_at').eq('status', 'pending'),
        supabase.from('visits').select('id', { count: 'exact', head: true }).eq('status', 'draft'),
      ]);
      const failed = [v, p, b, c, d].find((x) => x.error);
      if (failed) return setErr(failed.error.message);
      setData({ visits: v.data, payments: p.data, balances: b.data, collections: c.data, drafts: d.count || 0 });
    })();
  }, []);

  const stats = useMemo(() => {
    if (!data) return null;
    const start = range === 'today' ? todayKey() : range === 'week' ? daysAgoKey(6) : monthStartKey();
    const inRange = (iso) => dayKey(iso) >= start;
    const vs = data.visits.filter((x) => inRange(x.created_at));
    const total = (x) => (x.visit_items || []).reduce((s, i) => s + Number(i.line_total || 0), 0);
    const sales = vs.reduce((s, x) => s + total(x), 0);
    const collected = data.payments.filter((x) => inRange(x.created_at)).reduce((s, x) => s + Number(x.amount), 0);
    const byRep = {};
    vs.forEach((x) => {
      const n = (x.reps && x.reps.name) || '—';
      byRep[n] = byRep[n] || { visits: 0, sales: 0 };
      byRep[n].visits += 1; byRep[n].sales += total(x);
    });
    const outstanding = data.balances.reduce((s, x) => s + Math.max(Number(x.balance), 0), 0);
    const now = Date.now();
    const overdue = data.collections.filter((x) => Date.parse(x.due_at) < now).length;
    // last 14 days
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const k = daysAgoKey(i);
      const val = data.visits.filter((x) => dayKey(x.created_at) === k).reduce((s, x) => s + total(x), 0);
      days.push({ k, val, label: shortDay(k + 'T12:00:00Z') });
    }
    return { visits: vs.length, sales, collected, outstanding, overdue, pending: data.collections.length, byRep: Object.entries(byRep).sort((a, b) => b[1].sales - a[1].sales), days };
  }, [data, range]);

  if (err) return <div className="card err">حصل خطأ في تحميل البيانات: {err}</div>;
  if (!stats) return <div className="muted">جاري التحميل…</div>;
  const max = Math.max(...stats.days.map((d) => d.val), 1);

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
        <div className={'kpi' + (stats.overdue ? ' danger' : '')}><div className="l">متأخرة</div><div className="v">{num(stats.overdue)}</div></div>
        <div className="kpi"><div className="l">زيارات غير مؤكدة</div><div className="v">{num(data.drafts)}</div></div>
      </div>

      <div className="card">
        <h2>مبيعات آخر 14 يوم</h2>
        <div className="barwrap">
          <div className="bars">
            {stats.days.map((d) => (
              <div key={d.k} className="bar" style={{ height: (d.val / max) * 100 + '%' }} title={d.k + ' — ' + money(d.val)}>
                <span>{d.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <h2>أداء المناديب</h2>
        {stats.byRep.length === 0 ? <div className="muted">مفيش زيارات مؤكدة في الفترة دي.</div> : (
          <div className="scroll"><table className="table">
            <thead><tr><th>المندوب</th><th>الزيارات</th><th>المبيعات</th></tr></thead>
            <tbody>{stats.byRep.map(([n, s]) => <tr key={n}><td>{n}</td><td>{num(s.visits)}</td><td>{money(s.sales)}</td></tr>)}</tbody>
          </table></div>
        )}
      </div>
    </>
  );
}
