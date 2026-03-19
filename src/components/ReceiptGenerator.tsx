import React from 'react';
import { Reservation, Hotel, LedgerEntry } from '../types';
import { formatCurrency } from '../utils';
import { format } from 'date-fns';

interface ReceiptProps {
  hotel: Hotel;
  reservation: Reservation;
  type: 'restaurant' | 'comprehensive';
  ledgerEntries?: LedgerEntry[];
}

export function ReceiptGenerator({ hotel, reservation, type, ledgerEntries = [] }: ReceiptProps) {
  const branding = hotel.branding || {};
  
  const totalDebits = ledgerEntries.filter(e => e.type === 'debit').reduce((acc, e) => acc + e.amount, 0);
  const totalCredits = ledgerEntries.filter(e => e.type === 'credit').reduce((acc, e) => acc + e.amount, 0);
  const balance = totalDebits - totalCredits;

  return (
    <div className="bg-white text-black p-8 max-w-[400px] mx-auto font-mono text-sm shadow-lg">
      {/* Hotel Header */}
      <div className="text-center border-b border-black pb-4 mb-4">
        {branding.logoUrl && (
          <img src={branding.logoUrl} alt={hotel.name} className="h-12 mx-auto mb-2 object-contain" />
        )}
        <h1 className="text-xl font-bold uppercase">{hotel.name}</h1>
        <p className="text-[10px]">{branding.address || 'Hotel Address'}</p>
        <p className="text-[10px]">{branding.phone || 'Tel: +123456789'}</p>
        {branding.email && <p className="text-[10px]">{branding.email}</p>}
      </div>

      {/* Receipt Info */}
      <div className="mb-4">
        <div className="flex justify-between">
          <span>Receipt #:</span>
          <span>{reservation.id.slice(-6).toUpperCase()}</span>
        </div>
        <div className="flex justify-between">
          <span>Date:</span>
          <span>{format(new Date(), 'dd MMM yyyy HH:mm')}</span>
        </div>
        <div className="flex justify-between">
          <span>Guest:</span>
          <span>{reservation.guestName}</span>
        </div>
        <div className="flex justify-between">
          <span>Room:</span>
          <span>{reservation.roomNumber}</span>
        </div>
      </div>

      <div className="border-t border-dashed border-black my-2" />

      {/* Items */}
      <div className="space-y-1">
        {type === 'restaurant' ? (
          ledgerEntries.filter(e => e.category === 'restaurant').map(e => (
            <div key={e.id} className="flex justify-between">
              <span className="flex-1">{e.description}</span>
              <span>{formatCurrency(e.amount)}</span>
            </div>
          ))
        ) : (
          <>
            <div className="flex justify-between font-bold">
              <span>Room Charges</span>
              <span>{formatCurrency(reservation.totalAmount)}</span>
            </div>
            {ledgerEntries.filter(e => e.category !== 'room' && e.type === 'debit').map(e => (
              <div key={e.id} className="flex justify-between text-[12px]">
                <span className="flex-1 pl-2">- {e.description}</span>
                <span>{formatCurrency(e.amount)}</span>
              </div>
            ))}
          </>
        )}
      </div>

      <div className="border-t border-dashed border-black my-2" />

      {/* Totals */}
      <div className="space-y-1">
        <div className="flex justify-between font-bold text-lg">
          <span>TOTAL</span>
          <span>{formatCurrency(type === 'restaurant' ? totalDebits : (reservation.totalAmount + totalDebits - reservation.totalAmount))}</span>
        </div>
        {type === 'comprehensive' && (
          <>
            <div className="flex justify-between text-emerald-700">
              <span>Paid</span>
              <span>{formatCurrency(totalCredits + (reservation.paidAmount || 0))}</span>
            </div>
            <div className="flex justify-between font-bold border-t border-black pt-1">
              <span>BALANCE DUE</span>
              <span>{formatCurrency(Math.max(0, (reservation.totalAmount + totalDebits - (reservation.paidAmount || 0) - totalCredits)))}</span>
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div className="mt-8 text-center text-[10px] border-t border-black pt-4">
        <p className="font-bold mb-1">THANK YOU FOR YOUR VISIT!</p>
        <p>{branding.footerNotes || 'Please come again.'}</p>
        <p className="mt-2 opacity-50">Powered by PMS Enterprise</p>
      </div>

      {/* Print Button (Hidden during print) */}
      <div className="mt-6 flex justify-center print:hidden">
        <button 
          onClick={() => window.print()}
          className="bg-black text-white px-6 py-2 rounded-full text-xs font-bold hover:bg-zinc-800 transition-all"
        >
          Print Receipt
        </button>
      </div>
    </div>
  );
}
