import { TZ, CURRENCY } from './supabase';

// U+200E keeps the minus sign on the left of the digits inside right-to-left text (-3, not 3-)
export const num = (n) => { const v = Number(n || 0); const t = v.toLocaleString('en-US', { maximumFractionDigits: 2 }); return v < 0 ? '\u200E' + t : t; };
export const money = (n) => num(n) + ' ' + CURRENCY;

const dtf = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { timeZone: TZ, weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export const dateTime = (iso) => (iso ? dtf.format(new Date(iso)) : '—');

const dayf = new Intl.DateTimeFormat('en-CA', { timeZone: TZ });
export const dayKey = (isoOrDate) => dayf.format(new Date(isoOrDate)); // YYYY-MM-DD in the business timezone
export const todayKey = () => dayKey(new Date());
export const daysAgoKey = (n) => dayKey(new Date(Date.now() - n * 86400000));
export const monthStartKey = () => todayKey().slice(0, 8) + '01';

const wdf = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { timeZone: TZ, weekday: 'short', day: '2-digit' });
export const shortDay = (iso) => wdf.format(new Date(iso));

export const mapsLink = (lat, lng) => (lat != null && lng != null ? `https://www.google.com/maps?q=${lat},${lng}` : null);

export const TYPE_LABEL = { sale: '🛒 بيع', follow_up: '🤝 متابعة', collection: '💵 تحصيل' };
export const STATUS_LABEL = { draft: 'مسودة', confirmed: 'مؤكدة', cancelled: 'ملغية' };

export const unitAr = (u) => ({ carton: 'كرتونة', box: 'علبة', pack: 'باكو', piece: 'قطعة' }[u] || u || '');
