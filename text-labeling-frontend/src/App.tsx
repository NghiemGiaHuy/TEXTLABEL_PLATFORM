// src/App.tsx

import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';

import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Projects from './pages/Projects';
import ProjectDetails from './pages/ProjectDetails';
import Users from './pages/Users';
import Workspace from './pages/Workspace';
import ReviewWorkspace from './pages/ReviewWorkspace';
import RelationWorkspace from './pages/RelationWorkspace';
import Settings from './pages/Settings';
import MainLayout from './layouts/MainLayout';
import ProtectedRoute from './components/ProtectedRoute';

export default function App() {
  const initialize = useAuthStore((s) => s.initialize);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isInitialized = useAuthStore((s) => s.isInitialized);

  // Rehydrate auth state from localStorage on mount
  useEffect(() => {
    initialize();
  }, [initialize]);

  return (
    <BrowserRouter>
      <Routes>
        {/* ─── Public Routes ─── */}
        <Route
          path="/login"
          element={
            !isInitialized ? null : isAuthenticated ? <Navigate to="/" replace /> : <Login />
          }
        />

        {/* ─── Protected Routes (inside MainLayout) ─── */}
        <Route
          element={
            <ProtectedRoute>
              <MainLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/" element={<Dashboard />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/:id" element={<ProjectDetails />} />
          <Route path="/workspace/:taskId" element={<Workspace />} />
          <Route path="/workspace-relation/:taskId" element={<RelationWorkspace />} />
          <Route path="/review/:projectId/:taskId" element={<ReviewWorkspace />} />
          <Route path="/admin/users" element={<Users />} />
          <Route path="/settings" element={<Settings />} />
        </Route>

        {/* ─── Catch-all ─── */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
