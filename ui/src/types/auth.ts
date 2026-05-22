export type AuthUser = { id: string; email: string; displayName: string; role: "USER" | "ADMIN" };

export type AuthState = { token: string; user: AuthUser } | null;
