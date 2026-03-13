import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Sidebar } from './components/Sidebar';
import { AuthPage } from './components/AuthPage';
import { Dashboard } from './components/Dashboard';
import { SuperAdmin } from './components/SuperAdmin';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Rooms } from './components/Rooms';
import { FrontDesk } from './components/FrontDesk';
import { StaffManagement } from './components/StaffManagement';
import { Settings } from './components/Settings';
import { Housekeeping } from './components/Housekeeping';
import { Kitchen } from './components/Kitchen';
import { Finance } from './components/Finance';
import { Reports } from './components/Reports';
import { motion, AnimatePresence } from 'motion/react';

import { SubscriptionExpiredPage } from './components/SubscriptionExpiredPage';

function AppContent() {
  const { user, loading, profile, isSubscriptionActive } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // If no user is logged in, show AuthPage
  if (!user) {
    return <AuthPage />;
  }

  // If user is logged in but has no profile, they need to complete registration
  if (!profile) {
    return <AuthPage />;
  }

  // If subscription is expired and user is not superAdmin, show Expired page
  if (!isSubscriptionActive && profile.role !== 'superAdmin') {
    return <SubscriptionExpiredPage />;
  }

  return (
    <div className="flex h-screen bg-zinc-950 overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto relative">
        <AnimatePresence mode="wait">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/rooms" element={<Rooms />} />
            <Route path="/front-desk" element={<FrontDesk />} />
            <Route path="/housekeeping" element={<Housekeeping />} />
            <Route path="/kitchen" element={<Kitchen />} />
            <Route path="/finance" element={<Finance />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/super-admin" element={
              profile.role === 'superAdmin' ? (
                <ErrorBoundary>
                  <SuperAdmin />
                </ErrorBoundary>
              ) : <Navigate to="/" />
            } />
            <Route path="/staff" element={
              profile.role === 'hotelAdmin' ? <StaffManagement /> : <Navigate to="/" />
            } />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<div className="p-8 text-zinc-500">Module under development...</div>} />
          </Routes>
        </AnimatePresence>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Router>
        <AppContent />
      </Router>
    </AuthProvider>
  );
}
