/**
 * Synthesizes audible alert tones using browser native Web Audio API.
 * Does not depend on external MP3 audio files or CDNs.
 */

class SoundAlertService {
  private audioCtx: AudioContext | null = null;
  private isMuted: boolean = false;
  private listeners: Set<(muted: boolean) => void> = new Set();

  constructor() {
    if (typeof window !== 'undefined') {
      this.isMuted = localStorage.getItem('hotel_sound_alerts_muted') === 'true';

      const unlockAudio = () => {
        if (this.audioCtx && this.audioCtx.state === 'suspended') {
          this.audioCtx.resume().catch(() => {});
        }
      };

      window.addEventListener('click', unlockAudio, { passive: true });
      window.addEventListener('keydown', unlockAudio, { passive: true });
      window.addEventListener('touchstart', unlockAudio, { passive: true });
    }
  }

  private getAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    try {
      if (!this.audioCtx) {
        const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtxClass) {
          this.audioCtx = new AudioCtxClass();
        }
      }
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }
      return this.audioCtx;
    } catch (e) {
      console.warn('Web Audio initialization error:', e);
      return null;
    }
  }

  public getIsMuted(): boolean {
    return this.isMuted;
  }

  public toggleMute(): boolean {
    return this.setMuted(!this.isMuted);
  }

  public setMuted(muted: boolean): boolean {
    this.isMuted = muted;
    if (typeof window !== 'undefined') {
      localStorage.setItem('hotel_sound_alerts_muted', muted ? 'true' : 'false');
    }
    this.listeners.forEach(cb => cb(this.isMuted));
    return this.isMuted;
  }

  public subscribe(cb: (muted: boolean) => void) {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  /**
   * Overdue Stay notification sound:
   * Urgent repeating dual-tone chime (A5 880Hz -> E5 659Hz)
   * Beeps periodically until guest is checked out, postponed, or given grace period.
   */
  public playOverdueStayBeep() {
    if (this.isMuted) return;
    try {
      const ctx = this.getAudioContext();
      if (!ctx || ctx.state !== 'running') return;

      const now = ctx.currentTime;

      // First Tone: High warning pulse (880Hz)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(880, now);
      osc1.frequency.exponentialRampToValueAtTime(800, now + 0.18);
      gain1.gain.setValueAtTime(0.25, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.22);

      // Second Tone: Descending urgency (659Hz)
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(659.25, now + 0.22);
      gain2.gain.setValueAtTime(0.28, now + 0.22);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.48);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.22);
      osc2.stop(now + 0.48);

      // Third Tone: Re-alert tap (880Hz)
      const osc3 = ctx.createOscillator();
      const gain3 = ctx.createGain();
      osc3.type = 'sine';
      osc3.frequency.setValueAtTime(880, now + 0.52);
      gain3.gain.setValueAtTime(0.22, now + 0.52);
      gain3.gain.exponentialRampToValueAtTime(0.001, now + 0.72);
      osc3.connect(gain3);
      gain3.connect(ctx.destination);
      osc3.start(now + 0.52);
      osc3.stop(now + 0.72);
    } catch (e) {
      console.warn('Could not play overdue stay alert sound:', e);
    }
  }

  /**
   * Pending Settlement notification sound:
   * Distinct attention chime (C5 523Hz -> G5 784Hz)
   * Beeps until outstanding order balances or ledger debts are settled.
   */
  public playPendingSettlementBeep() {
    if (this.isMuted) return;
    try {
      const ctx = this.getAudioContext();
      if (!ctx || ctx.state !== 'running') return;

      const now = ctx.currentTime;

      // Tone 1
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'triangle';
      osc1.frequency.setValueAtTime(523.25, now);
      gain1.gain.setValueAtTime(0.22, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.25);

      // Tone 2
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(783.99, now + 0.2);
      gain2.gain.setValueAtTime(0.26, now + 0.2);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.2);
      osc2.stop(now + 0.5);
    } catch (e) {
      console.warn('Could not play pending settlement alert sound:', e);
    }
  }
}

export const soundAlerts = new SoundAlertService();
