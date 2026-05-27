import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import type { AuthState } from "../../types/auth";

type AuditLogItem = {
  id: string;
  actionType: string;
  resourceType: string;
  resourceId: string | null;
  resourceLabel: string | null;
  metadata: unknown;
  createdAtUtc: string;
};

function formatMetaPreview(meta: unknown): string {
  if (meta == null) return "—";
  try {
    const s = JSON.stringify(meta);
    return s.length > 120 ? `${s.slice(0, 117)}…` : s;
  } catch {
    return "—";
  }
}

function fmtUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace("T", " ").slice(0, 19);
}

export function AuditPage({ auth }: { auth: AuthState }) {
  if (!auth) return null;
  const token = auth.token;
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: ["me-audit", auth.user.id, page],
    queryFn: () =>
      api<{ page: number; pageSize: number; total: number; items: AuditLogItem[] }>(
        `/api/me/audit-logs?page=${page}&pageSize=30`,
        undefined,
        token,
      ),
  });

  const totalPages = query.data ? Math.max(1, Math.ceil(query.data.total / query.data.pageSize)) : 1;

  return (
    <div className="browse-page">
      <header className="browse-masthead">
        <h1 className="browse-masthead__title">My activity log</h1>
        <p className="browse-masthead__lede">
          Read-only timeline of your app activity including auth, searches, ratings, catalog changes, and AI actions.
        </p>
      </header>

      <section className="browse-shelf browse-shelf--connect">
        <div className="browse-shelf__inner">
          {query.error ? <p className="status status--error">{(query.error as Error).message}</p> : null}

          <div className="admin-table-wrap admin-table-wrap--wide">
            <table className="admin-table admin-table--dense">
              <thead>
                <tr>
                  <th>Time (UTC)</th>
                  <th>Action</th>
                  <th>Resource</th>
                  <th>Label</th>
                  <th>Metadata</th>
                </tr>
              </thead>
              <tbody>
                {query.isLoading ? (
                  <tr>
                    <td colSpan={5} className="admin-table__empty">
                      Loading…
                    </td>
                  </tr>
                ) : query.data?.items.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="admin-table__empty">
                      No activity yet.
                    </td>
                  </tr>
                ) : (
                  query.data?.items.map((row) => (
                    <tr key={row.id}>
                      <td className="admin-table__muted admin-table__nowrap">{fmtUtc(row.createdAtUtc)}</td>
                      <td>
                        <code className="admin-code">{row.actionType}</code>
                      </td>
                      <td className="admin-table__muted">
                        {row.resourceType}
                        {row.resourceId ? ` · ${row.resourceId.slice(0, 8)}…` : ""}
                      </td>
                      <td>{row.resourceLabel ?? "—"}</td>
                      <td className="admin-table__meta" title={formatMetaPreview(row.metadata)}>
                        {formatMetaPreview(row.metadata)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {query.data && query.data.total > 0 ? (
            <nav className="browse-pagination" aria-label="Activity pagination">
              <button type="button" className="button button--secondary button--sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </button>
              <span className="browse-pagination__meta">
                Page {page} of {totalPages} · {query.data.total} events
              </span>
              <button
                type="button"
                className="button button--secondary button--sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </nav>
          ) : null}
        </div>
      </section>
    </div>
  );
}
