import React from 'react';
import { Loader2 } from 'lucide-react';
import { useRequestManager } from '../contexts/RequestManagerContext';
import { cn } from '../utils';

interface AsyncButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  requestKey: string;
  onClickAsync?: () => Promise<any>;
  loadingMessage?: string;
  showOverlay?: boolean;
  loadingText?: React.ReactNode;
  icon?: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'danger' | 'outline' | 'ghost';
}

export const AsyncButton: React.FC<AsyncButtonProps> = ({
  requestKey,
  onClickAsync,
  onClick,
  loadingMessage,
  showOverlay = false,
  loadingText,
  icon,
  children,
  className,
  disabled,
  variant = 'primary',
  ...props
}) => {
  const { executeRequest, isPending } = useRequestManager();
  const pending = isPending(requestKey);

  const handleClick = async (e: React.MouseEvent<HTMLButtonElement>) => {
    if (pending || disabled) return;

    if (onClick) {
      onClick(e);
    }

    if (onClickAsync) {
      try {
        await executeRequest(requestKey, onClickAsync, {
          loadingMessage,
          showOverlay,
          preventDuplicates: true,
        });
      } catch (err) {
        // Handled or toasted in handler
      }
    }
  };

  const getVariantClasses = () => {
    switch (variant) {
      case 'primary':
        return 'bg-emerald-600 hover:bg-emerald-500 text-white font-bold shadow-lg shadow-emerald-950/20 active:scale-[0.98]';
      case 'secondary':
        return 'bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-semibold border border-zinc-700/60 active:scale-[0.98]';
      case 'danger':
        return 'bg-red-600 hover:bg-red-500 text-white font-bold shadow-lg shadow-red-950/20 active:scale-[0.98]';
      case 'outline':
        return 'border border-zinc-700 hover:bg-zinc-800/60 text-zinc-300 font-medium active:scale-[0.98]';
      case 'ghost':
        return 'hover:bg-zinc-800/50 text-zinc-400 hover:text-zinc-200 font-medium';
      default:
        return 'bg-emerald-600 hover:bg-emerald-500 text-white font-bold';
    }
  };

  return (
    <button
      {...props}
      disabled={disabled || pending}
      onClick={handleClick}
      className={cn(
        'relative inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none select-none',
        getVariantClasses(),
        className
      )}
    >
      {pending ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin shrink-0 text-current" />
          <span>{loadingText || children}</span>
        </>
      ) : (
        <>
          {icon && <span className="shrink-0">{icon}</span>}
          <span>{children}</span>
        </>
      )}
    </button>
  );
};
