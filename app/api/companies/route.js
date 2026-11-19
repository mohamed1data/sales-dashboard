import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Founder-only: creates a company together with its manager login, adds more managers, resets a manager password.
// Needs SUPABASE_SECRET_KEY (server-only env var in Vercel, NO "NEXT_PUBLIC_" prefix).
export async function POST(req) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) return json({ error: 'SUPABASE_SECRET_KEY مش مضاف في Vercel (Environment Variables).' }, 500);
  const admin = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });

  // 1) only the founder
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'غير مصرح' }, 401);
  const { data: u, error: uerr } = await admin.auth.getUser(token);
  if (uerr || !u || !u.user || !u.user.email) return json({ error: 'غير مصرح' }, 401);
  const { data: users, error: derr } = await admin.from('dashboard_users').select('email,role,tenant_id');
  if (derr) return json({ error: derr.message }, 500);
  const me = (users || []).find((x) => String(x.email).toLowerCase() === u.user.email.toLowerCase());
  if (!me || me.role !== 'founder') return json({ error: 'غير مصرح' }, 403);

  // 2) what does he want?
  let body;
  try { body = await req.json(); } catch (e) { return json({ error: 'طلب غير صالح' }, 400); }
  const action = body && body.action;
  const email = String((body && body.email) || '').trim().toLowerCase();
  const password = String((body && body.password) || '');

  async function createManager(tenant_id) {
    if (!EMAIL_RE.test(email)) throw new Error('الإيميل غير صحيح');
    if (password.length < 8) throw new Error('كلمة السر لازم تكون 8 حروف على الأقل');
    const { data: created, error: cerr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (cerr || !created || !created.user) {
      const m = String((cerr && cerr.message) || '');
      throw new Error(/already|registered|exists/i.test(m) ? 'الإيميل ده مستخدم قبل كده' : (m || 'تعذّر إنشاء الحساب'));
    }
    const { error: ierr } = await admin.from('dashboard_users').insert({ email, role: 'manager', tenant_id });
    if (ierr) { await admin.auth.admin.deleteUser(created.user.id); throw new Error(ierr.message); }
    return created.user.id;
  }

  try {
    if (action === 'create') {
      const name = String(body.name || '').trim();
      if (!name) return json({ error: 'اكتب اسم الشركة' }, 400);
      let rep_limit = null;
      if (body.rep_limit !== null && body.rep_limit !== undefined && String(body.rep_limit).trim() !== '') {
        rep_limit = Number(body.rep_limit);
        if (!Number.isInteger(rep_limit) || rep_limit < 0) return json({ error: 'حد المناديب لازم يكون رقم صحيح' }, 400);
      }
      const { data: t, error: terr } = await admin.from('tenants').insert({ name, rep_limit }).select('id,invite_code').single();
      if (terr) return json({ error: terr.message }, 400);
      try { await createManager(t.id); }
      catch (e) { await admin.from('tenants').delete().eq('id', t.id); return json({ error: e.message }, 400); }
      return json({ ok: true, tenant_id: t.id, invite_code: t.invite_code });
    }

    if (action === 'add_manager') {
      const { data: t } = await admin.from('tenants').select('id').eq('id', body.tenant_id).maybeSingle();
      if (!t) return json({ error: 'الشركة غير موجودة' }, 404);
      await createManager(t.id);
      return json({ ok: true });
    }

    if (action === 'reset_password') {
      const target = (users || []).find((x) => String(x.email).toLowerCase() === email);
      if (!target || target.role !== 'manager') return json({ error: 'المدير غير موجود' }, 404);
      if (password.length < 8) return json({ error: 'كلمة السر لازم تكون 8 حروف على الأقل' }, 400);
      let found = null;
      for (let page = 1; page <= 20 && !found; page++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
        if (error) return json({ error: error.message }, 500);
        found = (data.users || []).find((x) => String(x.email || '').toLowerCase() === email) || null;
        if (!data.users || data.users.length < 200) break;
      }
      if (!found) return json({ error: 'حساب الدخول غير موجود' }, 404);
      const { error: perr } = await admin.auth.admin.updateUserById(found.id, { password });
      if (perr) return json({ error: perr.message }, 400);
      return json({ ok: true });
    }
  } catch (e) {
    return json({ error: String(e.message || e) }, 400);
  }
  return json({ error: 'إجراء غير معروف' }, 400);
}
