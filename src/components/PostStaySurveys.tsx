import React, { useState, useEffect } from 'react';
import { collection, query, getDocs, addDoc, updateDoc, doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Reservation, Hotel, Guest } from '../types';
import { 
  Star, 
  Send, 
  CheckCircle, 
  Clock, 
  ExternalLink, 
  MessageSquare, 
  Award, 
  Sparkles, 
  User, 
  Clipboard, 
  Smile, 
  Check,
  AlertTriangle,
  Flame,
  ThumbsUp,
  Mail
} from 'lucide-react';
import { format, differenceInDays, parseISO, addHours } from 'date-fns';
import { formatCurrency } from '../utils';
import { toast } from 'sonner';

export interface SurveyFeedback {
  id?: string;
  reservationId: string;
  guestId: string;
  guestName: string;
  guestEmail: string;
  roomNumber: string;
  checkoutDate: string;
  status: 'scheduled' | 'sent' | 'completed';
  scheduledSendTime: string; // 24 hours after checkout
  completedAt?: string;
  overallRating?: number;
  cleanlinessRating?: number;
  serviceRating?: number;
  comfortRating?: number;
  valueRating?: number;
  comments?: string;
  managerResponse?: string;
}

interface PostStaySurveysProps {
  hotelId: string;
  currency: string;
  exchangeRate: number;
}

