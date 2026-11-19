'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { money, num, dateTime, unitAr, STATUS_LABEL } from '../lib/format';
import InvoicePhoto from './InvoicePhoto';
import VoicePlayer from './VoicePlayer';

const SELECT = 'id,created_at,kind,source,invoice_no,invoice_date,declared_total,status,notes,photo_path,voice_path,transcript,reps(name),stock_issue_items(product_text,quantity,unit,unit_price,line_total)';

export default function Stock({ mine = false }) {
  const [stock, setStock] = useState(null);
  const [reps, setReps] = useState([]);
  const [issues, setIssues] = useState(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(null);
  const [view, setView] = useState('custody');
  const [repFilter, setRepFilter] = useState('');

  useEffect(() => {
    (async () => {
      const [s, r, i] = await Promise.all([
        supabase.from('rep_stock').select('rep_id,item,unit,received,sold,on_hand,on_hand_value'),
        supabase.from('reps').select('id,name').order('name'),
        supabase.from('stock_issues').select(SELECT).order('created_at', { ascending: false }).limit(150),
      ]);
      const e = s.error || r.error || i.error;
      if (e) return setErr(e.message);
      setStock(s.data); setReps(r.data); setIssues(i.data);
    })();
  }, []);

  const byRep = useMemo(() => {
    if (!stock) return [];
    return reps.map((r) => {
      const items = stock.filter((x) => x.rep_id === r.id && (Number(x.received) !== 0 || Number(x.sold) !== 0));
      const value = items.reduce((s, x) => s + Number(x.on_hand_value || 0), 0);
      const negative = items.filter((x) => Number(x.on_hand) < 0).length;
      return { ...r, items, value, negative };
    }).filter((r) => r.items.length > 0 && (!repFilter || r.id === repFilter));
  }, [stock, reps, repFilter]);

  if (err) return <div className="card err">{err}</div>;
  if (!stock || !issues) return <div className="muted">جاري التحميل…</div>;

  const totalValue = byRep.reduce((s, r) => s + r.value, 0);
  const totalNeg = byRep.reduce((s, r) => s + r.negative, 0);
  const shownIssues = issues.filter((x) => !repFilter || (x.reps && reps.find((r) => r.id === repFilter && r.name === x.reps.name)));
  const issueTotal = (x) => (x.stock_issue_items || []).reduce((s, i) => s + Number(i.line_total || 0), 0);

  return (
    <>
      <div className="kpis">
        <div className="kpi"><div className="l">{mine ? 'قيمة عهدتي' : 'قيمة العهدة عند المناديب'}</div><div className="v">{money(totalValue)}</div></div>
        <div className={'kpi' + (totalNeg ? ' danger' : '')}><div className="l">أصناف رصيدها سالب</div><div className="v">{num(totalNeg)}</div></div>
        <div className="kpi"><div className="l">فواتير غير مؤكدة</div><div className="v">{num(issues.filter((x) => x.status === 'draft').length)}</div></div>
      </div>

      <div className="row">
        <button className={'btn' + (view === 'custody' ? ' primary' : '')} onClick={() => setView('custody')}>العهدة الحالية</button>
        <button className={'btn' + (view === 'invoices' ? ' primary' : '')} onClick={() => setView('invoices')}>الفواتير</button>
        {!mine && (
          <select value={repFilter} onChange={(e) => setRepFilter(e.target.value)}>
            <option value="">كل المناديب</option>
            {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        )}
      </div>

      {view === 'custody' && (
        <>
          {byRep.length === 0 && <div className="card muted">مفيش عهدة مسجّلة لسه. أول ما مندوب يأكّد فاتورة استلام هتظهر هنا.</div>}
          {byRep.map((r) => (
            <div className="card" key={r.id}>
              <h2>{mine ? 'عهدتي' : r.name} — {money(r.value)}{r.negative > 0 && <span className="chip cancelled" style={{ marginInlineStart: 8 }}>{r.negative} رصيد سالب</span>}</h2>
              <div className="scroll"><table className="table stack">
                <thead><tr><th>الصنف</th><th>استلم</th><th>باع</th><th>معاه</th><th>القيمة</th></tr></thead>
                <tbody>
                  {r.items.map((x, k) => (
                    <tr key={k}>
                      <td data-label="">{x.item}</td>
                      <td data-label="استلم">{num(x.received)} {unitAr(x.unit)}</td>
                      <td data-label="باع">{num(x.sold)}</td>
                      <td data-label="معاه" className={Number(x.on_hand) < 0 ? 'neg' : ''}>{num(x.on_hand)}</td>
                      <td data-label="القيمة">{num(x.on_hand_value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
              {r.negative > 0 && <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>{mine ? '⚠️ الرصيد السالب معناه إنك بعت أكتر من اللي استلمته في الفواتير المؤكدة: غالبًا فاتورة ناقصة، ابعتها للبوت.' : '⚠️ الرصيد السالب معناه إن المندوب باع أكتر من اللي استلمه في الفواتير المؤكدة: غالبًا فاتورة ناقصة أو كمية غلط.'}</div>}
            </div>
          ))}
        </>
      )}

      {view === 'invoices' && (
        <div className="card">
          {shownIssues.length === 0 && <div className="muted">مفيش فواتير.</div>}
          {shownIssues.map((x) => (
            <div key={x.id} className="visit" onClick={() => setOpen(open === x.id ? null : x.id)}>
              <div className="head">
                <div>
                  <b>{x.kind === 'return' ? '↩️ مرتجع' : '📦 استلام'}{x.invoice_no ? ' — فاتورة ' + x.invoice_no : ''}</b> <span className="muted">— {(x.reps && x.reps.name) || '—'}</span>
                  <div className="muted" style={{ fontSize: 13 }}>{dateTime(x.created_at)}{x.invoice_date ? ' · تاريخ الفاتورة ' + x.invoice_date : ''}</div>
                </div>
                <div style={{ textAlign: 'left' }}>
                  <span className={'chip ' + x.status}>{STATUS_LABEL[x.status]}</span>
                  <div>{issueTotal(x) > 0 ? money(issueTotal(x)) : ''}</div>
                </div>
              </div>
              {open === x.id && (
                <div className="detail" onClick={(e) => e.stopPropagation()}>
                  {(x.stock_issue_items || []).length > 0 && (
                    <div className="scroll"><table className="table">
                      <thead><tr><th>الصنف</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead>
                      <tbody>{x.stock_issue_items.map((i, k) => (
                        <tr key={k}><td>{i.product_text}</td><td>{num(i.quantity)} {unitAr(i.unit)}</td><td>{i.unit_price != null ? num(i.unit_price) : '—'}</td><td>{i.line_total != null ? num(i.line_total) : '—'}</td></tr>
                      ))}</tbody>
                    </table></div>
                  )}
                  {x.declared_total != null && <div>🧾 الإجمالي المكتوب على الفاتورة: {money(x.declared_total)}</div>}
                  {x.notes && <div>📝 {x.notes}</div>}
                  {x.transcript && <div className="muted">«{x.transcript}»</div>}
                  {x.photo_path && <InvoicePhoto path={x.photo_path} />}
                  {x.voice_path && <VoicePlayer path={x.voice_path} />}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
