// src/store/QuizContext.tsx
// Replaces: Firestore-based QuizContext
// Uses: Supabase Realtime + standard REST queries

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from 'react';
import { supabase } from '../services/supabase';
import { Quiz, QuizAttempt } from '../types';
import { useAuth } from './AuthContext';

// ─── Helpers: map DB snake_case ↔ our camelCase types ────────────────────────
function dbToQuiz(row: any): Quiz {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    topic: row.topic,
    difficulty: row.difficulty,
    questions: row.questions,
    createdAt: row.created_at,
    author: row.author,
    authorId: row.author_id,
    deletedAt: row.deleted_at ?? undefined,
    isPublic: row.is_public,
    shortCode: row.short_code ?? undefined,
  };
}

function quizToDb(quiz: Quiz, authorId?: string) {
  return {
    id: quiz.id,
    title: quiz.title,
    description: quiz.description,
    topic: quiz.topic ?? 'Chung',
    difficulty: quiz.difficulty ?? 'medium',
    questions: quiz.questions,
    created_at: quiz.createdAt,
    author: quiz.author,
    author_id: authorId ?? quiz.authorId ?? null,
    deleted_at: quiz.deletedAt ?? null,
    is_public: quiz.isPublic ?? false,
    short_code: quiz.shortCode ?? null,
  };
}

function dbToAttempt(row: any): QuizAttempt {
  return {
    id: row.id,
    quizId: row.quiz_id,
    userId: row.user_id ?? undefined,
    userName: row.user_name ?? undefined,
    answers: row.answers,
    score: row.score,
    essayGrades: row.essay_grades ?? {},
    timestamp: row.timestamp,
    status: row.status,
  };
}

function attemptToDb(attempt: QuizAttempt) {
  return {
    id: attempt.id,
    quiz_id: attempt.quizId,
    user_id: attempt.userId ?? null,
    user_name: attempt.userName ?? null,
    answers: attempt.answers,
    score: attempt.score,
    essay_grades: attempt.essayGrades ?? {},
    timestamp: attempt.timestamp,
    status: attempt.status,
  };
}

// ─── Context type ─────────────────────────────────────────────────────────────
interface QuizContextType {
  quizzes: Quiz[];
  attempts: QuizAttempt[];
  addQuiz: (quiz: Quiz) => Promise<void>;
  editQuiz: (quiz: Quiz) => Promise<void>;
  deleteQuiz: (id: string) => Promise<void>;
  restoreQuiz: (id: string) => Promise<void>;
  permanentDeleteQuiz: (id: string) => Promise<void>;
  deleteAllQuizzesByAuthor: (authorId: string) => Promise<void>;
  togglePublishQuiz: (id: string, isPublic: boolean) => Promise<void>;
  getPublicQuizzes: () => Promise<Quiz[]>;
  importQuiz: (quiz: Quiz) => Promise<void>;
  updateAttempt: (id: string, updates: Partial<QuizAttempt>) => Promise<void>;
  addAttempt: (attempt: QuizAttempt) => Promise<void>;
  getQuiz: (id: string) => Quiz | undefined;
  getQuizByShortCode: (code: string) => Promise<Quiz | undefined>;
  fetchQuizById: (id: string) => Promise<boolean>;
  publishQuiz: (id: string) => Promise<void>;
  getAllAttemptsForQuiz: (quizId: string) => QuizAttempt[];
  fetchAttemptsForQuiz: (quizId: string) => Promise<QuizAttempt[]>;
  isLoading: boolean;
}

const QuizContext = createContext<QuizContextType | undefined>(undefined);

