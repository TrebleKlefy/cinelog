import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import type { AuthState } from "../../types/auth";

export function AdminAiModelsPage({ auth }: { auth: AuthState }) {
  if (!auth) return null;
  const token = auth.token;
  const qc = useQueryClient();
  const providers = useQuery({
    queryKey: ["admin-llm"],
    queryFn: () =>
      api<{
        active: { providerKey: string; modelKey: string } | null;
        providers: Array<{ providerKey: string; displayName: string; models: Array<{ modelKey: string; isEnabled: boolean }> }>;
      }>("/api/admin/llm/providers", undefined, token),
  });
  const [providerKey, setProviderKey] = useState("");
  const [modelKey, setModelKey] = useState("");
  const updateLlm = useMutation({
    mutationFn: () => api("/api/admin/llm/active", { method: "PATCH", body: JSON.stringify({ providerKey, modelKey }) }, token),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-llm"] });
      qc.invalidateQueries({ queryKey: ["admin-stats"] });
    },
  });

  return (
    <div className="admin-page">
      <div className="admin-page__header">
        <h2 className="admin-page__title">AI & models</h2>
        <p className="admin-page__subtitle">Choose the active LLM provider and model for natural-language search and recommendations.</p>
      </div>

      <section className="admin-panel">
        <h3 className="admin-panel__title">Current selection</h3>
        <p className="admin-panel__text admin-panel__text--mono">
          {providers.data?.active
            ? `${providers.data.active.providerKey} / ${providers.data.active.modelKey}`
            : "Not set"}
        </p>
      </section>

      <section className="admin-panel">
        <h3 className="admin-panel__title">Change active model</h3>
        {updateLlm.isError && <p className="admin-banner admin-banner--error">{(updateLlm.error as Error).message}</p>}
        {updateLlm.isSuccess && <p className="admin-banner admin-banner--ok">Active model updated.</p>}
        <div className="admin-form-row">
          <label className="admin-field">
            <span>Provider</span>
            <select value={providerKey} onChange={(e) => { setProviderKey(e.target.value); setModelKey(""); }}>
              <option value="">Select…</option>
              {providers.data?.providers.map((p) => (
                <option key={p.providerKey} value={p.providerKey}>
                  {p.displayName} ({p.providerKey})
                </option>
              ))}
            </select>
          </label>
          <label className="admin-field">
            <span>Model</span>
            <select value={modelKey} onChange={(e) => setModelKey(e.target.value)}>
              <option value="">Select…</option>
              {providers.data?.providers
                .find((p) => p.providerKey === providerKey)
                ?.models.filter((m) => m.isEnabled)
                .map((m) => (
                  <option key={m.modelKey} value={m.modelKey}>
                    {m.modelKey}
                  </option>
                ))}
            </select>
          </label>
          <button type="button" className="button" disabled={!providerKey || !modelKey || updateLlm.isPending} onClick={() => updateLlm.mutate()}>
            {updateLlm.isPending ? "Saving…" : "Set active"}
          </button>
        </div>
      </section>

      <section className="admin-panel">
        <h3 className="admin-panel__title">Registered providers</h3>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Provider</th>
                <th>Key</th>
                <th>Models</th>
              </tr>
            </thead>
            <tbody>
              {providers.data?.providers.map((p) => (
                <tr key={p.providerKey}>
                  <td>{p.displayName}</td>
                  <td className="admin-table__muted">{p.providerKey}</td>
                  <td>{p.models.filter((m) => m.isEnabled).map((m) => m.modelKey).join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
