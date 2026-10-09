import React, { useState, useEffect, useRef } from 'react';
import { ZoomIn, ZoomOut, RotateCcw, Monitor } from 'lucide-react';
import { cn } from '../utils';

const DEFAULT_SCALE = 82;
const MIN_SCALE = 70;
const MAX_SCALE = 100;
const STEP = 4;

const PRESETS = [
  { label: 'Ultra Compact', value: 74 },
  { label: 'Compact (Default)', value: 82 },
  { label: 'Medium', value: 90 },
  { label: 'Standard', value: 100 },
];

export function UIScaleControl() {
  const [scale, setScale] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('pms_ui_scale');
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= MIN_SCALE && parsed <= MAX_SCALE) {
          return parsed;
        }
      }
    } catch {
      // fallback
    }
    return DEFAULT_SCALE;
  });

  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Apply scale to document root
  const applyScale = (newScale: number) => {
    const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, newScale));
    setScale(clamped);
    try {
      localStorage.setItem('pms_ui_scale', clamped.toString());
      document.documentElement.style.fontSize = `${clamped}%`;
    } catch (e) {
      console.error('Failed to save UI scale:', e);
    }
  };

  useEffect(() => {
    // Initial mount apply
    document.documentElement.style.fontSize = `${scale}%`;
  }, [scale]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleZoomIn = () => {
    applyScale(Math.min(MAX_SCALE, scale + STEP));
  };

  const handleZoomOut = () => {
    applyScale(Math.max(MIN_SCALE, scale - STEP));
  };

  const handleReset = () => {
    applyScale(DEFAULT_SCALE);
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={menuRef}>
      <div 
        className="flex items-center bg-zinc-900 border border-zinc-800 rounded-lg p-0.5 text-zinc-400 select-none shadow-sm"
        title="Interface Zoom & Density Scale"
      >
        <button
          type="button"
          onClick={handleZoomOut}
          disabled={scale <= MIN_SCALE}
          className="p-1 hover:text-white hover:bg-zinc-800 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          title="Zoom out interface (Make UI smaller)"
          aria-label="Zoom out interface"
        >
          <ZoomOut size={13} />
        </button>

        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className={cn(
            "px-1.5 py-0.5 text-[10px] font-bold tracking-tight rounded transition-colors flex items-center gap-1",
            scale !== DEFAULT_SCALE ? "text-emerald-400" : "text-zinc-300 hover:text-white"
          )}
          title="Click to select preset UI density scale"
          aria-label="Current UI scale"
        >
          <span>{scale}%</span>
        </button>

        <button
          type="button"
          onClick={handleZoomIn}
          disabled={scale >= MAX_SCALE}
          className="p-1 hover:text-white hover:bg-zinc-800 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          title="Zoom in interface (Make UI larger)"
          aria-label="Zoom in interface"
        >
          <ZoomIn size={13} />
        </button>
      </div>

      {isOpen && (
        <div className="absolute right-0 top-full mt-1.5 w-48 bg-zinc-900 border border-zinc-800 rounded-xl shadow-xl p-2 z-50 animate-in fade-in zoom-in-95 duration-150">
          <div className="px-2 py-1 text-[10px] font-bold text-zinc-500 uppercase tracking-wider flex items-center justify-between border-b border-zinc-800/80 mb-1.5 pb-1.5">
            <span className="flex items-center gap-1.5">
              <Monitor size={11} className="text-zinc-400" />
              Interface Density
            </span>
            {scale !== DEFAULT_SCALE && (
              <button
                type="button"
                onClick={handleReset}
                className="text-zinc-400 hover:text-emerald-400 flex items-center gap-1 font-semibold normal-case text-[10px] transition-colors"
                title="Reset to recommended default scale"
              >
                <RotateCcw size={10} />
                Reset
              </button>
            )}
          </div>

          <div className="space-y-0.5">
            {PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                onClick={() => {
                  applyScale(preset.value);
                  setIsOpen(false);
                }}
                className={cn(
                  "w-full flex items-center justify-between px-2.5 py-1.5 text-xs rounded-lg transition-colors text-left",
                  scale === preset.value
                    ? "bg-emerald-500/10 text-emerald-400 font-bold border border-emerald-500/20"
                    : "text-zinc-300 hover:bg-zinc-800/80 hover:text-white"
                )}
              >
                <span>{preset.label}</span>
                <span className="text-[10px] font-mono text-zinc-500">{preset.value}%</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
