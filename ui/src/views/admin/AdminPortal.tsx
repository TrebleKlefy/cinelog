import { NavLink, Navigate, Outlet } from "react-router-dom";
import type { AuthState } from "../../types/auth";

const navItems: Array<{ to: string; label: string; desc: string }> = [
  { to: "/admin/overview", label: "Overview", desc: "Platform snapshot" },
  { to: "/admin/users", label: "Users", desc: "Accounts & roles" },
  { to: "/admin/ai", label: "AI & models", desc: "LLM provider" },
  { to: "/admin/audit", label: "Audit log", desc: "Security & actions" },
];

export function AdminPortal({ auth, onLogout }: { auth: AuthState; onLogout: () => void }) {
  if (!auth) {
    return <Navigate to="/search" replace />;
  }
  if (auth.user.role !== "ADMIN") {
    return <Navigate to="/search" replace />;
  }

  return (
    <div className="admin-portal">
      <aside className="admin-portal__sidebar" aria-label="Admin navigation">
        <div className="admin-portal__brand">
          <span className="admin-portal__brand-badge">Admin</span>
          <h1 className="admin-portal__brand-title">Console</h1>
          <p className="admin-portal__brand-sub">cineLog</p>
        </div>
        <nav className="admin-portal__nav">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `admin-nav-link${isActive ? " admin-nav-link--active" : ""}`}
            >
              <span className="admin-nav-link__label">{item.label}</span>
              <span className="admin-nav-link__desc">{item.desc}</span>
            </NavLink>
          ))}
        </nav>
        <div className="admin-portal__sidebar-footer">
          <NavLink to="/search" className="admin-portal__back">
            ← Back to app
          </NavLink>
        </div>
      </aside>
      <div className="admin-portal__main">
        <header className="admin-portal__topbar">
          <div className="admin-portal__topbar-meta">
            <span className="admin-portal__role-pill">Administrator</span>
            <span className="admin-portal__email">{auth.user.email}</span>
          </div>
          <button type="button" className="button admin-portal__logout" onClick={onLogout}>
            Sign out
          </button>
        </header>
        <div className="admin-portal__content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
