import React from 'react';
import { Reservation, Hotel, LedgerEntry, CorporateAccount } from '../types';
import { formatCurrency, cn } from '../utils';
import { format } from 'date-fns';
import { useAuth } from '../contexts/AuthContext';
import { Printer, Receipt, Calendar, User, Building2, MapPin, Phone, Mail } from 'lucide-react';

interface ReceiptProps {
  hotel: Hotel;
  reservation?: Reservation;
  account?: CorporateAccount;
  type: 'restaurant' | 'comprehensive' | 'corporate';
  ledgerEntries?: LedgerEntry[];
}

export function ReceiptGenerator({ hotel, reservation, account, type, ledgerEntries = [] }: ReceiptProps) {
  const { currency, exchangeRate } = useAuth();
  const branding = hotel.branding || {};
  
  const debits = ledgerEntries.filter(e => e.type === 'debit');
  const credits = ledgerEntries.filter(e => e.type === 'credit');
  
  const totalDebits = debits.reduce((acc, e) => acc + e.amount, 0);
  const totalCredits = credits.reduce((acc, e) => acc + e.amount, 0);
  const totalPayments = credits.filter(e => e.category?.toLowerCase() === 'payment').reduce((acc, e) => acc + e.amount, 0);
  const totalOtherCredits = totalCredits - totalPayments;
  
  // If room charges are already in ledger, don't add reservation.totalAmount again
  const hasRoomChargeInLedger = ledgerEntries.some(e => e.category?.toLowerCase() === 'room' && e.type === 'debit');
  const subtotal = type === 'corporate' ? totalDebits : (hasRoomChargeInLedger ? totalDebits : ((reservation?.totalAmount || 0) + totalDebits));
  
  // Calculate Taxes
  const activeTaxes = (hotel.taxes || []).filter(t => {
    if (t.status !== 'active') return false;
    if (type === 'restaurant') {
      return t.category === 'restaurant' || t.category === 'all';
    }
    if (type === 'comprehensive' || type === 'corporate') {
      return true; // Show all taxes on comprehensive/corporate receipt
    }
    return t.category === 'all';
  });

  let taxTotal = 0;
  const taxBreakdown = activeTaxes.map(tax => {
    let amount = 0;
    if (tax.isInclusive) {
      amount = subtotal - (subtotal / (1 + tax.percentage / 100));
    } else {
      amount = subtotal * (tax.percentage / 100);
      taxTotal += amount;
    }
    return { ...tax, amount };
  });

  const grandTotal = subtotal + taxTotal;
  const hasPaymentInLedger = ledgerEntries.some(e => e.category?.toLowerCase() === 'payment' && e.type === 'credit');
  const totalPaid = totalCredits + (type === 'corporate' ? 0 : (hasPaymentInLedger ? 0 : (reservation?.paidAmount || 0)));
  const balance = grandTotal - totalPaid;

  return (
    <div className={cn(
      "bg-white text-zinc-900 mx-auto font-sans shadow-2xl border border-zinc-200 print:shadow-none print:border-none print:p-0 print:m-0",
      (type === 'comprehensive' || type === 'corporate') ? "w-[210mm] min-h-[297mm] p-16 receipt-container" : "w-[80mm] p-4 docket-container"
    )}>
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          @page { 
            size: ${type === 'restaurant' ? '80mm auto' : 'A4'}; 
            margin: 0; 
          }
          body * { visibility: hidden; }
          .receipt-container, .receipt-container *, .docket-container, .docket-container * { visibility: visible; }
          .receipt-container, .docket-container { 
            position: absolute; 
            left: 0; 
            top: 0; 
            width: ${type === 'restaurant' ? '80mm' : '210mm'} !important;
            margin: 0 !important;
            padding: ${type === 'restaurant' ? '5mm' : '20mm'} !important;
          }
          .print-hidden { display: none !important; }
        }
      `}} />
      {/* Hotel Header */}
      <div className="text-center border-b-2 border-zinc-900 pb-8 mb-8">
        {branding.logoUrl ? (
          <img src={branding.logoUrl} alt={hotel.name} className="h-24 mx-auto mb-4 object-contain" referrerPolicy="no-referrer" />
        ) : (
          <div className="w-20 h-20 bg-zinc-900 text-white rounded-2xl flex items-center justify-center mx-auto mb-4 font-bold text-3xl">
            {hotel.name.charAt(0)}
          </div>
        )}
        <h1 className="text-3xl font-black uppercase tracking-tighter">{branding.organizationName || hotel.name}</h1>
        <div className="text-xs text-zinc-500 font-medium mt-2 space-y-1">
          <p className="flex items-center justify-center gap-1"><MapPin size={12} /> {branding.address || 'Hotel Address'}</p>
          <p className="flex items-center justify-center gap-1">
            <Phone size={12} /> {branding.phone || '+123456789'} 
            {branding.email && <><span className="mx-2">|</span> <Mail size={12} /> {branding.email}</>}
          </p>
          {hotel.website && <p className="text-emerald-600 font-bold text-sm">{hotel.website}</p>}
        </div>
      </div>

      {/* Receipt Info Grid */}
      <div className="grid grid-cols-2 gap-x-12 gap-y-8 mb-10 text-sm">
        <div>
          <p className="text-zinc-400 font-bold uppercase tracking-widest text-[10px] mb-2 flex items-center gap-1">
            <User size={12} /> {type === 'corporate' ? 'Account Details' : 'Guest Details'}
          </p>
          <p className="font-bold text-lg">{type === 'corporate' ? account?.name : reservation?.guestName}</p>
          <p className="text-zinc-500">{type === 'corporate' ? account?.email : reservation?.guestEmail}</p>
          {type === 'corporate' && account?.taxId && <p className="text-zinc-400 text-xs mt-1">Tax ID: {account.taxId}</p>}
        </div>
        <div className="text-right">
          <p className="text-zinc-400 font-bold uppercase tracking-widest text-[10px] mb-2 flex items-center justify-end gap-1">
            <Receipt size={12} /> {type === 'corporate' ? 'OFFICIAL RECEIPT' : 'Receipt Information'}
          </p>
          <p className="font-bold text-lg">#{type === 'corporate' ? account?.id.slice(-8).toUpperCase() : reservation?.id.slice(-8).toUpperCase()}</p>
          <p className="text-zinc-500">{format(new Date(), 'MMMM dd, yyyy HH:mm')}</p>
        </div>
        {reservation && (
          <>
            <div>
              <p className="text-zinc-400 font-bold uppercase tracking-widest text-[10px] mb-2 flex items-center gap-1">
                <Calendar size={12} /> Stay Details
              </p>
              <p className="font-bold text-base">Room {reservation.roomNumber}</p>
              <p className="text-zinc-500">
                {format(new Date(reservation.checkIn), 'MMM dd')} - {format(new Date(reservation.checkOut), 'MMM dd, yyyy')}
              </p>
            </div>
            <div className="text-right">
              <p className="text-zinc-400 font-bold uppercase tracking-widest text-[10px] mb-2">Status</p>
              <span className="px-3 py-1 bg-zinc-100 rounded text-xs font-bold uppercase">
                {reservation.status.replace('_', ' ')}
              </span>
            </div>
          </>
        )}
        {type === 'corporate' && !reservation && (
          <>
            <div>
              <p className="text-zinc-400 font-bold uppercase tracking-widest text-[10px] mb-2 flex items-center gap-1">
                <Building2 size={12} /> Corporate Info
              </p>
              <p className="font-bold">{account?.contactPerson}</p>
              <p className="text-zinc-500">{account?.phone}</p>
            </div>
            <div className="text-right">
              <p className="text-zinc-400 font-bold uppercase tracking-widest text-[10px] mb-2">Billing Cycle</p>
              <span className="px-3 py-1 bg-zinc-100 rounded text-xs font-bold uppercase">
                {account?.billingCycle}
              </span>
            </div>
          </>
        )}
      </div>

      <div className="border-t border-zinc-100 my-6" />

      {/* Charges Section */}
      <div className="space-y-4 mb-8">
        <div className="flex justify-between text-[10px] font-bold text-zinc-400 uppercase tracking-widest border-b border-zinc-100 pb-2">
          <span>Charges / Description</span>
          <span className="text-right">Amount</span>
        </div>
        
        <div className="space-y-3">
          {type === 'restaurant' ? (
            ledgerEntries.filter(e => e.category === 'restaurant' && e.type === 'debit').map(e => (
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
              {reservation && !hasRoomChargeInLedger && (
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <p className="text-sm font-bold">Room Charges (Base)</p>
                    <p className="text-[10px] text-zinc-400">Accommodation for {reservation.roomNumber}</p>
                  </div>
                  <span className="font-bold text-sm text-right">{formatCurrency(reservation.totalAmount, currency, exchangeRate)}</span>
                </div>
              )}
              {debits.map(e => (
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

      {/* Payments Section */}
      {(type === 'comprehensive' || type === 'corporate') && (credits.length > 0 || (type !== 'corporate' && reservation && !hasPaymentInLedger && reservation.paidAmount > 0)) && (
        <div className="space-y-4 mb-8">
          <div className="flex justify-between text-[10px] font-bold text-emerald-600 uppercase tracking-widest border-b border-emerald-100 pb-2">
            <span>Payments / Credits</span>
            <span className="text-right">Amount</span>
          </div>
          
          <div className="space-y-3">
            {type !== 'corporate' && reservation && !hasPaymentInLedger && reservation.paidAmount > 0 && (
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <p className="text-sm font-bold text-emerald-600">Initial Payment</p>
                  <p className="text-[10px] text-zinc-400">Recorded at booking</p>
                </div>
                <span className="font-bold text-sm text-right text-emerald-600">-{formatCurrency(reservation.paidAmount, currency, exchangeRate)}</span>
              </div>
            )}
            {credits.map(e => (
              <div key={e.id} className="flex justify-between items-start">
                <div className="flex-1">
                  <p className="text-sm font-bold text-emerald-600">{e.description}</p>
                  <p className="text-[10px] text-zinc-400">{format(new Date(e.timestamp), 'MMM dd, HH:mm')}</p>
                </div>
                <span className="font-bold text-sm text-right text-emerald-600">-{formatCurrency(e.amount, currency, exchangeRate)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Totals Section */}
      <div className="bg-zinc-50 p-6 rounded-2xl space-y-3">
        <div className="flex justify-between items-center">
          <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Subtotal</span>
          <span className="font-bold">{formatCurrency(subtotal, currency, exchangeRate)}</span>
        </div>

        {taxBreakdown.filter(t => t.showOnReceipt).map(tax => (
          <div key={tax.id} className="flex justify-between items-center text-xs">
            <span className="text-zinc-500 uppercase tracking-widest font-bold">
              {tax.name} ({tax.percentage}%) {tax.isInclusive ? '(Incl.)' : ''}
            </span>
            <span className="font-bold">{formatCurrency(tax.amount, currency, exchangeRate)}</span>
          </div>
        ))}
        
        <div className="border-t border-zinc-200 pt-3 flex justify-between items-center">
          <span className="text-sm font-black uppercase tracking-tighter">Grand Total</span>
          <span className="text-xl font-black">{formatCurrency(grandTotal, currency, exchangeRate)}</span>
        </div>
        
        {type !== 'restaurant' && (
          <>
            <div className="flex justify-between items-center text-emerald-600">
              <span className="text-xs font-bold uppercase tracking-widest">Payments Received</span>
              <span className="font-bold">{formatCurrency(type === 'corporate' ? totalPayments : (hasPaymentInLedger ? totalPayments : (reservation?.paidAmount || 0)), currency, exchangeRate)}</span>
            </div>
            {totalOtherCredits > 0 && (
              <div className="flex justify-between items-center text-emerald-600">
                <span className="text-xs font-bold uppercase tracking-widest">Discounts & Transfers</span>
                <span className="font-bold">{formatCurrency(totalOtherCredits, currency, exchangeRate)}</span>
              </div>
            )}
            <div className="border-t border-zinc-200 pt-3 flex justify-between items-center">
              <span className="text-sm font-black uppercase tracking-tighter">
                {balance < 0 ? 'Credit Balance' : 'Balance Due'}
              </span>
              <span className={cn(
                "text-xl font-black",
                balance < 0 ? "text-emerald-600" : ""
              )}>
                {formatCurrency(Math.abs(balance), currency, exchangeRate)}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Bank Details Section */}
      {(branding.bankName || branding.accountNumber) && (
        <div className="mt-6 p-4 border border-zinc-100 rounded-xl text-[10px]">
          <p className="text-zinc-400 font-bold uppercase tracking-widest mb-2">Bank Details</p>
          <div className="flex justify-between">
            <span className="text-zinc-500">Bank Name:</span>
            <span className="font-bold">{branding.bankName || 'N/A'}</span>
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-zinc-500">Account Number:</span>
            <span className="font-bold">{branding.accountNumber || 'N/A'}</span>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="mt-10 text-center">
        <p className="text-sm font-bold mb-1 italic">{branding.greeting || `Thank you for choosing ${hotel.name}!`}</p>
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
          Print {type === 'restaurant' ? 'Docket' : 'Official Receipt'}
        </button>
      </div>
    </div>
  );
}
