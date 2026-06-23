import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Sidebar } from './components/Sidebar';
import { WifiOff, RefreshCw } from 'lucide-react';
import { AuthPage } from './components/AuthPage';
import { Dashboard } from './components/Dashboard';
import { SuperAdmin } from './components/SuperAdmin';
import { GlobalErrorBoundary } from './components/GlobalErrorBoundary';
import { Rooms } from './components/Rooms';
import { FrontDesk } from './components/FrontDesk';
import { StaffManagement } from './components/StaffManagement';
import { AdminSettings } from './components/AdminSettings';
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
import { AuditLogs } from './components/AuditLogs';
import { Tasks } from './components/Tasks';
import { TopBar } from './components/TopBar';
import { PermissionGuard } from './components/PermissionGuard';
import { cn } from './utils';
import { motion, AnimatePresence } from 'motion/react';

import { Toaster } from 'sonner';

import { SubscriptionExpiredPage } from './components/SubscriptionExpiredPage';
import { OnboardingTour } from './components/OnboardingTour';
import { CommandPalette } from './components/CommandPalette';

function AppContent() {
  const { user, loading, profile, isSubscriptionActive, isOffline, retryConnection } = useAuth();
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const location = useLocation();

  // Close sidebar on route change (mobile)
  React.useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

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
    <div className="flex h-screen bg-zinc-950 overflow-hidden relative">
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
      <CommandPalette />
      
      {/* Overlay for mobile sidebar */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSidebarOpen(false)}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[50] lg:hidden"
          />
        )}
      </AnimatePresence>

      <div className={cn(
        "fixed inset-y-0 left-0 z-[60] lg:static lg:block transition-transform duration-300 transform",
        sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
      )}>
        <Sidebar onClose={() => setSidebarOpen(false)} />
      </div>

      <main className="flex-1 flex flex-col overflow-hidden w-full">
        <TopBar onMenuClick={() => setSidebarOpen(true)} />
        <div className="flex-1 overflow-y-auto relative">
          <AnimatePresence mode="wait">
          <Routes location={location} key={location.pathname}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/rooms" element={
              <PermissionGuard permission="manage_rooms" showError>
                <Rooms />
              </PermissionGuard>
            } />
            <Route path="/front-desk" element={
              <PermissionGuard permission="access_front_desk" showError>
                <FrontDesk />
              </PermissionGuard>
            } />
            <Route path="/housekeeping" element={
              <PermissionGuard permission="manage_rooms" showError>
                <Housekeeping />
              </PermissionGuard>
            } />
            <Route path="/f-and-b" element={
              <PermissionGuard permission="manage_kitchen" showError>
                <FandB />
              </PermissionGuard>
            } />
            <Route path="/inventory" element={
              <PermissionGuard permission="manage_inventory" showError>
                <Inventory />
              </PermissionGuard>
            } />
            <Route path="/maintenance" element={
              <PermissionGuard permission="manage_maintenance" showError>
                <Maintenance />
              </PermissionGuard>
            } />
            <Route path="/guests" element={
              <PermissionGuard permission="edit_guest_profiles" showError>
                <GuestManagement />
              </PermissionGuard>
            } />
            <Route path="/corporate" element={
              <PermissionGuard permission="manage_corporate" showError>
                <CorporateManagement />
              </PermissionGuard>
            } />
            <Route path="/operations" element={
              <PermissionGuard permission="access_front_desk" showError>
                <OperationsDashboard />
              </PermissionGuard>
            } />
            <Route path="/finance" element={
              <PermissionGuard permission="view_financial_records" showError>
                <Finance />
              </PermissionGuard>
            } />
            <Route path="/reports" element={
              <PermissionGuard permission="view_reports" showError>
                <Reports />
              </PermissionGuard>
            } />
            <Route path="/super-admin" element={
              <PermissionGuard permission="access_super_admin">
                <GlobalErrorBoundary>
                  <SuperAdmin />
                </GlobalErrorBoundary>
              </PermissionGuard>
            } />
            <Route path="/staff" element={
              <PermissionGuard permission="manage_staff" showError>
                <StaffManagement />
              </PermissionGuard>
            } />
            <Route path="/admin-settings" element={
              <PermissionGuard permission="edit_hotel_settings" showError>
                <AdminSettings />
              </PermissionGuard>
            } />
            <Route path="/activity-logs" element={
              <PermissionGuard permission="view_activity_logs" showError>
                <div className="p-4 sm:p-8 h-full">
                  <AuditLogs />
                </div>
              </PermissionGuard>
            } />
            <Route path="/tasks" element={<Tasks />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<div className="p-8 text-zinc-500">Module under development...</div>} />
          </Routes>
        </AnimatePresence>
      </div>
    </main>
  </div>
);
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes cache
      refetchOnWindowFocus: false,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <GlobalErrorBoundary>
        <AuthProvider>
          <Router>
            <AppContent />
          </Router>
        </AuthProvider>
      </GlobalErrorBoundary>
    </QueryClientProvider>
  );
}
