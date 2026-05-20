// src/components/ProtectedRoute.tsx

import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

interface Props {
  children: React.ReactNode;
}

/**
 * Wrapper that redirects unauthenticated users to /login.
 * Preserves the original URL so we can redirect back after login.
 */
export default function ProtectedRoute({ children }: Props) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isInitialized = useAuthStore((s) => s.isInitialized);
  const location = useLocation();

  if (!isInitialized) {
    return null;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
