import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Bed, 
  CalendarDays, 
  Users, 
  ClipboardList, 
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
  XCircle
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { cn } from '../utils';
import { auth } from '../firebase';
import { toast } from 'sonner';

import { useTranslation } from 'react-i18next';

export function Sidebar() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { profile, hotel, isSubscriptionActive, systemSettings, setSelectedHotelId } = useAuth();
  const location = useLocation();

  const menuItems = [
    { icon: LayoutDashboard, label: t('sidebar.dashboard'), path: '/', roles: ['hotelAdmin', 'staff', 'superAdmin'], permission: 'dashboard' },
    { icon: Activity, label: 'Operations', path: '/operations', roles: ['hotelAdmin', 'staff'], permission: 'dashboard' },
    { icon: CalendarDays, label: t('sidebar.calendar'), path: '/front-desk', roles: ['hotelAdmin', 'staff'], permission: 'frontDesk' },
    { icon: Bed, label: t('sidebar.rooms'), path: '/rooms', roles: ['hotelAdmin', 'staff'], permission: 'rooms' },
    { icon: ClipboardList, label: t('sidebar.housekeeping'), path: '/housekeeping', roles: ['hotelAdmin', 'staff'], permission: 'housekeeping' },
    { icon: ChefHat, label: 'F & B', path: '/f-and-b', roles: ['hotelAdmin', 'staff'], permission: 'kitchen' },
    { icon: Package, label: t('sidebar.inventory'), path: '/inventory', roles: ['hotelAdmin', 'staff'], permission: 'inventory' },
    { icon: Wrench, label: t('sidebar.maintenance'), path: '/maintenance', roles: ['hotelAdmin', 'staff'], permission: 'maintenance' },
    { icon: Users, label: t('sidebar.guests'), path: '/guests', roles: ['hotelAdmin', 'staff'], permission: 'guests' },
    { icon: Building2, label: 'Corporate', path: '/corporate', roles: ['hotelAdmin', 'staff'], permission: 'corporate' },
    { icon: DollarSign, label: t('sidebar.finance'), path: '/finance', roles: ['hotelAdmin', 'staff'], permission: 'finance' },
    { icon: BarChart3, label: t('sidebar.reports'), path: '/reports', roles: ['hotelAdmin', 'staff'], permission: 'reports' },
    { icon: UserCog, label: t('sidebar.staff'), path: '/staff', roles: ['hotelAdmin', 'staff'], permission: 'staff' },
    { icon: ShieldCheck, label: 'Super Admin', path: '/super-admin', roles: ['superAdmin'] },
    { icon: Settings, label: t('sidebar.settings'), path: '/settings', roles: ['hotelAdmin', 'superAdmin', 'staff'], permission: 'settings' },
  ];

  const filteredItems = menuItems.filter(item => {
    if (!profile) return false;
    
    // Super Admin always sees their items + everything else for diagnosis
    if (profile.role === 'superAdmin') {
      return true;
    }

    // Hotel Admin and Staff checks
    if (profile.role === 'hotelAdmin' || profile.role === 'staff') {
      // Check if role is allowed
      if (!item.roles.includes(profile.role)) return false;

      // Check if module is enabled for the hotel
      if (item.permission && hotel?.modulesEnabled) {
        // Special case: Corporate is always available for Premium and Enterprise plans
        if (item.permission === 'corporate' && (hotel.plan === 'premium' || hotel.plan === 'enterprise')) {
          return true;
        }
        if (!hotel.modulesEnabled.includes(item.permission)) return false;
      }

      // Staff specific permission check
      if (profile.role === 'staff') {
        if (item.permission === 'dashboard') return true;
        return (profile.permissions || []).includes(item.permission || '');
      }

      return true;
    }
    
    return false;
  });

  return (
    <div className="w-64 bg-zinc-950 text-zinc-400 flex flex-col h-screen border-r border-zinc-800">
      <div className="p-6">
        <h1 className="text-xl font-bold text-zinc-50 tracking-tighter flex items-center gap-2">
          <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center text-black">
            SW
          </div>
          SmartWave
        </h1>
      </div>

      <nav className="flex-1 px-4 space-y-1 overflow-y-auto">
        {filteredItems.map((item) => {
          const isActive = location.pathname === item.path;
          const isDisabled = !isSubscriptionActive && profile?.role !== 'superAdmin' && item.path !== '/';

          return (
            <Link
              key={item.path}
              to={isDisabled ? '#' : item.path}
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
