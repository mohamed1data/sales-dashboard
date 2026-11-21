# لوحة المدير — Sales Rep Bot

لوحة بتقرأ من Supabase بتاع نفس نسخة العميل (Next.js + Vercel).

## التشغيل

1. **قاعدة Supabase جديدة وفارغة فقط:** شغّل ملفات SQL بالترتيب التالي:
   - `sql/sales_bot_schema.sql`
   - `sql/dashboard_policies.sql` (غيّر الإيميل المؤقت فيه قبل التشغيل)
   - `sql/stock_migration.sql`
   - `sql/reps_admin.sql`
   - `sql/rep_portal.sql`
   - `sql/workflow_update_2.sql`
   - `sql/catalog.sql`
   - `sql/rep_delete.sql`
   - `sql/multitenant_migration.sql` **أخيرًا**
   - `sql/performance_migration.sql` بعد الـ multi-tenant لتحسين لوحة 50–500 مندوب.

   لو القاعدة موجودة بالفعل، **لا** تشغّل `sales_bot_schema.sql` مرة ثانية. طبّق فقط الـ migration الجديدة المطلوبة.
2. `sql/security_fix.sql` خاص بالنسخة القديمة أحادية الشركة؛ **لا تشغّله بعد** `multitenant_migration.sql` لأنه قد يلغي عزل الشركات.
3. Supabase ← Authentication ← Users ← **Add user**: حساب المؤسس الأول، وعلّم **Auto Confirm User**.
4. انسخ `.env.example` إلى `.env.local` وحط:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` = الـ **Publishable key** (`sb_publishable_...`)، وهو اللي كان اسمه anon. (لو مشروعك لسه على المفاتيح القديمة حطّ الـ anon في `NEXT_PUBLIC_SUPABASE_ANON_KEY` وهيشتغل برضو). **مش** الـ Secret / service_role.
5. جرّب محليًا: `npm install` ثم `npm run dev` وافتح http://localhost:3000
6. للنشر: ارفع المجلد على GitHub، واعمل Import في Vercel، وحط نفس المتغيرات في Environment Variables.

## حسابات المناديب (لوحة المندوب)

- المندوب يدخل على **نفس رابط اللوحة** بإيميل وكلمة سر، ويشوف بس: زياراته، عملاءه، تحصيلاته، وعهدته.
- المدير يعمل الحساب من تبويب «المناديب» ← «➕ إنشاء حساب» (الإيميل + كلمة سر، وفيه زرار 🎲 توليد). بتظهر البيانات مرة واحدة عشان تنسخها وتبعتها للمندوب.
- ده محتاج متغير **سيرفر** في Vercel: `SUPABASE_SECRET_KEY` = الـ Secret key (`sb_secret_...`). **من غير** `NEXT_PUBLIC_` في الاسم، ومن نوع Secret. بعد إضافته اعمل Redeploy.
- على الموبايل: افتح الرابط في Chrome/Safari ← «إضافة إلى الشاشة الرئيسية» وهيشتغل كأنه تطبيق.

## الأصناف (مرجع البوت)

- تبويب «الأصناف» للمدير: إضافة/تعديل/إيقاف/حذف، أسماء بديلة، وحدة أساسية + وحدات تانية بمعامل تحويل (كرتونة = 24 باكو)، سعر البيع، أقل سعر، وسعر المصنع (سري: المناديب ما يشوفوهوش). وفيه استيراد من إكسل.
- شغّل `catalog.sql` قبل `multitenant_migration.sql`. لا تشغّل `security_fix.sql` بعد نظام الـ multi-tenant.
- المندوب بيشوف تبويب «الأسعار» (سعر البيع وأقل سعر بس).

## الصلاحيات

- الإيميلات المسموح لها بالدخول بس هي اللي في جدول `dashboard_users`.
- المفتاح اللي في اللوحة (anon) من غير تسجيل دخول ما يقدرش يقرا أي حاجة (RLS).
- اللوحة تقدر تقرا كل الجداول وتغيّر حالة التحصيل (تم / إلغاء) بس.
- **ما تحطش** الـ Secret key (`sb_secret_...`) ولا الـ `service_role` في أي متغير بيبدأ بـ `NEXT_PUBLIC_`. مكانه Config node في n8n أو متغير Vercel server-only باسم `SUPABASE_SECRET_KEY` فقط.

## ملاحظات

- الفويسات بتتسمع عن طريق روابط مؤقتة (ساعة). ملفات تليجرام بصيغة ogg/opus: شغالة في Chrome/Edge/Firefox، وSafari القديم ممكن ما يشغّلهاش (استخدم "تنزيل الملف").
- بعد تشغيل `performance_migration.sql`، النظرة العامة والتبويب الرئيسي للمندوب يعتمدان على RPCs مجمعة في PostgreSQL، وليس على تنزيل أول 1000 زيارة للمتصفح.
- التوقيت والعملة: `NEXT_PUBLIC_TIMEZONE` و `NEXT_PUBLIC_CURRENCY`.
