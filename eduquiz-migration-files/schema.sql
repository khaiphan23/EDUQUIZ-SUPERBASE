-- ============================================================
-- EduQuiz - Supabase Schema
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- PROFILES TABLE (extends Supabase Auth users)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  photo_url TEXT,
  bio TEXT,
  notifications JSONB DEFAULT '{"email": true, "push": true, "activitySummary": true}'::jsonb,
  preferences JSONB DEFAULT '{"theme": "light", "language": "vi"}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- QUIZZES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.quizzes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  topic TEXT DEFAULT 'Chung',
  difficulty TEXT DEFAULT 'medium' CHECK (difficulty IN ('easy', 'medium', 'hard')),
  questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
  author TEXT NOT NULL DEFAULT '',
  author_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  deleted_at TEXT, -- ISO string, null = not deleted
  is_public BOOLEAN DEFAULT FALSE,
  short_code TEXT UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_quizzes_author_id ON public.quizzes(author_id);
CREATE INDEX IF NOT EXISTS idx_quizzes_is_public ON public.quizzes(is_public);
CREATE INDEX IF NOT EXISTS idx_quizzes_short_code ON public.quizzes(short_code);
CREATE INDEX IF NOT EXISTS idx_quizzes_deleted_at ON public.quizzes(deleted_at);

-- ============================================================
-- ATTEMPTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.attempts (
  id TEXT PRIMARY KEY,
  quiz_id TEXT NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
  user_id TEXT, -- Can be guest (non-UUID format)
  user_name TEXT,
  answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  score FLOAT NOT NULL DEFAULT 0,
  essay_grades JSONB DEFAULT '{}'::jsonb,
  timestamp BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
  status TEXT DEFAULT 'completed' CHECK (status IN ('completed', 'pending-grading'))
);

CREATE INDEX IF NOT EXISTS idx_attempts_quiz_id ON public.attempts(quiz_id);
CREATE INDEX IF NOT EXISTS idx_attempts_user_id ON public.attempts(user_id);

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quizzes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attempts ENABLE ROW LEVEL SECURITY;

-- PROFILES policies
CREATE POLICY "Users can view their own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Users can insert their own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- QUIZZES policies
CREATE POLICY "Authors can manage their own quizzes"
  ON public.quizzes FOR ALL
  USING (auth.uid() = author_id);

CREATE POLICY "Anyone can view public non-deleted quizzes"
  ON public.quizzes FOR SELECT
  USING (is_public = TRUE AND deleted_at IS NULL);

CREATE POLICY "Anyone can view a quiz by ID (for sharing)"
  ON public.quizzes FOR SELECT
  USING (deleted_at IS NULL);

-- ATTEMPTS policies
CREATE POLICY "Anyone can create an attempt"
  ON public.attempts FOR INSERT
  WITH CHECK (TRUE);

CREATE POLICY "Users can view their own attempts"
  ON public.attempts FOR SELECT
  USING (user_id = auth.uid()::text OR user_id LIKE 'guest-%');

CREATE POLICY "Quiz authors can view all attempts for their quiz"
  ON public.attempts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.quizzes
      WHERE quizzes.id = attempts.quiz_id
      AND quizzes.author_id = auth.uid()
    )
  );

CREATE POLICY "Users can update their own attempts"
  ON public.attempts FOR UPDATE
  USING (user_id = auth.uid()::text);

-- ============================================================
-- TRIGGER: Auto-create profile on signup
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.email, '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- TRIGGER: Update updated_at on profiles
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS on_profiles_updated ON public.profiles;
CREATE TRIGGER on_profiles_updated
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================
-- STORAGE BUCKET for Avatars
-- Run separately in Storage section or here:
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Avatar images are publicly accessible"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

CREATE POLICY "Users can upload their own avatar"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can update their own avatar"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete their own avatar"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);
