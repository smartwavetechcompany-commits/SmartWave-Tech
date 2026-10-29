import React from 'react';
import { Hotel } from '../types';
import { format } from 'date-fns';
import { Printer, XCircle, CheckCircle, FileText, Download } from 'lucide-react';
import { printDocument, PrintOptions, generatePdfExport } from '../utils/printUtils';
import { cn } from '../utils';

export interface PrintTemplateProps {
  id?: string;
  hotel: Hotel | null;
  documentTitle: string;
  documentSubtitle?: string;
  documentNumber?: string;
  date?: string | Date;
  operatorName?: string;
  customerOrGuest?: {
    name: string;
    subtext?: string;
    phone?: string;
    email?: string;
    roomNumber?: string;
    idNumber?: string;
  };
  metadata?: Array<{ label: string; value: string | React.ReactNode }>;
  summaryCards?: Array<{ label: string; value: string | React.ReactNode; highlight?: boolean }>;
  children: React.ReactNode;
  showSignatures?: boolean;
  notesOrTerms?: string[];
  pageSize?: 'A4 portrait' | 'A4 landscape' | '80mm auto';
  pageMargin?: string;
  onClose?: () => void;
  actions?: React.ReactNode;
  className?: string;
}

/**
 * Standardized High-Contrast Print Layout Template for Invoices and Reports.
 * Optimizes output strictly for paper printing:
 * - Automatically isolates printable document and strips all extraneous app UI
 * - High-contrast monochromatic styling that eliminates ink-wasting fills
 * - Crisp page-break controls (break-inside: avoid)
 * - Standardized hotel brand header with TIN / CAC legal identifiers
 * - Official audit signature blocks and computerized document declaration
 */
