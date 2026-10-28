import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from './api.js';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined);   // undefined = still checking, null = signed out
  useEffect(() => { api.get('/auth/me').then((r) => setUser(r.user)).catch(() => setUser(null)); }, []);
  const login = useCallback(async (email, password) => { const r = await api.post('/auth/login', { email, password }); setUser(r.user); return r.user; }, []);
  const register = useCallback(async (payload) => { const r = await api.post('/auth/register', payload); setUser(r.user); return r.user; }, []);
  const logout = useCallback(async () => { try { await api.post('/auth/logout'); } finally { setUser(null); } }, []);
  return <Ctx.Provider value={{ user, login, register, logout }}>{children}</Ctx.Provider>;
}
