import type { AuthState } from "../types/auth";

const KEY = "auth";

export function getAuth(): AuthState {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthState;
  } catch {
    return null;
  }
}

export function setAuth(auth: AuthState): void {
  if (!auth) localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, JSON.stringify(auth));
}