export function PrintTemplate({
  id = 'standard-print-document',
  hotel,
  documentTitle,
  documentSubtitle,
  documentNumber,
  date = new Date(),
  operatorName,
  customerOrGuest,
  metadata = [],
  summaryCards = [],
  children,
  showSignatures = true,
  notesOrTerms,
  pageSize = 'A4 portrait',
  pageMargin = '10mm',
  onClose,
  actions,
  className
}: PrintTemplateProps) {
  const branding = hotel?.branding || {};
  const formattedDate = date instanceof Date 
    ? format(date, 'MMMM dd, yyyy HH:mm') 
    : String(date);

  const handlePrint = () => {
    const target = document.getElementById(id);
    const options: PrintOptions = {
      title: `${hotel?.name || 'Hotel'} - ${documentTitle}${documentNumber ? ` - ${documentNumber}` : ''}`,
      pageSize,
      pageMargin
    };
    printDocument(target, options);
  };

  const handleDownloadPdf = () => {
    const target = document.getElementById(id);
    const cleanDocTitle = `${hotel?.name || 'Hotel'}-${documentTitle}${documentNumber ? `-${documentNumber}` : ''}`;
    generatePdfExport(target, {
      title: documentTitle,
      filename: cleanDocTitle,
      orientation: pageSize === 'A4 landscape' ? 'landscape' : 'portrait'
    });
  };

  return (
    <div className="relative w-full max-w-5xl mx-auto">
      {/* On-Screen Action Toolbar (Hidden during printing) */}
      <div className="flex items-center justify-between gap-3 mb-4 p-3 bg-zinc-900 border border-zinc-800 rounded-xl print:hidden shadow-lg">
        <div className="flex items-center gap-2 text-zinc-300">
          <FileText size={18} className="text-emerald-500" />
          <div>
            <h3 className="text-xs font-bold text-zinc-100">{documentTitle}</h3>
            <p className="text-[10px] text-zinc-500">Standardized Paper Print Layout</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {actions}
          <button
            type="button"
            onClick={handleDownloadPdf}
            className="px-3.5 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-bold rounded-lg text-xs active:scale-95 transition-all flex items-center gap-1.5 border border-zinc-700 shadow-sm cursor-pointer"
            title="Download PDF Document"
          >
            <Download size={15} className="text-emerald-400" />
            <span className="hidden sm:inline">Download PDF</span>
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="px-4 py-2 bg-emerald-500 text-black font-bold rounded-lg text-xs hover:bg-emerald-400 active:scale-95 transition-all flex items-center gap-2 shadow-md cursor-pointer"
            title="Print Document"
          >
            <Printer size={15} />
            <span>Print Document</span>
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
              title="Close Preview"
            >
              <XCircle size={18} />
            </button>
          )}
        </div>
      </div>

      {/* Printable Document Sheet Container */}
      <div
        id={id}
        data-printable="true"
        className={cn(
          "bg-white text-zinc-900 mx-auto font-sans p-8 sm:p-12 border border-zinc-300 rounded-xl shadow-2xl",
          "print:shadow-none print:border-none print:p-0 print:m-0 print:w-full print:rounded-none",
          pageSize === 'A4 landscape' ? "w-full" : "max-w-[210mm]",
          className
        )}
      >
        {/* ================================================================ */}
        {/* STANDARDIZED HOTEL HEADER                                        */}
        {/* ================================================================ */}
        <header className="border-b-2 border-black pb-5 mb-6">
          <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
            {/* Hotel Identity */}
            <div className="flex items-start gap-3">
              {branding.logoUrl ? (
                <img
                  src={branding.logoUrl}
                  alt={hotel?.name || 'Hotel Logo'}
                  className="h-16 w-auto max-w-[140px] object-contain shrink-0"
                  crossOrigin="anonymous"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-14 h-14 bg-zinc-900 text-white rounded-lg flex items-center justify-center font-black text-xl shrink-0">
                  {hotel?.name?.charAt(0) || 'H'}
                </div>
              )}
              <div>
                <h1 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-black leading-tight">
                  {branding.organizationName || hotel?.name || 'HOTEL RESORT & SUITES'}
                </h1>
                {branding.address && (
                  <p className="text-[11px] text-zinc-700 font-medium leading-normal mt-0.5 max-w-sm">
                    {branding.address}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-zinc-600 mt-1 font-mono">
                  {branding.phone && <span>Tel: {branding.phone}</span>}
                  {branding.email && <span>Email: {branding.email}</span>}
                  {(branding.website || hotel?.website) && <span>Web: {branding.website || hotel?.website}</span>}
                </div>
                {/* Legal & Tax IDs */}
                {(branding.tin || branding.cac) && (
                  <div className="flex flex-wrap items-center gap-x-3 mt-1.5 text-[9px] font-mono font-bold text-zinc-800">
                    {branding.tin && <span className="border border-zinc-400 px-1.5 py-0.5 rounded">TIN: {branding.tin}</span>}
                    {branding.cac && <span className="border border-zinc-400 px-1.5 py-0.5 rounded">CAC/RC: {branding.cac}</span>}
                  </div>
                )}
              </div>
            </div>

            {/* Document Title & Reference Metadata */}
            <div className="text-left sm:text-right shrink-0 border-t sm:border-t-0 pt-2 sm:pt-0 border-zinc-200 w-full sm:w-auto">
              <span className="inline-block px-2.5 py-1 bg-black text-white text-[11px] font-black uppercase tracking-wider rounded">
                {documentTitle}
              </span>
              {documentSubtitle && (
                <p className="text-[10px] text-zinc-600 font-bold uppercase mt-1">
                  {documentSubtitle}
                </p>
              )}
              {documentNumber && (
                <p className="text-sm font-mono font-black text-black mt-1">
                  Ref: #{documentNumber}
                </p>
              )}
              <p className="text-[10px] font-mono text-zinc-600 mt-0.5">
                Date: {formattedDate}
              </p>
              {operatorName && (
                <p className="text-[10px] text-zinc-500 mt-0.5">
                  Issued By: <span className="font-semibold text-zinc-800">{operatorName}</span>
                </p>
              )}
            </div>
          </div>
        </header>

        {/* ================================================================ */}
        {/* CUSTOMER / GUEST & STAY METADATA GRID                            */}
        {/* ================================================================ */}
        {(customerOrGuest || metadata.length > 0) && (
          <section className="mb-6 bg-zinc-50 border border-zinc-200 rounded-lg p-4 print:bg-transparent print:border-zinc-300">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 text-xs">
              {customerOrGuest && (
                <div className="border-b sm:border-b-0 sm:border-r border-zinc-200 pb-3 sm:pb-0 pr-3">
                  <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 block mb-1">
                    Billed To / Guest Details
                  </span>
                  <p className="font-bold text-sm text-black">{customerOrGuest.name}</p>
                  {customerOrGuest.subtext && <p className="text-zinc-600 text-[11px]">{customerOrGuest.subtext}</p>}
                  {customerOrGuest.roomNumber && (
                    <p className="text-zinc-800 text-[11px] font-semibold mt-0.5">
                      Room Number: <span className="font-mono font-bold">{customerOrGuest.roomNumber}</span>
                    </p>
                  )}
                  {customerOrGuest.phone && <p className="text-zinc-600 text-[10px] font-mono">Tel: {customerOrGuest.phone}</p>}
                  {customerOrGuest.email && <p className="text-zinc-600 text-[10px]">Email: {customerOrGuest.email}</p>}
                </div>
              )}

              {metadata.map((item, idx) => (
                <div key={idx} className="space-y-0.5">
                  <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 block">
                    {item.label}
                  </span>
                  <div className="font-medium text-zinc-900 text-xs">{item.value}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ================================================================ */}
        {/* SUMMARY METRICS CARDS (IF APPLICABLE)                             */}
        {/* ================================================================ */}
        {summaryCards.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            {summaryCards.map((card, idx) => (
              <div 
                key={idx} 
                className={cn(
                  "p-3 rounded border text-left",
                  card.highlight 
                    ? "bg-zinc-100 border-black text-black font-bold" 
                    : "bg-white border-zinc-300 text-zinc-800"
                )}
              >
                <div className="text-[9px] font-bold uppercase tracking-wider text-zinc-600">{card.label}</div>
                <div className="text-sm font-black mt-0.5 font-mono">{card.value}</div>
              </div>
            ))}
          </div>
        )}

        {/* ================================================================ */}
        {/* DOCUMENT MAIN CONTENT & LINE ITEMS                               */}
        {/* ================================================================ */}
        <main className="space-y-4 print-content mb-8">
          {children}
        </main>

        {/* ================================================================ */}
        {/* TERMS & POLICIES                                                 */}
        {/* ================================================================ */}
        {notesOrTerms && notesOrTerms.length > 0 && (
          <div className="mt-6 pt-4 border-t border-zinc-200 text-[10px] text-zinc-600 space-y-1 break-inside-avoid">
            <span className="font-bold uppercase tracking-wider text-zinc-800 block mb-1">
              Terms & Hotel Policies:
            </span>
            <ul className="list-disc list-inside space-y-0.5 pl-1">
              {notesOrTerms.map((note, idx) => (
                <li key={idx} className="leading-relaxed">{note}</li>
              ))}
            </ul>
          </div>
        )}

        {/* ================================================================ */}
        {/* STANDARDIZED SIGNATURES & VERIFICATION BLOCK                     */}
        {/* ================================================================ */}
        {showSignatures && (
          <div className="mt-8 pt-6 border-t-2 border-zinc-300 grid grid-cols-2 gap-8 break-inside-avoid text-xs">
            <div>
              <div className="border-b border-zinc-400 pb-1 h-12 flex items-end">
                <span className="text-[10px] text-zinc-400 italic">Signature</span>
              </div>
              <p className="text-[10px] font-bold text-zinc-800 uppercase tracking-wider mt-1.5">
                Authorized Hotel Signatory / Front Office
              </p>
              <p className="text-[9px] text-zinc-500 font-mono">Date: ________________________</p>
            </div>

            <div>
              <div className="border-b border-zinc-400 pb-1 h-12 flex items-end">
                <span className="text-[10px] text-zinc-400 italic">Signature</span>
              </div>
              <p className="text-[10px] font-bold text-zinc-800 uppercase tracking-wider mt-1.5">
                Guest / Client Signature & Confirmation
              </p>
              <p className="text-[9px] text-zinc-500 font-mono">Date: ________________________</p>
            </div>
          </div>
        )}

        {/* ================================================================ */}
        {/* OFFICIAL FOOTER & DISCLAIMER                                     */}
        {/* ================================================================ */}
        <footer className="mt-8 pt-4 border-t border-zinc-200 text-center text-[9px] text-zinc-500 space-y-0.5 break-inside-avoid font-mono">
          <p className="font-bold text-zinc-700 uppercase">
            Official Document • {hotel?.name || 'Hotel Property'}
          </p>
          <p>
            This is a computer-generated document. Generated via Hotel PMS on {formattedDate}.
          </p>
          <p className="text-[8px] text-zinc-400">
            Thank you for choosing {hotel?.name || 'our property'}. For any inquiries, please contact {branding.email || branding.phone || 'the front desk'}.
          </p>
        </footer>
      </div>
    </div>
  );
}
