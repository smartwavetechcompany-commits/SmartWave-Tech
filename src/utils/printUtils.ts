/**
 * Universal Print Engine for Tyyl Tech PMS
 * 
 * Ensures that whenever any document (receipt, invoice, folio, kitchen docket, 
 * audit timeline, DSS report, breakfast list, staff slip, etc.) is printed, 
 * ONLY that exact document is printed — completely isolating it from background 
 * dashboards, open underlying modals, sidebars, headers, and UI interfaces.
 */

export interface PrintOptions {
  title?: string;
  pageSize?: 'A4' | 'A4 portrait' | 'A4 landscape' | '80mm auto' | 'letter';
  pageMargin?: string;
  landscape?: boolean;
}

let activeCleanupFn: (() => void) | null = null;

/**
 * Isolates an element into #print-root and prepares the DOM for clean printing.
 */
function isolateElementForPrint(
  element: HTMLElement,
  options?: PrintOptions
): void {
  // If a previous print session is somehow lingering, clean it up
  if (activeCleanupFn) {
    activeCleanupFn();
  }

  // Ensure #print-root exists in DOM
  let printRoot = document.getElementById('print-root');
  if (!printRoot) {
    printRoot = document.createElement('div');
    printRoot.id = 'print-root';
    printRoot.setAttribute('aria-hidden', 'true');
    document.body.appendChild(printRoot);
  }

  // Deep clone the printable element
  const cloned = element.cloneNode(true) as HTMLElement;

  // Unhide the root clone if it was hidden on screen (e.g., hidden print:block containers)
  cloned.classList.remove('hidden');
  cloned.style.display = 'block';

  // Unhide any descendant elements that had 'hidden print:block'
  const printBlockElements = cloned.querySelectorAll<HTMLElement>(
    '.hidden, [class*="hidden"]'
  );
  printBlockElements.forEach(el => {
    if (el.classList.contains('print:block') || el.className.includes('print:block')) {
      el.classList.remove('hidden');
      el.style.display = 'block';
    }
  });

  // Remove interactive elements, close buttons, print triggers, inputs, and toasts
  const elementsToRemove = cloned.querySelectorAll<HTMLElement>(
    'button, .print\\:hidden, .no-print, [data-sonner-toaster], .cursor-pointer.hover\\:bg-white\\/10, [class*="print:hidden"], input:not([type="checkbox"]):not([type="radio"]), select, textarea'
  );
  elementsToRemove.forEach(el => el.remove());

  // Copy canvas contents (QR codes, logos, signatures) from original to clone
  const origCanvases = element.querySelectorAll<HTMLCanvasElement>('canvas');
  const cloneCanvases = cloned.querySelectorAll<HTMLCanvasElement>('canvas');
  origCanvases.forEach((orig, idx) => {
    const dest = cloneCanvases[idx];
    if (dest) {
      dest.width = orig.width;
      dest.height = orig.height;
      const ctx = dest.getContext('2d');
      if (ctx) {
        ctx.drawImage(orig, 0, 0);
      }
    }
  });

  // Copy form field values
  const origInputs = element.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select');
  const cloneInputs = cloned.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select');
  origInputs.forEach((orig, idx) => {
    const dest = cloneInputs[idx];
    if (dest) {
      dest.value = orig.value;
    }
  });

  // Clean shadow, borders, and margins for clean print output
  cloned.classList.remove('shadow-2xl', 'shadow-xl', 'shadow-lg', 'shadow-md', 'shadow-sm');
  cloned.style.boxShadow = 'none';
  cloned.style.margin = '0 auto';

  // If thermal docket, ensure width constraint
  const isDocket = cloned.classList.contains('docket-container') || cloned.classList.contains('fandb-docket');
  if (isDocket) {
    cloned.style.width = '80mm';
    cloned.style.maxWidth = '80mm';
  } else {
    cloned.style.width = '100%';
    cloned.style.maxWidth = options?.landscape ? '100%' : '210mm';
  }

  // Clear previous print content and append cloned document
  printRoot.innerHTML = '';
  printRoot.appendChild(cloned);

  // Set document title for print header/file save name
  const originalTitle = document.title;
  if (options?.title) {
    document.title = options.title;
  }

  // Inject dynamic print style override for @page
  const styleId = 'dynamic-print-override-style';
  let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = styleId;
    document.head.appendChild(styleEl);
  }

  let chosenPageSize = options?.pageSize;
  if (!chosenPageSize) {
    if (isDocket) {
      chosenPageSize = '80mm auto';
    } else if (options?.landscape) {
      chosenPageSize = 'A4 landscape';
    } else {
      chosenPageSize = 'A4 portrait';
    }
  }

  const chosenMargin = options?.pageMargin ?? (isDocket ? '0' : '8mm');

  styleEl.textContent = `
    @media print {
      @page {
        size: ${chosenPageSize};
        margin: ${chosenMargin};
      }
    }
  `;

  // Activate isolated printing mode
  document.documentElement.classList.add('is-printing-active');
  document.body.classList.add('is-printing-active');

  // Define cleanup routine
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    activeCleanupFn = null;
    document.documentElement.classList.remove('is-printing-active');
    document.body.classList.remove('is-printing-active');
    if (options?.title) {
      document.title = originalTitle;
    }
    if (styleEl && styleEl.parentNode) {
      styleEl.parentNode.removeChild(styleEl);
    }
    if (printRoot) {
      printRoot.innerHTML = '';
    }
    window.removeEventListener('afterprint', onAfterPrint);
  };

  const onAfterPrint = () => {
    // Allow browser print spooler time to complete
    setTimeout(cleanup, 2500);
  };

  activeCleanupFn = cleanup;
  window.addEventListener('afterprint', onAfterPrint);

  // Safety timeout (120 seconds) so user taking time in browser print dialog never gets document wiped
  setTimeout(cleanup, 120000);
}

