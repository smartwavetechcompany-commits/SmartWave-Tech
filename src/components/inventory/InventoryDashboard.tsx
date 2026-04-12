import React from 'react';
import { Package, AlertTriangle, TrendingUp, DollarSign, ArrowUpRight, ArrowDownRight, Box, ShoppingCart, History } from 'lucide-react';
import { InventoryItem, InventoryTransaction } from '../../types';
import { formatCurrency } from '../../utils';
import { useAuth } from '../../contexts/AuthContext';
import { motion } from 'motion/react';
import { cn } from '../../utils';
import { format, subDays, isAfter } from 'date-fns';

interface InventoryDashboardProps {
  items: InventoryItem[];
  transactions: InventoryTransaction[];
}

export function InventoryDashboard({ items, transactions }: InventoryDashboardProps) {
  const { currency, exchangeRate } = useAuth();

  const totalValue = items.reduce((acc, item) => acc + (item.quantity * item.price), 0);
  const lowStockCount = items.filter(i => i.quantity <= i.minThreshold).length;
  const outOfStockCount = items.filter(i => i.quantity <= 0).length;
  
  const recentTransactions = [...transactions]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 5);

  const stats = [
    {
      label: 'Total Inventory Value',
      value: formatCurrency(totalValue, currency, exchangeRate),
      icon: DollarSign,
      color: 'text-emerald-500',
      bg: 'bg-emerald-500/10'
    },
    {
      label: 'Total Items',
      value: items.length,
      icon: Package,
      color: 'text-blue-500',
      bg: 'bg-blue-500/10'
    },
    {
      label: 'Low Stock Alerts',
      value: lowStockCount,
      icon: AlertTriangle,
      color: 'text-amber-500',
      bg: 'bg-amber-500/10'
    },
    {
      label: 'Out of Stock',
      value: outOfStockCount,
      icon: Box,
      color: 'text-red-500',
      bg: 'bg-red-500/10'
    }
  ];

  return (
    <div className="space-y-8">
      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat, index) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
            className="bg-zinc-900 border border-zinc-800 p-6 rounded-3xl"
          >
            <div className="flex items-center justify-between mb-4">
              <div className={cn("p-3 rounded-2xl", stat.bg, stat.color)}>
                <stat.icon size={24} />
              </div>
            </div>
            <div className="text-2xl font-bold text-white mb-1">{stat.value}</div>
            <div className="text-sm text-zinc-500 font-medium">{stat.label}</div>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Low Stock List */}
        <div className="lg:col-span-2 bg-zinc-900 border border-zinc-800 rounded-3xl overflow-hidden">
          <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AlertTriangle className="text-amber-500" size={20} />
              <h3 className="text-lg font-bold text-white">Critical Stock Alerts</h3>
            </div>
            <span className="px-3 py-1 bg-amber-500/10 text-amber-500 text-xs font-bold rounded-full">
              {lowStockCount} Items
            </span>
          </div>
          <div className="divide-y divide-zinc-800">
            {items.filter(i => i.quantity <= i.minThreshold).slice(0, 6).map((item) => (
              <div key={item.id} className="p-4 flex items-center justify-between hover:bg-zinc-800/50 transition-colors">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-zinc-800 rounded-xl flex items-center justify-center text-zinc-400">
                    <Package size={20} />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-white">{item.name}</div>
                    <div className="text-xs text-zinc-500">{item.category} • SKU: {item.sku}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className={cn(
                    "text-sm font-bold",
                    item.quantity <= 0 ? "text-red-500" : "text-amber-500"
                  )}>
                    {item.quantity} {item.unit}
                  </div>
                  <div className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">
                    Min: {item.minThreshold}
                  </div>
                </div>
              </div>
            ))}
            {lowStockCount === 0 && (
              <div className="p-12 text-center text-zinc-500">
                <Package size={48} className="mx-auto mb-4 opacity-20" />
                <p>All stock levels are healthy</p>
              </div>
            )}
          </div>
        </div>

        {/* Recent Activity */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl overflow-hidden">
          <div className="p-6 border-b border-zinc-800 flex items-center gap-3">
            <History className="text-blue-500" size={20} />
            <h3 className="text-lg font-bold text-white">Recent Movements</h3>
          </div>
          <div className="p-6 space-y-6">
            {recentTransactions.map((tx) => {
              const item = items.find(i => i.id === tx.itemId);
              return (
                <div key={tx.id} className="flex gap-4">
                  <div className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                    tx.type === 'stock_in' ? "bg-emerald-500/10 text-emerald-500" :
                    tx.type === 'stock_out' ? "bg-red-500/10 text-red-500" :
                    "bg-blue-500/10 text-blue-500"
                  )}>
                    {tx.type === 'stock_in' ? <ArrowUpRight size={16} /> : 
                     tx.type === 'stock_out' ? <ArrowDownRight size={16} /> : 
                     <TrendingUp size={16} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-white truncate">
                      {item?.name || 'Unknown Item'}
                    </div>
                    <div className="text-xs text-zinc-500 flex items-center justify-between">
                      <span className="capitalize">{tx.type.replace('_', ' ')}</span>
                      <span>{format(new Date(tx.timestamp), 'HH:mm')}</span>
                    </div>
                  </div>
                  <div className={cn(
                    "text-sm font-bold",
                    tx.type === 'stock_in' ? "text-emerald-500" : "text-red-500"
                  )}>
                    {tx.type === 'stock_in' ? '+' : '-'}{tx.quantity}
                  </div>
                </div>
              );
            })}
            {recentTransactions.length === 0 && (
              <div className="text-center py-8 text-zinc-500">
                No recent activity
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
