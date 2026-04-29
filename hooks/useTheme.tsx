import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type AppTheme = 'dark' | 'light';

type ThemeContextValue = {
  theme: AppTheme;
  loading: boolean;
  setTheme: (theme: AppTheme) => Promise<void>;
  toggleTheme: () => Promise<void>;
};

const STORAGE_KEY = 'appTheme';

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<AppTheme>('dark');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((saved) => {
        if (saved === 'light' || saved === 'dark') {
          setThemeState(saved);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  async function setTheme(nextTheme: AppTheme) {
    setThemeState(nextTheme);
    await AsyncStorage.setItem(STORAGE_KEY, nextTheme);
  }

  async function toggleTheme() {
    const nextTheme: AppTheme = theme === 'dark' ? 'light' : 'dark';
    await setTheme(nextTheme);
  }

  const value = useMemo(
    () => ({ theme, loading, setTheme, toggleTheme }),
    [theme, loading]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return ctx;
}
