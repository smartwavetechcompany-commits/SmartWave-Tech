import React, { useState } from 'react';
import { 
  BarChart3, PieChart, TrendingUp, Download, 
  Calendar, Filter, FileText, DollarSign,
  Package, ArrowUpRight, ArrowDownRight,
  ChevronRight, Layers, Building2
} from 'lucide-react';
import { InventoryItem, InventoryTransaction, OperationType } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { motion } from 'motion/react';
import { cn, formatCurrency, exportToCSV } from '../../utils';
import { format, startOfMonth, endOfMonth, isWithinInterval, startOfDay, endOfDay, subMonths } from 'date-fns';
import { toast } from 'sonner';

interface InventoryReportsProps {
  items: InventoryItem[];
  transactions: InventoryTransaction[];
}

export function InventoryReports({ items, transactions }: InventoryReportsProps) {
  const { currency, exchangeRate } = useAuth();
  const [dateRange, setDateRange] = useState({
    start: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
    end: format(new Date(), 'yyyy-MM-dd')
  });

  const filteredTransactions = transactions.filter(tx => 
    isWithinInterval(new Date(tx.timestamp), {
      start: startOfDay(new Date(dateRange.start)),
      end: endOfDay(new Date(dateRange.end))
    })
  );

  const consumptionByDept = filteredTransactions
    .filter(tx => tx.type === 'consumption' || tx.type === 'stock_out')
    .reduce((acc, tx) => {
      const dept = tx.department || 'Unassigned';
      const item = items.find(i => i.id === tx.itemId);
      const cost = tx.quantity * (item?.price || 0);
      acc[dept] = (acc[dept] || 0) + cost;
      return acc;
    }, {} as Record<string, number>);

  const exportStockReport = () => {
    const data = items.map(item => ({
      SKU: item.sku,
      Name: item.name,
      Category: item.category,
      Type: item.type,
      Quantity: item.quantity,
      Unit: item.unit,
      UnitPrice: item.price,
      TotalValue: item.quantity * item.price,
      Status: item.status
    }));
    exportToCSV(data, `stock_on_hand_${format(new Date(), 'yyyy-MM-dd')}.csv`);
    toast.success('Stock report exported');
  };

  const exportConsumptionReport = () => {
    const data = filteredTransactions
      .filter(tx => tx.type === 'consumption' || tx.type === 'stock_out')
      .map(tx => {
        const item = items.find(i => i.id === tx.itemId);
        return {
          Date: format(new Date(tx.timestamp), 'yyyy-MM-dd HH:mm'),
          Item: item?.name || 'Unknown',
          Quantity: tx.quantity,
          Unit: item?.unit || '',
          Department: tx.department || 'N/A',
          Reason: tx.reason || '',
          EstimatedCost: tx.quantity * (item?.price || 0)
        };
      });
    exportToCSV(data, `consumption_report_${dateRange.start}_to_${dateRange.end}.csv`);
    toast.success('Consumption report exported');
  };

  return (
    <div className="space-y-8">
      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-zinc-900/50 p-6 rounded-3xl border border-zinc-800">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-zinc-950 border border-zinc-800 p-1 rounded-xl">
            <input
              type="date"
              value={dateRange.start}
              onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
              className="bg-transparent text-xs text-zinc-400 font-bold px-3 py-2 focus:outline-none"
            />
            <span className="text-zinc-600 text-xs">to</span>
            <input
              type="date"
              value={dateRange.end}
              onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
              className="bg-transparent text-xs text-zinc-400 font-bold px-3 py-2 focus:outline-none"
            />
          </div>
        </div>
        <div className="flex gap-3">
          <button
            onClick={exportStockReport}
            className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-white px-6 py-2.5 rounded-xl font-bold text-sm transition-all"
          >
            <Package size={18} />
            Stock Report
          </button>
          <button
            onClick={exportConsumptionReport}
            className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-black px-6 py-2.5 rounded-xl font-bold text-sm transition-all"
          >
            <Download size={18} />
            Consumption Report
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Consumption by Department */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <Building2 className="text-blue-500" size={24} />
              <h3 className="text-xl font-bold text-white">Consumption by Department</h3>
            </div>
            <div className="text-xs text-zinc-500 font-bold uppercase tracking-widest">Cost Allocation</div>
          </div>
          <div className="space-y-6">
            {Object.entries(consumptionByDept).length > 0 ? (
              Object.entries(consumptionByDept).map(([dept, cost]) => (
                <div key={dept} className="space-y-2">
                  <div className="flex justify-between items-end">
                    <span className="text-sm font-bold text-zinc-300">{dept}</span>
                    <span className="text-sm font-bold text-white">{formatCurrency(cost, currency, exchangeRate)}</span>
                  </div>
                  <div className="w-full h-2 bg-zinc-950 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-blue-500 rounded-full transition-all duration-1000"
                      style={{ width: `${Math.min(100, (cost / Object.values(consumptionByDept).reduce((a, b) => a + b, 0)) * 100)}%` }}
                    />
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-12 text-zinc-500">
                No consumption data for this period
              </div>
            )}
          </div>
        </div>

        {/* Inventory Valuation */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <DollarSign className="text-emerald-500" size={24} />
              <h3 className="text-xl font-bold text-white">Inventory Valuation</h3>
            </div>
            <div className="text-xs text-zinc-500 font-bold uppercase tracking-widest">Financial Summary</div>
          </div>
          <div className="grid grid-cols-2 gap-6">
            <div className="bg-zinc-950 p-6 rounded-2xl border border-zinc-800">
              <div className="text-xs text-zinc-500 font-bold uppercase tracking-widest mb-2">Total Asset Value</div>
              <div className="text-2xl font-bold text-white">
                {formatCurrency(items.reduce((acc, i) => acc + (i.quantity * i.price), 0), currency, exchangeRate)}
              </div>
            </div>
            <div className="bg-zinc-950 p-6 rounded-2xl border border-zinc-800">
              <div className="text-xs text-zinc-500 font-bold uppercase tracking-widest mb-2">Period Consumption</div>
              <div className="text-2xl font-bold text-red-500">
                {formatCurrency(Object.values(consumptionByDept).reduce((a, b) => a + b, 0), currency, exchangeRate)}
              </div>
            </div>
          </div>
          
          <div className="mt-8 space-y-4">
            <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Top Consumed Items</h4>
            {filteredTransactions
              .filter(tx => tx.type === 'consumption')
              .reduce((acc, tx) => {
                const item = items.find(i => i.id === tx.itemId);
                if (!item) return acc;
                const existing = acc.find(a => a.id === item.id);
                if (existing) {
                  existing.qty += tx.quantity;
                  existing.cost += tx.quantity * item.price;
                } else {
                  acc.push({ id: item.id, name: item.name, qty: tx.quantity, cost: tx.quantity * item.price });
                }
                return acc;
              }, [] as { id: string, name: string, qty: number, cost: number }[])
              .sort((a, b) => b.cost - a.cost)
              .slice(0, 5)
              .map(item => (
                <div key={item.id} className="flex items-center justify-between p-3 bg-zinc-950/50 rounded-xl border border-zinc-800/50">
                  <div className="text-sm font-medium text-zinc-300">{item.name}</div>
                  <div className="text-sm font-bold text-white">{formatCurrency(item.cost, currency, exchangeRate)}</div>
                </div>
              ))
            }
          </div>
        </div>
      </div>
    </div>
  );
}
