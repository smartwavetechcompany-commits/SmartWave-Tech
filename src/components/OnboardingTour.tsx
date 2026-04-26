import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../contexts/AuthContext';
import { doc, updateDoc } from 'firebase/firestore';
import { db, safeWrite, serverTimestamp } from '../firebase';
import { 
  X, 
  ChevronRight, 
  ChevronLeft, 
  Sparkles,
  LayoutDashboard,
  CalendarDays,
  Bed,
  Settings as SettingsIcon,
  CheckCircle2
} from 'lucide-react';
import { cn, safeStringify } from '../utils';

interface Step {
  title: string;
  description: string;
  icon: React.ReactNode;
  target?: string; // CSS selector for highlighting (optional for now)
}

const steps: Step[] = [
  {
    title: "Welcome to SmartWave PMS",
    description: "Your all-in-one solution for modern hotel management. Let's take a quick tour of the main features.",
    icon: <Sparkles className="text-emerald-500" size={32} />
  },
  {
    title: "The Dashboard",
    description: "Get a bird's-eye view of your hotel's performance, occupancy rates, and daily operations at a glance.",
    icon: <LayoutDashboard className="text-blue-500" size={32} />
  },
  {
    title: "Front Desk",
    description: "This is where the magic happens. Manage bookings, check-ins, check-outs, and guest folios with ease.",
    icon: <CalendarDays className="text-purple-500" size={32} />
  },
  {
    title: "Room Management",
    description: "Configure your room types, set prices, and monitor housekeeping status in real-time.",
    icon: <Bed className="text-amber-500" size={32} />
  },
  {
    title: "System Settings",
    description: "Customize your hotel branding, configure taxes, and manage your subscription settings.",
    icon: <SettingsIcon className="text-zinc-500" size={32} />
  },
  {
    title: "You're All Set!",
    description: "You're ready to start managing your hotel like a pro. Need help? Click the Support link in the sidebar.",
    icon: <CheckCircle2 className="text-emerald-500" size={32} />
  }
];

export function OnboardingTour() {
  const { profile } = useAuth();
  const [currentStep, setCurrentStep] = useState(0);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (profile && !profile.hasCompletedOnboarding) {
      // Delay slightly to ensure layout is ready
      const timer = setTimeout(() => setIsVisible(true), 1500);
      return () => clearTimeout(timer);
    }
  }, [profile]);

  const handleComplete = async () => {
    if (!profile?.uid) return;
    try {
      await safeWrite(doc(db, 'users', profile.uid), {
        hasCompletedOnboarding: true,
        updatedAt: serverTimestamp()
      }, profile.hotelId || 'system', 'COMPLETE_ONBOARDING');
      setIsVisible(false);
    } catch (err: any) {
      console.error("Failed to complete onboarding:", err.message || safeStringify(err));
      setIsVisible(false);
    }
  };

  const nextStep = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(prev => prev + 1);
    } else {
      handleComplete();
    }
  };

  const prevStep = () => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
    }
  };

  if (!isVisible) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl"
        >
          {/* Header */}
          <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center text-black font-black text-xs">
                SW
              </div>
              <span className="text-sm font-bold text-white tracking-tight">SmartWave Onboarding</span>
            </div>
            <button 
              onClick={handleComplete}
              className="p-2 text-zinc-500 hover:text-white transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          {/* Content */}
          <div className="p-10 text-center space-y-6">
            <motion.div 
              key={currentStep}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="flex flex-col items-center space-y-6"
            >
              <div className="w-20 h-20 bg-zinc-800 rounded-2xl flex items-center justify-center shadow-inner">
                {steps[currentStep].icon}
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-black text-white tracking-tight">
                  {steps[currentStep].title}
                </h2>
                <p className="text-zinc-400 leading-relaxed">
                  {steps[currentStep].description}
                </p>
              </div>
            </motion.div>
          </div>

          {/* Footer */}
          <div className="p-6 bg-zinc-950 border-t border-zinc-800 flex items-center justify-between">
            <div className="flex gap-1">
              {steps.map((_, i) => (
                <div 
                  key={i}
                  className={cn(
                    "h-1.5 rounded-full transition-all duration-300",
                    i === currentStep ? "w-8 bg-emerald-500" : "w-2 bg-zinc-800"
                  )}
                />
              ))}
            </div>

            <div className="flex gap-3">
              {currentStep > 0 && (
                <button 
                  onClick={prevStep}
                  className="px-4 py-2 rounded-xl text-sm font-bold text-zinc-400 hover:text-white transition-colors flex items-center gap-1"
                >
                  <ChevronLeft size={18} />
                  Back
                </button>
              )}
              <button 
                onClick={nextStep}
                className="bg-emerald-500 text-black px-6 py-2 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-emerald-400 transition-all active:scale-95"
              >
                {currentStep === steps.length - 1 ? "Get Started" : "Next"}
                {currentStep < steps.length - 1 && <ChevronRight size={18} />}
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
