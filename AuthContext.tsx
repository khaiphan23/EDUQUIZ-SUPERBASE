// src/store/AuthContext.tsx
// Replaces: Firebase onAuthStateChanged → Supabase onAuthStateChange

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from 'react';
import { supabase } from '../services/supabase';
import { authService } from '../services/authService';
import { User } from '../types';

interface AuthContextType {
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  deleteAccount: () => Promise<void>;
  updateUserProfile: (updates: {
    name?: string;
    photoURL?: string;
    bio?: string;
    notifications?: { email: boolean; push: boolean; activitySummary: boolean };
    preferences?: { theme: 'light' | 'dark' | 'system'; language: 'vi' | 'en' };
  }) => Promise<void>;
  updateUserPassword: (currentPassword: string, newPassword: string) => Promise<void>;
  uploadAvatar: (file: File) => Promise<string>;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // ── Bootstrap: subscribe to Supabase auth state ───────────────────────────
  useEffect(() => {
    // Initial session check
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        const fullUser = await authService.getCurrentUser();
        setUser(fullUser);
      }
      setIsLoading(false);
    });

    // Listen for login / logout / token refresh
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (session?.user) {
          const fullUser = await authService.getCurrentUser();
          setUser(fullUser);
        } else {
          setUser(null);
        }
        setIsLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  // ── Apply theme when user preferences change ──────────────────────────────
  useEffect(() => {
    const theme = user?.preferences?.theme ?? 'light';
    const root = window.document.documentElement;

    const applyTheme = (target: string) => {
      root.classList.remove('light', 'dark');
      if (target === 'system') {
        const sys = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        root.classList.add(sys);
      } else {
        root.classList.add(target);
      }
    };

    applyTheme(theme);

    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = () => applyTheme('system');
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
  }, [user?.preferences?.theme]);

  // ── Auth actions ──────────────────────────────────────────────────────────
  const login = async (email: string, password: string) => {
    const loggedInUser = await authService.login(email, password);
    setUser(loggedInUser);
  };

  const register = async (name: string, email: string, password: string) => {
    const newUser = await authService.register(name, email, password);
    setUser(newUser);
  };

  const logout = () => {
    authService.logout();
    setUser(null);
  };

  const deleteAccount = async () => {
    await authService.deleteAccount();
    setUser(null);
  };

  const updateUserProfile = async (updates: {
    name?: string;
    photoURL?: string;
    bio?: string;
    notifications?: { email: boolean; push: boolean; activitySummary: boolean };
    preferences?: { theme: 'light' | 'dark' | 'system'; language: 'vi' | 'en' };
  }) => {
    if (!user) return;
    await authService.updateUserProfile(user.id, updates);
    // Optimistic local update
    setUser(prev => prev ? { ...prev, ...updates } : null);
  };

  const updateUserPassword = async (currentPassword: string, newPassword: string) => {
    if (!user) return;
    await authService.updateUserPassword(currentPassword, newPassword);
  };

  const uploadAvatar = async (file: File): Promise<string> => {
    if (!user) throw new Error('Chưa đăng nhập');
    return authService.uploadAvatar(user.id, file);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        login,
        register,
        logout,
        deleteAccount,
        updateUserProfile,
        updateUserPassword,
        uploadAvatar,
        isLoading,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
