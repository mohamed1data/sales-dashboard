'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

// Downloads the file with the user's session and plays it from memory with an explicit type,
// so a wrong content-type on the stored file can not break playback, and every failure shows its real reason.
export default function VoicePlayer({ path, label }) {
  const [url, setUrl] = useState(null);
  const [info, setInfo] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  async function load() {
    setBusy(true); setErr(''); setInfo('');
    try {
      const { data, error } = await supabase.storage.from('voices').download(path);
      if (error || !data) {
        let m = String((error && error.message) || 'unknown');
        try { const j = await error.context.json(); m = j.message || j.error || m; } catch (e) { /* not json */ }
        throw new Error('الملف مش موجود أو مفيش صلاحية (' + m + ')');
      }
      if (data.size < 300) throw new Error('الملف فاضي أو تالف (' + data.size + ' بايت): الرفع من البوت ما اكتملش.');
      const kb = Math.round(data.size / 1024);
      const canOgg = typeof document !== 'undefined' && document.createElement('audio').canPlayType('audio/ogg; codecs=opus');
      setInfo(kb + ' KB' + (canOgg ? '' : ' — المتصفح ده مش بيشغّل صيغة فويس تليجرام (ogg/opus)، افتح اللوحة من Chrome أو نزّل الملف'));
      setUrl(URL.createObjectURL(new Blob([data], { type: 'audio/ogg' })));
    } catch (e) { setErr(String(e.message || e)); }
    setBusy(false);
  }

  if (!url) {
    return (
      <div style={{ marginTop: 6 }}>
        <button className="btn" disabled={busy} onClick={load}>{busy ? '…' : '▶ ' + (label || 'سماع الفويس')}</button>
        {err && <div className="err">{err}</div>}
      </div>
    );
  }
  return (
    <div>
      <audio controls autoPlay src={url} onError={() => setErr('المتصفح مش قادر يشغّل الملف ده. جرّب Chrome أو نزّله.')} />
      <a href={url} download={path.split('/').pop()} className="muted" style={{ fontSize: 12 }}>تنزيل الملف</a>
      {info && <div className="muted" style={{ fontSize: 12 }}>{info}</div>}
      {err && <div className="err">{err}</div>}
    </div>
  );
}
