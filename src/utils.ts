import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Performs a deep clone that is safe from circular references.
 * Useful for preparing data for Firestore or other serialization-heavy operations.
 */
export function deepCloneSafe(obj: any): any {
  if (obj === undefined) return undefined;
  if (obj === null) return null;
  if (typeof obj !== 'object') return obj;

  const stack = new Map();

  function isPlainObject(val: any): boolean {
    if (typeof val !== 'object' || val === null) return false;
    
    // Explicitly reject known non-plain objects, SDK classes, or custom instances
    try {
      if (val.constructor && typeof val.constructor === 'function') {
        const name = val.constructor.name || '';
        // If it has a non-standard constructor name (not Object, not Array, etc.), it is not a plain object
        if (name && name !== 'Object' && name !== 'Array' && name !== 'Date' && name !== 'Error' && name !== 'RegExp') {
          return false;
        }
      }
    } catch (e) {}

    const proto = Object.getPrototypeOf(val);
    if (proto === null) return true;
    
    if (proto !== Object.prototype) return false;
    
    const ctor = val.constructor;
    if (typeof ctor === 'undefined') return true;
    
    return ctor === Object;
  }

  function getSafeValue(val: any, depth: number = 0): any {
    if (depth > 12) return '[Max Depth Reached]';
    
    if (val === null || typeof val !== 'object') {
      return val;
    }

    // Handle Dates
    if (val instanceof Date) {
      return val.toISOString();
    }

    // Handle Firestore Timestamps
    try {
      if (typeof val.toDate === 'function' && 'seconds' in val && 'nanoseconds' in val) {
        return val.toDate().toISOString();
      }
    } catch (e) {}

    // Check circular references
    if (stack.has(val)) {
      return '[Circular Reference]';
    }

    // Add to stack before recursion
    try {
      stack.set(val, true);
    } catch (e) {
      return '[Unserializable]';
    }

    try {
      const isArray = Array.isArray(val);
      
      // If NOT a plain object and NOT an array, treat as a special object
      // and stop traversing to prevent circular structures and getter errors
      if (!isArray && !isPlainObject(val)) {
        let constructorName = '';
        try {
          if (val.constructor && typeof val.constructor === 'function') {
            constructorName = val.constructor.name || '';
          }
        } catch (e) {}

        if (constructorName === 'FieldValue' || constructorName === 'rt' || constructorName === 'Y2' || constructorName === 'Ka') {
          return '[Firestore FieldValue]';
        }

        // Check if it's a Firestore Document/Collection/Query Reference
        try {
          if ('path' in val && typeof (val as any).path === 'string') {
            return `[Firestore Reference: ${val.path}]`;
          }
        } catch (e) {}

        return constructorName ? `[Object ${constructorName}]` : '[Special Object]';
      }

      // Handle Errors
      if (val instanceof Error || (val.message && val.stack)) {
        return {
          name: val.name || 'Error',
          message: val.message,
          code: (val as any).code,
          stack: val.stack
        };
      }

      let result: any;

      if (isArray) {
        if (val.length > 500) {
          result = val.slice(0, 500).map(item => getSafeValue(item, depth + 1)).concat([`... and ${val.length - 500} more items`]);
        } else {
          result = val.map(item => getSafeValue(item, depth + 1));
        }
      } else {
        const safeObj: any = {};
        let count = 0;
        const MAX_KEYS = 200;
        const keys = Object.keys(val);
        
        for (const key of keys) {
          if (count++ > MAX_KEYS) {
            safeObj['...'] = `Truncated (${keys.length} total keys)`;
            break;
          }
          
          if (key.startsWith('_') || key.startsWith('$')) continue;
          
          try {
            const value = val[key];
            if (typeof value === 'function') continue;
            safeObj[key] = getSafeValue(value, depth + 1);
          } catch (e) {
            safeObj[key] = '[Property Access Error]';
          }
        }
        result = safeObj;
      }

      return result;
    } finally {
      stack.delete(val);
    }
  }

  return getSafeValue(obj);
}

export function safeStringify(obj: any): string {
  if (obj === undefined) return 'undefined';
  if (obj === null) return 'null';
  if (typeof obj !== 'object') return String(obj);

  try {
    const safeTarget = deepCloneSafe(obj);
    const seen = new WeakSet();
    return JSON.stringify(safeTarget, (key, value) => {
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          return '[Circular Reference]';
        }
        seen.add(value);
      }
      return value;
    }, 2);
  } catch (e) {
    try {
      // Final desperation fallback: serialize top level properties as strings
      const fallback: any = {};
      const keys = Object.keys(obj).slice(0, 50);
      for (const key of keys) {
        try {
          const val = obj[key];
          if (typeof val === 'function') continue;
          if (typeof val === 'object' && val !== null) {
            fallback[key] = '[Object]';
          } else {
            fallback[key] = String(val).slice(0, 100);
          }
        } catch (inner) {
          fallback[key] = '[Error]';
        }
      }
      return JSON.stringify(fallback, null, 2);
    } catch (finalError) {
      return `[Circular or Unstringifiable Object: ${e instanceof Error ? e.message : 'Unknown'}]`;
    }
  }
}

export function formatCurrency(amount: number, currency: 'NGN' | 'USD' = 'NGN', exchangeRate: number = 1500) {
  const value = currency === 'USD' ? amount / exchangeRate : amount;
  
  if (currency === 'NGN') {
    return '₦' + new Intl.NumberFormat('en-NG', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export function convertCurrency(amount: number, to: 'NGN' | 'USD', exchangeRate: number) {
  if (to === 'USD') return amount / exchangeRate;
  return amount;
}

export function exportToCSV(data: any[], filename: string) {
  if (data.length === 0) return;
  
  const headers = Object.keys(data[0]).join(',');
  const rows = data.map(obj => {
    return Object.values(obj).map(val => {
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    }).join(',');
  });
  
  const csvContent = [headers, ...rows].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  if (link.download !== undefined) {
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.setAttribute('target', '_self');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}
