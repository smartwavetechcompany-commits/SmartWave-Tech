/**
 * Audio Alert Service using native Web Audio API
 * Generates alert chimes/beeps without external audio file dependencies.
 * Respects browser autoplay restrictions by unlocking AudioContext on user interaction.
 */

class SoundAlertManager {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = false;
  private intervalId: any = null;
  private listeners: Set<(isMuted: boolean) => void> = new Set();

  constructor() {
    // Check localStorage for user mute preference
    if (typeof window !== 'undefined') {
      const savedMute = localStorage.getItem('system_alerts_muted');
      if (savedMute === 'true') {
        this.isMuted = true;
      }
    }
  }

  private initContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public unlockAudio() {
    this.initContext();
  }

  public getIsMuted(): boolean {
    return this.isMuted;
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
    if (typeof window !== 'undefined') {
      localStorage.setItem('system_alerts_muted', muted ? 'true' : 'false');
    }
    this.listeners.forEach(cb => cb(this.isMuted));
  }

  public subscribe(cb: (isMuted: boolean) => void) {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  /**
   * Play an audible beep/chime sequence
   * @param type 'overdue' (urgent high chime) | 'settlement' (warm chime)
   */
  public playAlertBeep(type: 'overdue' | 'settlement' = 'overdue') {
    if (this.isMuted) return;

    try {
      const ctx = this.initContext();
      if (!ctx || ctx.state !== 'running') return;

      const now = ctx.currentTime;
      const isUrgent = type === 'overdue';

      // First Tone
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(isUrgent ? 880 : 659.25, now); // A5 or E5

      gain1.gain.setValueAtTime(0, now);
      gain1.gain.linearRampToValueAtTime(0.18, now + 0.03);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.23);

      // Second Tone (Higher Pitch)
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(isUrgent ? 1046.5 : 880, now + 0.14); // C6 or A5

      gain2.gain.setValueAtTime(0, now + 0.14);
      gain2.gain.linearRampToValueAtTime(0.18, now + 0.17);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.14);
      osc2.stop(now + 0.46);

      // If urgent overstay, add a third accent pulse
      if (isUrgent) {
        const osc3 = ctx.createOscillator();
        const gain3 = ctx.createGain();
        osc3.type = 'sine';
        osc3.frequency.setValueAtTime(1174.66, now + 0.32); // D6

        gain3.gain.setValueAtTime(0, now + 0.32);
        gain3.gain.linearRampToValueAtTime(0.15, now + 0.35);
        gain3.gain.exponentialRampToValueAtTime(0.001, now + 0.65);

        osc3.connect(gain3);
        gain3.connect(ctx.destination);
        osc3.start(now + 0.32);
        osc3.stop(now + 0.66);
      }
    } catch {
      // Audio playback fails gracefully if browser tab is inactive or not yet interacted with
    }
  }
}

export const soundAlertManager = new SoundAlertManager();
