import { Navigate, Route, Routes } from "react-router-dom";
import type { AuthState } from "../types/auth";
import { AdminAiModelsPage } from "../views/admin/AdminAiModelsPage";
import { AdminAuditPage } from "../views/admin/AdminAuditPage";
import { AdminOverviewPage } from "../views/admin/AdminOverviewPage";
import { AdminPortal } from "../views/admin/AdminPortal";
import { AdminUsersPage } from "../views/admin/AdminUsersPage";
import { CatalogPage } from "../views/catalog/CatalogPage";
import { CollectionPage } from "../views/collection/CollectionPage";
import { DashboardPage } from "../views/dashboard/DashboardPage";
import { MovieDetailPage } from "../views/movie-detail/MovieDetailPage";
import { SearchPage } from "../views/search/SearchPage";
import { MainLayout } from "./MainLayout";

export function Layout({ auth, onLogout }: { auth: AuthState; onLogout: () => void }) {
  return (
    <Routes>
      <Route path="/admin/*" element={<AdminPortal auth={auth} onLogout={onLogout} />}>
        <Route index element={<Navigate to="overview" replace />} />
        <Route path="overview" element={<AdminOverviewPage auth={auth} />} />
        <Route path="users" element={<AdminUsersPage auth={auth} />} />
        <Route path="ai" element={<AdminAiModelsPage auth={auth} />} />
        <Route path="audit" element={<AdminAuditPage auth={auth} />} />
      </Route>
      <Route element={<MainLayout auth={auth} onLogout={onLogout} />}>
        <Route path="/" element={<Navigate to="/search" replace />} />
        <Route path="/dashboard" element={<DashboardPage auth={auth} />} />
        <Route path="/search" element={<SearchPage auth={auth} />} />
        <Route path="/catalog" element={<CatalogPage auth={auth} />} />
        <Route path="/collection" element={<CollectionPage auth={auth} />} />
        <Route path="/movies/:movieId" element={<MovieDetailPage auth={auth} />} />
      </Route>
      <Route path="*" element={<Navigate to="/search" replace />} />
    </Routes>
  );
}
