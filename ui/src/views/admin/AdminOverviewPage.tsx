import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import type { AuthState } from "../../types/auth";

export function AdminOverviewPage({ auth }: { auth: AuthState }) {
  if (!auth) return null;
  const token = auth.token;
  const stats = useQuery({
    queryKey: ["admin-stats"],
    queryFn: () =>
      api<{
        users: number;
        movies: number;
        auditLogs: number;
        collections: number;
      }>("/api/admin/stats", undefined, token),
  });
  const providers = useQuery({
    queryKey: ["admin-llm"],
    queryFn: () =>
      api<{ active: { providerKey: string; modelKey: string } | null }>("/api/admin/llm/providers", undefined, token),
  });

  const cards = [
    { label: "Registered users", value: stats.data?.users, to: "/admin/users" },
    { label: "Movies in catalog", value: stats.data?.movies },
    { label: "Audit events", value: stats.data?.auditLogs, to: "/admin/audit" },
    { label: "Collections", value: stats.data?.collections },
  ];

  return (
    <div className="admin-page">
      <div className="admin-page__header">
        <h2 className="admin-page__title">Overview</h2>
        <p className="admin-page__subtitle">High-level metrics and quick access to admin tools.</p>
      </div>

      {stats.error && <p className="admin-banner admin-banner--error">{(stats.error as Error).message}</p>}

      <div className="admin-stat-grid">
        {cards.map((c) => {
          const inner = (
            <>
              <span className="admin-stat-card__label">{c.label}</span>
              <span className="admin-stat-card__value">{stats.isLoading ? "…" : (c.value ?? "—")}</span>
            </>
          );
          return c.to ? (
            <Link key={c.label} to={c.to} className="admin-stat-card admin-stat-card--link">
              {inner}
            </Link>
          ) : (
            <div key={c.label} className="admin-stat-card">
              {inner}
            </div>
          );
        })}
      </div>

      <section className="admin-panel">
        <h3 className="admin-panel__title">Active AI configuration</h3>
        <p className="admin-panel__text">
          {providers.isLoading
            ? "Loading…"
            : providers.data?.active
              ? `${providers.data.active.providerKey} · ${providers.data.active.modelKey}`
              : "Not configured"}
        </p>
        <Link to="/admin/ai" className="admin-link-button">
          Manage models →
        </Link>
      </section>
    </div>
  );
}
