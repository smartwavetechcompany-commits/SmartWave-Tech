import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useModuleAccess } from './PermissionGuard';
import { isModuleEnabled } from '../utils/plans';
import { 
  Search, 
  Sparkles, 
  ArrowRight,
  LayoutDashboard,
  Activity,
  CalendarDays,
  Bed,
  ClipboardList,
  ChefHat,
  Package,
  Wrench,
  CheckCircle,
  Users,
  Building2,
  DollarSign,
  BarChart3,
  UserCog,
  ShieldCheck,
  Settings
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../utils';

interface CommandItem {
  icon: React.ComponentType<{ size: number; className?: string }>;
  label: string;
  category: string;
  path: string;
  keywords: string[];
  capability: string | null;
  module: string | null;
}

export function CommandPalette() {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { profile, hotel, isSubscriptionActive } = useAuth();
  const { canAccessModule } = useModuleAccess();
  const navigate = useNavigate();
  const location = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const commandItems: CommandItem[] = [
    { icon: LayoutDashboard, label: 'Dashboard Overview', category: 'Navigation', path: '/', keywords: ['dashboard', 'home', 'main', 'overview'], capability: null, module: 'dashboard' },
    { icon: Activity, label: 'Operations Dashboard', category: 'Navigation', path: '/operations', keywords: ['operations', 'arrivals', 'checkins', 'inhouse', 'occupancy', 'live'], capability: 'access_front_desk', module: 'dashboard' },
    { icon: CalendarDays, label: 'Room Calendar (Front Desk)', category: 'Navigation', path: '/front-desk', keywords: ['calendar', 'booking', 'reservation', 'frontdesk', 'reception'], capability: 'access_front_desk', module: 'frontDesk' },
    { icon: Bed, label: 'Rooms Inventory & Types', category: 'Navigation', path: '/rooms', keywords: ['rooms', 'beds', 'categories', 'hotel rooms', 'inventory'], capability: 'manage_rooms', module: 'rooms' },
    { icon: ClipboardList, label: 'Housekeeping Rules & Status', category: 'Navigation', path: '/housekeeping', keywords: ['housekeeping', 'clean', 'dirty', 'maid', 'room cleaning'], capability: 'manage_rooms', module: 'housekeeping' },
    { icon: ChefHat, label: 'Food & Beverage Service', category: 'Navigation', path: '/f-and-b', keywords: ['food', 'beverage', 'kitchen', 'restaurant', 'bar', 'f&b'], capability: 'manage_kitchen', module: 'kitchen' },
    { icon: Package, label: 'Inventory Stock & Supplies', category: 'Navigation', path: '/inventory', keywords: ['inventory', 'supplies', 'stock', 'warehouse', 'purchase'], capability: 'manage_inventory', module: 'inventory' },
    { icon: Wrench, label: 'Maintenance & Fault Tickets', category: 'Navigation', path: '/maintenance', keywords: ['maintenance', 'repair', 'broken', 'fault', 'ticket', 'engineering'], capability: 'manage_maintenance', module: 'maintenance' },
    { icon: CheckCircle, label: 'Tasks & Reminders', category: 'Navigation', path: '/tasks', keywords: ['tasks', 'reminders', 'to-do', 'checklist'], capability: null, module: 'dashboard' },
    { icon: Users, label: 'Guest Directory', category: 'Navigation', path: '/guests', keywords: ['guests', 'customers', 'clients', 'profiles', 'directory'], capability: 'edit_guest_profiles', module: 'guests' },
    { icon: Building2, label: 'Corporate Accounts & Partners', category: 'Navigation', path: '/corporate', keywords: ['corporate', 'companies', 'accounts', 'partners', 'b2b'], capability: 'manage_corporate', module: 'corporate' },
    { icon: DollarSign, label: 'Financial Ledger & Folios', category: 'Navigation', path: '/finance', keywords: ['finance', 'ledger', 'invoice', 'credit', 'debit', 'payments'], capability: 'view_financial_records', module: 'finance' },
    { icon: BarChart3, label: 'Reports & Business Analytics', category: 'Navigation', path: '/reports', keywords: ['reports', 'analytics', 'statistics', 'charts', 'revenue'], capability: 'view_reports', module: 'reports' },
    { icon: UserCog, label: 'Staff Management', category: 'Navigation', path: '/staff', keywords: ['staff', 'employees', 'roles', 'users', 'departments'], capability: 'manage_staff', module: 'staff' },
    { icon: ClipboardList, label: 'Audit Logs & Security', category: 'Navigation', path: '/activity-logs', keywords: ['logs', 'audit', 'activity', 'security', 'history'], capability: 'view_activity_logs', module: 'staff' },
    { icon: ShieldCheck, label: 'Super Admin Control Center', category: 'Navigation', path: '/super-admin', keywords: ['superadmin', 'hotels', 'system', 'licensing'], capability: 'access_super_admin', module: null },
    { icon: Settings, label: 'Hotel Branding & Preferences', category: 'Navigation', path: '/settings', keywords: ['branding', 'settings', 'logo', 'receipts', 'colors', 'personalization'], capability: null, module: 'settings' },
  ];

  // Filter commands by permissions, subscription, and search text
  const allowedCommands = commandItems.filter(item => {
    if (!profile) return false;
    
    // Check Role capacity
    if (item.capability && !canAccessModule(item.capability as any)) {
      return false;
    }

    // Check Plan active modules
    if (item.module && profile?.role !== 'superAdmin') {
      if (!isModuleEnabled(hotel, item.module)) return false;
    }

    // Default
    return true;
  });

  const filtered = allowedCommands.filter(item => {
    const term = search.toLowerCase();
    return item.label.toLowerCase().includes(term) ||
           item.category.toLowerCase().includes(term) ||
           item.keywords.some(kw => kw.toLowerCase().includes(term));
  });

  // Hotkey listener for Ctrl+K & Cmd+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen(prev => !prev);
      } else if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Autofocus input when opened
  useEffect(() => {
    if (isOpen) {
      setSearch('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [isOpen]);

  // Handle arrows and select
  useEffect(() => {
    const handleKeys = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => (prev + 1) % filtered.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => (prev - 1 + filtered.length) % filtered.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filtered[selectedIndex]) {
          handleSelect(filtered[selectedIndex]);
        }
      }
    };

    window.addEventListener('keydown', handleKeys);
    return () => window.removeEventListener('keydown', handleKeys);
  }, [isOpen, filtered, selectedIndex]);

  // Scroll active item into view
  useEffect(() => {
    if (listRef.current) {
      const activeElement = listRef.current.querySelector('[data-active="true"]');
      if (activeElement) {
        activeElement.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex]);

  const handleSelect = (item: CommandItem) => {
    const isDisabled = !isSubscriptionActive && profile?.role !== 'superAdmin' && item.path !== '/';
    if (isDisabled) return;
    
    navigate(item.path);
    setIsOpen(false);
  };

  return (
    <>
      {/* Universal Floating Shortcut Hint */}
      <div className="fixed bottom-4 right-4 z-50 pointer-events-none hidden md:block">
        <div className="bg-zinc-900/90 border border-zinc-800 text-zinc-400 backdrop-blur-md px-3 py-1.5 rounded-full text-[10px] font-bold tracking-wider flex items-center gap-1.5 shadow-25 shadow-black/80">
          <span className="text-zinc-500">SHORTCUT:</span>
          <kbd className="px-1.5 py-0.5 bg-zinc-950 border border-zinc-800 rounded font-mono text-zinc-300">Ctrl + K</kbd>
          <span className="text-zinc-500">FOR COMMAND PALETTE</span>
        </div>
      </div>

      <AnimatePresence>
        {isOpen && (
          <div className="fixed inset-0 z-[200] flex items-start justify-center pt-[10vh] p-4">
            {/* Backdrop */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsOpen(false)}
              className="absolute inset-0 bg-black/70 backdrop-blur-md"
            />

            {/* Panel */}
            <motion.div
              initial={{ opacity: 0, scale: 0.97, y: -8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: -8 }}
              className="relative w-full max-w-lg bg-zinc-900 border border-zinc-805 rounded-xl flex flex-col overflow-hidden max-h-[70vh] shadow-2xl shadow-black/90"
            >
              <div className="p-4 border-b border-zinc-800 flex items-center gap-3 bg-zinc-950/40 relative">
                <Search className="text-zinc-500 shrink-0" size={18} />
                <input 
                  ref={inputRef}
                  type="text"
                  placeholder="Where do you want to go today?"
                  className="w-full bg-transparent border-none text-sm text-zinc-100 placeholder-zinc-500 outline-none pr-10"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setSelectedIndex(0);
                  }}
                />
                <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-1 font-mono text-[9px] font-bold text-zinc-500 bg-zinc-950 px-2 py-1 border border-zinc-800 rounded">
                  ESC
                </div>
              </div>

              {/* Dynamic Hints */}
              <div className="px-4 py-2 bg-gradient-to-r from-emerald-500/5 to-violet-500/5 border-b border-zinc-800/50 flex items-center gap-2">
                <Sparkles size={11} className="text-emerald-500" />
                <span className="text-[10px] text-zinc-400 font-semibold tracking-wide uppercase">Command Palette Navigation</span>
              </div>

              {/* Results */}
              <div 
                ref={listRef}
                className="flex-1 overflow-y-auto p-2 space-y-0.5 divide-y divide-zinc-800/10 min-h-[150px]"
              >
                {filtered.length === 0 ? (
                  <div className="px-4 py-10 text-center text-zinc-500 text-xs">
                    No modules or commands match <span className="text-zinc-300 font-mono">"{search}"</span>
                  </div>
                ) : (
                  filtered.map((item, index) => {
                    const isSelected = index === selectedIndex;
                    const isActive = location.pathname === item.path;
                    const isDisabled = !isSubscriptionActive && profile?.role !== 'superAdmin' && item.path !== '/';

                    return (
                      <button
                        key={item.path}
                        data-active={isSelected}
                        disabled={isDisabled}
                        onClick={() => handleSelect(item)}
                        onMouseEnter={() => setSelectedIndex(index)}
                        className={cn(
                          "w-full flex items-center justify-between px-3 py-2.5 rounded-lg transition-all text-left",
                          isSelected ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "text-zinc-300 border border-transparent",
                          isActive && !isSelected && "bg-zinc-850/30 text-emerald-500",
                          isDisabled && "opacity-40 cursor-not-allowed"
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <item.icon className={cn("shrink-0", isSelected ? "text-emerald-400 animate-pulse" : "text-zinc-500")} size={16} />
                          <div>
                            <span className="text-xs font-bold block">{item.label}</span>
                            <span className="text-[9px] text-zinc-500 block uppercase font-mono tracking-widest">{item.category}</span>
                          </div>
                        </div>

                        {isSelected && (
                          <div className="flex items-center gap-1.5 text-[10px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded animate-bounce">
                            Navigate <ArrowRight size={10} />
                          </div>
                        )}
                      </button>
                    );
                  })
                )}
              </div>

              {/* Keyboard Cheat Legend Footer */}
              <div className="p-3 bg-zinc-950 border-t border-zinc-800 text-[10px] text-zinc-500 flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <span>Use <kbd className="font-mono text-zinc-300">↑↓</kbd> to select</span>
                  <span><kbd className="font-mono text-zinc-300">↵</kbd> to enter</span>
                </div>
                <div>
                  Shortcut: <kbd className="px-1.5 py-0.5 bg-zinc-900 border border-zinc-800 rounded font-mono text-zinc-300">Ctrl+K</kbd> to hide
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
