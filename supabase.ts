// src/services/supabase.ts
// Replaces: src/services/firebase.ts
//
// Setup:
//   npm install @supabase/supabase-js
//   Add to .env.local:
//     VITE_SUPABASE_URL=https://xxxx.supabase.co
//     VITE_SUPABASE_ANON_KEY=eyJ...

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables.\n' +
    'Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env.local file.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});

// Type-safe table helper
export type Tables = {
  profiles: {
    id: string;
    name: string;
    email: string;
    photo_url: string | null;
    bio: string | null;
    notifications: { email: boolean; push: boolean; activitySummary: boolean };
    preferences: { theme: 'light' | 'dark' | 'system'; language: 'vi' | 'en' };
    created_at: string;
    updated_at: string;
  };
  quizzes: {
    id: string;
    title: string;
    description: string;
    topic: string;
    difficulty: 'easy' | 'medium' | 'hard';
    questions: any[];
    created_at: number;
    author: string;
    author_id: string | null;
    deleted_at: string | null;
    is_public: boolean;
    short_code: string | null;
  };
  attempts: {
    id: string;
    quiz_id: string;
    user_id: string | null;
    user_name: string | null;
    answers: Record<string, any>;
    score: number;
    essay_grades: Record<string, any>;
    timestamp: number;
    status: 'completed' | 'pending-grading';
  };
};
