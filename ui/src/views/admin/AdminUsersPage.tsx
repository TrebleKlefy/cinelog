import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import type { AuthState } from "../../types/auth";

export function AdminUsersPage({ auth }: { auth: AuthState }) {
  if (!auth) return null;
  const token = auth.token;
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");

  const query = useQuery({
    queryKey: ["admin-users", page, search],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: "20" });
      if (search.trim()) params.set("q", search.trim());
      return api<{
        page: number;
        pageSize: number;
        total: number;
        items: Array<{
          id: string;
          email: string;
          displayName: string;
          role: string;
          createdAt: string;
          ratingsCount: number;
          collectionsCount: number;
        }>;
      }>(`/api/admin/users?${params}`, undefined, token);
    },
  });

  const totalPages = query.data ? Math.max(1, Math.ceil(query.data.total / query.data.pageSize)) : 1;

  return (
    <div className="admin-page">
      <div className="admin-page__header">
        <h2 className="admin-page__title">Users</h2>
        <p className="admin-page__subtitle">Search accounts, roles, and engagement counts (read-only).</p>
      </div>

      <div className="admin-toolbar">
        <div className="admin-toolbar__search">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (setSearch(q), setPage(1))}
            placeholder="Search email or display name…"
          />
          <button type="button" className="button button--sm" onClick={() => { setSearch(q); setPage(1); }}>
            Search
          </button>
        </div>
      </div>

      {query.error && <p className="admin-banner admin-banner--error">{(query.error as Error).message}</p>}

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Display name</th>
              <th>Role</th>
              <th className="admin-table__num">Ratings</th>
              <th className="admin-table__num">Collections</th>
              <th>Joined</th>
            </tr>
          </thead>
          <tbody>
            {query.isLoading ? (
              <tr>
                <td colSpan={6} className="admin-table__empty">
                  Loading…
                </td>
              </tr>
            ) : query.data?.items.length === 0 ? (
              <tr>
                <td colSpan={6} className="admin-table__empty">
                  No users match.
                </td>
              </tr>
            ) : (
              query.data?.items.map((u) => (
                <tr key={u.id}>
                  <td>{u.email}</td>
                  <td>{u.displayName}</td>
                  <td>
                    <span className={`admin-role-pill admin-role-pill--${u.role === "ADMIN" ? "admin" : "user"}`}>{u.role}</span>
                  </td>
                  <td className="admin-table__num">{u.ratingsCount}</td>
                  <td className="admin-table__num">{u.collectionsCount}</td>
                  <td className="admin-table__muted">{new Date(u.createdAt).toLocaleString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {query.data && query.data.total > 0 && (
        <div className="admin-pagination">
          <button type="button" className="button button--secondary button--sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </button>
          <span className="admin-pagination__meta">
            Page {page} of {totalPages} · {query.data.total} users
          </span>
          <button
            type="button"
            className="button button--secondary button--sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
