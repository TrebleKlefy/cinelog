export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export async function api<T>(path: string, init?: RequestInit, token?: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const data: unknown = await res.json();
  if (!res.ok) {
    const msg = typeof data === "object" && data !== null && "error" in data ? String((data as { error: unknown }).error) : "Request failed";
    throw new Error(msg);
  }
  return data as T;
}
