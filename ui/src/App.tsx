import { useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { PublicCollectionPage } from "./views/collection/PublicCollectionPage";
import { LoginPage } from "./views/login/LoginPage";
import { queryClient } from "./lib/queryClient";
import type { AuthState } from "./types/auth";
import { getAuth, setAuth } from "./lib/authStorage";

export default function App() {
  const [auth, setAuthState] = useState<AuthState>(getAuth());

  return (
    <Routes>
      <Route path="/collections/:slug" element={<PublicCollectionPage auth={auth} />} />
      <Route
        path="*"
        element={
          auth ? (
            <Layout
              auth={auth}
              onLogout={() => {
                queryClient.clear();
                setAuth(null);
                setAuthState(null);
              }}
            />
          ) : (
            <Routes>
              <Route path="/" element={<LoginPage onLogin={setAuthState} />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          )
        }
      />
    </Routes>
  );
}
