import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import './i18n';
import './utils/notificationSound';
import App from './App.tsx';
import './index.css';

// Global defensive console sanitizer to prevent circular JSON serialization
// crashes in the iframe console log interceptors of the sandbox environment.
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

function sanitizeArg(arg: any): any {
  if (arg === null || arg === undefined) return arg;
  if (typeof arg !== 'object') return arg;
  
  if (arg instanceof Error) {
    const errObj: any = {
      message: arg.message,
      name: arg.name,
      stack: arg.stack
    };
    if ('code' in arg) errObj.code = (arg as any).code;
    return errObj;
  }
  
  try {
    const seen = new WeakSet();
    const clean = (val: any): any => {
      if (val === null || typeof val !== 'object') return val;
      if (seen.has(val)) return '[Circular]';
      seen.add(val);
      
      if (val.constructor && (
        val.constructor.name === 'FieldValue' || 
        val.constructor.name === 'rt' || 
        val.constructor.name === 'Y2' || 
        val.constructor.name === 'Ka' ||
        val.constructor.name === 'Firestore' ||
        val.constructor.name === 'DocumentReference'
      )) {
        return `[Object ${val.constructor.name}]`;
      }
      
      if (Array.isArray(val)) {
        return val.slice(0, 100).map(clean);
      }
      
      const res: any = {};
      const keys = Object.keys(val).slice(0, 100);
      for (const k of keys) {
        if (k.startsWith('_') || k.startsWith('$')) continue;
        try {
          const propertyVal = val[k];
          if (typeof propertyVal === 'function') continue;
          res[k] = clean(propertyVal);
        } catch (e) {
          res[k] = '[Access Error]';
        }
      }
      return res;
    };
    return clean(arg);
  } catch (e) {
    return '[Unserializable]';
  }
}

console.error = function (...args: any[]) {
  const first = typeof args[0] === 'string' ? args[0] : '';
  if (first.includes('[vite] failed to connect to websocket')) {
    return;
  }
  const safeArgs = args.map(sanitizeArg);
  originalConsoleError.apply(console, safeArgs);
};

console.warn = function (...args: any[]) {
  const safeArgs = args.map(sanitizeArg);
  originalConsoleWarn.apply(console, safeArgs);
};

// Smart horizontal scroll wheel support for non-touch & desktop mouse users
if (typeof window !== 'undefined') {
  window.addEventListener('wheel', (e: WheelEvent) => {
    // If native horizontal scroll is already occurring or delta is zero, do nothing
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.deltaY === 0) return;

    let target = e.target as HTMLElement | null;
    while (target && target !== document.body && target !== document.documentElement) {
      const style = window.getComputedStyle(target);
      const isHorizontalScroll = (style.overflowX === 'auto' || style.overflowX === 'scroll');
      const isVerticalScroll = (style.overflowY === 'auto' || style.overflowY === 'scroll');

      const canScrollHorizontally = target.scrollWidth > target.clientWidth + 2;
      const canScrollVertically = target.scrollHeight > target.clientHeight + 2;

      // If this element is a dedicated horizontal scrolling container (like tab bar, chip row, or table)
      // and cannot scroll vertically, translate vertical wheel turn to horizontal scroll
      if (isHorizontalScroll && canScrollHorizontally && (!isVerticalScroll || !canScrollVertically)) {
        const atStart = target.scrollLeft <= 0 && e.deltaY < 0;
        const atEnd = target.scrollLeft + target.clientWidth >= target.scrollWidth - 1 && e.deltaY > 0;
        if (!atStart && !atEnd) {
          target.scrollLeft += e.deltaY;
          e.preventDefault();
          return;
        }
      }
      target = target.parentElement;
    }
  }, { passive: false });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

