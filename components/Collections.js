'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { money, dateTime, dayKey, todayKey, mapsLink } from '../lib/format';

export default function Collections() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('collections')
      .select('id,due_at,amount_due,clients(name,phone,lat,lng),reps(name)')
      .eq('status', 'pending').order('due_at', { ascending: true }).limit(300);
    if (error) return setErr(error.message);
    setErr(''); setRows(data);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function setStatus(id, status) {
    if (!confirm(status === 'done' ? 'تأكيد: تم التحصيل؟' : 'إلغاء التحصيل ده؟')) return;
    const { error } = await supabase.from('collections').update({ status }).eq('id', id);
    if (error) return alert(error.message);
    load();
  }

  if (err) return <div className="card err">{err}</div>;
  if (!rows) return <div className="muted">جاري التحميل…</div>;

  const today = todayKey();
  const groups = [
    ['متأخرة', 'over', rows.filter((r) => dayKey(r.due_at) < today)],
    ['النهارده', '', rows.filter((r) => dayKey(r.due_at) === today)],
    ['قادمة', '', rows.filter((r) => dayKey(r.due_at) > today)],
  ];
  const sum = rows.reduce((s, r) => s + Number(r.amount_due || 0), 0);

  return (
    <div className="card">
      <h2>التحصيلات المنتظرة — إجمالي {money(sum)}</h2>
      {rows.length === 0 && <div className="muted">مفيش تحصيلات منتظرة 🎉</div>}
      {groups.map(([title, cls, list]) => list.length > 0 && (
        <div key={title}>
          <div className={'group-title ' + cls}>{title} ({list.length})</div>
          <div className="scroll"><table className="table stack"><tbody>
            {list.map((r) => (
              <tr key={r.id}>
                <td data-label=""><b>{r.clients && r.clients.name}</b><div className="muted" style={{ fontSize: 13 }}>{r.reps && r.reps.name} · {dateTime(r.due_at)}</div></td>
                <td data-label="المطلوب">{r.amount_due ? money(r.amount_due) : '—'}</td>
                <td data-label="">
                  {r.clients && r.clients.phone && <a href={'tel:' + r.clients.phone}>📞</a>}{' '}
                  {r.clients && mapsLink(r.clients.lat, r.clients.lng) && <a href={mapsLink(r.clients.lat, r.clients.lng)} target="_blank" rel="noreferrer">📍</a>}
                </td>
                <td data-label="" style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn ok" onClick={() => setStatus(r.id, 'done')}>تم</button>{' '}
                  <button className="btn bad" onClick={() => setStatus(r.id, 'cancelled')}>إلغاء</button>
                </td>
              </tr>
            ))}
          </tbody></table></div>
        </div>
      ))}
    </div>
  );
}
