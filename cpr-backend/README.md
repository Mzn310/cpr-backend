# CPR Backend (Node.js + Express + MongoDB Atlas)

بديل بسيط لـ Google Sheets في workflow n8n الحالي، يستخدم MongoDB Atlas (سحابي، بدون تنصيب سيرفر). يحل 3 مشاكل رئيسية:
- تعارض حجز نفس الموعد من مريضين (Race condition) — عبر `findOneAndUpdate` الذري في `POST /api/slots/:id/hold`
- المواعيد المعلّقة للأبد بعد فشل الدفع — تحرير تلقائي بعد 65 دقيقة
- التحقق من توقيع Stripe قبل تثبيت أي حجز

## إعداد MongoDB Atlas (مرة واحدة)
1. أنشئ حساب مجاني على https://www.mongodb.com/cloud/atlas
2. أنشئ Cluster مجاني (M0)
3. Database Access → أنشئ مستخدم DB (يوزر/باسورد)
4. Network Access → أضف IP السيرفر اللي بيشغّل الـ backend (أو `0.0.0.0/0` مؤقتاً للتجربة فقط)
5. Database → Connect → Drivers → انسخ رابط الاتصال، وحطه بمكان `MONGODB_URI` بملف `.env`

> ملاحظة: الكود يستخدم MongoDB Transactions (لضمان أن تحديث الموعد وإنشاء الحجز يتمّان معاً أو لا يتمّان إطلاقاً). Atlas يدعم هذا تلقائياً لأنه Replica Set حتى بالخطة المجانية. لو شغّلت MongoDB محلياً بشكل standalone (بدون Atlas) هذا الجزء لن يعمل.

## التشغيل
```bash
cd cpr-backend
cp .env.example .env   # عدّل القيم (خصوصاً MONGODB_URI)
npm install
npm start               # يشتغل على http://localhost:4000
```

## نقاط النهاية (Endpoints)
كلها تحتاج الهيدر `x-api-key: <CLINIC_API_KEY>` ما عدا `/health` و `/api/webhooks/stripe` (محمي بتوقيع Stripe بدلاً من ذلك).

| Method | Path | الوصف |
|---|---|---|
| GET | /api/slots?status=Available | قائمة المواعيد المتاحة |
| POST | /api/slots/:id/hold | حجز مؤقت ذري (يفشل لو الموعد أُخذ) |
| POST | /api/slots/:id/release | تحرير موعد يدوياً |
| POST | /api/slots | إضافة موعد جديد (لوحة الإدارة) |
| GET | /api/bookings | كل الحجوزات المؤكدة |
| GET/PUT | /api/conversations/:chatId | قراءة/تحديث حالة المحادثة (بديل شيت Conversations) |
| POST | /api/conversations/:chatId/resume | استئناف البوت لمحادثة متوقفة |
| POST | /api/appointments | يستبدل رابط عيادتك الوهمي — ينشئ حجز مؤكد |
| POST | /api/webhooks/stripe | Stripe يرسل الأحداث هنا مباشرة (وليس لـ n8n) |

## التعديلات المطلوبة على workflow الـ n8n
1. أضف في Node "0. Config Keys": `backend_api_url` و `backend_api_key`
2. استبدل عُقد Google Sheets التالية بعُقد HTTP Request تنادي هذا الـ backend:
   - Node 3 (قراءة الحالة) → `GET /api/conversations/:chatId`
   - Nodes 7f, 8c, 11b, 16b, 20/21, 29, 33 (كتابة الحالة) → `PUT /api/conversations/:chatId`
   - Node 18 (قراءة المواعيد) → `GET /api/slots?status=Available`
   - Node 7d2 (تعليق الموعد) → `POST /api/slots/:id/hold` (لو رجعت 409 يعني الموعد أُخذ — أرسل "اختر موعد ثاني" بدل المتابعة)
   - Node 30 (تأكيد الحجز في نظام العيادة) → `POST /api/appointments`
3. **أهم خطوة أمنية**: غيّر Webhook URL في Stripe Dashboard ليشير مباشرة لـ `https://your-backend.com/api/webhooks/stripe` بدل رابط n8n. عُقد n8n 23–31 تصير غير ضرورية.

## ملاحظة: أرقام المعرّفات (IDs)
مع MongoDB، كل `id` هو الآن نص ObjectId (مثل `"66f1a2b3c4d5e6f7a8b9c0d1"`) وليس رقم متسلسل — لا يوجد تغيير مطلوب من جهتك في n8n سوى التعامل مع النص كما هو، بدون تحويله لرقم.
