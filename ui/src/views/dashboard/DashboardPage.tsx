import { PageCard } from "../../components/PageCard";
import { RecommendationShelf } from "../../components/RecommendationShelf";
import type { AuthState } from "../../types/auth";

export function DashboardPage({ auth }: { auth: AuthState }) {
  return (
    <PageCard title={`Welcome, ${auth?.user.displayName ?? "there"}`} subtitle="AI-powered ideas tailored to your watch preferences.">
      <RecommendationShelf auth={auth} />
    </PageCard>
  );
}