/**
 * Universal printDocument function. Call this on any button click.
 */
export function printDocument(
  target: Element | string | null,
  options?: PrintOptions
): void {
  let element: HTMLElement | null = null;

  if (typeof target === 'string') {
    element = document.getElementById(target) || document.querySelector<HTMLElement>(target);
  } else if (target instanceof HTMLElement) {
    element = target;
  } else if (target instanceof Element) {
    element = target as HTMLElement;
  }

  // Fallback discovery if target is not directly provided
  if (!element) {
    element = document.querySelector<HTMLElement>(
      '#standard-print-document, #active-hotel-receipt, .receipt-container, .docket-container, #bulk-settle-invoice, .superadmin-receipt, .staff-handover-slip, .corporate-invoice, #active-report-print-manifest, #breakfast-manifest-print-container, #dss-guest-report-print-container, [data-printable="true"]'
    );
  }

  if (!element) {
    window.print();
    return;
  }

  // Isolate document
  isolateElementForPrint(element, options);

  // Trigger browser print dialog after frame paint
  const executePrint = () => {
    try {
      window.print();
    } catch (err) {
      console.error('Print execution error:', err);
    }
  };

  requestAnimationFrame(() => {
    setTimeout(executePrint, 60);
  });
}

/**
 * Global Automatic Print Interceptor:
 * Ensures that even if the user presses Ctrl+P or uses the browser's native Print command,
 * if an active document (receipt, invoice, docket, handover slip, or report) is present,
 * it automatically isolates that exact document into #print-root so the underlying screen/timeline NEVER leaks!
 */
export function setupGlobalPrintListener(): void {
  if (typeof window === 'undefined') return;

  window.addEventListener('beforeprint', () => {
    // If already in isolated print mode, nothing to do
    if (document.body.classList.contains('is-printing-active')) return;

    // Check for open printable documents in priority order
    const prioritySelectors = [
      '#standard-print-document',
      '#active-hotel-receipt',
      '.receipt-container',
      '.docket-container',
      '#bulk-settle-invoice',
      '#superadmin-subscription-receipt',
      '.superadmin-receipt',
      '#staff-handover-slip',
      '.staff-handover-slip',
      '#fandb-kitchen-docket',
      '.fandb-docket',
      '#breakfast-manifest-print-container',
      '#dss-guest-report-print-container',
      '#ar-outstanding-guest-ledger-container',
      '#reports-analytics-print-container',
      '#active-report-print-manifest',
      '#active-guest-timeline',
      '.outstanding-ledger-document',
      '.guest-timeline-document',
      '[data-printable="true"]'
    ];

    for (const selector of prioritySelectors) {
      const found = document.querySelector<HTMLElement>(selector);
      if (found && found.isConnected) {
        // Verify container is connected in the active document view
        const isPrintContainer = found.id.includes('print-container') || found.id.includes('print-manifest') || found.getAttribute('data-printable') === 'true';
        const isRelevant = isPrintContainer
          ? (found.parentElement !== null)
          : (found.offsetWidth > 0 || found.offsetHeight > 0 || found.offsetParent !== null);

        if (isRelevant) {
          isolateElementForPrint(found);
          break;
        }
      }
    }
  });
}

// Automatically install global print listener on module load
setupGlobalPrintListener();

export { generatePdfExport, type GeneratePdfExportOptions } from './pdfExport';
