'use client';

import { useEffect, useState } from 'react';
import { supabase, APP_NAME } from '../lib/supabase';
import Overview from './Overview';
import Visits from './Visits';
import Collections from './Collections';
import Clients from './Clients';
import Reps from './Reps';
import Stock from './Stock';
import Products from './Products';
import RepApp from './RepApp';
import Companies from './Companies';

const TABS = [
  ['overview', '📊', 'نظرة'],
  ['visits', '🧾', 'الزيارات'],
  ['collections', '💵', 'التحصيل'],
  ['stock', '📦', 'العهدة'],
  ['clients', '🏪', 'العملاء'],
  ['products', '🏷️', 'الأصناف'],
  ['reps', '🧑‍💼', 'المناديب'],
];

export default function Dashboard({ session }) {
  const [tab, setTab] = useState('overview');
  const [role, setRole] = useState(undefined); // 'manager' | 'rep' | 'none'
  const [rep, setRep] = useState(null);
  const [ctx, setCtx] = useState(null); // {role:'founder'|'manager', tenant_name, rep_limit, invite_code, ...}
  const [overlap, setOverlap] = useState(false); // this login is a manager AND linked to a rep (misconfiguration)

  useEffect(() => {
    (async () => {
      // One database RPC replaces the previous 2–3 startup reads. The function
      // decides manager vs rep inside PostgreSQL, with the active tenant checks.
      const { data, error } = await supabase.rpc('my_app_context');
      if (error || !data) return setRole('none');
      if (data.kind === 'manager') {
        setCtx({ role: data.role || 'manager', tenant_id: data.tenant_id, tenant_name: data.tenant_name, rep_limit: data.rep_limit, invite_code: data.invite_code, is_owner: data.is_owner });
        setOverlap(!!data.overlap);
        return setRole('manager');
      }
      if (data.kind === 'rep' && data.rep && data.rep.active) {
        setRep(data.rep);
        return setRole('rep');
      }
      setRole('none');
    })();
  }, [session.user.id]);

  if (role === undefined) return <div className="center muted">جاري التحميل…</div>;
  if (role === 'none') {
    return (
      <div className="center">
        <div className="card login">
          <h2>غير مصرح</h2>
          <p className="muted">الحساب ({session.user.email}) مش مرتبط بمدير ولا بمندوب نشط. كلّم المدير.</p>
          <button className="btn" onClick={() => supabase.auth.signOut()}>تسجيل خروج</button>
        </div>
      </div>
    );
  }
  if (role === 'rep') return <RepApp rep={rep} email={session.user.email} />;
  const tabs = ctx && ctx.role === 'founder' ? [...TABS, ['companies', '🏢', 'الشركات']] : TABS;

  return (
    <div className="wrap">
      <div className="top">
        <div>
          <h1>{APP_NAME}</h1>
          <div className="muted" style={{ fontSize: 12 }}>👤 {ctx && ctx.role === 'founder' ? 'مؤسس' : 'مدير'}{ctx && ctx.tenant_name ? ' — ' + ctx.tenant_name : ''} · <span dir="ltr">{session.user.email}</span></div>
        </div>
        <button className="btn" onClick={() => supabase.auth.signOut()}>خروج</button>
      </div>
      {overlap && (
        <div className="card" style={{ borderColor: 'var(--danger)' }}>
          ⚠️ الحساب ده مسجّل <b>كمدير وكمندوب</b> في نفس الوقت (إيميله موجود في جدول <code>dashboard_users</code>)، عشان كده بيفتح لوحة المدير.
          لو عايزه مندوب بس، احذف إيميله من الجدول ده في Supabase.
        </div>
      )}
      <nav className={'tabs' + (tabs.length > 6 ? ' many' : '')}>
        {tabs.map(([k, icon, label]) => (
          <button key={k} className={'tab' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>
            <span className="ti">{icon}</span><span className="tl">{label}</span>
          </button>
        ))}
      </nav>
      {tab === 'overview' && <Overview />}
      {tab === 'visits' && <Visits />}
      {tab === 'collections' && <Collections />}
      {tab === 'stock' && <Stock />}
      {tab === 'clients' && <Clients />}
      {tab === 'products' && <Products />}
      {tab === 'reps' && <Reps tenant={ctx} />}
      {tab === 'companies' && ctx && ctx.role === 'founder' && <Companies />}
    </div>
  );
}
