import React, { useEffect, useState } from 'react';
import { Reservation, Hotel } from '../types';
import { generateRoomKeyToken, checkKeyStatus, RoomKeyData } from '../utils/qrCrypto';
import QRCode from 'qrcode';
import { 
  X, 
  Key, 
  Smartphone, 
  ShieldCheck, 
  Calendar, 
  RefreshCw, 
  Download, 
  Printer, 
  Wifi, 
  Clock,
  Lock,
  Compass
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

interface DigitalKeyModalProps {
  reservation: Reservation;
  hotel: Hotel | null;
  onClose: () => void;
}

export function DigitalKeyModal({ reservation, hotel, onClose }: DigitalKeyModalProps) {
  const [keyData, setKeyData] = useState<RoomKeyData | null>(null);
  const [qrSrc, setQrSrc] = useState<string>('');
  const [status, setStatus] = useState<'active' | 'expired' | 'pending'>('active');
  const [isLoading, setIsLoading] = useState(true);

  const generateKey = async () => {
    if (!hotel || !reservation) return;
    setIsLoading(true);
    try {
      const kd = generateRoomKeyToken(
        hotel.id,
        reservation.id,
        reservation.guestId || 'GUEST-TRANS',
        reservation.guestName,
        reservation.roomNumber,
        reservation.checkIn,
        reservation.checkOut
      );
      setKeyData(kd);

      // Generate base64 QR Code string
      const qrDataUrl = await QRCode.toDataURL(kd.rawPayload, {
        width: 256,
        margin: 1.5,
        color: {
          dark: '#09090b', // zinc-950
          light: '#ffffff' // white
        }
      });
      setQrSrc(qrDataUrl);

      // Verify status
      const keyStat = checkKeyStatus(kd.validFrom, kd.validUntil);
      setStatus(keyStat);
    } catch (err: any) {
      console.error(err);
      toast.error('Could not generate encrypted access key');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    generateKey();
  }, [reservation.id, hotel?.id]);

  const handleDownload = () => {
    if (!qrSrc) return;
    const link = document.createElement('a');
    link.href = qrSrc;
    link.download = `digital-key-rm${reservation.roomNumber}-${reservation.guestName.toLowerCase().replace(/\s+/g, '-')}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('Digital Access Key QR Code downloaded successfully!');
  };

  const statusLabel = {
    active: { text: 'Key Operational (Active)', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
    pending: { text: 'Upcoming Stay (Not Active Yet)', color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
    expired: { text: 'Stay Expired (Access Voided)', color: 'text-red-400 bg-red-500/10 border-red-500/20' }
  }[status];

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-[100] flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-sm overflow-hidden flex flex-col relative max-h-[90vh]">
        {/* Close Button */}
        <button 
          onClick={onClose}
          type="button"
          className="absolute top-4 right-4 p-2 text-zinc-500 hover:text-zinc-50 hover:bg-zinc-800 rounded-full transition-all cursor-pointer z-10"
        >
          <X size={18} />
        </button>

        <div className="p-6 pb-2 border-b border-zinc-850">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-xl">
              <Key size={16} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-zinc-50">Room SmartKey Vault</h3>
              <p className="text-[10px] text-zinc-500">Encrypted wireless electronic key</p>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 flex flex-col items-center justify-center space-y-5 text-center">
          {isLoading ? (
            <div className="py-24 space-y-3">
              <RefreshCw className="animate-spin text-emerald-500 mx-auto" size={28} />
              <p className="text-xs text-zinc-500 uppercase tracking-widest font-bold">Encrypting key blocks...</p>
            </div>
          ) : keyData && (
            <>
              {/* Smartphone mock layout representing mobile wallet card */}
              <div className="relative w-64 bg-zinc-950 border border-zinc-801 rounded-2xl p-5 shadow-2xl overflow-hidden self-center flex flex-col justify-between pt-6 ring-1 ring-zinc-850">
                {/* Visual Accent Gradient Wave */}
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 via-teal-500 to-indigo-500" />
                
                <div className="flex justify-between items-start mb-3">
                  <div className="text-left">
                    <span className="text-[7px] font-black uppercase text-zinc-500 tracking-wider">Hotel Room Key</span>
                    <h4 className="text-[11px] font-bold text-zinc-100 max-w-[150px] truncate leading-tight mt-0.5">
                      {hotel?.name || 'Local Hotel'}
                    </h4>
                  </div>
                  <div className="flex items-center gap-1 bg-zinc-900/80 px-1.5 py-0.5 rounded border border-zinc-800 text-[8px] text-zinc-400 font-bold uppercase tracking-wide">
                    <Wifi size={9} className="text-emerald-400 animate-pulse" />
                    BLE enabled
                  </div>
                </div>

                {/* Big Room Key Display */}
                <div className="bg-zinc-900/60 rounded-xl py-3 border border-zinc-900 mx-auto w-full my-2 relative">
                  <span className="text-[8px] font-bold text-zinc-500 uppercase tracking-widest block">Authorized Cabin</span>
                  <div className="text-2xl font-black text-zinc-50 tracking-tight flex items-center justify-center gap-2 mt-0.5">
                    <Lock size={18} className="text-emerald-500 mb-0.5" />
                    RE-S1. {keyData.roomNumber}
                  </div>
                  <span className="text-[8px] italic text-emerald-400/80 block mt-0.5">Touch smartphone to guest door lock handle</span>
                </div>

                {/* Encrypted QR code box */}
                <div className="my-3 bg-white p-3 rounded-xl inline-block mx-auto relative group shadow-lg">
                  <img 
                    src={qrSrc} 
                    alt="Encrypted Access QR Key" 
                    className="w-40 h-40 select-none pointer-events-none"
                    referrerPolicy="no-referrer"
                  />
                  {status === 'expired' && (
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-xs flex flex-col items-center justify-center text-red-400 border border-red-500/30 rounded-xl font-bold uppercase text-[9px]">
                      Expired Pass
                    </div>
                  )}
                </div>

                {/* Time Validity & Holder Detail */}
                <div className="text-left border-t border-zinc-900 pt-3 mt-1 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-[7px] font-black uppercase text-zinc-500">Key Holder</span>
                      <p className="text-[10px] font-bold text-zinc-350 truncate max-w-[120px]">{keyData.guestName}</p>
                    </div>
                    <div className="text-right">
                      <span className="text-[7px] font-black uppercase text-zinc-500">Status</span>
                      <p className="text-[9px] font-extrabold text-emerald-400 uppercase tracking-wider block">
                        {status}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-1 bg-zinc-900/40 p-1.5 rounded border border-zinc-900/30 text-[8px] text-zinc-450">
                    <div className="flex items-center gap-1.5 justify-between">
                      <div className="flex items-center gap-1">
                        <Calendar size={10} className="text-zinc-500" />
                        <span>Valid From:</span>
                      </div>
                      <span className="font-bold text-zinc-300">
                        {format(new Date(keyData.validFrom), 'MMM d, h:mm a')}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 justify-between">
                      <div className="flex items-center gap-1">
                        <Clock size={10} className="text-zinc-505" />
                        <span>Valid Until:</span>
                      </div>
                      <span className="font-bold text-zinc-300">
                        {format(new Date(keyData.validUntil), 'MMM d, h:mm a')}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mt-2.5 pt-2 border-t border-zinc-900 text-[6.5px] font-mono text-zinc-650 truncate uppercase tracking-widest text-center flex items-center justify-center gap-1">
                  <ShieldCheck size={9} className="text-zinc-600" />
                  SIGN: {keyData.signature} &bull; TYYL SECURE CORE
                </div>
              </div>

              {/* Status Warning Box */}
              {statusLabel && (
                <div className={`px-4 py-2 text-xs rounded-xl border font-bold text-center w-full max-w-[280px] ${statusLabel.color}`}>
                  {statusLabel.text}
                </div>
              )}
            </>
          )}
        </div>

        {/* Sync panel / Print buttons */}
        <div className="p-5 bg-zinc-950/70 border-t border-zinc-850 grid grid-cols-2 gap-2">
          <button
            onClick={generateKey}
            type="button"
            className="py-2.5 bg-zinc-900 hover:bg-zinc-850 text-[10px] font-black uppercase text-zinc-300 border border-zinc-800 rounded-xl transition-all flex items-center justify-center gap-1.5 active:scale-95 cursor-pointer"
          >
            <RefreshCw size={12} className="text-zinc-505" />
            Refresh Sign
          </button>
          <button
            onClick={handleDownload}
            type="button"
            className="py-2.5 bg-emerald-600 hover:bg-emerald-500 text-[10px] font-black uppercase text-white rounded-xl transition-all flex items-center justify-center gap-1.5 active:scale-95 cursor-pointer"
          >
            <Download size={12} />
            Download
          </button>
        </div>
      </div>
    </div>
  );
}
