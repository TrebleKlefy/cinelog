import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { setAuth } from "../../lib/authStorage";
import type { AuthState, AuthUser } from "../../types/auth";

export function LoginPage({ onLogin }: { onLogin: (auth: AuthState) => void }) {
  const [email, setEmail] = useState("admin@demo.com");
  const [password, setPassword] = useState("Admin123!");
  const [error, setError] = useState("");
  const mutation = useMutation({
    mutationFn: () =>
      api<{ token: string; user: AuthUser }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      }),
    onSuccess: (data) => {
      const auth: AuthState = { token: data.token, user: data.user };
      setAuth(auth);
      onLogin(auth);
    },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <main className="auth-shell">
      <section className="auth">
        <div className="auth__brand">
          <img
            src="/cinelog-logo.png"
            alt=""
            width={160}
            height={160}
            decoding="async"
            className="auth__brand-logo"
            aria-hidden
          />
          <h1 className="auth__brand-name">cineLog</h1>
          <p className="auth__brand-tagline">Your film archive</p>
        </div>
        <div className="auth__header">
          <h2>Welcome back</h2>
          <p>Sign in to your catalog, discover titles, and get personalized picks.</p>
        </div>
        <div className="auth__hint">
          <p>
            <strong>Demo admin:</strong> admin@demo.com / Admin123!
          </p>
          <p>
            <strong>Demo user:</strong> user@demo.com / User123!
          </p>
        </div>
        <label className="field">
          <span>Email</span>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        </label>
        <label className="field">
          <span>Password</span>
          <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="Enter password" />
        </label>
        <button type="button" className="button button--gold" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          {mutation.isPending ? "Signing in..." : "Sign in"}
        </button>
        {error && <p className="status status--error">{error}</p>}
      </section>
    </main>
  );
}
