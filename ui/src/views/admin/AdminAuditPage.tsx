import { createPortal } from "react-dom";
import { useEffect, useState, type ReactNode } from "react";
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
  user: { id: string; email: string; displayName: string };
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

function formatMetaFull(meta: unknown): string {
  if (meta == null || meta === undefined) return "null";
  if (typeof meta === "string") return meta;
  try {
    return JSON.stringify(meta, null, 2);
  } catch {
    try {
      return String(meta);
    } catch {
      return "[unserializable]";
    }
  }
}

function formatUtcDetailed(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toISOString();
  } catch {
    return iso;
  }
}

function AuditDetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="admin-audit-detail__field">
      <dt className="admin-audit-detail__label">{label}</dt>
      <dd className="admin-audit-detail__value">{value}</dd>
    </div>
  );
}

function AuditLogDetailModal({ row, onClose }: { row: AuditLogItem | null; onClose: () => void }) {
  useEffect(() => {
    if (!row) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [row, onClose]);

  if (!row) return null;

  const ui = (
    <div className="movie-modal-root" role="presentation">
      <button type="button" className="movie-modal-overlay" aria-label="Close audit details" onClick={onClose} />
      <div
        className="movie-modal-dialog movie-modal-dialog--audit-detail"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-audit-detail-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="movie-modal-toolbar">
          <span className="movie-modal-toolbar-muted">Full audit payload</span>
          <button type="button" className="movie-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="movie-modal-body admin-audit-detail-body">
          <h2 id="admin-audit-detail-title" className="admin-audit-detail-title">
            <code className="admin-code">{row.actionType}</code>
          </h2>
          <p className="admin-audit-detail__sub">{formatUtcDetailed(row.createdAtUtc)}</p>

          <dl className="admin-audit-detail__list">
            <AuditDetailRow label="Event ID" value={<code className="admin-audit-detail__mono">{row.id}</code>} />
            <AuditDetailRow
              label="User"
              value={
                <div className="admin-cell-user">
                  <span>{row.user.email}</span>
                  <span className="admin-table__muted">{row.user.displayName}</span>
                  <code className="admin-audit-detail__mono admin-audit-detail__mono--muted">{row.user.id}</code>
                </div>
              }
            />
            <AuditDetailRow label="Resource type" value={row.resourceType} />
            <AuditDetailRow label="Resource ID" value={row.resourceId ? <code className="admin-audit-detail__mono">{row.resourceId}</code> : "—"} />
            <AuditDetailRow label="Resource label" value={row.resourceLabel ?? "—"} />
          </dl>

          <section className="admin-audit-detail__metadata-section" aria-labelledby="admin-audit-meta-heading">
            <h3 id="admin-audit-meta-heading" className="admin-audit-detail-meta-heading">
              Metadata (JSON)
            </h3>
            <pre className="admin-audit-detail-metadata" tabIndex={0}>
              {formatMetaFull(row.metadata)}
            </pre>
          </section>
        </div>
      </div>
    </div>
  );

  return createPortal(ui, document.body);
}

export function AdminAuditPage({ auth }: { auth: AuthState }) {
  if (!auth) return null;
  const token = auth.token;
  const [page, setPage] = useState(1);
  const [detailRow, setDetailRow] = useState<AuditLogItem | null>(null);

  const query = useQuery({
    queryKey: ["admin-audit", page],
    queryFn: () =>
      api<{
        page: number;
        pageSize: number;
        total: number;
        items: AuditLogItem[];
      }>(`/api/admin/activity?page=${page}&pageSize=30`, undefined, token),
  });

  const totalPages = query.data ? Math.max(1, Math.ceil(query.data.total / query.data.pageSize)) : 1;

  return (
    <div className="admin-page">
      <AuditLogDetailModal row={detailRow} onClose={() => setDetailRow(null)} />

      <div className="admin-page__header">
        <h2 className="admin-page__title">Audit log</h2>
        <p className="admin-page__subtitle">
          Immutable trail of structured actions across users (newest first).{" "}
          <strong>Click any cell</strong> in a row to open full IDs, timestamps, and metadata JSON.
        </p>
      </div>

      {query.error && <p className="admin-banner admin-banner--error">{(query.error as Error).message}</p>}

      <div className="admin-table-wrap admin-table-wrap--wide">
        <table className="admin-table admin-table--dense">
          <thead>
            <tr>
              <th>Time (UTC)</th>
              <th>User</th>
              <th>Action</th>
              <th>Resource</th>
              <th>Label</th>
              <th>Metadata</th>
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
                  No audit entries.
                </td>
              </tr>
            ) : (
              query.data?.items.map((row) => (
                <tr
                  key={row.id}
                  className="admin-table-row--audit"
                  tabIndex={0}
                  role="button"
                  aria-label={`Open audit details for ${row.actionType}`}
                  onClick={() => setDetailRow(row)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setDetailRow(row);
                    }
                  }}
                >
                  <td className="admin-table__muted admin-table__nowrap">{new Date(row.createdAtUtc).toISOString().replace("T", " ").slice(0, 19)}</td>
                  <td>
                    <div className="admin-cell-user">
                      <span>{row.user.email}</span>
                      <span className="admin-table__muted">{row.user.displayName}</span>
                    </div>
                  </td>
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

      {query.data && query.data.total > 0 && (
        <div className="admin-pagination">
          <button type="button" className="button button--secondary button--sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </button>
          <span className="admin-pagination__meta">
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
        </div>
      )}
    </div>
  );
}
