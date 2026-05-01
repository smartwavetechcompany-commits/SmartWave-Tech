import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Sidebar } from './components/Sidebar';
import { WifiOff, RefreshCw } from 'lucide-react';
import { AuthPage } from './components/AuthPage';
import { Dashboard } from './components/Dashboard';
import { SuperAdmin } from './components/SuperAdmin';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Rooms } from './components/Rooms';
import { FrontDesk } from './components/FrontDesk';
import { StaffManagement } from './components/StaffManagement';
import { Settings } from './components/Settings';
import { Housekeeping } from './components/Housekeeping';
import { FandB } from './components/FandB';
import { Inventory } from './components/Inventory';
import { Maintenance } from './components/Maintenance';
import { GuestManagement } from './components/GuestManagement';
import { CorporateManagement } from './components/CorporateManagement';
import { OperationsDashboard } from './components/OperationsDashboard';
import { Finance } from './components/Finance';
import { Reports } from './components/Reports';
import { Notifications } from './components/Notifications';
import { TopBar } from './components/TopBar';
import { PermissionGuard } from './components/PermissionGuard';
import { motion, AnimatePresence } from 'motion/react';

import { Toaster } from 'sonner';

import { SubscriptionExpiredPage } from './components/SubscriptionExpiredPage';
import { OnboardingTour } from './components/OnboardingTour';

function AppContent() {
  const { user, loading, profile, isSubscriptionActive, isOffline, retryConnection } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // If no user is logged in, show AuthPage
  if (!user) {
    return (
      <>
        <Toaster position="top-right" theme="dark" richColors />
        <AuthPage />
      </>
    );
  }

  // If user is logged in but has no profile, they need to complete registration
  if (!profile) {
    return (
      <>
        <Toaster position="top-right" theme="dark" richColors />
        <AuthPage />
      </>
    );
  }

  // If subscription is expired and user is not superAdmin, show Expired page
  if (!isSubscriptionActive && profile.role !== 'superAdmin') {
    return (
      <>
        <Toaster position="top-right" theme="dark" richColors />
        <SubscriptionExpiredPage />
      </>
    );
  }

  return (
    <div className="flex h-screen bg-zinc-950 overflow-hidden">
      <Toaster position="top-right" theme="dark" richColors />
      
      {isOffline && (
        <div className="fixed top-0 left-0 right-0 z-[100] bg-red-500 text-white px-4 py-2 flex items-center justify-center gap-4 animate-in slide-in-from-top duration-300">
          <div className="flex items-center gap-2">
            <WifiOff size={16} />
            <span className="text-sm font-bold">You are currently offline. Some features may be unavailable.</span>
          </div>
          <button 
            onClick={retryConnection}
            className="flex items-center gap-1 px-3 py-1 bg-white/20 hover:bg-white/30 rounded-lg text-xs font-bold transition-all"
          >
            <RefreshCw size={12} />
            Retry Connection
          </button>
        </div>
      )}

      <OnboardingTour />
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden">
        <TopBar />
        <div className="flex-1 overflow-y-auto relative">
          <AnimatePresence mode="wait">
          <Routes location={location} key={location.pathname}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/rooms" element={<Rooms />} />
            <Route path="/front-desk" element={<FrontDesk />} />
            <Route path="/housekeeping" element={<Housekeeping />} />
            <Route path="/f-and-b" element={<FandB />} />
            <Route path="/inventory" element={<Inventory />} />
            <Route path="/maintenance" element={<Maintenance />} />
            <Route path="/guests" element={<GuestManagement />} />
            <Route path="/corporate" element={<CorporateManagement />} />
            <Route path="/operations" element={<OperationsDashboard />} />
            <Route path="/finance" element={<Finance />} />
            <Route path="/reports" element={
              <PermissionGuard permission="view_reports" showError>
                <Reports />
              </PermissionGuard>
            } />
            <Route path="/super-admin" element={
              <PermissionGuard permission="access_super_admin">
                <ErrorBoundary>
                  <SuperAdmin />
                </ErrorBoundary>
              </PermissionGuard>
            } />
            <Route path="/staff" element={
              <PermissionGuard permission="manage_staff" showError>
                <StaffManagement />
              </PermissionGuard>
            } />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<div className="p-8 text-zinc-500">Module under development...</div>} />
          </Routes>
        </AnimatePresence>
      </div>
    </main>
  </div>
);
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <Router>
          <AppContent />
        </Router>
      </AuthProvider>
    </ErrorBoundary>
  );
}
