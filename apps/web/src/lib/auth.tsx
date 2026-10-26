import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import toast from 'react-hot-toast';
import { get, post, refreshSession, setAccessToken, setLogoutHandler } from './api';

export type Role = 'SUPER_ADMIN' | 'COMPANY_ADMIN' | 'PAYROLL_MANAGER' | 'REPORTING_MANAGER' | 'EMPLOYEE';
export interface Me {
  id: string; email: string; roles: Role[]; employeeId: string | null; totpEnabled: boolean; lastLoginAt: string | null; mustChangePassword?: boolean;
  company: { id: string; name: string }; employee: { firstName: string; lastName: string; code: string } | null;
}
interface AuthCtx {
  me: Me | null; ready: boolean;
  login: (email: string, password: string) => Promise<{ otpRequired?: boolean; challenge?: string }>;
  verifyOtp: (challenge: string, code: string) => Promise<void>;
  logout: (reason?: string) => Promise<void>;
  can: (...roles: Role[]) => boolean;
  reload: () => Promise<void>;
}
const Ctx = createContext<AuthCtx>(null!);
const IDLE_MS = 15 * 60_000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const qc = useQueryClient();
  const idleTimer = useRef<number>();

  const reload = useCallback(async () => setMe(await get<Me>('/auth/me')), []);
  const clear = useCallback(() => { setAccessToken(null); setMe(null); qc.clear(); }, [qc]);

  const logout = useCallback(async (reason?: string) => {
    await post('/auth/logout').catch(() => {});
    clear();
    if (reason) toast(reason, { icon: '🔒' });
  }, [clear]);

  useEffect(() => {
    setLogoutHandler(() => { clear(); });
    // Restore session from the httpOnly refresh cookie; keep the preloader up at least briefly so it doesn't flash.
    const minDelay = new Promise((r) => setTimeout(r, 1100));
    (async () => {
      if (await refreshSession()) await reload().catch(() => {});
      await minDelay;
      setReady(true);
    })();
  }, [clear, reload]);

  // Auto sign-out after 15 minutes without activity: payroll screens hold sensitive data.
  useEffect(() => {
    if (!me) return;
    const reset = () => { clearTimeout(idleTimer.current); idleTimer.current = window.setTimeout(() => logout('Signed out after 15 minutes of inactivity'), IDLE_MS); };
    const events = ['mousemove', 'keydown', 'touchstart', 'scroll'];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => { clearTimeout(idleTimer.current); events.forEach((e) => window.removeEventListener(e, reset)); };
  }, [me, logout]);

  const finish = async (b: { accessToken: string }) => { setAccessToken(b.accessToken); await reload(); };
  const login: AuthCtx['login'] = async (email, password) => {
    const b = await post('/auth/login', { email, password });
    if (b.otpRequired) return b;
    await finish(b);
    return {};
  };
  const verifyOtp = async (challenge: string, code: string) => finish(await post('/auth/otp/verify', { challenge, code }));
  const can = (...roles: Role[]) => !!me?.roles.some((r) => r === 'SUPER_ADMIN' || roles.includes(r));

  return <Ctx.Provider value={{ me, ready, login, verifyOtp, logout, can, reload }}>{children}</Ctx.Provider>;
}
export const useAuth = () => useContext(Ctx);
