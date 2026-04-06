import React from 'react';
import { TrackingCodeRequest, SystemSettings, PlanType } from '../types';
import { formatCurrency } from '../utils';
import { format } from 'date-fns';
import { Printer, Receipt, Calendar, User, Building2, MapPin, Phone, Mail, CheckCircle2 } from 'lucide-react';

interface SuperAdminReceiptProps {
  request: TrackingCodeRequest;
  settings: SystemSettings;
}

export function SuperAdminReceipt({ request, settings }: SuperAdminReceiptProps) {
  const planPrices: Record<PlanType, number> = {
    standard: 50000,
    premium: 100000,
    enterprise: 250000
  };

  const amount = planPrices[request.plan] || 0;

  return (
    <div className="bg-white text-zinc-900 p-10 max-w-[500px] mx-auto font-sans shadow-2xl border border-zinc-200 print:shadow-none print:border-none print:p-0">
      {/* Header */}
      <div className="text-center border-b-2 border-zinc-900 pb-6 mb-6">
        <div className="w-16 h-16 bg-emerald-500 text-black rounded-2xl flex items-center justify-center mx-auto mb-3 font-black text-2xl">
          SW
        </div>
        <h1 className="text-2xl font-black uppercase tracking-tighter">SmartWave PMS</h1>
        <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mt-1">Official Subscription Receipt</p>
      </div>

      {/* Info Grid */}
      <div className="grid grid-cols-2 gap-y-6 mb-8 text-xs">
        <div>
          <p className="text-zinc-400 font-bold uppercase tracking-widest text-[9px] mb-1 flex items-center gap-1">
            <Building2 size={10} /> Hotel Details
          </p>
          <p className="font-bold text-sm">{request.hotelName}</p>
          <p className="text-zinc-500">{request.email}</p>
        </div>
        <div className="text-right">
          <p className="text-zinc-400 font-bold uppercase tracking-widest text-[9px] mb-1 flex items-center justify-end gap-1">
            <Receipt size={10} /> Receipt No.
          </p>
          <p className="font-bold text-sm">#SUB-{request.id.slice(-6).toUpperCase()}</p>
          <p className="text-zinc-500">{format(new Date(request.timestamp), 'MMM dd, yyyy')}</p>
        </div>
      </div>

      <div className="border-t border-zinc-100 my-6" />

      {/* Subscription Details */}
      <div className="space-y-4 mb-8">
        <div className="flex justify-between text-[10px] font-bold text-zinc-400 uppercase tracking-widest border-b border-zinc-100 pb-2">
          <span>Description</span>
          <span className="text-right">Amount</span>
        </div>
        
        <div className="flex justify-between items-start">
          <div className="flex-1">
            <p className="text-sm font-bold">SmartWave PMS - {request.plan.toUpperCase()} Plan</p>
            <p className="text-[10px] text-zinc-400">
              {request.type === 'extension' ? 'Subscription Extension' : 'New Subscription Registration'}
            </p>
          </div>
          <span className="font-bold text-sm text-right">{formatCurrency(amount, 'NGN', 1)}</span>
        </div>

        {request.generatedCode && (
          <div className="bg-emerald-50 p-3 rounded-lg border border-emerald-100 flex items-center justify-between">
            <div>
              <p className="text-[9px] font-bold text-emerald-600 uppercase tracking-widest">Tracking Code</p>
              <p className="text-sm font-mono font-bold text-emerald-700">{request.generatedCode}</p>
            </div>
            <CheckCircle2 className="text-emerald-500" size={20} />
          </div>
        )}
      </div>

      {/* Totals */}
      <div className="bg-zinc-50 p-6 rounded-2xl space-y-3">
        <div className="flex justify-between items-center">
          <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Subtotal</span>
          <span className="font-bold">{formatCurrency(amount, 'NGN', 1)}</span>
        </div>
        <div className="flex justify-between items-center text-emerald-600">
          <span className="text-xs font-bold uppercase tracking-widest">Status</span>
          <span className="font-bold uppercase tracking-widest text-[10px]">Paid in Full</span>
        </div>
        <div className="border-t border-zinc-200 pt-3 flex justify-between items-center">
          <span className="text-sm font-black uppercase tracking-tighter">Total Amount</span>
          <span className="text-xl font-black">{formatCurrency(amount, 'NGN', 1)}</span>
        </div>
      </div>

      {/* Payment Info */}
      <div className="mt-8 p-4 border border-zinc-100 rounded-xl">
        <p className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest mb-2">Payment Information</p>
        <div className="text-[10px] space-y-1">
          <p><span className="font-bold">Bank:</span> {settings.bankName}</p>
          <p><span className="font-bold">Account Name:</span> {settings.accountName}</p>
          <p><span className="font-bold">Account Number:</span> {settings.accountNumber}</p>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-10 text-center">
        <p className="text-sm font-bold mb-1 italic">Welcome to the SmartWave Family!</p>
        <p className="text-[10px] text-zinc-400 leading-relaxed">
          For any support inquiries, please contact us at {settings.supportEmail}
        </p>
      </div>

      {/* Print Button */}
      <div className="mt-8 flex justify-center print:hidden">
        <button 
          onClick={() => window.print()}
          className="bg-zinc-900 text-zinc-50 px-8 py-3 rounded-xl text-sm font-bold hover:bg-zinc-800 transition-all active:scale-95 shadow-lg shadow-zinc-200 flex items-center gap-2"
        >
          <Printer size={18} />
          Print Receipt
        </button>
      </div>
    </div>
  );
}
