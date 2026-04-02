// src/pages/QuizResult.tsx
// Updated: replaced firebase/firestore direct import with supabase client

import React, { useState, useEffect, useRef } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { useQuizStore } from '../store/QuizContext';
import { Button } from '../components/Button';
import { getAIExplanation, gradeEssayAI } from '../services/geminiService';
import {
  CheckCircle, XCircle, BrainCircuit, RefreshCcw, Home as HomeIcon,
  Loader2, AlignLeft, Trophy,
} from 'lucide-react';
import { EssayGrade, QuizAttempt } from '../types';
import { supabase } from '../services/supabase';

export const QuizResult: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { state } = useLocation();
  const navigate = useNavigate();
  const { getQuiz, attempts, updateAttempt, fetchAttemptsForQuiz } = useQuizStore();

  const attemptId = state?.attemptId;

  const [localAttempt, setLocalAttempt] = useState<QuizAttempt | null>(null);
  const [leaderboard, setLeaderboard] = useState<QuizAttempt[]>([]);
  const [loading, setLoading] = useState(true);

  const quiz = getQuiz(id ?? '');
  const currentAttempt = localAttempt ?? attempts.find(a => a.id === attemptId);

  const [loadingExplanation, setLoadingExplanation] = useState<string | null>(null);
  const [aiExplanations, setAiExplanations] = useState<Record<string, string>>({});
  const [gradingProgress, setGradingProgress] = useState<{ current: number; total: number } | null>(null);

  const gradingStartedRef = useRef(false);

  // ── Load attempt from Supabase if not in context ──────────────────────────
  useEffect(() => {
    const loadData = async () => {
      if (!id) return;

      if (attemptId && !attempts.find(a => a.id === attemptId)) {
        const { data } = await supabase
          .from('attempts')
          .select('*')
          .eq('id', attemptId)
          .single();

        if (data) {
          setLocalAttempt({
            id: data.id,
            quizId: data.quiz_id,
            userId: data.user_id ?? undefined,
            userName: data.user_name ?? undefined,
            answers: data.answers,
            score: data.score,
            essayGrades: data.essay_grades ?? {},
            timestamp: data.timestamp,
            status: data.status,
          });
        }
      }

      // Leaderboard
      try {
        const all = await fetchAttemptsForQuiz(id);
        const userBestMap = new Map<string, QuizAttempt>();
        all.forEach(att => {
          if (!att.userId) return;
          const existing = userBestMap.get(att.userId);
          if (!existing || att.score > existing.score) {
            userBestMap.set(att.userId, att);
          }
        });
        const sorted = Array.from(userBestMap.values()).sort((a, b) => b.score - a.score);
        setLeaderboard(sorted.slice(0, 5));
      } catch (e) {
        console.error('Error fetching leaderboard:', e);
      }

      setLoading(false);
    };

    loadData();
  }, [id, attemptId, attempts, fetchAttemptsForQuiz]);

  // ── Auto-grade essays ─────────────────────────────────────────────────────
  useEffect(() => {
    const gradeEssays = async () => {
      if (!currentAttempt || !quiz || currentAttempt.status === 'completed' || gradingStartedRef.current) return;

      gradingStartedRef.current = true;
      const essayQuestions = quiz.questions.filter(q => q.type === 'essay');
      if (essayQuestions.length === 0) return;

      setGradingProgress({ current: 0, total: essayQuestions.length });

      const newEssayGrades: Record<string, EssayGrade> = { ...(currentAttempt.essayGrades ?? {}) };

      for (let i = 0; i < essayQuestions.length; i++) {
        const q = essayQuestions[i];
        const answer = currentAttempt.answers[q.id];

        if (typeof answer === 'string' && !newEssayGrades[q.id]) {
          const grade = await gradeEssayAI(q.text, answer, q.sampleAnswer);
          newEssayGrades[q.id] = grade;
          setGradingProgress({ current: i + 1, total: essayQuestions.length });
        }
      }

      let totalPoints = 0;
      quiz.questions.forEach(q => {
        if (q.type === 'essay') {
          if (newEssayGrades[q.id]) totalPoints += newEssayGrades[q.id].score / 100;
        } else {
          if (currentAttempt.answers[q.id] === q.correctAnswerIndex) totalPoints += 1;
        }
      });

      const finalScore = (totalPoints / quiz.questions.length) * 100;
      const updates = { essayGrades: newEssayGrades, score: finalScore, status: 'completed' as const };

      await updateAttempt(currentAttempt.id, updates);

      if (localAttempt) {
        setLocalAttempt(prev => prev ? { ...prev, ...updates } : null);
      }

      setGradingProgress(null);
    };

    gradeEssays();
  }, [currentAttempt, quiz, updateAttempt, localAttempt]);

  if (loading || !quiz || !currentAttempt) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh]">
        <Loader2 className="h-10 w-10 animate-spin text-indigo-600 mb-4" />
        <p className="text-slate-500">Đang tải kết quả...</p>
        {!loading && (!quiz || !currentAttempt) && (
          <Button onClick={() => navigate('/')} className="mt-4">Trang chủ</Button>
        )}
      </div>
    );
  }

  const isGrading = currentAttempt.status === 'pending-grading' || gradingProgress !== null;
  const scoreColor = currentAttempt.score >= 80 ? 'text-green-600' : currentAttempt.score >= 50 ? 'text-yellow-600' : 'text-red-600';
  const scoreBg = currentAttempt.score >= 80 ? 'bg-green-100' : currentAttempt.score >= 50 ? 'bg-yellow-100' : 'bg-red-100';

  const fetchExplanation = async (questionId: string) => {
    if (aiExplanations[questionId]) return;
    setLoadingExplanation(questionId);
    const q = quiz.questions.find(quest => quest.id === questionId);
    if (q) {
      const userAnswerIdx = currentAttempt.answers[q.id] as number;
      const explanation = await getAIExplanation(
        q.text,
        q.options[userAnswerIdx],
        q.options[q.correctAnswerIndex]
      );
      setAiExplanations(prev => ({ ...prev, [questionId]: explanation }));
    }
    setLoadingExplanation(null);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-8 pb-12">
      {/* Score Card */}
      <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-md text-center space-y-4">
        {isGrading ? (
          <div className="py-8">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-indigo-50 text-indigo-600 mb-4 animate-pulse">
              <Loader2 className="h-10 w-10 animate-spin" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900">AI đang chấm bài...</h1>
            <p className="text-slate-500">
              {gradingProgress
                ? `Đang phân tích câu trả lời ${gradingProgress.current} / ${gradingProgress.total}`
                : 'Vui lòng đợi...'}
            </p>
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-bold text-slate-900">Hoàn thành!</h1>
            <div className={`inline-flex items-center justify-center w-32 h-32 rounded-full ${scoreBg} ${scoreColor} text-4xl font-black mb-4`}>
              {Math.round(currentAttempt.score)}%
            </div>
            <p className="text-slate-600">
              Bạn đạt được <span className="font-bold text-slate-900">{Math.round(currentAttempt.score)}%</span> tổng điểm.
            </p>
            <div className="flex justify-center gap-3 pt-4">
              <Button variant="outline" onClick={() => navigate('/')}>
                <HomeIcon className="h-4 w-4 mr-2" /> Trang chủ
              </Button>
              <Button onClick={() => navigate(`/quiz/${quiz.id}`)}>
                <RefreshCcw className="h-4 w-4 mr-2" /> Làm lại
              </Button>
            </div>
          </>
        )}
      </div>

      {/* Leaderboard */}
      {!isGrading && leaderboard.length > 0 && (
        <div className="bg-gradient-to-br from-indigo-900 to-indigo-800 rounded-2xl p-6 text-white shadow-lg">
          <div className="flex items-center gap-3 mb-6">
            <Trophy className="h-6 w-6 text-yellow-400" />
            <h2 className="text-xl font-bold">Bảng Xếp Hạng (Top 5)</h2>
          </div>
          <div className="space-y-3">
            {leaderboard.map((entry, idx) => (
              <div
                key={idx}
                className={`flex items-center justify-between p-3 rounded-xl ${entry.id === currentAttempt.id ? 'bg-white/20 border border-white/40' : 'bg-white/10'}`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 flex items-center justify-center rounded-full font-bold ${idx === 0 ? 'bg-yellow-400 text-yellow-900' : idx === 1 ? 'bg-slate-300 text-slate-800' : idx === 2 ? 'bg-orange-400 text-orange-900' : 'bg-indigo-700 text-white'}`}>
                    {idx + 1}
                  </div>
                  <span className="font-medium truncate max-w-[150px] sm:max-w-xs">{entry.userName ?? 'Ẩn danh'}</span>
                  {entry.id === currentAttempt.id && (
                    <span className="text-xs bg-indigo-500 px-2 py-0.5 rounded text-white">Bạn</span>
                  )}
                </div>
                <div className="font-bold text-lg">{Math.round(entry.score)}%</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Question breakdown */}
      <div className="space-y-6">
        <h2 className="text-xl font-bold text-slate-900 px-2">Chi tiết kết quả</h2>

        {quiz.questions.map((q) => {
          const answer = currentAttempt.answers[q.id];

          if (q.type === 'essay') {
            const grade = currentAttempt.essayGrades?.[q.id];
            return (
              <div key={q.id} className="bg-white rounded-xl border border-slate-200 p-6">
                <div className="flex items-start gap-4">
                  <AlignLeft className="h-6 w-6 text-indigo-500 mt-1 flex-shrink-0" />
                  <div className="flex-grow space-y-3">
                    <h3 className="font-medium text-slate-900 text-lg">{q.text}</h3>
                    {q.imageUrl && (
                      <div className="mb-3 rounded-lg overflow-hidden border border-slate-200 max-w-sm">
                        <img src={q.imageUrl} alt="Minh họa" className="w-full h-auto object-contain bg-slate-50" />
                      </div>
                    )}
                    <div className="bg-slate-50 p-4 rounded-lg text-sm text-slate-800">
                      <span className="block text-xs font-semibold text-slate-500 mb-1">Câu trả lời của bạn:</span>
                      {answer}
                    </div>
                    {grade ? (
                      <div className={`p-4 rounded-lg text-sm border ${grade.score >= 70 ? 'bg-green-50 border-green-100 text-green-900' : 'bg-yellow-50 border-yellow-100 text-yellow-900'}`}>
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-bold flex items-center">
                            <BrainCircuit className="h-4 w-4 mr-2" /> Nhận xét từ AI
                          </span>
                          <span className="font-bold text-lg">{grade.score}/100</span>
                        </div>
                        <p>{grade.feedback}</p>
                      </div>
                    ) : (
                      <div className="p-4 rounded-lg text-sm bg-slate-50 border border-slate-100 text-slate-500 flex items-center">
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Đang chấm điểm...
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          }

          const userAnswerIdx = answer as number;
          const isCorrect = userAnswerIdx === q.correctAnswerIndex;
          const showAiExplanation = aiExplanations[q.id];

          return (
            <div key={q.id} className={`bg-white rounded-xl border p-6 ${isCorrect ? 'border-slate-200' : 'border-red-200'}`}>
              <div className="flex items-start gap-4">
                <div className="mt-1 flex-shrink-0">
                  {isCorrect
                    ? <CheckCircle className="h-6 w-6 text-green-500" />
                    : <XCircle className="h-6 w-6 text-red-500" />}
                </div>
                <div className="flex-grow space-y-3">
                  <h3 className="font-medium text-slate-900 text-lg">{q.text}</h3>
                  {q.imageUrl && (
                    <div className="mb-3 rounded-lg overflow-hidden border border-slate-200 max-w-sm">
                      <img src={q.imageUrl} alt="Minh họa" className="w-full h-auto object-contain bg-slate-50" />
                    </div>
                  )}
                  <div className="space-y-2 text-sm">
                    <div className={`flex items-center p-2 rounded-lg ${isCorrect ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
                      <span className="font-semibold w-24 flex-shrink-0">Bạn chọn:</span>
                      <span>{q.options[userAnswerIdx]}</span>
                    </div>
                    {!isCorrect && (
                      <div className="flex items-center p-2 rounded-lg bg-green-50 text-green-800">
                        <span className="font-semibold w-24 flex-shrink-0">Đáp án:</span>
                        <span>{q.options[q.correctAnswerIndex]}</span>
                      </div>
                    )}
                  </div>
                  <div className="pt-2">
                    {q.explanation && (
                      <p className="text-sm text-slate-500 italic mb-2">Ghi chú: {q.explanation}</p>
                    )}
                    {!isCorrect && !showAiExplanation && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => fetchExplanation(q.id)}
                        isLoading={loadingExplanation === q.id}
                        className="text-indigo-600 hover:bg-indigo-50 pl-0 hover:pl-2"
                      >
                        <BrainCircuit className="h-4 w-4 mr-2" />
                        Hỏi AI tại sao tôi sai
                      </Button>
                    )}
                    {showAiExplanation && (
                      <div className="bg-indigo-50 p-4 rounded-lg text-sm text-indigo-900 flex gap-3">
                        <BrainCircuit className="h-5 w-5 text-indigo-600 flex-shrink-0" />
                        <div>
                          <span className="font-bold block mb-1">Phản hồi từ Gemini:</span>
                          {showAiExplanation}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
