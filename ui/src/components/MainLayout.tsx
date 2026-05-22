import { NavLink, Link, Outlet, useLocation } from "react-router-dom";
import type { AuthState } from "../types/auth";
import { MovieAgentChatWidget } from "./MovieAgentChatWidget";
import { ShareIcon } from "./icons/ShareIcon";

type LinkItem = { to: string; label: string; end?: boolean; shareBadge?: boolean };

function AdminConsoleLink({ className }: { className: (active: boolean) => string }) {
  const { pathname } = useLocation();
  const active = pathname.startsWith("/admin");
  return (
    <Link to="/admin/overview" className={className(active)}>
      Admin
    </Link>
  );
}

export function MainLayout({ auth, onLogout }: { auth: AuthState; onLogout: () => void }) {
  const links: LinkItem[] = [
    { to: "/search", label: "Search", end: true },
    { to: "/catalog", label: "Catalog", end: true },
    { to: "/collection", label: "Collection", end: true, shareBadge: true },
  ];

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar__brand">
          <Link to="/search" className="topbar__brand-lockup">
            <img
              src="/cinelog-logo.png"
              alt=""
              width={42}
              height={42}
              decoding="async"
              className="topbar__logo"
              aria-hidden
            />
            <div className="topbar__brand-text">
              <span className="topbar__wordmark">cineLog</span>
              <p className="topbar__tagline">Your film archive</p>
            </div>
          </Link>
        </div>
        <nav className="topbar__nav" aria-label="Primary navigation">
          {links.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end ?? item.to === "/"}
              title={item.shareBadge ? "Your shelf here can be shared with a public link" : undefined}
              className={({ isActive }) => (isActive ? "nav-link nav-link--active" : "nav-link")}
            >
              <span className="nav-link__label">
                {item.shareBadge ? <ShareIcon className="nav-link__share-icon" width={15} height={15} aria-hidden /> : null}
                {item.label}
              </span>
            </NavLink>
          ))}
          {auth?.user.role === "ADMIN" && (
            <AdminConsoleLink
              className={(active) => (active ? "nav-link nav-link--active" : "nav-link")}
            />
          )}
        </nav>
        <button type="button" className="button button--secondary button--sm" onClick={onLogout}>
          Logout
        </button>
      </header>
      <main className="container">
        <Outlet />
      </main>
      {auth ? <MovieAgentChatWidget auth={auth} /> : null}
    </div>
  );
}
