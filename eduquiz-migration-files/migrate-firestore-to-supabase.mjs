#!/usr/bin/env node
// scripts/migrate-firestore-to-supabase.mjs
//
// USAGE:
//   node scripts/migrate-firestore-to-supabase.mjs
//
// REQUIREMENTS:
//   npm install firebase-admin @supabase/supabase-js dotenv
//
// ENV VARIABLES (create .env.migration):
//   FIREBASE_SERVICE_ACCOUNT_PATH=./serviceAccountKey.json
//   SUPABASE_URL=https://xxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY=eyJ...   <-- use SERVICE ROLE key (not anon)

import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import admin from 'firebase-admin';
import 'dotenv/config';

// ─── Config ──────────────────────────────────────────────────────────────────
const SERVICE_ACCOUNT_PATH =
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? './serviceAccountKey.json';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌  Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment');
  process.exit(1);
}

// ─── Init Firebase Admin ──────────────────────────────────────────────────────
const serviceAccount = JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const firestore = admin.firestore();

// ─── Init Supabase (service role — bypasses RLS) ──────────────────────────────
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ─── Helpers ──────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

// ─── Step 1: Migrate Firebase Auth users → Supabase Auth ─────────────────────
async function migrateUsers() {
  console.log('\n📦  Step 1: Migrating Firebase Auth users...');

  let nextPageToken;
  const allUsers = [];

  do {
    const result = await admin.auth().listUsers(1000, nextPageToken);
    allUsers.push(...result.users);
    nextPageToken = result.pageToken;
  } while (nextPageToken);

  console.log(`   Found ${allUsers.length} users in Firebase`);

  const userIdMap = {}; // firebaseUid → supabaseUid

  for (const fbUser of allUsers) {
    try {
      // Create user in Supabase Auth
      const { data, error } = await supabase.auth.admin.createUser({
        email: fbUser.email,
        email_confirm: true,
        // NOTE: passwords cannot be migrated from Firebase (hashed differently).
        // Users will need to reset their password via "Forgot Password".
        // We set a random temp password here.
        password: `TempPass_${Math.random().toString(36).slice(2, 10)}!`,
        user_metadata: {
          name: fbUser.displayName ?? fbUser.email?.split('@')[0] ?? 'User',
          firebase_uid: fbUser.uid,
        },
      });

      if (error) {
        if (error.message.includes('already been registered')) {
          console.log(`   ⚠️  User ${fbUser.email} already exists — skipping`);
          // Find existing user
          const { data: existing } = await supabase.auth.admin.listUsers();
          const found = existing?.users?.find(u => u.email === fbUser.email);
          if (found) userIdMap[fbUser.uid] = found.id;
        } else {
          console.error(`   ❌  Failed to create ${fbUser.email}:`, error.message);
        }
        continue;
      }

      userIdMap[fbUser.uid] = data.user.id;

      // Upsert profile
      await supabase.from('profiles').upsert({
        id: data.user.id,
        name: fbUser.displayName ?? fbUser.email?.split('@')[0] ?? 'User',
        email: fbUser.email ?? '',
        photo_url: fbUser.photoURL ?? null,
      });

      console.log(`   ✅  Migrated user: ${fbUser.email}`);
      await sleep(50); // Rate limit buffer
    } catch (err) {
      console.error(`   ❌  Error migrating user ${fbUser.email}:`, err.message);
    }
  }

  // Merge Firestore user profiles (bio, notifications, preferences)
  console.log('\n   Merging Firestore user profiles...');
  const usersSnap = await firestore.collection('users').get();
  for (const doc of usersSnap.docs) {
    const data = doc.data();
    const supabaseUid = userIdMap[doc.id];
    if (!supabaseUid) continue;

    await supabase.from('profiles').update({
      bio: data.bio ?? null,
      notifications: data.notifications ?? null,
      preferences: data.preferences ?? null,
    }).eq('id', supabaseUid);
  }

  console.log(`\n   ✅  User migration complete. Mapped ${Object.keys(userIdMap).length} users.`);
  return userIdMap;
}

