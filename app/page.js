'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import Login from '../components/Login';
import Dashboard from '../components/Dashboard';

export default function Page() {
  const [session, setSession] = useState(undefined); // undefined = loading
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session || null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s || null));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (session === undefined) return <div className="center muted">جاري التحميل…</div>;
  if (!session) return <Login />;
  return <Dashboard session={session} />;
}