export function PostStaySurveys({ hotelId, currency, exchangeRate }: PostStaySurveysProps) {
  const { hotel, profile } = useAuth();
  const [surveys, setSurveys] = useState<SurveyFeedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSurvey, setSelectedSurvey] = useState<SurveyFeedback | null>(null);
  const [simulationSurvey, setSimulationSurvey] = useState<SurveyFeedback | null>(null);
  const [managerResponseText, setManagerResponseText] = useState('');
  const [submittingResponse, setSubmittingResponse] = useState(false);

  // Load existing surveys
  useEffect(() => {
    if (!hotelId) return;
    
    const q = collection(db, 'hotels', hotelId, 'surveys');
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as SurveyFeedback));
      // Sort: Completed on top, then scheduled time
      items.sort((a,b) => {
        if (a.status === 'completed' && b.status !== 'completed') return -1;
        if (a.status !== 'completed' && b.status === 'completed') return 1;
        return new Date(b.checkoutDate).getTime() - new Date(a.checkoutDate).getTime();
      });
      setSurveys(items);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [hotelId]);

  // Handle saving manager response
  const handleSaveResponse = async (survey: SurveyFeedback) => {
    if (!survey.id || !managerResponseText.trim()) return;
    setSubmittingResponse(true);
    try {
      const docRef = doc(db, 'hotels', hotelId, 'surveys', survey.id);
      await updateDoc(docRef, {
        managerResponse: managerResponseText
      });
      toast.success('Response posted successfully');
      setManagerResponseText('');
      setSelectedSurvey(null);
    } catch (err: any) {
      toast.error('Failed to post response: ' + (err.message || err));
    } finally {
      setSubmittingResponse(false);
    }
  };

  // Simulate sending survey immediately
  const handleSimulateSend = async (survey: SurveyFeedback) => {
    if (!survey.id) return;
    try {
      const docRef = doc(db, 'hotels', hotelId, 'surveys', survey.id);
      await updateDoc(docRef, {
        status: 'sent',
        scheduledSendTime: new Date().toISOString() // Marked sent now
      });
      toast.success(`Survey invitation email simulated for ${survey.guestName}`);
    } catch (err: any) {
      toast.error('Simulation error: ' + err.message);
    }
  };

  // Trigger test survey seed (in case zero exist)
  const handleSeedDemoySurveys = async () => {
    try {
      // Find checkout reservations
      const resQuery = collection(db, 'hotels', hotelId, 'reservations');
      const resSnap = await getDocs(resQuery);
      const checkouts = resSnap.docs
        .map(d => ({ id: d.id, ...d.data() } as Reservation))
        .filter(r => r.status === 'checked_out');

      if (checkouts.length === 0) {
        toast.info("No checked out reservations found. Please check out a guest in Front Desk to automatically generate a survey workflow!");
        return;
      }

      let count = 0;
      for (const res of checkouts) {
        // Check if survey already exists
        const exists = surveys.some(s => s.reservationId === res.id);
        if (!exists) {
          const checkOutStr = res.checkOut || new Date().toISOString().split('T')[0];
          const checkOutDateTime = parseISO(checkOutStr);
          const sendTime = addHours(checkOutDateTime, 24).toISOString();

          // Add a scheduled survey
          await addDoc(collection(db, 'hotels', hotelId, 'surveys'), {
            reservationId: res.id,
            guestId: res.guestId || 'demo_guest',
            guestName: res.guestName,
            guestEmail: res.guestEmail || `${res.guestName.toLowerCase().replace(/\s+/g, '')}@pms-demo.com`,
            roomNumber: res.roomNumber,
            checkoutDate: checkOutStr,
            status: 'scheduled',
            scheduledSendTime: sendTime
          });
          count++;
        }
      }

      if (count > 0) {
        toast.success(`Generated ${count} pending survey pipelines for checked-out bookings.`);
      } else {
        toast.info("All checked-out bookings already have active survey pipelines.");
      }
    } catch (err: any) {
      toast.error('Failed to seed: ' + err.message);
    }
  };

  // Calculations for Satisfaction metrics
  const completedSurveys = surveys.filter(s => s.status === 'completed');
  const responseRate = surveys.length ? Math.round((completedSurveys.length / surveys.length) * 100) : 0;
  
  const avgOverall = completedSurveys.length 
    ? parseFloat((completedSurveys.reduce((acc, s) => acc + (s.overallRating || 0), 0) / completedSurveys.length).toFixed(1))
    : 0;

  const avgCleanliness = completedSurveys.length 
    ? parseFloat((completedSurveys.reduce((acc, s) => acc + (s.cleanlinessRating || 0), 0) / completedSurveys.length).toFixed(1))
    : 0;

  const avgService = completedSurveys.length 
    ? parseFloat((completedSurveys.reduce((acc, s) => acc + (s.serviceRating || 0), 0) / completedSurveys.length).toFixed(1))
    : 0;

  const avgComfort = completedSurveys.length 
    ? parseFloat((completedSurveys.reduce((acc, s) => acc + (s.comfortRating || 0), 0) / completedSurveys.length).toFixed(1))
    : 0;

  const avgValue = completedSurveys.length 
    ? parseFloat((completedSurveys.reduce((acc, s) => acc + (s.valueRating || 0), 0) / completedSurveys.length).toFixed(1))
    : 0;

  // NPS Index = count of 5 stars (promoters) minus count of 1-3 stars (detractors) over total respondents
  const promoters = completedSurveys.filter(s => (s.overallRating || 0) >= 5).length;
  const detractors = completedSurveys.filter(s => (s.overallRating || 0) <= 3).length;
  const npsScore = completedSurveys.length 
    ? Math.round(((promoters - detractors) / completedSurveys.length) * 100)
    : 0;

  return (
    <div className="space-y-6">
      
      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        
        {/* NPS Card */}
        <div className="bg-zinc-950 p-5 rounded-2xl border border-purple-500/20 shadow-xl relative overflow-hidden flex flex-col justify-between">
          <div className="absolute top-0 right-0 w-24 h-24 bg-purple-500/5 rounded-full blur-xl pointer-events-none" />
          <div className="flex justify-between items-start">
            <span className="text-zinc-500 text-[10px] font-black uppercase tracking-widest">Net Promoter Index (NPS)</span>
            <div className="p-1 px-1.5 rounded bg-purple-500/20 text-purple-400 text-[9px] font-extrabold uppercase pointer-events-none">Loyalty Tracker</div>
          </div>
          <div className="my-3 flex items-baseline gap-2">
            <span className="text-3xl font-black text-zinc-50">{npsScore > 0 ? `+${npsScore}` : npsScore}</span>
            <span className="text-xs text-zinc-500">on -100 to +100 index</span>
          </div>
          <p className="text-[10px] text-zinc-500">
            Based on {promoters} promoters (5★) and {detractors} detractors (≤3★)
          </p>
        </div>

        {/* Guest Rating Overall */}
        <div className="bg-zinc-950 p-5 rounded-2xl border border-emerald-500/20 shadow-xl relative overflow-hidden flex flex-col justify-between">
          <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 rounded-full blur-xl pointer-events-none" />
          <div className="flex justify-between items-start">
            <span className="text-zinc-500 text-[10px] font-black uppercase tracking-widest">Guest Experience Rating</span>
            <Smile size={18} className="text-emerald-500" />
          </div>
          <div className="my-3 flex items-center gap-2">
            <span className="text-3xl font-black text-emerald-400">{avgOverall || "N/A"}</span>
            <div className="flex text-amber-500">
              {[...Array(5)].map((_, i) => (
                <Star 
                  key={i} 
                  size={14} 
                  fill={i < Math.round(avgOverall) ? "currentColor" : "none"} 
                  className={i < Math.round(avgOverall) ? "text-amber-500" : "text-zinc-700"}
                />
              ))}
            </div>
          </div>
          <p className="text-[10px] text-zinc-500">
            Average of {completedSurveys.length} guest feedback ratings
          </p>
        </div>

        {/* Survey Response Rate Card */}
        <div className="bg-zinc-950 p-5 rounded-2xl border border-zinc-850 shadow-xl relative overflow-hidden flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <span className="text-zinc-500 text-[10px] font-black uppercase tracking-widest">Survey Completion</span>
            <Award size={18} className="text-zinc-400" />
          </div>
          <div className="my-3">
            <div className="text-3xl font-black text-zinc-100">{responseRate}%</div>
            <div className="w-full bg-zinc-90 w bg-zinc-900 rounded-full h-1.5 mt-2">
              <div className="bg-emerald-500 h-1.5 rounded-full" style={{ width: `${responseRate}%` }} />
            </div>
          </div>
          <p className="text-[10px] text-zinc-500">
            {completedSurveys.length} responses out of {surveys.length} checkout surveys
          </p>
        </div>

        {/* Auto Dispatch Status */}
        <div className="bg-zinc-950 p-5 rounded-2xl border border-zinc-850 shadow-xl relative overflow-hidden flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <span className="text-zinc-500 text-[10px] font-black uppercase tracking-widest">Automation Engine</span>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[9px] font-black text-emerald-400 uppercase">ACTIVE</span>
            </div>
          </div>
          <div className="my-2.5">
            <div className="text-xs text-zinc-300 font-bold">24-Hour Post Checkout</div>
            <div className="text-[11px] text-zinc-500 mt-1">
              Surveys are scheduled instantly and dispatched automatically exactly 24 hours after departure.
            </div>
          </div>
          <button
            onClick={handleSeedDemoySurveys}
            className="w-full mt-2 py-1 bg-zinc-900 border border-zinc-800 text-zinc-300 rounded-lg hover:border-purple-500/50 hover:text-purple-400 transition-all font-bold text-[10px] uppercase tracking-wider"
          >
            Refresh Pending Pipelines
          </button>
        </div>
      </div>

      {/* Categories Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-zinc-950 p-6 rounded-2xl border border-zinc-850">
        <div className="space-y-1">
          <div className="text-[9px] font-black text-zinc-500 uppercase">Room Cleanliness</div>
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold text-zinc-200">{avgCleanliness || "N/A"}</span>
            <div className="flex-1 bg-zinc-900 h-2 rounded-full overflow-hidden">
              <div className="bg-blue-500 h-full rounded-full" style={{ width: `${(avgCleanliness / 5) * 100}%` }} />
            </div>
          </div>
        </div>
        <div className="space-y-1">
          <div className="text-[9px] font-black text-zinc-500 uppercase">Staff Hospitality</div>
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold text-zinc-200">{avgService || "N/A"}</span>
            <div className="flex-1 bg-zinc-900 h-2 rounded-full overflow-hidden">
              <div className="bg-emerald-500 h-full rounded-full" style={{ width: `${(avgService / 5) * 100}%` }} />
            </div>
          </div>
        </div>
        <div className="space-y-1">
          <div className="text-[9px] font-black text-zinc-500 uppercase">Comfort & Bedding</div>
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold text-zinc-200">{avgComfort || "N/A"}</span>
            <div className="flex-1 bg-zinc-900 h-2 rounded-full overflow-hidden">
              <div className="bg-purple-500 h-full rounded-full" style={{ width: `${(avgComfort / 5) * 100}%` }} />
            </div>
          </div>
        </div>
        <div className="space-y-1">
          <div className="text-[9px] font-black text-zinc-500 uppercase">Value for Money</div>
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold text-zinc-200">{avgValue || "N/A"}</span>
            <div className="flex-1 bg-zinc-900 h-2 rounded-full overflow-hidden">
              <div className="bg-amber-500 h-full rounded-full" style={{ width: `${(avgValue / 5) * 100}%` }} />
            </div>
          </div>
        </div>
      </div>

      {/* Main Grid: Left is Surveys list/Outbox, Right is feedback details */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Surveys Outbox */}
        <div className="lg:col-span-2 bg-zinc-950 rounded-2xl border border-zinc-850 overflow-hidden shadow-xl">
          <div className="p-4 bg-zinc-900 border-b border-zinc-850 flex justify-between items-center">
            <div className="flex items-center gap-2">
              <Clipboard size={16} className="text-purple-400" />
              <h3 className="text-sm font-bold text-zinc-50">Post-Stay Outbox & Pipeline</h3>
            </div>
            <div className="text-[10px] text-zinc-500">
              Total Managed Stay Pipelines: {surveys.length}
            </div>
          </div>

          <div className="overflow-x-auto">
            {loading ? (
              <div className="py-12 text-center text-zinc-500">Loading pipelines...</div>
            ) : surveys.length === 0 ? (
              <div className="py-12 text-center text-zinc-500 space-y-3">
                <p>No surveys generated yet.</p>
                <p className="text-xs text-zinc-650 max-w-md mx-auto">
                  Guests checked out in Front Desk are automatically loaded here with a 24-hour delayed trigger countdown!
                </p>
                <button
                  onClick={handleSeedDemoySurveys}
                  className="px-4 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-200 font-bold text-[11px] uppercase tracking-wider hover:border-emerald-500 transition-all"
                >
                  Generate Seeds from Past Checkouts
                </button>
              </div>
            ) : (
              <table className="w-full text-left">
                <thead className="bg-zinc-950 border-b border-zinc-850 text-[10px] text-zinc-500 uppercase tracking-widest font-black">
                  <tr>
                    <th className="px-4 py-3">Guest & Room</th>
                    <th className="px-4 py-3">Departure Date</th>
                    <th className="px-4 py-3">Email Status</th>
                    <th className="px-4 py-3">Overall Stay Rating</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-900">
                  {surveys.map((survey) => (
                    <tr 
                      key={survey.id} 
                      className={`hover:bg-zinc-900/40 transition-colors cursor-pointer ${selectedSurvey?.id === survey.id ? 'bg-zinc-900/60 font-medium' : ''}`}
                      onClick={() => setSelectedSurvey(survey)}
                    >
                      <td className="px-4 py-3">
                        <div className="font-bold text-zinc-200">{survey.guestName}</div>
                        <div className="text-[10px] text-zinc-500">Room {survey.roomNumber} • {survey.guestEmail}</div>
                      </td>
                      <td className="px-4 py-3 text-xs text-zinc-400">
                        {survey.checkoutDate}
                      </td>
                      <td className="px-4 py-3">
                        {survey.status === 'completed' && (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-black text-[9px] uppercase">
                            <CheckCircle size={10} />
                            Completed
                          </span>
                        )}
                        {survey.status === 'sent' && (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 font-black text-[9px] uppercase">
                            <Send size={10} />
                            Email Sent
                          </span>
                        )}
                        {survey.status === 'scheduled' && (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 font-black text-[9px] uppercase" title={`Scheduled for ${format(new Date(survey.scheduledSendTime), 'MMM d, HH:mm')}`}>
                            <Clock size={10} />
                            24h Pending
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {survey.status === 'completed' ? (
                          <div className="flex items-center gap-1 text-amber-500 font-black text-xs">
                            <Star size={12} fill="currentColor" />
                            <span>{survey.overallRating}/5</span>
                          </div>
                        ) : (
                          <span className="text-[10px] text-zinc-650 italic">Awaiting Response</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-2">
                          {survey.status === 'scheduled' && (
                            <button
                              onClick={() => handleSimulateSend(survey)}
                              className="px-2 py-1 bg-zinc-900 hover:bg-zinc-850 rounded text-zinc-300 hover:text-blue-400 transition-all font-black text-[9px] uppercase"
                              title="Force instantaneous dispatch simulation of feedback invitation"
                            >
                              Dispatch Now
                            </button>
                          )}
                          <button
                            onClick={() => setSimulationSurvey(survey)}
                            className="px-2 py-1 bg-purple-500/10 hover:bg-purple-500/20 rounded text-purple-400 border border-purple-500/20 transition-all font-black text-[9px] uppercase flex items-center gap-1"
                            title="Mock guest completing rating portal"
                          >
                            <ExternalLink size={10} />
                            Guest View
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Guest Review Panel / Response Pane */}
        <div className="bg-zinc-950 rounded-2xl border border-zinc-850 overflow-hidden shadow-xl">
          <div className="p-4 bg-zinc-900 border-b border-zinc-850">
            <h3 className="text-sm font-bold text-zinc-50 flex items-center gap-2">
              <MessageSquare size={16} className="text-emerald-400" />
              Review Detail Inspector
            </h3>
          </div>

          {selectedSurvey ? (
            <div className="p-6 space-y-6">
              
              {/* Header Details */}
              <div className="border-b border-zinc-900 pb-4 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-zinc-400">Guest Review</span>
                  <span className="text-[10px] font-black text-zinc-500">Room {selectedSurvey.roomNumber}</span>
                </div>
                <h4 className="text-lg font-black text-zinc-100">{selectedSurvey.guestName}</h4>
                <p className="text-xs text-zinc-500">Stay ended on {selectedSurvey.checkoutDate}</p>
              </div>

              {selectedSurvey.status === 'completed' ? (
                <>
                  {/* Detailed Scores */}
                  <div className="space-y-3">
                    <h5 className="text-[10px] font-black uppercase text-zinc-500 tracking-wider">Metric Performance</h5>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-zinc-900/50 p-3 rounded-xl border border-zinc-90 pointer-events-none">
                        <div className="text-[10px] text-zinc-500">Overall Satisfaction</div>
                        <div className="text-lg font-black text-amber-500 flex items-center gap-1.5 mt-1">
                          <Star size={16} fill="currentColor" />
                          {selectedSurvey.overallRating} / 5
                        </div>
                      </div>

                      <div className="bg-zinc-900/50 p-3 rounded-xl border border-zinc-90 pointer-events-none">
                        <div className="text-[10px] text-zinc-500">Room Cleanliness</div>
                        <div className="text-lg font-black text-blue-400 flex items-center gap-1.5 mt-1">
                          <Star size={16} fill="currentColor" className="text-blue-400" />
                          {selectedSurvey.cleanlinessRating} / 5
                        </div>
                      </div>

                      <div className="bg-zinc-900/50 p-3 rounded-xl border border-zinc-90 pointer-events-none">
                        <div className="text-[10px] text-zinc-500">Staff Service</div>
                        <div className="text-lg font-black text-emerald-400 flex items-center gap-1.5 mt-1">
                          <Star size={16} fill="currentColor" className="text-emerald-400" />
                          {selectedSurvey.serviceRating} / 5
                        </div>
                      </div>

                      <div className="bg-zinc-900/50 p-3 rounded-xl border border-zinc-90 pointer-events-none">
                        <div className="text-[10px] text-zinc-500">Comfort & Comforts</div>
                        <div className="text-lg font-black text-purple-400 flex items-center gap-1.5 mt-1">
                          <Star size={16} fill="currentColor" className="text-purple-400" />
                          {selectedSurvey.comfortRating} / 5
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Feedback Narrative */}
                  <div className="space-y-2 pointer-events-none">
                    <h5 className="text-[10px] font-black uppercase text-zinc-500 tracking-wider">Commentary</h5>
                    <div className="bg-zinc-900 p-4 rounded-xl border border-zinc-850 text-xs text-zinc-350 italic text-left relative">
                      <span className="text-xl text-zinc-600 block leading-none select-none">“</span>
                      {selectedSurvey.comments || "Guest left no narrative thoughts."}
                      <span className="text-xl text-zinc-600 block text-right leading-none select-none mt-2">”</span>
                    </div>
                  </div>

                  {/* Manager Response Block */}
                  <div className="space-y-3 pt-2">
                    <h5 className="text-[10px] font-black uppercase text-zinc-500 tracking-wider flex items-center gap-1">
                      <span>Service Recovery / Manager Response</span>
                    </h5>

                    {selectedSurvey.managerResponse ? (
                      <div className="bg-emerald-950/20 border border-emerald-800/20 p-4 rounded-xl space-y-2 text-left pointer-events-none">
                        <div className="flex justify-between text-[10px] font-bold text-emerald-400">
                          <span>Service Manager Response:</span>
                          <span>Posted</span>
                        </div>
                        <p className="text-xs text-zinc-300 italic">"{selectedSurvey.managerResponse}"</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <textarea
                          value={managerResponseText}
                          onChange={(e) => setManagerResponseText(e.target.value)}
                          className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-xs text-zinc-100 placeholder-zinc-550 outline-none focus:border-purple-500 h-24 resize-none"
                          placeholder="Draft a public message to show appreciation or address guest complaints..."
                        />
                        <button
                          onClick={() => handleSaveResponse(selectedSurvey)}
                          disabled={submittingResponse || !managerResponseText.trim()}
                          className="w-full py-2.5 bg-purple-500 text-black rounded-xl font-bold text-xs hover:bg-purple-400 transition-all flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50"
                        >
                          {submittingResponse ? 'Posting...' : 'Post Manager Response'}
                        </button>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="py-20 text-center text-zinc-600 flex flex-col items-center justify-center gap-4">
                  <Clock size={32} className="text-zinc-700 pointer-events-none animate-pulse" />
                  <div>
                    <h5 className="font-bold text-zinc-500 text-sm">Awaiting Guest Response</h5>
                    <p className="text-xs text-zinc-650 max-w-xs mx-auto mt-1">
                      This stay was checked out recently. You can copy the simulation guest-link above to seed ratings!
                    </p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="py-24 text-center text-zinc-600 italic text-xs">
              Select or check a survey row on the left to inspect rating detail or post managerial review.
            </div>
          )}
        </div>
      </div>

      {/* Guest Survey Simulation Modal */}
      {simulationSurvey && (
        <GuestSurveyPortal 
          survey={simulationSurvey}
          onClose={() => {
            setSimulationSurvey(null);
          }}
          hotelId={hotelId}
        />
      )}
    </div>
  );
}

// ---------------- GUEST SURVEY RATING SUBMISSION COMPONENT ----------------
interface GuestSurveyPortalProps {
  survey: SurveyFeedback;
  hotelId: string;
  onClose: () => void;
}

export function GuestSurveyPortal({ survey, hotelId, onClose }: GuestSurveyPortalProps) {
  const [overall, setOverall] = useState(5);
  const [cleanliness, setCleanliness] = useState(5);
  const [service, setService] = useState(5);
  const [comfort, setComfort] = useState(5);
  const [value, setValue] = useState(5);
  const [comments, setComments] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);

  // Prefill if survey already finished
  useEffect(() => {
    if (survey.status === 'completed') {
      setOverall(survey.overallRating || 5);
      setCleanliness(survey.cleanlinessRating || 5);
      setService(survey.serviceRating || 5);
      setComfort(survey.comfortRating || 5);
      setValue(survey.valueRating || 5);
      setComments(survey.comments || '');
      setCompleted(true);
    }
  }, [survey]);

  const handleSubmitSurvey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!survey.id) return;
    setSubmitting(true);
    try {
      const docRef = doc(db, 'hotels', hotelId, 'surveys', survey.id);
      await updateDoc(docRef, {
        status: 'completed',
        overallRating: overall,
        cleanlinessRating: cleanliness,
        serviceRating: service,
        comfortRating: comfort,
        valueRating: value,
        comments,
        completedAt: new Date().toISOString()
      });
      setCompleted(true);
      toast.success('Thank you for your valuable feedback!');
    } catch (err: any) {
      toast.error('Failed to submit: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-[70] flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-lg bg-zinc-950 border border-zinc-800 rounded-3xl overflow-hidden shadow-2xl relative my-8">
        
        {/* Banner */}
        <div className="p-6 bg-gradient-to-r from-purple-900/40 to-slate-900 border-b border-zinc-800 text-left relative flex justify-between items-center">
          <div>
            <span className="text-xs font-black text-purple-400 uppercase tracking-widest flex items-center gap-1 pointer-events-none">
              <Sparkles size={11} />
              GUEST SURVEY FEEDBACK PORTAL
            </span>
            <h4 className="text-xl font-black text-zinc-100 tracking-tight mt-1">How was your stay?</h4>
          </div>
          <button 
            type="button"
            onClick={onClose}
            className="p-1.5 hover:bg-zinc-900 text-zinc-500 hover:text-zinc-50 rounded-full transition-all"
          >
            <Check size={18} />
          </button>
        </div>

        {completed ? (
          <div className="p-8 text-center space-y-6">
            <div className="w-16 h-16 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center mx-auto pointer-events-none">
              <ThumbsUp size={28} className="text-emerald-400" />
            </div>
            
            <div className="space-y-2 pointer-events-none">
              <h3 className="text-lg font-black text-zinc-100">Feedback Submitted Successfully!</h3>
              <p className="text-xs text-zinc-400 max-w-xs mx-auto">
                Thank you, {survey.guestName}. Your ratings and comments have been aggregated in the PMS Reports & Analytics module to help our operational staff improve accommodations.
              </p>
            </div>

            <div className="bg-zinc-900 p-4 rounded-2xl border border-zinc-850 text-left text-xs pointer-events-none">
              <div className="font-bold text-zinc-300">Your Submitted Scores:</div>
              <div className="grid grid-cols-2 gap-2 mt-2 font-semibold">
                <div className="text-zinc-500 flex justify-between">Overall: <span className="text-amber-500">★ {overall}</span></div>
                <div className="text-zinc-500 flex justify-between">Service: <span className="text-emerald-400">★ {service}</span></div>
                <div className="text-zinc-500 flex justify-between">Cleanliness: <span className="text-blue-400">★ {cleanliness}</span></div>
                <div className="text-zinc-500 flex justify-between">Comfort: <span className="text-purple-400">★ {comfort}</span></div>
              </div>
            </div>

            <button
              onClick={onClose}
              className="px-6 py-2.5 bg-zinc-900 border border-zinc-800 hover:border-purple-500 rounded-xl text-zinc-300 transition-all font-bold text-xs uppercase"
            >
              Close Survey
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmitSurvey} className="p-6 text-left space-y-5">
            <div className="p-4 bg-zinc-900/60 rounded-2xl border border-zinc-900 space-y-1 text-xs">
              <p className="text-zinc-300 font-bold">Dear {survey.guestName},</p>
              <p className="text-zinc-500">
                You checked out of room <span className="text-zinc-300 font-bold">{survey.roomNumber}</span> on {survey.checkoutDate}. We would deeply appreciate your ratings on these key categories to maintain our standards.
              </p>
            </div>

            {/* Category Ratings Slider/Radios */}
            <div className="space-y-4">
              
              {/* Overall */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs font-bold">
                  <span className="text-zinc-400">1. Overall Stay Experience</span>
                  <span className="text-amber-500 font-black flex items-center gap-1">★ {overall}/5</span>
                </div>
                <div className="flex justify-between items-center gap-2">
                  {[1, 2, 3, 4, 5].map((val) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setOverall(val)}
                      className={`flex-1 py-1 px-3 border rounded-xl text-xs font-bold transition-all ${overall === val ? 'bg-amber-500 text-black border-amber-600' : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-zinc-305'}`}
                    >
                      {val}
                    </button>
                  ))}
                </div>
              </div>

              {/* Cleanliness */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs font-bold">
                  <span className="text-zinc-400">2. Room Cleanliness</span>
                  <span className="text-blue-400 font-black flex items-center gap-1">★ {cleanliness}/5</span>
                </div>
                <div className="flex justify-between items-center gap-2">
                  {[1, 2, 3, 4, 5].map((val) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setCleanliness(val)}
                      className={`flex-1 py-1 px-3 border rounded-xl text-xs font-bold transition-all ${cleanliness === val ? 'bg-blue-400 text-black border-blue-500' : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-zinc-305'}`}
                    >
                      {val}
                    </button>
                  ))}
                </div>
              </div>

              {/* Staff service */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs font-bold">
                  <span className="text-zinc-400">3. Staff Service & Hospitality</span>
                  <span className="text-emerald-400 font-black flex items-center gap-1">★ {service}/5</span>
                </div>
                <div className="flex justify-between items-center gap-2">
                  {[1, 2, 3, 4, 5].map((val) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setService(val)}
                      className={`flex-1 py-1 px-3 border rounded-xl text-xs font-bold transition-all ${service === val ? 'bg-emerald-400 text-black border-emerald-500' : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-zinc-305'}`}
                    >
                      {val}
                    </button>
                  ))}
                </div>
              </div>

              {/* Comfort */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs font-bold">
                  <span className="text-zinc-400">4. Comfort, Aircon & Bedding</span>
                  <span className="text-purple-400 font-black flex items-center gap-1">★ {comfort}/5</span>
                </div>
                <div className="flex justify-between items-center gap-2">
                  {[1, 2, 3, 4, 5].map((val) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setComfort(val)}
                      className={`flex-1 py-1 px-3 border rounded-xl text-xs font-bold transition-all ${comfort === val ? 'bg-purple-400 text-black border-purple-500' : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-zinc-305'}`}
                    >
                      {val}
                    </button>
                  ))}
                </div>
              </div>

              {/* Value for money */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs font-bold">
                  <span className="text-zinc-400">5. Value for Money</span>
                  <span className="text-amber-500 font-black flex items-center gap-1">★ {value}/5</span>
                </div>
                <div className="flex justify-between items-center gap-2">
                  {[1, 2, 3, 4, 5].map((val) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setValue(val)}
                      className={`flex-1 py-1 px-3 border rounded-xl text-xs font-bold transition-all ${value === val ? 'bg-amber-400 text-black border-amber-500' : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-zinc-305'}`}
                    >
                      {val}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* General Feedback Comments */}
            <div className="space-y-1">
              <label className="text-xs font-bold text-zinc-400">Additional Remarks / Feedback</label>
              <textarea
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                maxLength={500}
                placeholder="Share your recommendations or individual praise for hotel service..."
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-xs text-zinc-100 placeholder-zinc-550 outline-none focus:border-purple-500 h-20 resize-none"
              />
            </div>

            {/* Buttons */}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-2.5 rounded-xl font-bold bg-zinc-900 border border-zinc-800 text-zinc-400 hover:bg-zinc-800 transition-all text-xs"
              >
                Go Back
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 py-2.5 rounded-xl font-bold bg-purple-500 text-black hover:bg-purple-400 hover:shadow-lg hover:shadow-purple-500/20 transition-all text-xs active:scale-95 text-center flex justify-center items-center"
              >
                {submitting ? 'Submitting Feedback...' : 'Post Guest Feedback'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
