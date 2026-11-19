'use client';

import { useState } from 'react';
import { supabase, APP_NAME } from '../lib/supabase';
import RepToday from './RepToday';
import Visits from './Visits';
import Clients from './Clients';
import Stock from './Stock';
import RepPrices from './RepPrices';

const TABS = [
  ['today', '🏠', 'اليوم'],
  ['visits', '🧾', 'زياراتي'],
  ['clients', '🏪', 'عملائي'],
  ['stock', '📦', 'عهدتي'],
  ['prices', '🏷️', 'الأسعار'],
];

export default function RepApp({ rep, email }) {
  const [tab, setTab] = useState('today');
  return (
    <div className="wrap">
      <div className="top">
        <div>
          <h1>{APP_NAME}</h1>
          <div className="muted" style={{ fontSize: 12 }}>👤 مندوب — {rep.name}{email ? <> · <span dir="ltr">{email}</span></> : null}</div>
        </div>
        <button className="btn" onClick={() => supabase.auth.signOut()}>خروج</button>
      </div>
      <nav className="tabs">
        {TABS.map(([k, icon, label]) => (
          <button key={k} className={'tab' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>
            <span className="ti">{icon}</span><span className="tl">{label}</span>
          </button>
        ))}
      </nav>
      {tab === 'today' && <RepToday rep={rep} />}
      {tab === 'visits' && <Visits mine />}
      {tab === 'clients' && <Clients mine />}
      {tab === 'stock' && <Stock mine />}
      {tab === 'prices' && <RepPrices />}
    </div>
  );
}
