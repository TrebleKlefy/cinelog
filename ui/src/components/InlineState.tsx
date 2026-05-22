export function InlineState({
  loading,
  error,
  emptyText,
  hasData,
}: {
  loading?: boolean;
  error?: string;
  emptyText?: string;
  hasData: boolean;
}) {
  if (loading) return <p className="status status--loading">Loading...</p>;
  if (error) return <p className="status status--error">{error}</p>;
  if (!hasData) return <p className="status status--empty">{emptyText ?? "No data yet."}</p>;
  return null;
}
