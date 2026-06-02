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
  X
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { hasPermission } from '../utils/permissions';
import { cn } from '../utils';
import { isModuleEnabled } from '../utils/plans';
import { auth } from '../firebase';
import { toast } from 'sonner';

import { useTranslation } from 'react-i18next';

export function Sidebar({ onClose }: { onClose?: () => void }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { profile, hotel, isSubscriptionActive, systemSettings, setSelectedHotelId } = useAuth();
  const location = useLocation();

  const menuItems = [
    { icon: LayoutDashboard, label: t('sidebar.dashboard'), path: '/', capability: null, module: 'dashboard' },
    { icon: Activity, label: 'Operations', path: '/operations', capability: 'access_front_desk', module: 'dashboard' },
    { icon: CalendarDays, label: t('sidebar.calendar'), path: '/front-desk', capability: 'access_front_desk', module: 'frontDesk' },
    { icon: Bed, label: t('sidebar.rooms'), path: '/rooms', capability: 'manage_rooms', module: 'rooms' },
    { icon: ClipboardList, label: t('sidebar.housekeeping'), path: '/housekeeping', capability: 'manage_rooms', module: 'housekeeping' },
    { icon: ChefHat, label: 'F & B', path: '/f-and-b', capability: 'manage_kitchen', module: 'kitchen' },
    { icon: Package, label: t('sidebar.inventory'), path: '/inventory', capability: 'manage_inventory', module: 'inventory' },
    { icon: Wrench, label: t('sidebar.maintenance'), path: '/maintenance', capability: 'manage_maintenance', module: 'maintenance' },
    { icon: CheckCircle, label: 'Tasks', path: '/tasks', capability: null, module: 'dashboard' },
    { icon: Users, label: t('sidebar.guests'), path: '/guests', capability: 'edit_guest_profiles', module: 'guests' },
    { icon: Building2, label: 'Corporate', path: '/corporate', capability: 'manage_corporate', module: 'corporate' },
    { icon: DollarSign, label: t('sidebar.finance'), path: '/finance', capability: 'view_financial_records', module: 'finance' },
    { icon: BarChart3, label: t('sidebar.reports'), path: '/reports', capability: 'view_reports', module: 'reports' },
    { icon: UserCog, label: t('sidebar.staff'), path: '/staff', capability: 'manage_staff', module: 'staff' },
    { icon: ShieldCheck, label: 'Admin Controls', path: '/admin-settings', capability: 'edit_hotel_settings', module: 'settings' },
    { icon: ClipboardList, label: 'Activity Logs', path: '/activity-logs', capability: 'view_activity_logs', module: 'staff' },
    { icon: ShieldCheck, label: 'Super Admin', path: '/super-admin', capability: 'access_super_admin' },
    { icon: Settings, label: t('sidebar.settings'), path: '/settings', capability: null, module: 'settings' },
  ];

  const filteredItems = menuItems.filter(item => {
    if (!profile) return false;
    
    // 1. Check Role-based Capability
    if (item.capability && !hasPermission(profile, item.capability as any)) {
      return false;
    }

    // 2. Check Module toggles for the hotel
    if (item.module && profile?.role !== 'superAdmin') {
      if (!isModuleEnabled(hotel, item.module)) return false;
    }

    // 3. Check Department-based Restriction from Hotel Admin Settings
    if (hotel?.settings?.staff?.restrictByDepartment && profile?.department && !['hotelAdmin', 'superAdmin'].includes(profile?.role || '')) {
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
        
        // Settings/Dashboard are usually allowed for everyone, but let's be strict if module is defined
        if (!isAllowed) return false;
      }
    }

    // Default: allow (Super Admins pass through here for items without modules)
    return true;
  });

  return (
    <div className="w-60 bg-zinc-950 text-zinc-400 flex flex-col h-screen border-r border-zinc-800">
      <div className="p-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-zinc-50 tracking-tighter flex items-center gap-2">
          <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center text-black font-black text-xs">
            TT
          </div>
          Tyyl Tech
        </h1>
        {onClose && (
          <button 
            onClick={onClose}
            className="lg:hidden p-1 text-zinc-500 hover:text-zinc-50"
          >
            <X size={20} />
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
