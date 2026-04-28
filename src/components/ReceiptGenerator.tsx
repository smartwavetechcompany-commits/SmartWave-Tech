import React from 'react';
import { Reservation, Hotel, LedgerEntry, CorporateAccount } from '../types';
import { formatCurrency, cn, safeToDate } from '../utils';
import { format } from 'date-fns';
import { useAuth } from '../contexts/AuthContext';
import { Printer, Receipt, Calendar, User, Building2, MapPin, Phone, Mail } from 'lucide-react';

interface ReceiptProps {
  hotel: Hotel;
  reservation?: Reservation;
  account?: CorporateAccount;
  type: 'restaurant' | 'comprehensive' | 'corporate';
  ledgerEntries?: LedgerEntry[];
  folioType?: 'guest' | 'company' | 'all';
}

export function ReceiptGenerator({ hotel, reservation, account, type, ledgerEntries = [], folioType = 'all' }: ReceiptProps) {
  const { currency, exchangeRate } = useAuth();
  const branding = hotel.branding || {};

  // Filter entries based on folioType if reservation is corporate
  const filteredEntries = (reservation?.corporateId && folioType !== 'all')
    ? ledgerEntries.filter(e => folioType === 'company' ? !!e.corporateId : !e.corporateId)
    : ledgerEntries;
  
  const debits = filteredEntries.filter(e => e.type === 'debit');
  const credits = filteredEntries.filter(e => e.type === 'credit');
  
  const totalDebits = debits.reduce((acc, e) => acc + e.amount, 0);
  const totalCredits = credits.reduce((acc, e) => acc + e.amount, 0);
  const totalPayments = credits.filter(e => e.category?.toLowerCase() === 'payment').reduce((acc, e) => acc + e.amount, 0);
  const totalOtherCredits = totalCredits - totalPayments;
  
  const totalTaxDebits = filteredEntries.filter(e => e.category === 'tax' && e.type === 'debit').reduce((acc, e) => acc + e.amount, 0);
  const totalNonTaxDebits = totalDebits - totalTaxDebits;
  
  // If room charges are already in ledger, don't add reservation.totalAmount again
  const hasRoomChargeInLedger = filteredEntries.some(e => e.category?.toLowerCase() === 'room' && e.type === 'debit');
  const subtotal = totalNonTaxDebits;
  
  // Calculate Taxes
  const activeTaxes = (hotel.taxes || []).filter(t => {
    const status = (t.status || '').toLowerCase();
    const category = (t.category || '').toLowerCase();
    if (status !== 'active') return false;
    if (type === 'restaurant') {
      return category === 'restaurant' || category === 'all';
    }
    if (type === 'comprehensive' || type === 'corporate') {
      return true; // Show all taxes on comprehensive/corporate receipt
    }
    return category === 'all';
  });

  let taxTotal = 0;
  let exclusiveTaxTotal = 0;
  const taxBreakdown = activeTaxes.map(tax => {
    let amount = 0;
    
    // If we have taxes in ledger, use them for accurate reporting
    if (totalTaxDebits > 0) {
      amount = filteredEntries
        .filter(e => e.category === 'tax' && e.type === 'debit' && e.description.toLowerCase().includes(tax.name.toLowerCase()))
        .reduce((acc, e) => acc + e.amount, 0);
      
      // If amount is 0 in ledger, it might be an inclusive tax that was only added to description
      if (amount === 0 && tax.isInclusive) {
        amount = subtotal * (tax.percentage / 100);
      }
      
      taxTotal += amount;
      if (!tax.isInclusive) {
        exclusiveTaxTotal += amount;
      }
    } else {
      // Fallback to calculation if ledger is empty (e.g. preview before posting)
      amount = subtotal * (tax.percentage / 100);
      taxTotal += amount;
      if (!tax.isInclusive) {
        exclusiveTaxTotal += amount;
      }
    }
    return { ...tax, amount };
  });

  // Add "Other Taxes" if there are unmatched tax debits in the ledger
  const matchedExclusiveTaxTotal = taxBreakdown.filter(t => !t.isInclusive).reduce((acc, t) => acc + t.amount, 0);
  const otherTaxAmount = totalTaxDebits > matchedExclusiveTaxTotal ? totalTaxDebits - matchedExclusiveTaxTotal : 0;
  if (otherTaxAmount > 0.01) {
    exclusiveTaxTotal += otherTaxAmount;
  }

  const grandTotal = subtotal + exclusiveTaxTotal;
  const hasPaymentInLedger = ledgerEntries.some(e => e.category?.toLowerCase() === 'payment' && e.type === 'credit');
  const totalPaid = totalCredits + (type === 'corporate' ? 0 : (hasPaymentInLedger ? 0 : (reservation?.paidAmount || 0)));
  const balance = grandTotal - totalPaid;

  return (
    <div className={cn(
      "bg-white text-zinc-900 mx-auto font-sans shadow-2xl border border-zinc-200 print:shadow-none print:border-none print:p-0 print:m-0",
      (type === 'comprehensive' || type === 'corporate') ? "w-[210mm] min-h-[297mm] print:min-h-0 pt-8 px-12 pb-12 receipt-container" : "w-[80mm] p-4 docket-container"
    )}>
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          @page { 
            size: ${type === 'restaurant' ? '80mm auto' : 'A4'}; 
            margin: 0; 
          }
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            height: auto !important;
            background: white !important;
          }
          body * { 
            visibility: hidden !important; 
          }
          .receipt-container, .receipt-container *, .docket-container, .docket-container * { 
            visibility: visible !important; 
          }
          .receipt-container, .docket-container { 
            position: fixed !important; 
            left: 0 !important; 
            top: 0 !important; 
            width: ${type === 'restaurant' ? '80mm' : '210mm'} !important;
            height: auto !important;
            min-height: 0 !important;
            margin: 0 !important;
            padding: ${type === 'restaurant' ? '5mm' : '10mm 15mm'} !important;
            background: white !important;
            box-shadow: none !important;
            border: none !important;
            z-index: 99999 !important;
          }
          .print-hidden { display: none !important; }
        }
      `}} />
      {/* Hotel Header */}
      <div className="text-center border-b-2 border-zinc-900 pb-6 mb-6">
        {branding.logoUrl ? (
          <img src={branding.logoUrl} alt={hotel.name} className="h-20 mx-auto mb-4 object-contain" referrerPolicy="no-referrer" />
        ) : (
          <div className="w-16 h-16 bg-zinc-100 text-zinc-900 rounded-full flex items-center justify-center mx-auto mb-4 font-black text-2xl border-2 border-zinc-900">
            {hotel.name.charAt(0)}
          </div>
        )}
        <h1 className="text-2xl font-black uppercase tracking-tighter">{branding.organizationName || hotel.name}</h1>
        <div className="text-[10px] text-zinc-500 font-medium mt-1 space-y-0.5">
          <p className="flex items-center justify-center gap-1"><MapPin size={10} /> {branding.address || 'Hotel Address'}</p>
          <p className="flex items-center justify-center gap-1">
            <Phone size={10} /> {branding.phone || '+123456789'} 
            {branding.email && <><span className="mx-2">|</span> <Mail size={10} /> {branding.email}</>}
          </p>
          {hotel.website && <p className="text-emerald-600 font-bold text-xs">{hotel.website}</p>}
        </div>
      </div>

      {/* Receipt Info Grid */}
      <div className="grid grid-cols-2 gap-x-8 gap-y-6 mb-8 text-sm">
        <div>
          <p className="text-zinc-400 font-bold uppercase tracking-widest text-[9px] mb-1 flex items-center gap-1">
            <User size={10} /> {type === 'corporate' ? 'Account Details' : 'Guest Details'}
          </p>
          <p className="font-bold text-base">{type === 'corporate' ? account?.name : reservation?.guestName}</p>
          <p className="text-zinc-500 text-xs">{type === 'corporate' ? account?.email : reservation?.guestEmail}</p>
          {type === 'corporate' && account?.taxId && <p className="text-zinc-400 text-[10px] mt-0.5">Tax ID: {account.taxId}</p>}
        </div>
        <div className="text-right">
          <p className="text-zinc-400 font-bold uppercase tracking-widest text-[9px] mb-1 flex items-center justify-end gap-1">
            <Receipt size={10} /> {type === 'corporate' ? 'OFFICIAL CORPORATE RECEIPT' : (folioType === 'company' ? 'CORPORATE FOLIO STATEMENT' : 'OFFICIAL GUEST RECEIPT')}
          </p>
          <p className="font-bold text-base">#{type === 'corporate' ? account?.id?.slice(-8).toUpperCase() : reservation?.id?.slice(-8).toUpperCase()}</p>
          <p className="text-zinc-500 text-xs">{format(new Date(), 'MMMM dd, yyyy HH:mm')}</p>
        </div>
        
        {reservation ? (
          <>
            <div>
              <p className="text-zinc-400 font-bold uppercase tracking-widest text-[9px] mb-1 flex items-center gap-1">
                <Calendar size={10} /> Stay Details
              </p>
              <p className="font-bold text-sm">Room {reservation.roomNumber}</p>
              <p className="text-zinc-500 text-xs">
                {format(safeToDate(reservation.checkIn), 'MMM dd')} - {format(safeToDate(reservation.checkOut), 'MMM dd, yyyy')}
              </p>
            </div>
            <div className="text-right">
              <p className="text-zinc-400 font-bold uppercase tracking-widest text-[9px] mb-1">Status</p>
              <span className="px-2 py-0.5 bg-zinc-100 rounded text-[10px] font-bold uppercase">
                {(reservation?.status || '').replace('_', ' ')}
              </span>
            </div>
          </>
        ) : type === 'corporate' && account ? (
          <>
            <div>
              <p className="text-zinc-400 font-bold uppercase tracking-widest text-[9px] mb-1 flex items-center gap-1">
                <Building2 size={10} /> Contact Person
              </p>
              <p className="font-bold text-sm">{account.contactPerson}</p>
              <p className="text-zinc-500 text-xs">{account.phone}</p>
            </div>
            <div className="text-right">
              <p className="text-zinc-400 font-bold uppercase tracking-widest text-[9px] mb-1">Billing Cycle</p>
              <span className="px-2 py-0.5 bg-zinc-100 rounded text-[10px] font-bold uppercase">
                {account.billingCycle}
              </span>
            </div>
          </>
        ) : null}
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
                  <p className="text-[10px] text-zinc-400">{format(safeToDate(e.timestamp), 'MMM dd, HH:mm')}</p>
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
                    <p className="text-[10px] text-zinc-400">{format(safeToDate(e.timestamp), 'MMM dd, HH:mm')}</p>
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
                  <p className="text-[10px] text-zinc-400">{format(safeToDate(e.timestamp), 'MMM dd, HH:mm')}</p>
                </div>
                <span className="font-bold text-sm text-right text-emerald-600">-{formatCurrency(e.amount, currency, exchangeRate)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Totals Section */}
      <div className="bg-zinc-50 p-4 rounded-xl space-y-2">
        <div className="flex justify-between items-center">
          <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Subtotal</span>
          <span className="font-bold text-sm">{formatCurrency(subtotal, currency, exchangeRate)}</span>
        </div>

        {taxBreakdown.filter(t => t.showOnReceipt).map(tax => (
          <div key={tax.id} className="flex justify-between items-center text-[10px]">
            <span className="text-zinc-500 uppercase tracking-widest font-bold">
              {tax.name} ({tax.percentage}%) {tax.isInclusive ? '(Incl.)' : ''}
            </span>
            <span className="font-bold">{formatCurrency(tax.amount, currency, exchangeRate)}</span>
          </div>
        ))}

        {otherTaxAmount > 0.01 && (
          <div className="flex justify-between items-center text-[10px]">
            <span className="text-zinc-500 uppercase tracking-widest font-bold">
              Other Posted Taxes
            </span>
            <span className="font-bold">{formatCurrency(otherTaxAmount, currency, exchangeRate)}</span>
          </div>
        )}
        
        <div className="border-t border-zinc-200 pt-2 flex justify-between items-center">
          <span className="text-xs font-black uppercase tracking-tighter">Grand Total</span>
          <span className="text-lg font-black">{formatCurrency(grandTotal, currency, exchangeRate)}</span>
        </div>
        
        {type !== 'restaurant' && (
          <>
            <div className="flex justify-between items-center text-emerald-600 text-[10px]">
              <span className="font-bold uppercase tracking-widest">Payments Received</span>
              <span className="font-bold">{formatCurrency(totalPayments, currency, exchangeRate)}</span>
            </div>
            {totalOtherCredits > 0 && (
              <div className="flex justify-between items-center text-emerald-600 text-[10px]">
                <span className="font-bold uppercase tracking-widest">Discounts & Transfers</span>
                <span className="font-bold">{formatCurrency(totalOtherCredits, currency, exchangeRate)}</span>
              </div>
            )}
            <div className="border-t border-zinc-200 pt-2 flex justify-between items-center">
              <span className="text-xs font-black uppercase tracking-tighter">
                {balance < 0 ? 'Credit Balance' : 'Balance Due'}
              </span>
              <span className={cn(
                "text-lg font-black",
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
        <div className="mt-4 p-3 border border-zinc-100 rounded-lg text-[9px]">
          <p className="text-zinc-400 font-bold uppercase tracking-widest mb-1">Bank Details</p>
          <div className="flex justify-between">
            <span className="text-zinc-500">Bank Name:</span>
            <span className="font-bold">{branding.bankName || 'N/A'}</span>
          </div>
          <div className="flex justify-between mt-0.5">
            <span className="text-zinc-500">Account Number:</span>
            <span className="font-bold">{branding.accountNumber || 'N/A'}</span>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="mt-6 text-center">
        <p className="text-xs font-bold mb-1 italic">{branding.greeting || `Thank you for choosing ${hotel.name}!`}</p>
        <p className="text-[9px] text-zinc-400 max-w-[250px] mx-auto leading-relaxed">
          {branding.footerNotes || 'We hope you enjoyed your stay. Please keep this receipt for your records.'}
        </p>
        <div className="mt-4 pt-4 border-t border-zinc-100 flex items-center justify-center gap-2 opacity-30 grayscale">
          <div className="w-3 h-3 bg-zinc-900 rounded-sm" />
          <span className="text-[7px] font-black uppercase tracking-widest">PMS Enterprise Certified</span>
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
