import React, { useEffect, useRef, useState } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { createPcmBlob, decodeAudioData, base64ToUint8Array } from '../utils/audioUtils';
import { MessageTurn, TicketDraft, UserContext } from '../types';
import TicketPreview from './TicketPreview';
import { extractTicketFromTranscript } from '../services/geminiService';

interface Props {
  userContext: UserContext;
}

const VoiceAgent: React.FC<Props> = ({ userContext }) => {
  // UI State
  const [callState, setCallState] = useState<'idle' | 'connecting' | 'active' | 'ended'>('idle');
  const [transcripts, setTranscripts] = useState<MessageTurn[]>([]);
  const [volume, setVolume] = useState(0);
  const [callDuration, setCallDuration] = useState(0);

  // Ticket State
  const [generatedTicket, setGeneratedTicket] = useState<TicketDraft | null>(null);
  const [ticketId, setTicketId] = useState<string | null>(null);

  // Refs for Audio & Session
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const aiClientRef = useRef<GoogleGenAI | null>(null);
  const callTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Buffer for transcriptions
  const currentInputTransRef = useRef('');
  const currentOutputTransRef = useRef('');

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------
  // Auto-submit state
  const [isAutoSubmitting, setIsAutoSubmitting] = useState(false);

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (process.env.API_KEY) {
      aiClientRef.current = new GoogleGenAI({ apiKey: process.env.API_KEY });
    }
    return () => {
      // Don't call stopSession in cleanup if unmounting, just cleanup resources
      cleanupResources();
    };
  }, []);

  // Call timer
  useEffect(() => {
    if (callState === 'active') {
      callTimerRef.current = setInterval(() => {
        setCallDuration(prev => prev + 1);
      }, 1000);
    } else {
      if (callTimerRef.current) {
        clearInterval(callTimerRef.current);
        callTimerRef.current = null;
      }
    }
    return () => {
      if (callTimerRef.current) clearInterval(callTimerRef.current);
    };
  }, [callState]);

  // ---------------------------------------------------------------------------
  // Session Management
  // ---------------------------------------------------------------------------
  const cleanupResources = () => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (inputSourceRef.current) {
      inputSourceRef.current.disconnect();
      inputSourceRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    activeSourcesRef.current.forEach(source => source.stop());
    activeSourcesRef.current.clear();
    nextStartTimeRef.current = 0;
  };

  const startSession = async () => {
    if (!aiClientRef.current) {
      console.error('[VoiceAgent] Cannot start session: GEMINI_API_KEY is not configured in .env.local');
      alert('API Key not configured!\n\nPlease add your Gemini API key to .env.local:\nGEMINI_API_KEY=your_key_here\n\nThen restart the dev server.');
      return;
    }

    setCallState('connecting');
    setTranscripts([]);
    setTicketId(null);
    setGeneratedTicket(null);
    setCallDuration(0);
    setIsAutoSubmitting(false);

    try {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      sessionPromiseRef.current = aiClientRef.current.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: handleOnOpen,
          onmessage: handleOnMessage,
          onclose: () => {
            console.log('Session closed');
            handleHangUp(); // Ensure consistent cleanup
          },
          onerror: (err) => {
            console.error('Session error', err);
            setCallState('idle');
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: 'Charon'
              }
            }
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: "Tumhara naam Aryan hai. Tum ek helpful IT support assistant ho. Tum Hinglish mein baat karte ho (Hindi aur English ka mix). Tumhara goal hai user ki problem sunna, clarifying questions puchna (jaise kaunsa component use kar rahe hain, ya koi error message dikha), aur unhe ticket file karne mein help karna. Responses concise aur friendly rakho. Complex technical problems khud solve mat karo, sirf ticket ke liye information gather karo. Always speak in Hinglish."
        }
      });

    } catch (err) {
      console.error("Failed to start session:", err);
      setCallState('idle');
    }
  };

  const stopSession = () => {
    cleanupResources();

    if (callState === 'active') {
      setCallState('ended');
      // Auto-submit logic
      if (transcripts.length > 0) {
        handleGenerateTicket(true);
      }
    } else {
      setCallState('idle');
    }
  };

  const handleCall = () => {
    if (callState === 'idle' || callState === 'ended') {
      startSession();
    }
  };

  const handleHangUp = () => {
    stopSession();
  };

  const handleNewCall = () => {
    setCallState('idle');
    setTranscripts([]);
    setCallDuration(0);
    setTicketId(null);
  };

  // ---------------------------------------------------------------------------
  // Gemini Callbacks
  // ---------------------------------------------------------------------------
  const handleOnOpen = () => {
    setCallState('active');

    if (!audioContextRef.current || !streamRef.current || !sessionPromiseRef.current) return;

    const source = audioContextRef.current.createMediaStreamSource(streamRef.current);
    inputSourceRef.current = source;

    // Reduced buffer size for lower latency (2048 instead of 4096)
    const processor = audioContextRef.current.createScriptProcessor(2048, 1, 1);
    processorRef.current = processor;

    // Pre-resolve session for faster sending
    let resolvedSession: any = null;
    sessionPromiseRef.current?.then(s => { resolvedSession = s; });

    processor.onaudioprocess = (e) => {
      const inputData = e.inputBuffer.getChannelData(0);

      // Fast volume calculation
      let sum = 0;
      for (let i = 0; i < inputData.length; i += 16) sum += inputData[i] * inputData[i];
      setVolume(Math.sqrt(sum / (inputData.length / 16)));

      // Send immediately if session is ready
      if (resolvedSession) {
        const pcmBlob = createPcmBlob(inputData);
        resolvedSession.sendRealtimeInput({ media: pcmBlob });
      }
    };

    source.connect(processor);
    processor.connect(audioContextRef.current.destination);
  };

  const handleOnMessage = async (message: LiveServerMessage) => {
    const serverContent = message.serverContent;
    if (serverContent) {
      if (serverContent.outputTranscription?.text) {
        currentOutputTransRef.current += serverContent.outputTranscription.text;
      }
      if (serverContent.inputTranscription?.text) {
        currentInputTransRef.current += serverContent.inputTranscription.text;
      }

      if (serverContent.turnComplete) {
        const newTurns: MessageTurn[] = [];
        if (currentInputTransRef.current.trim()) {
          newTurns.push({ role: 'user', text: currentInputTransRef.current, timestamp: Date.now() });
          currentInputTransRef.current = '';
        }
        if (currentOutputTransRef.current.trim()) {
          newTurns.push({ role: 'model', text: currentOutputTransRef.current, timestamp: Date.now() });
          currentOutputTransRef.current = '';
        }

        if (newTurns.length > 0) {
          setTranscripts(prev => [...prev, ...newTurns]);
        }
      }
    }

    const base64Audio = serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
    if (base64Audio && outputAudioContextRef.current) {
      try {
        const ctx = outputAudioContextRef.current;

        // Play immediately - minimal scheduling delay
        const playTime = Math.max(nextStartTimeRef.current, ctx.currentTime + 0.01);

        const audioBuffer = await decodeAudioData(base64ToUint8Array(base64Audio), ctx);

        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);

        source.start(playTime);
        nextStartTimeRef.current = playTime + audioBuffer.duration;

        source.onended = () => activeSourcesRef.current.delete(source);
        activeSourcesRef.current.add(source);
      } catch (e) {
        console.error("Audio decode error", e);
      }
    }
  };

  // ---------------------------------------------------------------------------
  // Ticket
  // ---------------------------------------------------------------------------
  const handleGenerateTicket = async (autoSubmit = false) => {
    if (transcripts.length === 0) return;

    if (autoSubmit) {
      setIsAutoSubmitting(true);
    }

    try {
      const draft = await extractTicketFromTranscript(transcripts);

      if (autoSubmit) {
        // Import dynamically or use the imported one (assuming dependency injection isn't strictly needed here)
        // We need to fetch 'submitTicketToMCP' or move it to props if it wasn't imported.
        // Since I can't see the imports in this replace block, I'll assume I need to handle the submission here.
        // Or easier: setGeneratedTicket(draft) and then have an effect that submits it?
        // No, let's submit directly using the service we know exists (TicketPreview uses it).

        const { submitTicketToMCP } = await import('../services/mcpService');
        const { sanitizeContext } = await import('../utils/sanitizer');

        const payload = {
          ...draft,
          user_context: sanitizeContext(userContext)
        };

        const result = await submitTicketToMCP(payload);
        if (result.success && result.ticket_id) {
          setTicketId(result.ticket_id);
        } else {
          console.error("Auto submission failed", result.error);
          setGeneratedTicket(draft); // Fallback to manual review
        }
        setIsAutoSubmitting(false);
      } else {
        setGeneratedTicket(draft);
      }
    } catch (e) {
      console.error("Ticket generation failed", e);
      setIsAutoSubmitting(false);
      if (!autoSubmit) alert("Could not generate ticket. Please try again.");
    }
  };

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // IDLE STATE - Phone Dialer View
  if (callState === 'idle') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 flex flex-col items-center justify-center p-6">
        {/* Title */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-white mb-2">Voice Support</h1>
          <p className="text-slate-400">Tap to call our AI support agent</p>
        </div>

        {/* Avatar */}
        <div className="relative mb-12">
          <div className="w-32 h-32 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-2xl">
            <svg className="w-16 h-16 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          </div>
          <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-emerald-500 text-white text-xs font-bold px-3 py-1 rounded-full">
            ONLINE
          </div>
        </div>

        {/* Agent Name */}
        <div className="text-center mb-16">
          <h2 className="text-2xl font-semibold text-white">Aryan</h2>
          <p className="text-slate-400 text-sm">AI Support Agent • Hinglish</p>
        </div>

        {/* Call Button */}
        <button
          onClick={handleCall}
          className="w-20 h-20 bg-emerald-500 hover:bg-emerald-400 rounded-full flex items-center justify-center shadow-lg shadow-emerald-500/30 transition-all hover:scale-110 active:scale-95"
        >
          <svg className="w-10 h-10 text-white" fill="currentColor" viewBox="0 0 24 24">
            <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 00-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z" />
          </svg>
        </button>
        <p className="text-slate-500 text-sm mt-4">Tap to call</p>
      </div>
    );
  }

  // CONNECTING STATE
  if (callState === 'connecting') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 flex flex-col items-center justify-center p-6">
        {/* Pulsing Avatar */}
        <div className="relative mb-12">
          <div className="absolute inset-0 w-32 h-32 rounded-full bg-blue-500/30 animate-ping"></div>
          <div className="relative w-32 h-32 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-2xl">
            <svg className="w-16 h-16 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          </div>
        </div>

        <h2 className="text-2xl font-semibold text-white mb-2">Calling Aryan...</h2>
        <p className="text-slate-400 text-sm mb-12">Connecting to AI Support</p>

        {/* Cancel Button */}
        <button
          onClick={handleHangUp}
          className="w-16 h-16 bg-red-500 hover:bg-red-400 rounded-full flex items-center justify-center shadow-lg shadow-red-500/30 transition-all"
        >
          <svg className="w-8 h-8 text-white rotate-135" fill="currentColor" viewBox="0 0 24 24">
            <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 00-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z" />
          </svg>
        </button>
        <p className="text-slate-500 text-sm mt-4">Cancel</p>
      </div>
    );
  }

  // ACTIVE CALL STATE
  if (callState === 'active') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 flex flex-col">
        {/* Header */}
        <div className="pt-12 pb-6 text-center">
          <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg">
            <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-white">Aryan</h2>
          <p className="text-emerald-400 text-sm font-medium">{formatTime(callDuration)}</p>
        </div>

        {/* Audio Visualizer */}
        <div className="flex justify-center gap-1 h-12 mb-4">
          {[...Array(7)].map((_, i) => (
            <div
              key={i}
              className="w-2 bg-gradient-to-t from-blue-500 to-purple-500 rounded-full transition-all duration-75"
              style={{
                height: `${Math.max(12, Math.min(48, volume * 200 * (Math.random() + 0.5)))}px`,
                opacity: 0.6 + volume * 0.4
              }}
            />
          ))}
        </div>

        {/* Transcript Area */}
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          <div className="max-w-lg mx-auto space-y-3">
            {transcripts.length === 0 && (
              <p className="text-center text-slate-500 mt-8">Listening...</p>
            )}
            {transcripts.map((t, i) => (
              <div key={i} className={`flex ${t.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${t.role === 'user'
                  ? 'bg-blue-600 text-white rounded-br-sm'
                  : 'bg-slate-700 text-slate-100 rounded-bl-sm'
                  }`}>
                  {t.text}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Call Controls */}
        <div className="pb-12 pt-6 bg-gradient-to-t from-slate-900 to-transparent">
          <div className="flex justify-center items-center gap-8">
            {/* End Call */}
            <button
              onClick={handleHangUp}
              className="w-16 h-16 bg-red-500 hover:bg-red-400 rounded-full flex items-center justify-center shadow-lg shadow-red-500/30 transition-all"
            >
              <svg className="w-8 h-8 text-white rotate-135" fill="currentColor" viewBox="0 0 24 24">
                <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 00-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // CALL ENDED STATE
  if (callState === 'ended') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 flex flex-col items-center justify-center p-6">

        {/* Loading Spinner for Auto Submit */}
        {isAutoSubmitting ? (
          <div className="text-center">
            <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-6"></div>
            <h2 className="text-2xl font-semibold text-white mb-2">Analysing conversation...</h2>
            <p className="text-slate-400">Creating ticket automatically</p>
          </div>
        ) : (
          <>
            {/* Ended Avatar */}
            <div className="w-24 h-24 mb-6 rounded-full bg-slate-700 flex items-center justify-center">
              <svg className="w-12 h-12 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            </div>

            <h2 className="text-2xl font-semibold text-white mb-1">Call Ended</h2>
            <p className="text-slate-400 text-sm mb-8">Duration: {formatTime(callDuration)}</p>

            {/* Transcript Summary */}
            {transcripts.length > 0 && (
              <div className="w-full max-w-md bg-slate-800/50 backdrop-blur rounded-xl p-4 mb-8 max-h-48 overflow-y-auto">
                <p className="text-xs text-slate-500 uppercase mb-2 font-medium">Conversation Summary</p>
                {transcripts.slice(-4).map((t, i) => (
                  <p key={i} className={`text-sm mb-2 ${t.role === 'user' ? 'text-blue-300' : 'text-slate-300'}`}>
                    <span className="font-semibold">{t.role === 'user' ? 'You: ' : 'Aryan: '}</span>
                    {t.text.length > 80 ? t.text.slice(0, 80) + '...' : t.text}
                  </p>
                ))}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-4">
              <button
                onClick={handleNewCall}
                className="px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-xl font-medium transition-all"
              >
                New Call
              </button>
              {transcripts.length > 0 && (
                <button
                  onClick={() => handleGenerateTicket(false)}
                  className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-medium transition-all flex items-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Create Ticket Manually
                </button>
              )}
            </div>
          </>
        )}

        {/* Success Overlay */}
        {ticketId && (
          <div className="fixed inset-0 bg-slate-900/95 flex flex-col items-center justify-center p-6 z-50">
            <div className="w-20 h-20 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center mb-6">
              <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-2xl font-bold text-white mb-2">Ticket Created!</h3>
            <p className="text-slate-400 mb-8">ID: <span className="font-mono text-emerald-400">{ticketId}</span></p>
            <p className="text-slate-500 text-sm mb-6">Sent to Fix Agent</p>
            <button
              onClick={() => { setTicketId(null); setCallState('idle'); setTranscripts([]); }}
              className="px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-xl font-medium"
            >
              Done
            </button>
          </div>
        )}

        {/* Ticket Preview Modal */}
        {generatedTicket && (
          <TicketPreview
            draft={generatedTicket}
            userContext={userContext}
            onClose={() => setGeneratedTicket(null)}
            onSuccess={(id) => {
              setGeneratedTicket(null);
              setTicketId(id);
            }}
          />
        )}
      </div>
    );
  }

  return null;
};

export default VoiceAgent;
