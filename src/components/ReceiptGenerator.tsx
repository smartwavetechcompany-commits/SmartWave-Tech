import React from 'react';
import { Reservation, Hotel, LedgerEntry } from '../types';
import { formatCurrency } from '../utils';
import { format } from 'date-fns';
import { useAuth } from '../contexts/AuthContext';
import { Printer, Receipt, Calendar, User, Building2, MapPin, Phone, Mail } from 'lucide-react';

interface ReceiptProps {
  hotel: Hotel;
  reservation: Reservation;
  type: 'restaurant' | 'comprehensive';
  ledgerEntries?: LedgerEntry[];
}

export function ReceiptGenerator({ hotel, reservation, type, ledgerEntries = [] }: ReceiptProps) {
  const { currency, exchangeRate } = useAuth();
  const branding = hotel.branding || {};
  
  const totalDebits = ledgerEntries.filter(e => e.type === 'debit').reduce((acc, e) => acc + e.amount, 0);
  const totalCredits = ledgerEntries.filter(e => e.type === 'credit').reduce((acc, e) => acc + e.amount, 0);
  
  // If room charges are already in ledger, don't add reservation.totalAmount again
  const hasRoomChargeInLedger = ledgerEntries.some(e => e.category === 'room' && e.type === 'debit');
  const grandTotal = hasRoomChargeInLedger ? totalDebits : (reservation.totalAmount + totalDebits);
  const totalPaid = totalCredits + (hasRoomChargeInLedger ? 0 : (reservation.paidAmount || 0));
  const balance = grandTotal - totalPaid;

  return (
    <div className="bg-white text-zinc-900 p-10 max-w-[500px] mx-auto font-sans shadow-2xl border border-zinc-200 print:shadow-none print:border-none print:p-0">
      {/* Hotel Header */}
      <div className="text-center border-b-2 border-zinc-900 pb-6 mb-6">
        {branding.logoUrl ? (
          <img src={branding.logoUrl} alt={hotel.name} className="h-16 mx-auto mb-3 object-contain" referrerPolicy="no-referrer" />
        ) : (
          <div className="w-16 h-16 bg-zinc-900 text-white rounded-2xl flex items-center justify-center mx-auto mb-3 font-bold text-2xl">
            {hotel.name.charAt(0)}
          </div>
        )}
        <h1 className="text-2xl font-black uppercase tracking-tighter">{hotel.name}</h1>
        <div className="text-[11px] text-zinc-500 font-medium mt-1 space-y-0.5">
          <p className="flex items-center justify-center gap-1"><MapPin size={10} /> {branding.address || 'Hotel Address'}</p>
          <p className="flex items-center justify-center gap-1">
            <Phone size={10} /> {branding.phone || '+123456789'} 
            {branding.email && <><span className="mx-1">|</span> <Mail size={10} /> {branding.email}</>}
          </p>
          {hotel.website && <p className="text-emerald-600 font-bold">{hotel.website}</p>}
        </div>
      </div>

      {/* Receipt Info Grid */}
      <div className="grid grid-cols-2 gap-y-6 mb-8 text-xs">
        <div>
          <p className="text-zinc-400 font-bold uppercase tracking-widest text-[9px] mb-1 flex items-center gap-1">
            <User size={10} /> Guest Details
          </p>
          <p className="font-bold text-sm">{reservation.guestName}</p>
          <p className="text-zinc-500">{reservation.guestEmail}</p>
        </div>
        <div className="text-right">
          <p className="text-zinc-400 font-bold uppercase tracking-widest text-[9px] mb-1 flex items-center justify-end gap-1">
            <Receipt size={10} /> Receipt Information
          </p>
          <p className="font-bold text-sm">#{reservation.id.slice(-8).toUpperCase()}</p>
          <p className="text-zinc-500">{format(new Date(), 'MMM dd, yyyy HH:mm')}</p>
        </div>
        <div>
          <p className="text-zinc-400 font-bold uppercase tracking-widest text-[9px] mb-1 flex items-center gap-1">
            <Calendar size={10} /> Stay Details
          </p>
          <p className="font-bold">Room {reservation.roomNumber}</p>
          <p className="text-zinc-500">
            {format(new Date(reservation.checkIn), 'MMM dd')} - {format(new Date(reservation.checkOut), 'MMM dd, yyyy')}
          </p>
        </div>
        <div className="text-right">
          <p className="text-zinc-400 font-bold uppercase tracking-widest text-[9px] mb-1">Status</p>
          <span className="px-2 py-0.5 bg-zinc-100 rounded text-[10px] font-bold uppercase">
            {reservation.status.replace('_', ' ')}
          </span>
        </div>
      </div>

      <div className="border-t border-zinc-100 my-6" />

      {/* Items Table */}
      <div className="space-y-4 mb-8">
        <div className="flex justify-between text-[10px] font-bold text-zinc-400 uppercase tracking-widest border-b border-zinc-100 pb-2">
          <span>Description</span>
          <span className="text-right">Amount</span>
        </div>
        
        <div className="space-y-3">
          {type === 'restaurant' ? (
            ledgerEntries.filter(e => e.category === 'restaurant').map(e => (
              <div key={e.id} className="flex justify-between items-start">
                <div className="flex-1">
                  <p className="text-sm font-bold">{e.description}</p>
                  <p className="text-[10px] text-zinc-400">{format(new Date(e.timestamp), 'MMM dd, HH:mm')}</p>
                </div>
                <span className="font-bold text-sm text-right">{formatCurrency(e.amount, currency, exchangeRate)}</span>
              </div>
            ))
          ) : (
            <>
              {!hasRoomChargeInLedger && (
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <p className="text-sm font-bold">Room Charges (Base)</p>
                    <p className="text-[10px] text-zinc-400">Accommodation for {reservation.roomNumber}</p>
                  </div>
                  <span className="font-bold text-sm text-right">{formatCurrency(reservation.totalAmount, currency, exchangeRate)}</span>
                </div>
              )}
              {ledgerEntries.filter(e => e.type === 'debit').map(e => (
                <div key={e.id} className="flex justify-between items-start">
                  <div className="flex-1">
                    <p className="text-sm font-bold">{e.description}</p>
                    <p className="text-[10px] text-zinc-400">{format(new Date(e.timestamp), 'MMM dd, HH:mm')}</p>
                  </div>
                  <span className="font-bold text-sm text-right">{formatCurrency(e.amount, currency, exchangeRate)}</span>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Totals Section */}
      <div className="bg-zinc-50 p-6 rounded-2xl space-y-3">
        <div className="flex justify-between items-center">
          <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Subtotal</span>
          <span className="font-bold">{formatCurrency(type === 'restaurant' ? totalDebits : grandTotal, currency, exchangeRate)}</span>
        </div>
        
        {type === 'comprehensive' && (
          <>
            <div className="flex justify-between items-center text-emerald-600">
              <span className="text-xs font-bold uppercase tracking-widest">Total Paid</span>
              <span className="font-bold">-{formatCurrency(totalPaid, currency, exchangeRate)}</span>
            </div>
            <div className="border-t border-zinc-200 pt-3 flex justify-between items-center">
              <span className="text-sm font-black uppercase tracking-tighter">Balance Due</span>
              <span className="text-xl font-black">{formatCurrency(Math.max(0, balance), currency, exchangeRate)}</span>
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div className="mt-10 text-center">
        <p className="text-sm font-bold mb-1 italic">Thank you for choosing {hotel.name}!</p>
        <p className="text-[10px] text-zinc-400 max-w-[250px] mx-auto leading-relaxed">
          {branding.footerNotes || 'We hope you enjoyed your stay. Please keep this receipt for your records.'}
        </p>
        <div className="mt-6 pt-6 border-t border-zinc-100 flex items-center justify-center gap-2 opacity-30 grayscale">
          <div className="w-4 h-4 bg-zinc-900 rounded-sm" />
          <span className="text-[8px] font-black uppercase tracking-widest">PMS Enterprise Certified</span>
        </div>
      </div>

      {/* Print Button (Hidden during print) */}
      <div className="mt-8 flex justify-center print:hidden">
        <button 
          onClick={() => window.print()}
          className="bg-zinc-900 text-white px-8 py-3 rounded-xl text-sm font-bold hover:bg-zinc-800 transition-all active:scale-95 shadow-lg shadow-zinc-200 flex items-center gap-2"
        >
          <Printer size={18} />
          Print Official Receipt
        </button>
      </div>
    </div>
  );
}