// ─── Step 2: Migrate Firestore quizzes → Supabase ────────────────────────────
async function migrateQuizzes(userIdMap) {
  console.log('\n📦  Step 2: Migrating quizzes...');
  const snap = await firestore.collection('quizzes').get();
  console.log(`   Found ${snap.size} quizzes`);

  const rows = snap.docs.map(doc => {
    const d = doc.data();
    return {
      id: doc.id,
      title: d.title ?? 'Untitled',
      description: d.description ?? '',
      topic: d.topic ?? 'Chung',
      difficulty: d.difficulty ?? 'medium',
      questions: d.questions ?? [],
      created_at: d.createdAt ?? Date.now(),
      author: d.author ?? 'Unknown',
      author_id: d.authorId ? (userIdMap[d.authorId] ?? null) : null,
      deleted_at: d.deletedAt ?? null,
      is_public: d.isPublic ?? false,
      short_code: d.shortCode ?? null,
    };
  });

  // Upsert in batches of 50
  const batches = chunk(rows, 50);
  let imported = 0;

  for (const batch of batches) {
    const { error } = await supabase.from('quizzes').upsert(batch, { onConflict: 'id' });
    if (error) {
      console.error('   ❌  Batch error:', error.message);
    } else {
      imported += batch.length;
      console.log(`   ✅  Imported ${imported}/${rows.length} quizzes`);
    }
    await sleep(200);
  }
}

// ─── Step 3: Migrate Firestore attempts → Supabase ───────────────────────────
async function migrateAttempts(userIdMap) {
  console.log('\n📦  Step 3: Migrating attempts...');
  const snap = await firestore.collection('attempts').get();
  console.log(`   Found ${snap.size} attempts`);

  const rows = snap.docs.map(doc => {
    const d = doc.data();
    // Map Firebase userId → Supabase userId (keep guest- prefix as-is)
    let userId = d.userId ?? null;
    if (userId && !userId.startsWith('guest-') && userIdMap[userId]) {
      userId = userIdMap[userId];
    }
    return {
      id: doc.id,
      quiz_id: d.quizId,
      user_id: userId,
      user_name: d.userName ?? null,
      answers: d.answers ?? {},
      score: d.score ?? 0,
      essay_grades: d.essayGrades ?? {},
      timestamp: d.timestamp ?? Date.now(),
      status: d.status ?? 'completed',
    };
  });

  // Filter out attempts whose quiz_id doesn't exist (orphaned)
  const { data: existingQuizzes } = await supabase.from('quizzes').select('id');
  const validQuizIds = new Set((existingQuizzes ?? []).map(q => q.id));
  const validRows = rows.filter(r => validQuizIds.has(r.quiz_id));
  console.log(`   Keeping ${validRows.length} valid attempts (skipping ${rows.length - validRows.length} orphaned)`);

  const batches = chunk(validRows, 100);
  let imported = 0;

  for (const batch of batches) {
    const { error } = await supabase.from('attempts').upsert(batch, { onConflict: 'id' });
    if (error) {
      console.error('   ❌  Batch error:', error.message);
    } else {
      imported += batch.length;
      console.log(`   ✅  Imported ${imported}/${validRows.length} attempts`);
    }
    await sleep(200);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🚀  EduQuiz: Firestore → Supabase Migration');
  console.log('============================================');
  console.log('⚠️   NOTE: User passwords CANNOT be migrated from Firebase.');
  console.log('    Users will need to reset their password after migration.');
  console.log('    Consider sending a password-reset email to all users.\n');

  try {
    const userIdMap = await migrateUsers();
    await migrateQuizzes(userIdMap);
    await migrateAttempts(userIdMap);

    console.log('\n🎉  Migration complete!');
    console.log('\nNext steps:');
    console.log('  1. Send password reset emails to all migrated users');
    console.log('  2. Update your .env.local with Supabase credentials');
    console.log('  3. Deploy to Vercel with the new environment variables');
    console.log('  4. Disable Firebase project once verified\n');
  } catch (err) {
    console.error('\n❌  Migration failed:', err);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

main();
