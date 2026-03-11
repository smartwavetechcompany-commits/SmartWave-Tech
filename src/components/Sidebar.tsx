import React from 'react';
import { Link, useLocation } from 'react-router-dom';
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
  BarChart3
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { cn } from '../utils';
import { auth } from '../firebase';

export function Sidebar() {
  const { profile, isSubscriptionActive } = useAuth();
  const location = useLocation();

  const menuItems = [
    { icon: LayoutDashboard, label: 'Dashboard', path: '/', roles: ['hotelAdmin', 'staff', 'superAdmin'], permission: 'dashboard' },
    { icon: CalendarDays, label: 'Front Desk', path: '/front-desk', roles: ['hotelAdmin', 'staff'], permission: 'frontDesk' },
    { icon: Bed, label: 'Rooms', path: '/rooms', roles: ['hotelAdmin', 'staff'], permission: 'rooms' },
    { icon: ClipboardList, label: 'Housekeeping', path: '/housekeeping', roles: ['hotelAdmin', 'staff'], permission: 'housekeeping' },
    { icon: ChefHat, label: 'Kitchen', path: '/kitchen', roles: ['hotelAdmin', 'staff'], permission: 'kitchen' },
    { icon: DollarSign, label: 'Finance', path: '/finance', roles: ['hotelAdmin', 'staff'], permission: 'finance' },
    { icon: BarChart3, label: 'Reports', path: '/reports', roles: ['hotelAdmin', 'staff'], permission: 'reports' },
    { icon: Users, label: 'Staff', path: '/staff', roles: ['hotelAdmin', 'staff'], permission: 'staff' },
    { icon: ShieldCheck, label: 'Super Admin', path: '/super-admin', roles: ['superAdmin'] },
    { icon: Settings, label: 'Settings', path: '/settings', roles: ['hotelAdmin', 'superAdmin', 'staff'], permission: 'settings' },
  ];

  const filteredItems = menuItems.filter(item => {
    if (!profile) return false;
    
    // Super Admin always sees their items
    if (profile.role === 'superAdmin') {
      return item.roles.includes('superAdmin');
    }

    // Hotel Admin sees everything except Super Admin items
    if (profile.role === 'hotelAdmin') {
      return item.roles.includes('hotelAdmin');
    }

    // Staff see items based on their permissions
    if (profile.role === 'staff') {
      if (!item.roles.includes('staff')) return false;
      
      // Dashboard is usually allowed for everyone
      if (item.permission === 'dashboard') return true;
      
      // Check explicit permissions
      return (profile.permissions || []).includes(item.permission || '');
    }
    
    return false;
  });

  return (
    <div className="w-64 bg-zinc-950 text-zinc-400 flex flex-col h-screen border-r border-zinc-800">
      <div className="p-6">
        <h1 className="text-xl font-bold text-white tracking-tighter flex items-center gap-2">
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
                isActive ? "bg-emerald-500/10 text-emerald-500" : "hover:bg-zinc-900 hover:text-white",
                isDisabled && "opacity-50 cursor-not-allowed active:scale-100"
              )}
            >
              <item.icon size={18} />
              <span className="text-sm font-medium">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-zinc-800">
        <button 
          onClick={() => auth.signOut()}
          className="flex items-center gap-3 px-3 py-2 w-full text-left rounded-lg hover:bg-red-500/10 hover:text-red-500 transition-all duration-200 active:scale-[0.98]"
        >
          <LogOut size={18} />
          <span className="text-sm font-medium">Logout</span>
        </button>
      </div>
    </div>
  );
}
