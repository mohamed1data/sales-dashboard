'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { money, num, dateTime, mapsLink, unitAr, TYPE_LABEL, STATUS_LABEL } from '../lib/format';
import VoicePlayer from './VoicePlayer';

const SELECT = 'id,created_at,status,visit_type,lat,lng,transcript,raw_text,voice_path,extra_voice_paths,client_notes,next_visit_at,reps(name),clients(name),visit_items(product_text,quantity,unit,unit_price,line_total),payments(amount,method)';
const METHOD = { cash: 'كاش', transfer: 'تحويل', cheque: 'شيك' };

export default function Visits({ mine = false }) {
  const [reps, setReps] = useState([]);
  const [f, setF] = useState({ rep: '', status: '', from: '', to: '', q: '' });
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => { supabase.from('reps').select('id,name').order('name').then(({ data }) => setReps(data || [])); }, []);

  useEffect(() => {
    (async () => {
      setRows(null);
      let q = supabase.from('visits').select(SELECT).order('created_at', { ascending: false }).limit(200);
      if (f.rep) q = q.eq('rep_id', f.rep);
      if (f.status) q = q.eq('status', f.status);
      if (f.from) q = q.gte('created_at', new Date(f.from + 'T00:00:00').toISOString());
      if (f.to) q = q.lte('created_at', new Date(f.to + 'T23:59:59').toISOString());
      const { data, error } = await q;
      if (error) return setErr(error.message);
      setErr(''); setRows(data);
    })();
  }, [f.rep, f.status, f.from, f.to]);

  const shown = (rows || []).filter((r) => !f.q || ((r.clients && r.clients.name) || '').includes(f.q));
  const total = (r) => (r.visit_items || []).reduce((s, i) => s + Number(i.line_total || 0), 0);
  const paid = (r) => (r.payments || []).reduce((s, p) => s + Number(p.amount || 0), 0);

  return (
    <div className="card">
      <div className="row">
        {!mine && (
          <select value={f.rep} onChange={(e) => setF({ ...f, rep: e.target.value })}>
            <option value="">كل المناديب</option>
            {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        )}
        <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
          <option value="">كل الحالات</option>
          <option value="confirmed">مؤكدة</option>
          <option value="draft">مسودة</option>
          <option value="cancelled">ملغية</option>
        </select>
        <input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} title="من" />
        <input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} title="إلى" />
        <input placeholder="بحث باسم العميل" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
      </div>
      {err && <div className="err">{err}</div>}
      {!rows && !err && <div className="muted">جاري التحميل…</div>}
      {rows && shown.length === 0 && <div className="muted">مفيش زيارات.</div>}
      {shown.map((r) => (
        <div key={r.id} className="visit" onClick={() => setOpen(open === r.id ? null : r.id)}>
          <div className="head">
            <div>
              <b>{(r.clients && r.clients.name) || 'عميل غير محدد'}</b> <span className="muted">— {(r.reps && r.reps.name) || '—'}</span>
              <div className="muted" style={{ fontSize: 13 }}>{dateTime(r.created_at)} · {TYPE_LABEL[r.visit_type]}</div>
            </div>
            <div style={{ textAlign: 'left' }}>
              <span className={'chip ' + r.status}>{STATUS_LABEL[r.status]}</span>
              <div>{total(r) > 0 ? money(total(r)) : ''}</div>
            </div>
          </div>
          {open === r.id && (
            <div className="detail" onClick={(e) => e.stopPropagation()}>
              {(r.visit_items || []).length > 0 && (
                <div className="scroll"><table className="table">
                  <thead><tr><th>الصنف</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead>
                  <tbody>{r.visit_items.map((i, k) => (
                    <tr key={k}><td>{i.product_text}</td><td>{num(i.quantity)} {unitAr(i.unit)}</td><td>{i.unit_price != null ? num(i.unit_price) : '—'}</td><td>{num(i.line_total)}</td></tr>
                  ))}</tbody>
                </table></div>
              )}
              {(r.payments || []).length > 0 && <div>💰 المدفوع: {money(paid(r))} {r.payments[0].method ? '(' + METHOD[r.payments[0].method] + ')' : ''} {total(r) > paid(r) && <span className="neg">· المتبقي {money(total(r) - paid(r))}</span>}</div>}
              {r.client_notes && <div>📝 {r.client_notes}</div>}
              {r.next_visit_at && <div>🔁 الزيارة الجاية: {dateTime(r.next_visit_at)}</div>}
              {(r.transcript || r.raw_text) && <div className="muted" style={{ marginTop: 6 }}>«{r.transcript || r.raw_text}»</div>}
              {mapsLink(r.lat, r.lng) && <div><a href={mapsLink(r.lat, r.lng)} target="_blank" rel="noreferrer">📍 مكان الزيارة</a></div>}
              {r.voice_path && <VoicePlayer path={r.voice_path} />}
              {(r.extra_voice_paths || []).map((p, i) => <VoicePlayer key={p} path={p} label={'فويس التعديل ' + (i + 1)} />)}
            </div>
          )}
        </div>
      ))}
      {rows && rows.length === 200 && <div className="muted">بيعرض آخر 200 زيارة. ضيّق الفلتر لو عايز أقدم.</div>}
    </div>
  );
}
