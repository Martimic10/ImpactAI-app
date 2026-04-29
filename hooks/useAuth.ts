import { useState, useEffect } from 'react';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import Constants from 'expo-constants';
import { supabase } from '@/lib/supabase';
import { User } from '@/types';
import { Session } from '@supabase/supabase-js';
import { DEV_MODE, MOCK_USER } from '@/lib/devMode';

WebBrowser.maybeCompleteAuthSession();

export function useAuth() {
  const [user, setUser] = useState<User | null>(DEV_MODE ? MOCK_USER : null);
  const [session, setSession] = useState<Session | null>(
    DEV_MODE ? ({} as Session) : null
  );
  const [loading, setLoading] = useState(!DEV_MODE);

  useEffect(() => {
    if (DEV_MODE) return;

    const timeout = setTimeout(() => setLoading(false), 5000);

    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        clearTimeout(timeout);
        setSession(session);
        if (session?.user) {
          fetchProfile(session.user.id, session.user.email ?? '');
        } else {
          setLoading(false);
        }
      })
      .catch(() => {
        clearTimeout(timeout);
        setLoading(false);
      });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        if (session?.user) {
          fetchProfile(session.user.id, session.user.email ?? '');
        } else {
          setUser(null);
          setLoading(false);
        }
      }
    );

    return () => {
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, []);

  async function fetchProfile(userId: string, email: string) {
    let authAvatar: string | undefined;
    try {
      const { data: authData } = await supabase.auth.getUser();
      authAvatar = authData.user?.user_metadata?.avatar_url as string | undefined;
    } catch {
      authAvatar = undefined;
    }

    try {
      const { data } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();

      if (data) {
        const profile = data as User;
        setUser({ ...profile, avatar_url: profile.avatar_url ?? authAvatar });
      } else {
        // Table exists but no row — use fallback from auth data
        setUser({
          id: userId,
          email,
          username: email.split('@')[0],
          plan: 'free',
          role: 'user',
          avatar_url: authAvatar,
        });
      }
    } catch {
      // Table doesn't exist yet — use auth data as fallback
      setUser({
        id: userId,
        email,
        username: email.split('@')[0],
        plan: 'free',
        role: 'user',
        avatar_url: authAvatar,
      });
    } finally {
      setLoading(false);
    }
  }

  async function signIn(email: string, password: string) {
    if (DEV_MODE) { setUser(MOCK_USER); setSession({} as Session); return; }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  async function signUp(email: string, password: string, username: string) {
    if (DEV_MODE) { setUser({ ...MOCK_USER, email, username }); setSession({} as Session); return; }

    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;

    if (data.user) {
      // Best-effort insert — graceful if table doesn't exist yet
      try {
        await supabase.from('users').insert({
          id: data.user.id,
          email,
          username,
          plan: 'free',
          role: 'user',
        });
      } catch {
        // graceful if table doesn't exist yet
      }
    }
  }

  async function signInWithOAuth(provider: 'google' | 'apple') {
    if (DEV_MODE) { setUser(MOCK_USER); setSession({} as Session); return; }
    if (Constants.appOwnership === 'expo') {
      throw new Error(
        `${provider === 'google' ? 'Google' : 'Apple'} sign-in is not supported in Expo Go. Use a development build (\`npm run ios\` or \`npm run android\`).`
      );
    }

    const redirectTo = Linking.createURL('auth/callback', { scheme: 'impactai' });

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo, skipBrowserRedirect: true },
    });

    if (error) throw error;
    if (!data.url) throw new Error('No OAuth URL returned');

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

    if (result.type === 'success') {
      const parsed = Linking.parse(result.url);
      const code = parsed.queryParams?.code as string | undefined;
      if (code) {
        const { error: sessionError } = await supabase.auth.exchangeCodeForSession(code);
        if (sessionError) throw sessionError;
      }
    }
  }

  async function signInWithGoogle() {
    await signInWithOAuth('google');
  }

  async function signInWithApple() {
    await signInWithOAuth('apple');
  }

  async function signOut() {
    if (DEV_MODE) return;
    await supabase.auth.signOut();
  }

  function extensionFromUri(uri: string) {
    const clean = uri.split('?')[0];
    const ext = clean.split('.').pop()?.toLowerCase();
    if (!ext || ext.length > 5) return 'jpg';
    return ext;
  }

  function contentTypeFromExt(ext: string) {
    if (ext === 'png') return 'image/png';
    if (ext === 'webp') return 'image/webp';
    if (ext === 'heic' || ext === 'heif') return 'image/heic';
    return 'image/jpeg';
  }

  async function updateAvatar(localUri: string) {
    if (!user) throw new Error('You must be signed in to update avatar.');

    if (DEV_MODE) {
      setUser((prev) => (prev ? { ...prev, avatar_url: localUri } : prev));
      return localUri;
    }

    const { data: authData } = await supabase.auth.getUser();
    const uid = authData.user?.id ?? user.id;

    const response = await fetch(localUri);
    const arrayBuffer = await response.arrayBuffer();
    const extension = extensionFromUri(localUri);
    const contentType = contentTypeFromExt(extension);
    const filePath = `${uid}/${Date.now()}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(filePath, arrayBuffer, {
        cacheControl: '3600',
        upsert: true,
        contentType,
      });

    if (uploadError) {
      if (uploadError.message.toLowerCase().includes('bucket')) {
        throw new Error('Avatar upload failed: missing "avatars" storage bucket.');
      }
      if (uploadError.message.toLowerCase().includes('row-level security')) {
        throw new Error('Avatar upload blocked by storage RLS policy.');
      }
      throw new Error(`Avatar upload failed: ${uploadError.message}`);
    }

    const { data: publicUrlData } = supabase.storage.from('avatars').getPublicUrl(filePath);
    const avatarUrl = publicUrlData.publicUrl;

    async function persistAvatarInAuthMetadata() {
      const { error: authMetaError } = await supabase.auth.updateUser({
        data: { avatar_url: avatarUrl },
      });
      if (authMetaError) {
        throw new Error(`Profile update failed: ${authMetaError.message}`);
      }
    }

    const { data: updatedRow, error: updateError } = await supabase
      .from('users')
      .update({ avatar_url: avatarUrl })
      .eq('id', uid)
      .select('id')
      .maybeSingle();

    if (updateError) {
      if (
        updateError.message.includes('record "new" has no field "updated_at"') ||
        updateError.message.includes('updated_at')
      ) {
        await persistAvatarInAuthMetadata();
        setUser((prev) => (prev ? { ...prev, avatar_url: avatarUrl } : prev));
        return avatarUrl;
      }
      throw new Error(`Profile update failed: ${updateError.message}`);
    }

    if (!updatedRow) {
      const { data: existingRow, error: existingError } = await supabase
        .from('users')
        .select('id')
        .eq('id', uid)
        .maybeSingle();

      if (existingError) {
        if (
          existingError.message.includes('record "new" has no field "updated_at"') ||
          existingError.message.includes('updated_at')
        ) {
          await persistAvatarInAuthMetadata();
          setUser((prev) => (prev ? { ...prev, avatar_url: avatarUrl } : prev));
          return avatarUrl;
        }
        throw new Error(`Profile update failed: ${existingError.message}`);
      }

      if (existingRow) {
        throw new Error('Profile update blocked by row-level security policy.');
      }

      const { error: insertError } = await supabase.from('users').insert({
        id: uid,
        email: user.email,
        username: user.username,
        plan: user.plan,
        role: user.role,
        avatar_url: avatarUrl,
      });
      if (insertError) {
        throw new Error(`Profile update failed: ${insertError.message}`);
      }
    }

    setUser((prev) => (prev ? { ...prev, avatar_url: avatarUrl } : prev));
    return avatarUrl;
  }

  return {
    user,
    session,
    loading,
    signIn,
    signUp,
    signInWithGoogle,
    signInWithApple,
    signOut,
    updateAvatar,
  };
}
