import React from 'react';
import { 
  ChevronLeft, 
  ChevronRight, 
  ChevronsLeft, 
  ChevronsRight 
} from 'lucide-react';
import { cn } from '../utils';

export interface PaginationProps {
  currentPage: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
  itemLabel?: string;
  className?: string;
  compact?: boolean;
}

export const Pagination: React.FC<PaginationProps> = ({
  currentPage,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
  itemLabel = 'items',
  className,
  compact = false,
}) => {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safeCurrentPage = Math.min(Math.max(1, currentPage), totalPages);

  const startItem = totalItems === 0 ? 0 : (safeCurrentPage - 1) * pageSize + 1;
  const endItem = Math.min(safeCurrentPage * pageSize, totalItems);

  // Generate page numbers with ellipses
  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      if (safeCurrentPage <= 4) {
        for (let i = 1; i <= 5; i++) pages.push(i);
        pages.push('...');
        pages.push(totalPages);
      } else if (safeCurrentPage >= totalPages - 3) {
        pages.push(1);
        pages.push('...');
        for (let i = totalPages - 4; i <= totalPages; i++) pages.push(i);
      } else {
        pages.push(1);
        pages.push('...');
        pages.push(safeCurrentPage - 1);
        pages.push(safeCurrentPage);
        pages.push(safeCurrentPage + 1);
        pages.push('...');
        pages.push(totalPages);
      }
    }
    return pages;
  };

  if (totalItems === 0) {
    return null;
  }

  return (
    <div 
      className={cn(
        "flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-zinc-800/80 bg-zinc-950/60 select-none text-xs",
        className
      )}
    >
      {/* Showing item range */}
      <div className="flex items-center gap-2 text-zinc-400 text-xs">
        <span>
          Showing <span className="font-semibold text-zinc-100 font-mono">{startItem}</span> to{' '}
          <span className="font-semibold text-zinc-100 font-mono">{endItem}</span> of{' '}
          <span className="font-semibold text-zinc-100 font-mono">{totalItems}</span> {itemLabel}
        </span>

        {/* Page size selector if provided */}
        {onPageSizeChange && pageSizeOptions.length > 0 && !compact && (
          <div className="hidden md:flex items-center gap-1.5 ml-4 pl-4 border-l border-zinc-800">
            <span className="text-zinc-500 text-[11px]">Per page:</span>
            <select
              value={pageSize}
              onChange={(e) => {
                const newSize = Number(e.target.value);
                onPageSizeChange(newSize);
                onPageChange(1);
              }}
              className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs rounded-lg px-2 py-1 focus:outline-none focus:border-emerald-500/50 cursor-pointer font-mono"
            >
              {pageSizeOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Pagination controls */}
      <div className="flex items-center gap-1">
        {/* First Page */}
        <button
          type="button"
          onClick={() => onPageChange(1)}
          disabled={safeCurrentPage <= 1}
          title="First Page"
          className="p-1.5 rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/70 disabled:opacity-30 disabled:pointer-events-none transition-all active:scale-95"
        >
          <ChevronsLeft size={14} />
        </button>

        {/* Previous Page */}
        <button
          type="button"
          onClick={() => onPageChange(safeCurrentPage - 1)}
          disabled={safeCurrentPage <= 1}
          title="Previous Page"
          className="p-1.5 rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/70 disabled:opacity-30 disabled:pointer-events-none transition-all active:scale-95"
        >
          <ChevronLeft size={14} />
        </button>

        {/* Page numbers */}
        <div className="flex items-center gap-1 mx-1">
          {compact ? (
            <span className="text-xs font-mono text-zinc-300 px-2">
              Page {safeCurrentPage} / {totalPages}
            </span>
          ) : (
            getPageNumbers().map((page, idx) => {
              if (page === '...') {
                return (
                  <span
                    key={`ellipsis-${idx}`}
                    className="px-1.5 text-zinc-600 font-mono text-xs select-none"
                  >
                    …
                  </span>
                );
              }

              const isCurrent = page === safeCurrentPage;
              return (
                <button
                  type="button"
                  key={`page-${page}`}
                  onClick={() => onPageChange(page as number)}
                  className={cn(
                    "min-w-[30px] h-[30px] px-2 rounded-lg text-xs font-mono font-medium transition-all",
                    isCurrent
                      ? "bg-emerald-500 text-zinc-950 font-bold shadow-sm shadow-emerald-500/20"
                      : "border border-zinc-800 bg-zinc-900/80 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
                  )}
                >
                  {page}
                </button>
              );
            })
          )}
        </div>

        {/* Next Page */}
        <button
          type="button"
          onClick={() => onPageChange(safeCurrentPage + 1)}
          disabled={safeCurrentPage >= totalPages}
          title="Next Page"
          className="p-1.5 rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/70 disabled:opacity-30 disabled:pointer-events-none transition-all active:scale-95"
        >
          <ChevronRight size={14} />
        </button>

        {/* Last Page */}
        <button
          type="button"
          onClick={() => onPageChange(totalPages)}
          disabled={safeCurrentPage >= totalPages}
          title="Last Page"
          className="p-1.5 rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/70 disabled:opacity-30 disabled:pointer-events-none transition-all active:scale-95"
        >
          <ChevronsRight size={14} />
        </button>

        {/* Compact size selector on mobile if present */}
        {onPageSizeChange && pageSizeOptions.length > 0 && (
          <div className="md:hidden ml-2">
            <select
              value={pageSize}
              onChange={(e) => {
                onPageSizeChange(Number(e.target.value));
                onPageChange(1);
              }}
              className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-[11px] rounded-lg px-1.5 py-1 font-mono"
            >
              {pageSizeOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}/pg
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </div>
  );
};
