import React from 'react';
import { motion } from 'motion/react';
import { Building2 } from 'lucide-react';

export function LandingLoadingScreen() {
  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center relative overflow-hidden select-none">
      {/* Subtle ambient background glow */}
      <div 
        className="pointer-events-none absolute w-[500px] h-[500px] rounded-full bg-emerald-500/10 blur-[120px] -top-24 -left-24" 
        aria-hidden="true" 
      />
      <div 
        className="pointer-events-none absolute w-[500px] h-[500px] rounded-full bg-emerald-500/5 blur-[140px] -bottom-24 -right-24" 
        aria-hidden="true" 
      />

      {/* Main branding container */}
      <motion.div 
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="relative z-10 flex flex-col items-center text-center px-4"
      >
        {/* Glowing Icon with subtle pulse rings */}
        <div className="relative mb-5 flex items-center justify-center">
          <motion.div 
            animate={{ 
              scale: [1, 1.25, 1],
              opacity: [0.35, 0.05, 0.35]
            }}
            transition={{ 
              duration: 2.4, 
              repeat: Infinity, 
              ease: "easeInOut" 
            }}
            className="absolute -inset-3 rounded-3xl bg-emerald-500/20 blur-md pointer-events-none"
          />

          <motion.div 
            animate={{ 
              scale: [1, 1.05, 1] 
            }}
            transition={{ 
              duration: 2.4, 
              repeat: Infinity, 
              ease: "easeInOut" 
            }}
            className="relative w-16 h-16 rounded-2xl bg-gradient-to-tr from-emerald-600 via-emerald-500 to-emerald-400 p-[1px] shadow-2xl shadow-emerald-500/20"
          >
            <div className="w-full h-full bg-zinc-950/80 backdrop-blur-sm rounded-[15px] flex items-center justify-center text-emerald-400">
              <Building2 size={32} strokeWidth={2.2} />
            </div>
          </motion.div>
        </div>

        {/* Brand Name & Tagline */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.4 }}
          className="space-y-1.5"
        >
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Tyyl Tech <span className="text-emerald-400">PMS</span>
          </h1>
          <p className="text-xs uppercase tracking-[0.25em] text-zinc-400 font-medium">
            Property Management System
          </p>
        </motion.div>

        {/* Sleek smooth loader bar */}
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.25, duration: 0.4 }}
          className="w-48 h-1 bg-zinc-900 border border-zinc-800/80 rounded-full overflow-hidden mt-8 relative"
        >
          <motion.div 
            animate={{ 
              x: ['-100%', '200%']
            }}
            transition={{ 
              duration: 1.5, 
              repeat: Infinity, 
              ease: "easeInOut" 
            }}
            className="w-1/2 h-full bg-gradient-to-r from-transparent via-emerald-400 to-transparent rounded-full shadow-[0_0_12px_rgba(52,211,153,0.8)]"
          />
        </motion.div>
      </motion.div>
    </div>
  );
}
