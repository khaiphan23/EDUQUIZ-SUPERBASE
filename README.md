# EduQuiz — Migration Guide
## Firebase → Supabase + Vercel

---

## 📋 Overview

| Layer | Before | After |
|-------|--------|-------|
| Auth | Firebase Auth | Supabase Auth |
| Database | Firestore (NoSQL) | Supabase (PostgreSQL) |
| Storage | Firebase Storage | Supabase Storage |
| Hosting | (any) | Vercel |
| Realtime | Firestore `onSnapshot` | Supabase Realtime |

---

## 🗂 Files Provided

```
eduquiz-migration/
├── supabase/
│   └── schema.sql              ← Run in Supabase SQL Editor
├── src/
│   ├── services/
│   │   ├── supabase.ts         ← Replaces firebase.ts
│   │   └── authService.ts      ← Replaces authService.ts
│   └── store/
│       ├── AuthContext.tsx     ← Replaces AuthContext.tsx
│       └── QuizContext.tsx     ← Replaces QuizContext.tsx
│   └── pages/
│       └── QuizResult.tsx      ← Replaces QuizResult.tsx (no firebase import)
└── scripts/
    └── migrate-firestore-to-supabase.mjs  ← Run once for data migration
```

---

## STEP 1 — Supabase Project Setup

