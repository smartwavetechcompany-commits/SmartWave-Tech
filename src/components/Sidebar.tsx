import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Bed, 
  CalendarDays, 
  Users, 
  ClipboardList, 
  CheckCircle,
  ChefHat, 
  Settings, 
  LogOut,
  ShieldCheck,
  DollarSign,
  BarChart3,
  Package,
  Wrench,
  UserCog,
  Building2,
  Activity,
  Mail,
  XCircle,
  X,
  Coffee,
  FileText,
  Receipt
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useModuleAccess } from './PermissionGuard';
import { cn } from '../utils';
import { isModuleEnabled } from '../utils/plans';
import { auth } from '../firebase';
import { toast } from 'sonner';

import { useTranslation } from 'react-i18next';

export function Sidebar({ onClose }: { onClose?: () => void }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { profile, hotel, isSubscriptionActive, systemSettings, setSelectedHotelId } = useAuth();
  const { canAccessModule, canAccessPMSModule } = useModuleAccess();
  const location = useLocation();

  const menuItems = [
    { icon: LayoutDashboard, label: t('sidebar.dashboard'), path: '/', capability: null, module: 'dashboard', pmsModuleId: 'dashboard' },
    { icon: Activity, label: 'Operations', path: '/operations', capability: 'access_front_desk', module: 'dashboard', pmsModuleId: 'reservations' },
    { icon: CalendarDays, label: t('sidebar.calendar'), path: '/front-desk', capability: 'access_front_desk', module: 'frontDesk', pmsModuleId: 'reservations' },
    { icon: Bed, label: t('sidebar.rooms'), path: '/rooms', capability: 'manage_rooms', module: 'rooms', pmsModuleId: 'rooms' },
    { icon: Activity, label: 'Room Status', path: '/room-status', capability: 'manage_rooms', module: 'rooms', pmsModuleId: 'rooms' },
    { icon: ClipboardList, label: t('sidebar.housekeeping'), path: '/housekeeping', capability: 'view_housekeeping', module: 'housekeeping', pmsModuleId: 'housekeeping' },
    { icon: ChefHat, label: 'F & B', path: '/f-and-b', capability: 'manage_kitchen', module: 'kitchen', pmsModuleId: 'kitchen' },
    { icon: Coffee, label: 'Breakfast List', path: '/breakfast-list', capability: 'manage_kitchen', module: 'kitchen', pmsModuleId: 'kitchen' },
    { icon: Package, label: t('sidebar.inventory'), path: '/inventory', capability: 'manage_inventory', module: 'inventory', pmsModuleId: 'inventory' },
    { icon: Wrench, label: t('sidebar.maintenance'), path: '/maintenance', capability: 'manage_maintenance', module: 'maintenance', pmsModuleId: 'maintenance' },
    { icon: CheckCircle, label: 'Tasks', path: '/tasks', capability: 'view_dashboard', module: 'dashboard', pmsModuleId: 'dashboard' },
    { icon: Users, label: t('sidebar.guests'), path: '/guests', capability: 'edit_guest_profiles', module: 'guests', pmsModuleId: 'guests' },
    { icon: Building2, label: 'Corporate', path: '/corporate', capability: 'manage_corporate', module: 'corporate', pmsModuleId: 'corporate' },
    { icon: DollarSign, label: t('sidebar.finance'), path: '/finance', capability: 'view_financial_records', module: 'finance', pmsModuleId: 'finance' },
    { icon: Receipt, label: 'Debt Ledger (AR)', path: '/debt-ledger', capability: 'view_debt_ledger', module: 'finance', pmsModuleId: 'finance' },
    { icon: BarChart3, label: t('sidebar.reports'), path: '/reports', capability: 'view_reports', module: 'reports', pmsModuleId: 'reports' },
    { icon: FileText, label: 'DSS Report', path: '/dss-report', capability: 'view_reports', module: 'reports', pmsModuleId: 'reports' },
    { icon: UserCog, label: t('sidebar.staff'), path: '/staff', capability: 'manage_staff', module: 'staff', pmsModuleId: 'staff' },
    { icon: ShieldCheck, label: 'Admin Controls', path: '/admin-settings', capability: 'edit_hotel_settings', module: 'settings', pmsModuleId: 'settings' },
    { icon: ClipboardList, label: 'Activity Logs', path: '/activity-logs', capability: 'view_activity_logs', module: 'staff', pmsModuleId: 'staff' },
    { icon: ShieldCheck, label: 'Super Admin', path: '/super-admin', capability: 'access_super_admin' },
    { icon: Settings, label: t('sidebar.settings'), path: '/settings', capability: 'view_settings', module: 'settings', pmsModuleId: 'settings' },
  ];

  const filteredItems = menuItems.filter(item => {
    if (!profile) return false;
    
    // Super Admins have complete visibility
    if (profile.role === 'superAdmin') {
      return true;
    }

    // Hotel Admins see everything within hotel except super-admin
    if (profile.role === 'hotelAdmin' || profile.role === 'admin') {
      if (item.capability === 'access_super_admin') return false;
      if (item.module && !isModuleEnabled(hotel, item.module)) return false;
      return true;
    }

    // SuperAdmin portal is never shown to regular staff
    if (item.capability === 'access_super_admin') return false;

    // 1. Check Role-based Capability / Module Assignment
    // A staff user has access if they have the specific capability OR if they have the module assigned
    const hasExplicitCapability = item.capability ? canAccessModule(item.capability as any) : true;
    const hasModuleAssigned = item.pmsModuleId 
      ? canAccessPMSModule(item.pmsModuleId)
      : false;

    if (!hasExplicitCapability && !hasModuleAssigned) {
      return false;
    }

    // 2. Check Module toggles for the hotel plan
    if (item.module) {
      if (!isModuleEnabled(hotel, item.module)) return false;
    }

    // Check dynamic visibility for Finance
    if (item.path === '/finance') {
      const allowed = hotel?.settings?.financial?.allowFinancialReportViewing ?? true;
      if (!allowed) {
        return false;
      }
    }

    // 3. Check Department-based Restriction from Hotel Admin Settings
    if (hotel?.settings?.staff?.restrictByDepartment && profile?.department) {
      // If the admin explicitly granted this capability or module, it always takes precedence
      const isExplicitlyAssigned = hasExplicitCapability || hasModuleAssigned;
      if (!isExplicitlyAssigned) {
        const dep = profile.department.toLowerCase();
        
        // Map modules to departments
        const moduleMap: Record<string, string[]> = {
          'frontDesk': ['front desk', 'reception', 'reservations'],
          'rooms': ['front desk', 'reception', 'housekeeping'],
          'housekeeping': ['housekeeping'],
          'kitchen': ['kitchen', 'f&b', 'restaurant', 'food & beverage'],
          'inventory': ['store', 'purchase', 'kitchen', 'maintenance'],
          'maintenance': ['maintenance', 'engineering'],
          'finance': ['accounts', 'finance'],
          'reports': ['management', 'finance', 'accounts'],
          'staff': ['hr', 'admin'],
          'corporate': ['sales', 'reservations', 'front desk'],
          'guests': ['front desk', 'reception', 'reservations'],
        };
        
        if (item.module && moduleMap[item.module]) {
          const allowedDepartments = moduleMap[item.module];
          const isAllowed = allowedDepartments.some(d => dep.includes(d) || d.includes(dep));
          
          if (!isAllowed) return false;
        }
      }
    }

    return true;
  });

  // Compute hotel brand initials (e.g. "Tide' Hotels & Resorts" -> "TH")
  const hotelDisplayName = hotel?.name || (profile?.role === 'superAdmin' ? 'Super Admin' : 'Hotel PMS');
  const hotelInitials = React.useMemo(() => {
    if (!hotel?.name) return profile?.role === 'superAdmin' ? 'SA' : 'HP';
    const clean = hotel.name.replace(/['"“”]/g, '').trim();
    const parts = clean.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }, [hotel?.name, profile?.role]);

  return (
    <div className="w-60 bg-zinc-950 text-zinc-400 flex flex-col h-screen border-r border-zinc-800">
      <div className="p-4 sm:p-5 flex items-center justify-between border-b border-zinc-800/60">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {hotel?.branding?.logoUrl ? (
            <img 
              src={hotel.branding.logoUrl} 
              alt={hotelDisplayName} 
              className="w-9 h-9 rounded-xl object-contain bg-zinc-900 border border-zinc-800 shrink-0 p-1"
              onError={(e) => {
                // If custom image fails to load, fallback to initials badge
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
          ) : (
            <div 
              className="w-9 h-9 rounded-xl flex items-center justify-center text-black font-black text-xs shrink-0 shadow-sm"
              style={{ backgroundColor: hotel?.branding?.primaryColor || '#10b981' }}
            >
              {hotelInitials}
            </div>
          )}
          <div className="flex flex-col min-w-0 flex-1">
            <span 
              className="text-sm font-bold text-zinc-50 tracking-tight truncate leading-tight" 
              title={hotelDisplayName}
            >
              {hotelDisplayName}
            </span>
            <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider truncate">
              {hotel?.branding?.organizationName || (profile?.role === 'superAdmin' && !hotel?.id ? 'Management Portal' : 'Hotel PMS')}
            </span>
          </div>
        </div>
        {onClose && (
          <button 
            onClick={onClose}
            className="lg:hidden p-1.5 text-zinc-500 hover:text-zinc-50 rounded-lg hover:bg-zinc-900 ml-1 shrink-0"
          >
            <X size={18} />
          </button>
        )}
      </div>

      <nav className="flex-1 px-4 space-y-1 overflow-y-auto">
        {filteredItems.map((item) => {
          const isActive = location.pathname === item.path;
          const isDisabled = !isSubscriptionActive && profile?.role !== 'superAdmin' && item.path !== '/';

          return (
            <Link
              key={item.path}
              to={isDisabled ? item.path : item.path}
              onClick={(e) => {
                if (isDisabled) e.preventDefault();
              }}
              target="_self"
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200 active:scale-[0.98]",
                isActive ? "bg-emerald-500/10 text-emerald-500" : "hover:bg-zinc-900 hover:text-zinc-50",
                isDisabled && "opacity-50 cursor-not-allowed active:scale-100"
              )}
            >
              <item.icon size={18} />
              <span className="text-sm font-medium">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-zinc-800 space-y-2">
        {profile?.role === 'superAdmin' && hotel?.id && (
          <button 
            onClick={() => {
              setSelectedHotelId(null);
              toast.success('Exited management mode');
              navigate('/super-admin');
            }}
            className="flex items-center gap-3 px-3 py-2 w-full text-left rounded-lg bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 transition-all duration-200 active:scale-[0.98]"
          >
            <XCircle size={18} />
            <span className="text-sm font-medium">Stop Managing Hotel</span>
          </button>
        )}
        {systemSettings?.supportEmail && (
          <a 
            href={`mailto:${systemSettings.supportEmail}`}
            className="flex items-center gap-3 px-3 py-2 w-full text-left rounded-lg hover:bg-emerald-500/10 hover:text-emerald-500 transition-all duration-200 active:scale-[0.98]"
          >
            <Mail size={18} />
            <span className="text-sm font-medium">Support</span>
          </a>
        )}
        <button 
          onClick={() => auth.signOut()}
          className="flex items-center gap-3 px-3 py-2 w-full text-left rounded-lg hover:bg-red-500/10 hover:text-red-500 transition-all duration-200 active:scale-[0.98]"
        >
          <LogOut size={18} />
          <span className="text-sm font-medium">{t('sidebar.logout')}</span>
        </button>
      </div>
    </div>
  );
}
