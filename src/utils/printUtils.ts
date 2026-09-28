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

export function printDocument(
  target: HTMLElement | string | null,
  options?: PrintOptions
): void {
  let element: HTMLElement | null = null;

  if (typeof target === 'string') {
    element = document.getElementById(target) || document.querySelector<HTMLElement>(target);
  } else if (target instanceof HTMLElement) {
    element = target;
  }

  // Fallback discovery if target is not directly provided
  if (!element) {
    element = document.querySelector<HTMLElement>(
      '.receipt-container, .docket-container, .superadmin-receipt, .staff-handover-slip, .corporate-invoice, [data-printable="true"]'
    );
  }

  if (!element) {
    window.print();
    return;
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

  // Remove interactive elements, close buttons, print triggers, and toasts
  const elementsToRemove = cloned.querySelectorAll<HTMLElement>(
    'button, .print\\:hidden, .no-print, [data-sonner-toaster], .cursor-pointer.hover\\:bg-white\\/10'
  );
  elementsToRemove.forEach(el => el.remove());

  // Clean shadow, borders, and margins for clean print output
  cloned.classList.remove('shadow-2xl', 'shadow-xl', 'shadow-lg', 'shadow-md');
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
  document.body.classList.add('is-printing-active');

  // Trigger print after rendering frame
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

  // Cleanup after print dialog closes
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
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
    window.removeEventListener('afterprint', cleanup);
  };

  window.addEventListener('afterprint', cleanup);
  // Failsafe timeout in case afterprint does not fire in all browsers
  setTimeout(cleanup, 4000);
}
