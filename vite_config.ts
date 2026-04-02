// vite.config.ts
// Updated: removed Firebase-specific defines, added Supabase VITE_ vars (auto-exposed)

import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react()],
    define: {
      // Gemini API key — keep supporting both naming conventions
      'process.env.GEMINI_API_KEY': JSON.stringify(
        env.GEMINI_API_KEY || env.VITE_GEMINI_API_KEY || ''
      ),
    },
    // VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are automatically
    // exposed via import.meta.env because they start with VITE_
    // No extra config needed for Supabase vars.
  };
});
