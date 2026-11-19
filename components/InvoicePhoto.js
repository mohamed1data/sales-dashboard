'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

// detects the real image type from the first bytes (the stored content-type can be wrong)
function sniff(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45) return 'image/webp';
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
  return null;
}

export default function InvoicePhoto({ path }) {
  const [url, setUrl] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  async function load() {
    setBusy(true); setErr('');
    try {
      const { data, error } = await supabase.storage.from('invoices').download(path);
      if (error || !data) {
        let m = String((error && error.message) || 'unknown');
        try { const j = await error.context.json(); m = j.message || j.error || m; } catch (e) { /* not json */ }
        throw new Error('الصورة مش موجودة أو مفيش صلاحية (' + m + ')');
      }
      const buf = new Uint8Array(await data.slice(0, 16).arrayBuffer());
      const type = sniff(buf);
      if (!type) throw new Error('الملف ده مش صورة صالحة (' + data.size + ' بايت): الرفع من البوت ما اكتملش.');
      setUrl(URL.createObjectURL(new Blob([data], { type })));
    } catch (e) { setErr(String(e.message || e)); }
    setBusy(false);
  }

  if (!url) {
    return (
      <div style={{ marginTop: 6 }}>
        <button className="btn" disabled={busy} onClick={load}>{busy ? '…' : '🖼 عرض صورة الفاتورة'}</button>
        {err && <div className="err">{err}</div>}
      </div>
    );
  }
  return (
    <div style={{ marginTop: 6 }}>
      <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="الفاتورة" style={{ maxWidth: '100%', maxHeight: 520, borderRadius: 8, border: '1px solid var(--line)' }} /></a>
    </div>
  );
}
