/**
 * High-fidelity Web Audio API Notification Sound Engine for Hotel PMS.
 * Synthesizes clear, pleasant, luxury-hotel chimes without external audio files
 * or network latency. Works seamlessly across desktop, tablet, and mobile browsers.
 */

import { toast } from 'sonner';

type SoundType = 'success' | 'error' | 'warning' | 'info';

let audioCtx: AudioContext | null = null;
let lastPlayedAt = 0;
let lastPlayedType: SoundType | '' = '';

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!audioCtx) {
      audioCtx = new AudioContextClass();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  } catch {
    return null;
  }
}

// User-gesture audio unlocker to satisfy browser autoplay policies
if (typeof window !== 'undefined') {
  const unlockAudio = () => {
    try {
      const ctx = getAudioContext();
      if (ctx && ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
    } catch {
      // Ignore
    }
  };

  ['click', 'touchstart', 'pointerdown', 'keydown'].forEach((evt) => {
    window.addEventListener(evt, unlockAudio, { once: true, passive: true });
  });
}

/**
 * Check if sound is enabled (defaults to true)
 */
export function isSoundEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem('pms_notification_sound') !== 'false';
  } catch {
    return true;
  }
}

/**
 * Toggle or set notification sound state
 */
export function setSoundEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem('pms_notification_sound', enabled ? 'true' : 'false');
  } catch {
    // Ignore
  }
}

/**
 * Synthesizes a notification chime using the Web Audio API.
 * Deduplicates bursts to avoid double-triggering within 120ms.
 */
export function playNotificationSound(type: SoundType = 'info'): void {
  if (!isSoundEnabled()) return;

  const now = Date.now();
  if (now - lastPlayedAt < 120 && lastPlayedType === type) {
    return;
  }
  lastPlayedAt = now;
  lastPlayedType = type;

  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const t = ctx.currentTime;
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.18, t);
    masterGain.connect(ctx.destination);

    switch (type) {
      case 'success': {
        // Luxury 3-tone ascending harmonic chime (C5 -> E5 -> G5)
        const notes = [523.25, 659.25, 783.99];
        notes.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          const noteTime = t + idx * 0.07;

          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, noteTime);

          gain.gain.setValueAtTime(0, noteTime);
          gain.gain.linearRampToValueAtTime(0.2, noteTime + 0.015);
          gain.gain.exponentialRampToValueAtTime(0.0001, noteTime + 0.35);

          osc.connect(gain);
          gain.connect(masterGain);

          osc.start(noteTime);
          osc.stop(noteTime + 0.36);
        });
        break;
      }

      case 'error': {
        // Gentle double descending alert tone (370Hz -> 290Hz)
        const notes = [370, 290];
        notes.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          const noteTime = t + idx * 0.1;

          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, noteTime);

          gain.gain.setValueAtTime(0, noteTime);
          gain.gain.linearRampToValueAtTime(0.22, noteTime + 0.015);
          gain.gain.exponentialRampToValueAtTime(0.0001, noteTime + 0.28);

          osc.connect(gain);
          gain.connect(masterGain);

          osc.start(noteTime);
          osc.stop(noteTime + 0.3);
        });
        break;
      }

      case 'warning': {
        // Crisp attention chime (D5 -> G5)
        const notes = [587.33, 783.99];
        notes.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          const noteTime = t + idx * 0.09;

          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, noteTime);

          gain.gain.setValueAtTime(0, noteTime);
          gain.gain.linearRampToValueAtTime(0.2, noteTime + 0.015);
          gain.gain.exponentialRampToValueAtTime(0.0001, noteTime + 0.32);

          osc.connect(gain);
          gain.connect(masterGain);

          osc.start(noteTime);
          osc.stop(noteTime + 0.34);
        });
        break;
      }

      case 'info':
      default: {
        // Crisp luxury water-drop ping (A5 880Hz + soft harmonic)
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, t);
        osc.frequency.exponentialRampToValueAtTime(440, t + 0.25);

        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.18, t + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);

        osc.connect(gain);
        gain.connect(masterGain);

        osc.start(t);
        osc.stop(t + 0.32);
        break;
      }
    }
  } catch {
    // Graceful fallback if Web Audio API is blocked or restricted
  }
}

/**
 * Automatically instrument Sonner's exported `toast` singleton so that any call
 * to toast.success, toast.error, toast.warning, toast.info, toast.message, toast.custom
 * anywhere in the entire system triggers the respective sound effect.
 */
let isInstrumented = false;

export function initializeNotificationSounds(): void {
  if (isInstrumented || typeof window === 'undefined') return;
  isInstrumented = true;

  try {
    // 1. Instrument toast methods
    const originalSuccess = toast.success;
    const originalError = toast.error;
    const originalWarning = toast.warning;
    const originalInfo = toast.info;
    const originalMessage = toast.message;
    const originalCustom = toast.custom;

    if (typeof originalSuccess === 'function') {
      toast.success = ((...args: Parameters<typeof originalSuccess>) => {
        playNotificationSound('success');
        return originalSuccess(...args);
      }) as typeof originalSuccess;
    }

    if (typeof originalError === 'function') {
      toast.error = ((...args: Parameters<typeof originalError>) => {
        playNotificationSound('error');
        return originalError(...args);
      }) as typeof originalError;
    }

    if (typeof originalWarning === 'function') {
      toast.warning = ((...args: Parameters<typeof originalWarning>) => {
        playNotificationSound('warning');
        return originalWarning(...args);
      }) as typeof originalWarning;
    }

    if (typeof originalInfo === 'function') {
      toast.info = ((...args: Parameters<typeof originalInfo>) => {
        playNotificationSound('info');
        return originalInfo(...args);
      }) as typeof originalInfo;
    }

    if (typeof originalMessage === 'function') {
      toast.message = ((...args: Parameters<typeof originalMessage>) => {
        playNotificationSound('info');
        return originalMessage(...args);
      }) as typeof originalMessage;
    }

    if (typeof originalCustom === 'function') {
      toast.custom = ((...args: Parameters<typeof originalCustom>) => {
        playNotificationSound('info');
        return originalCustom(...args);
      }) as typeof originalCustom;
    }

    // 2. DOM MutationObserver: Catch any toast elements that are mounted directly
    // or via any other code path (e.g. promise toasts, basic toast() calls, etc.)
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (let i = 0; i < mutation.addedNodes.length; i++) {
          const node = mutation.addedNodes[i];
          if (!(node instanceof HTMLElement)) continue;

          // Check if this node is a sonner toast or contains one
          const toastEl = node.hasAttribute('data-sonner-toast')
            ? node
            : node.querySelector?.('[data-sonner-toast]');

          if (toastEl && toastEl instanceof HTMLElement) {
            if (toastEl.dataset.soundTriggered === 'true') continue;
            toastEl.dataset.soundTriggered = 'true';

            const typeAttr = toastEl.getAttribute('data-type');
            if (typeAttr === 'error') {
              playNotificationSound('error');
            } else if (typeAttr === 'warning') {
              playNotificationSound('warning');
            } else if (typeAttr === 'success') {
              playNotificationSound('success');
            } else {
              playNotificationSound('info');
            }
          }
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  } catch {
    // Defensive wrapper
  }
}

// Auto-initialize immediately on module load in browser
if (typeof window !== 'undefined') {
  initializeNotificationSounds();
}