export const QuizProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { user, isLoading: authLoading } = useAuth();

  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [publicQuizzes, setPublicQuizzes] = useState<Quiz[]>([]);
  const [attempts, setAttempts] = useState<QuizAttempt[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // ── Load user's quizzes with Supabase Realtime ────────────────────────────
  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      setQuizzes([]);
      setAttempts([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    // Initial fetch
    const fetchUserData = async () => {
      const [{ data: quizData }, { data: attemptData }] = await Promise.all([
        supabase
          .from('quizzes')
          .select('*')
          .eq('author_id', user.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('attempts')
          .select('*')
          .eq('user_id', user.id),
      ]);

      setQuizzes((quizData ?? []).map(dbToQuiz));
      setAttempts((attemptData ?? []).map(dbToAttempt));
      setIsLoading(false);
    };

    fetchUserData();

    // Realtime subscription for user's quizzes
    const quizChannel = supabase
      .channel(`quizzes:author:${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'quizzes', filter: `author_id=eq.${user.id}` },
        (payload) => {
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const updated = dbToQuiz(payload.new);
            setQuizzes(prev => {
              const idx = prev.findIndex(q => q.id === updated.id);
              if (idx >= 0) {
                const next = [...prev];
                next[idx] = updated;
                return next;
              }
              return [updated, ...prev];
            });
          } else if (payload.eventType === 'DELETE') {
            setQuizzes(prev => prev.filter(q => q.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    // Realtime subscription for user's attempts
    const attemptChannel = supabase
      .channel(`attempts:user:${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'attempts', filter: `user_id=eq.${user.id}` },
        (payload) => {
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const updated = dbToAttempt(payload.new);
            setAttempts(prev => {
              const idx = prev.findIndex(a => a.id === updated.id);
              if (idx >= 0) {
                const next = [...prev];
                next[idx] = updated;
                return next;
              }
              return [updated, ...prev];
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(quizChannel);
      supabase.removeChannel(attemptChannel);
    };
  }, [user, authLoading]);

  // ── CRUD ──────────────────────────────────────────────────────────────────
  const addQuiz = async (quiz: Quiz) => {
    if (!user) return;
    const row = quizToDb(quiz, user.id);
    row.author = user.name;
    const { error } = await supabase.from('quizzes').insert(row);
    if (error) throw new Error(error.message);
  };

  const editQuiz = async (updatedQuiz: Quiz) => {
    if (!user) return;
    const row = quizToDb(updatedQuiz, user.id);
    const { error } = await supabase
      .from('quizzes')
      .upsert(row, { onConflict: 'id' });
    if (error) throw new Error(error.message);

    // Update publicQuizzes cache too
    setPublicQuizzes(prev =>
      prev.map(q => q.id === updatedQuiz.id ? updatedQuiz : q)
    );
  };

  const publishQuiz = async (id: string) => {
    const { error } = await supabase
      .from('quizzes')
      .update({ is_public: true })
      .eq('id', id);
    if (error) throw new Error(error.message);
  };

  const togglePublishQuiz = async (id: string, isPublic: boolean) => {
    if (!user) return;
    const { error } = await supabase
      .from('quizzes')
      .update({ is_public: isPublic })
      .eq('id', id);
    if (error) throw new Error(error.message);
  };

  // Soft delete
  const deleteQuiz = async (id: string) => {
    if (!user) return;
    const { error } = await supabase
      .from('quizzes')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new Error(error.message);
  };

  // Restore from trash
  const restoreQuiz = async (id: string) => {
    if (!user) return;
    const { error } = await supabase
      .from('quizzes')
      .update({ deleted_at: null })
      .eq('id', id);
    if (error) throw new Error(error.message);
  };

  // Hard delete
  const permanentDeleteQuiz = async (id: string) => {
    if (!user) return;
    const { error } = await supabase
      .from('quizzes')
      .delete()
      .eq('id', id);
    if (error) throw new Error(error.message);
  };

  const deleteAllQuizzesByAuthor = async (authorId: string) => {
    const { error } = await supabase
      .from('quizzes')
      .delete()
      .eq('author_id', authorId);
    if (error) throw new Error(error.message);
  };

  const getPublicQuizzes = async (): Promise<Quiz[]> => {
    const { data, error } = await supabase
      .from('quizzes')
      .select('*')
      .eq('is_public', true)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching public quizzes:', error);
      return [];
    }
    return (data ?? []).map(dbToQuiz);
  };

  // Import a quiz from a share link into local cache
  const importQuiz = async (quiz: Quiz) => {
    setPublicQuizzes(prev => {
      if (prev.some(q => q.id === quiz.id)) return prev;
      return [...prev, quiz];
    });

    try {
      const { data } = await supabase
        .from('quizzes')
        .select('*')
        .eq('id', quiz.id)
        .single();
      if (data) {
        const fresh = dbToQuiz(data);
        setPublicQuizzes(prev => {
          const idx = prev.findIndex(q => q.id === fresh.id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = fresh;
            return next;
          }
          return [...prev, fresh];
        });
      }
    } catch (e) {
      console.error('Error refreshing imported quiz:', e);
    }
  };

  // ── Attempts ───────────────────────────────────────────────────────────────
  const addAttempt = async (attempt: QuizAttempt) => {
    const { error } = await supabase
      .from('attempts')
      .insert(attemptToDb(attempt));
    if (error) throw new Error(error.message);

    // Add to local state for immediate result display
    setAttempts(prev => [...prev, attempt]);
  };

  const updateAttempt = async (id: string, updates: Partial<QuizAttempt>) => {
    const dbUpdates: Record<string, any> = {};
    if (updates.score !== undefined) dbUpdates.score = updates.score;
    if (updates.status !== undefined) dbUpdates.status = updates.status;
    if (updates.essayGrades !== undefined) dbUpdates.essay_grades = updates.essayGrades;

    const { error } = await supabase
      .from('attempts')
      .update(dbUpdates)
      .eq('id', id);
    if (error) throw new Error(error.message);

    setAttempts(prev =>
      prev.map(a => a.id === id ? { ...a, ...updates } : a)
    );
  };

  // ── Queries ────────────────────────────────────────────────────────────────
  const getQuiz = useCallback((id: string) => {
    return quizzes.find(q => q.id === id) || publicQuizzes.find(q => q.id === id);
  }, [quizzes, publicQuizzes]);

  const fetchQuizById = useCallback(async (id: string): Promise<boolean> => {
    if (getQuiz(id)) return true;

    const { data, error } = await supabase
      .from('quizzes')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) return false;

    const quiz = dbToQuiz(data);
    setPublicQuizzes(prev => {
      if (prev.some(q => q.id === quiz.id)) return prev;
      return [...prev, quiz];
    });
    return true;
  }, [getQuiz]);

  const getQuizByShortCode = useCallback(async (code: string): Promise<Quiz | undefined> => {
    const local =
      quizzes.find(q => q.shortCode === code) ||
      publicQuizzes.find(q => q.shortCode === code);
    if (local) return local;

    const { data, error } = await supabase
      .from('quizzes')
      .select('*')
      .eq('short_code', code)
      .single();

    if (error || !data) return undefined;

    const quiz = dbToQuiz(data);
    setPublicQuizzes(prev => {
      if (prev.some(q => q.id === quiz.id)) return prev;
      return [...prev, quiz];
    });
    return quiz;
  }, [quizzes, publicQuizzes]);

  const getAllAttemptsForQuiz = (quizId: string): QuizAttempt[] => {
    return attempts.filter(a => a.quizId === quizId);
  };

  const fetchAttemptsForQuiz = async (quizId: string): Promise<QuizAttempt[]> => {
    const { data, error } = await supabase
      .from('attempts')
      .select('*')
      .eq('quiz_id', quizId)
      .order('score', { ascending: false });

    if (error) {
      console.error('Error fetching attempts:', error);
      return [];
    }
    return (data ?? []).map(dbToAttempt);
  };

  return (
    <QuizContext.Provider
      value={{
        quizzes,
        attempts,
        addQuiz,
        editQuiz,
        deleteQuiz,
        restoreQuiz,
        permanentDeleteQuiz,
        deleteAllQuizzesByAuthor,
        togglePublishQuiz,
        getPublicQuizzes,
        importQuiz,
        addAttempt,
        updateAttempt,
        getQuiz,
        getQuizByShortCode,
        fetchQuizById,
        publishQuiz,
        getAllAttemptsForQuiz,
        fetchAttemptsForQuiz,
        isLoading,
      }}
    >
      {children}
    </QuizContext.Provider>
  );
};

export const useQuizStore = () => {
  const ctx = useContext(QuizContext);
  if (!ctx) throw new Error('useQuizStore must be used within QuizProvider');
  return ctx;
};
