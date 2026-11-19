import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Creates / resets / removes the LOGIN account of a rep. Only managers of the SAME company as the rep may call it.
// Needs SUPABASE_SECRET_KEY (server-only env var, NO "NEXT_PUBLIC_" prefix) in Vercel.
export async function POST(req) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) return json({ error: 'SUPABASE_SECRET_KEY مش مضاف في Vercel (Environment Variables).' }, 500);

  const admin = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });

  // 1) who is calling?
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'غير مصرح' }, 401);
  const { data: u, error: uerr } = await admin.auth.getUser(token);
  if (uerr || !u || !u.user || !u.user.email) return json({ error: 'غير مصرح' }, 401);
  // the caller must be a manager/founder of an ACTIVE company; he may only touch reps of HIS company
  const { data: allMgrs, error: merr } = await admin.from('dashboard_users').select('email,role,tenant_id,tenants(active)');
  if (merr) return json({ error: merr.message }, 500);
  const managers = (allMgrs || []).map((m) => String(m.email).toLowerCase());
  const me = (allMgrs || []).find((m) => String(m.email).toLowerCase() === u.user.email.toLowerCase());
  if (!me || !me.tenants || me.tenants.active === false) return json({ error: 'غير مصرح' }, 403);

  // 2) what do they want?
  let body;
  try { body = await req.json(); } catch (e) { return json({ error: 'طلب غير صالح' }, 400); }
  const { action, rep_id } = body || {};
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');

  const { data: rep, error: rerr } = await admin.from('reps').select('id,name,auth_user_id,email,tenant_id').eq('id', rep_id).maybeSingle();
  if (rerr || !rep || rep.tenant_id !== me.tenant_id) return json({ error: 'المندوب غير موجود' }, 404);

  if (action === 'create') {
    if (rep.auth_user_id) return json({ error: 'المندوب ده عنده حساب بالفعل' }, 400);
    if (!EMAIL_RE.test(email)) return json({ error: 'الإيميل غير صحيح' }, 400);
    if (password.length < 8) return json({ error: 'كلمة السر لازم تكون 8 حروف على الأقل' }, 400);
    if (managers.includes(email)) return json({ error: 'الإيميل ده تابع لمدير' }, 400);
    const { data: created, error: cerr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (cerr || !created || !created.user) {
      const m = String((cerr && cerr.message) || '');
      return json({ error: /already|registered|exists/i.test(m) ? 'الإيميل ده مستخدم قبل كده' : (m || 'تعذّر إنشاء الحساب') }, 400);
    }
    const { error: uperr } = await admin.from('reps').update({ auth_user_id: created.user.id, email }).eq('id', rep.id);
    if (uperr) { await admin.auth.admin.deleteUser(created.user.id); return json({ error: uperr.message }, 500); }
    return json({ ok: true });
  }

  if (action === 'reset') {
    if (!rep.auth_user_id) return json({ error: 'المندوب ده معندوش حساب' }, 400);
    if (password.length < 8) return json({ error: 'كلمة السر لازم تكون 8 حروف على الأقل' }, 400);
    const { error: perr } = await admin.auth.admin.updateUserById(rep.auth_user_id, { password });
    if (perr) return json({ error: perr.message }, 400);
    return json({ ok: true });
  }

  if (action === 'remove') {
    if (!rep.auth_user_id) return json({ error: 'المندوب ده معندوش حساب' }, 400);
    const { error: derr } = await admin.auth.admin.deleteUser(rep.auth_user_id);
    if (derr) return json({ error: derr.message }, 400);
    await admin.from('reps').update({ auth_user_id: null, email: null }).eq('id', rep.id);
    return json({ ok: true });
  }

  if (action === 'delete') {
    // permanent delete: login account + rep row. History (visits, invoices, collections) is kept and shows "deleted rep".
    if (rep.auth_user_id) {
      const { error: derr } = await admin.auth.admin.deleteUser(rep.auth_user_id);
      if (derr && !/not.?found/i.test(String(derr.message))) return json({ error: derr.message }, 400);
    }
    const { error: delerr } = await admin.from('reps').delete().eq('id', rep.id);
    if (delerr) return json({ error: delerr.message + ' — شغّل rep_delete.sql في Supabase لو لسه ما اتشغّلش.' }, 400);
    return json({ ok: true });
  }

  return json({ error: 'إجراء غير معروف' }, 400);
}