1. Go to [https://supabase.com](https://supabase.com) → **New Project**
2. Note your:
   - **Project URL**: `https://xxxx.supabase.co`
   - **anon public key** (Settings → API)
   - **service_role key** (for migration script only — never expose in frontend)

3. In **SQL Editor** → **New Query**, paste and run `supabase/schema.sql`

4. Verify in **Table Editor** that these tables exist:
   - `profiles`
   - `quizzes`
   - `attempts`

5. In **Storage** → verify `avatars` bucket exists (created by schema.sql)

---

## STEP 2 — Install Dependencies

```bash
# Remove Firebase SDK
npm uninstall firebase

# Install Supabase
npm install @supabase/supabase-js
```

---

## STEP 3 — Replace Source Files

Copy the files from `eduquiz-migration/src/` into your project:

```bash
# Services
cp src/services/supabase.ts     YOUR_PROJECT/src/services/supabase.ts
cp src/services/authService.ts  YOUR_PROJECT/src/services/authService.ts

# Store
cp src/store/AuthContext.tsx    YOUR_PROJECT/src/store/AuthContext.tsx
cp src/store/QuizContext.tsx    YOUR_PROJECT/src/store/QuizContext.tsx

# Pages
cp src/pages/QuizResult.tsx     YOUR_PROJECT/src/pages/QuizResult.tsx
```

### Update all imports of `firebase` across your codebase:

Search for `from '../services/firebase'` and replace with `from '../services/supabase'`.

The only file that should import `supabase` directly (besides services) is `QuizResult.tsx`.

---

## STEP 4 — Environment Variables

Create/update `.env.local`:

```env
# Supabase
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...your-anon-key...

# Gemini (unchanged)
GEMINI_API_KEY=your-gemini-key
VITE_GEMINI_API_KEY=your-gemini-key
```

> ⚠️ Never put `service_role` key in `.env.local` — that's only for the migration script.

---

## STEP 5 — Run Data Migration (One-Time)

> Skip this step if you have no production data to keep.

```bash
# Install migration dependencies (separate from app)
npm install firebase-admin @supabase/supabase-js dotenv

# Get your Firebase service account:
# Firebase Console → Project Settings → Service Accounts → Generate new private key
# Save as: serviceAccountKey.json  (in project root, add to .gitignore!)

# Create migration env file
cat > .env.migration << EOF
FIREBASE_SERVICE_ACCOUNT_PATH=./serviceAccountKey.json
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...your-service-role-key...
EOF

# Run migration
node --env-file=.env.migration scripts/migrate-firestore-to-supabase.mjs
```

### ⚠️ Important: Password Migration

Firebase passwords **cannot** be exported or migrated — they use a proprietary hashing algorithm.

After migration:
1. Users must reset their password via "Forgot Password"
2. In Supabase Dashboard → Auth → Email Templates, enable **"Reset Password"** email
3. Optionally send a bulk password-reset email to all users via:

```javascript
// One-time script to trigger reset emails
const { data: users } = await supabase.auth.admin.listUsers();
for (const user of users.users) {
  await supabase.auth.resetPasswordForEmail(user.email, {
    redirectTo: 'https://your-domain.com/#/reset-password'
  });
}
```

---

## STEP 6 — Deploy to Vercel

### Option A: Vercel CLI

```bash
npm install -g vercel
vercel login
vercel

# Set environment variables:
vercel env add VITE_SUPABASE_URL
vercel env add VITE_SUPABASE_ANON_KEY
vercel env add GEMINI_API_KEY
vercel env add VITE_GEMINI_API_KEY

# Deploy production:
vercel --prod
```

### Option B: Vercel Dashboard (recommended for teams)

1. Push your code to GitHub
2. Go to [vercel.com](https://vercel.com) → **New Project** → Import repo
3. Framework: **Vite**
4. Build command: `npm run build`
5. Output directory: `dist`
6. Add environment variables in **Settings → Environment Variables**:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `GEMINI_API_KEY`
   - `VITE_GEMINI_API_KEY`
7. Click **Deploy**

### Your `vercel.json` is already correct ✅
The existing `vercel.json` with SPA rewrites works perfectly.

---

## STEP 7 — Supabase Auth Email Config

In **Supabase Dashboard → Auth → URL Configuration**:

```
Site URL: https://your-app.vercel.app
Redirect URLs:
  https://your-app.vercel.app
  https://your-app.vercel.app/#/
  http://localhost:5173  (for dev)
```

---

## STEP 8 — Verify Everything Works

Test this checklist after deployment:

- [ ] Register new user
- [ ] Login / Logout
- [ ] Create quiz (manual + AI)
- [ ] Edit quiz
- [ ] Delete → Trash → Restore → Permanent delete
- [ ] Share quiz (short code)
- [ ] Take quiz as logged-in user
- [ ] Take quiz as guest (enter name)
- [ ] View quiz results + leaderboard
- [ ] Upload avatar in Settings
- [ ] Change password
- [ ] Public library loads quizzes
- [ ] Quiz stats page for author

---

## 🔧 Troubleshooting

### "Row Level Security" errors
If you see RLS errors in the browser console:
1. Check Supabase Dashboard → Table Editor → [table] → RLS policies
2. Ensure you ran the full `schema.sql` including all `CREATE POLICY` statements

### Realtime not working
Enable Realtime for each table:
- Supabase Dashboard → Database → Replication → toggle `quizzes` and `attempts`

### Quiz images (base64) too large
The existing app stores images as base64 in the `questions` JSONB column.
Supabase has a **1MB row size limit** (Postgres default).
For quizzes with many large images, consider:
1. Moving images to Supabase Storage
2. Storing only the URL in questions

```sql
-- Check current quiz sizes:
SELECT id, title, pg_column_size(questions) as size_bytes
FROM quizzes
ORDER BY size_bytes DESC
LIMIT 10;
```

### CORS errors
Ensure your Vercel domain is in Supabase → Auth → URL Configuration.

---

## 📊 Architecture After Migration

```
Browser
  │
  ├── Vercel (Static Hosting)
  │     └── React SPA (Vite build)
  │           ├── Supabase JS Client
  │           │     ├── Auth (JWT sessions)
  │           │     ├── Database (REST + Realtime)
  │           │     └── Storage (avatars)
  │           └── Google Gemini API (AI quiz generation)
  │
  └── Supabase (Backend)
        ├── PostgreSQL (quizzes, attempts, profiles)
        ├── Auth (email/password)
        ├── Storage (avatars bucket)
        └── Realtime (live quiz updates)
```

---

## 💰 Cost Estimate (Free Tier)

| Service | Free Tier Limit | Notes |
|---------|----------------|-------|
| Supabase | 500MB DB, 1GB storage, 50K MAU | Generous for small-medium apps |
| Vercel | 100GB bandwidth, unlimited deploys | Perfect for this app |
| Gemini API | Free tier available | Check current quota |

---

## 🔐 Security Checklist

- [ ] Never commit `serviceAccountKey.json` (add to `.gitignore`)
- [ ] Never commit `.env.local` (already in default `.gitignore`)
- [ ] Use `anon` key in frontend — never `service_role`
- [ ] RLS policies are enabled on all tables ✅ (done in schema.sql)
- [ ] Supabase Storage policies allow only own-user uploads ✅
