'use client';

import { useState, useRef, useCallback } from 'react';
import {
  Room,
  RoomEvent,
  Track,
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
  Participant,
} from 'livekit-client';
import { VoiceState } from '@/components/AudioOrb';
import { ChatMessage } from '@/lib/types';
import { CitationItem } from '@/lib/knowledge/grounding';

// Web Speech API types (not universally available in all TS DOM lib targets)
interface WebSpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: { transcript: string; confidence: number };
}

interface WebSpeechRecognitionEvent {
  readonly results: WebSpeechRecognitionResult[] & { length: number };
}

interface WebSpeechRecognitionErrorEvent {
  readonly error: string;
}

interface WebSpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: WebSpeechRecognitionEvent) => void) | null;
  onerror: ((event: WebSpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface UseLiveKitTwinReturn {
  state: VoiceState;
  messages: ChatMessage[];
  interimTranscript: string;
  audioLevel: number;
  isMuted: boolean;
  activeCitation: CitationItem | null;
  isDrawerOpen: boolean;
  errorMessage: string | null;
  startCall: () => Promise<void>;
  endCall: () => void;
  resetSession: () => void;
  toggleMute: () => void;
  sendMessage: (text: string) => Promise<void>;
  interruptPlayback: () => void;
  openCitation: (c: CitationItem) => void;
  closeCitation: () => void;
}

export function useLiveKitTwin(): UseLiveKitTwinReturn {
  const [state, setState] = useState<VoiceState>('idle');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [audioLevel, setAudioLevel] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [activeCitation, setActiveCitation] = useState<CitationItem | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const roomRef = useRef<Room | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const localAnalyserRef = useRef<AnalyserNode | null>(null);
  const remoteAnalyserRef = useRef<AnalyserNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<WebSpeechRecognition | null>(null);
  const isCallActiveRef = useRef<boolean>(false);
  const isSpeakingRef = useRef<boolean>(false);
  const lastSpokenTextRef = useRef<string>('');
  const lastQueryRef = useRef<{ text: string; time: number }>({ text: '', time: 0 });
  const animFrameRef = useRef<number | null>(null);
  const audioElementsRef = useRef<HTMLMediaElement[]>([]);
  const currentAudioSourceRef = useRef<AudioBufferSourceNode | null>(null);

  // Helper to detect acoustic feedback echoes of assistant's words or refusal phrases
  const isAcousticEcho = (input: string, lastSpoken: string): boolean => {
    const cleanInput = input
      .toLowerCase()
      .replace(/[^a-z0-9]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleanInput) return true;

    // Check standard assistant refusal phrases
    if (
      cleanInput.startsWith('i don t have verified information') ||
      cleanInput.startsWith('i dont have verified information') ||
      cleanInput.startsWith('i do not have verified information') ||
      cleanInput.includes('so i don t want to guess') ||
      cleanInput.includes('so i dont want to guess') ||
      cleanInput.includes('ask me anything about my work')
    ) {
      return true;
    }

    if (!lastSpoken) return false;

    // If cleanInput is a significant substring of what the assistant just spoke
    if (cleanInput.length > 8 && lastSpoken.includes(cleanInput)) {
      return true;
    }

    return false;
  };

  // Initialize or resume the Web Audio Context for audio analysis & playback
  const getAudioContext = useCallback(async (): Promise<AudioContext> => {
    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioContextRef.current = new AudioCtx();
    }
    if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume();
    }
    return audioContextRef.current;
  }, []);

  // Audio Level Analyser Loop for microphone and remote LiveKit audio stream
  const startAudioAnalysis = (stream: MediaStream) => {
    try {
      getAudioContext().then((audioCtx) => {
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 64;
        const source = audioCtx.createMediaStreamSource(stream);
        source.connect(analyser);

        localAnalyserRef.current = analyser;

        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        const checkLevel = () => {
          const activeAnalyser = remoteAnalyserRef.current || localAnalyserRef.current;
          if (activeAnalyser) {
            activeAnalyser.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
              sum += dataArray[i];
            }
            const avg = sum / dataArray.length;
            const normalized = Math.min(1, avg / 128);
            setAudioLevel(normalized);
          }

          animFrameRef.current = requestAnimationFrame(checkLevel);
        };

        checkLevel();
      });
    } catch (_e) {
      console.warn('[Audio Analysis Error]', _e);
    }
  };

  const startRemoteAudioAnalysis = (remoteStream: MediaStream) => {
    try {
      getAudioContext().then((audioCtx) => {
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 64;
        const source = audioCtx.createMediaStreamSource(remoteStream);
        source.connect(analyser);
        remoteAnalyserRef.current = analyser;
      });
    } catch (_e) {
      console.warn('[Remote Audio Analysis Error]', _e);
    }
  };

  const stopAudioAnalysis = () => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    remoteAnalyserRef.current = null;
    localAnalyserRef.current = null;
    setAudioLevel(0);
  };

  // Stops currently playing TTS audio (for interruption handling)
  const interruptPlayback = useCallback(() => {
    isSpeakingRef.current = false;
    if (currentAudioSourceRef.current) {
      try {
        currentAudioSourceRef.current.stop();
        currentAudioSourceRef.current.disconnect();
      } catch { /* expected if already stopped */ }
      currentAudioSourceRef.current = null;
    }
  }, []);

  // Server-Side Realtime TTS Audio Playback
  const playServerTTS = useCallback(
    async (text: string): Promise<void> => {
      interruptPlayback();
      lastSpokenTextRef.current = text
        .toLowerCase()
        .replace(/[^a-z0-9]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      try {
        console.log('[TTS] Requesting server-side TTS audio for answer...');
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });

        if (res.ok && res.headers.get('Content-Type')?.includes('audio')) {
          console.log('[TTS] Received binary audio stream from server, decoding...');
          const arrayBuffer = await res.arrayBuffer();
          const audioCtx = await getAudioContext();
          const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

          const source = audioCtx.createBufferSource();
          source.buffer = audioBuffer;

          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 64;
          source.connect(analyser);
          analyser.connect(audioCtx.destination);
          remoteAnalyserRef.current = analyser;

          currentAudioSourceRef.current = source;
          isSpeakingRef.current = true;
          setState('speaking');

          return new Promise<void>((resolve) => {
            source.onended = () => {
              console.log('[AUDIO] TTS playback completed');
              isSpeakingRef.current = false;
              remoteAnalyserRef.current = null;
              currentAudioSourceRef.current = null;
              if (isCallActiveRef.current) {
                setState('listening');
              }
              resolve();
            };

            source.start(0);
            console.log('[AUDIO] TTS audio playback started through Web Audio API');
          });
        } else {
          console.log('[TTS] Server TTS unavailable, answer displayed in transcript.');
          isSpeakingRef.current = false;
          if (isCallActiveRef.current) {
            setState('listening');
          }
        }
      } catch (err) {
        console.warn('[TTS] Server TTS notice:', err);
        isSpeakingRef.current = false;
        if (isCallActiveRef.current) {
          setState('listening');
        }
      }
    },
    [getAudioContext, interruptPlayback]
  );

  // Core RAG & LLM Message Handler
  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      // Prevent acoustic feedback echo of assistant's words or refusal phrases
      if (isAcousticEcho(trimmed, lastSpokenTextRef.current)) {
        console.log('[AUDIO] Ignored acoustic feedback echo from speaker:', trimmed);
        return;
      }

      // Debounce identical rapid queries within 2.5 seconds to prevent retry loops
      const now = Date.now();
      const normalizedQuery = trimmed.toLowerCase();
      if (
        lastQueryRef.current.text === normalizedQuery &&
        now - lastQueryRef.current.time < 2500
      ) {
        console.log('[QUERY] Debounced rapid duplicate query:', trimmed);
        return;
      }
      lastQueryRef.current = { text: normalizedQuery, time: now };

      interruptPlayback();

      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        sender: 'user',
        text: trimmed,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages((prev) => [...prev, userMsg]);
      setInterimTranscript('');
      setState('thinking');

      try {
        const historyPayload = messages.slice(-8).map((m) => ({
          role: m.sender,
          content: m.text,
          citedChunkIds: m.citations?.map((c) => c.source_id),
        }));

        console.log(`[QUERY] Sending inquiry to grounded RAG pipeline: "${trimmed}"`);
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: trimmed,
            history: historyPayload,
          }),
        });

        const data = await res.json();
        console.log(`[LLM] Grounded response received with ${data.citations?.length || 0} citations`);

        const assistantMsg: ChatMessage = {
          id: `ai-${Date.now()}`,
          sender: 'assistant',
          text: data.answer || "I'm having trouble retrieving verified profile data.",
          citations: data.citations || [],
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };

        setMessages((prev) => [...prev, assistantMsg]);

        // Attempt server-side TTS audio playback if call is active
        if (isCallActiveRef.current) {
          await playServerTTS(assistantMsg.text);
        } else {
          setState('idle');
        }
      } catch (err: unknown) {
        console.error('[Chat Error]', err);
        setErrorMessage('Failed to receive grounded answer.');
        if (isCallActiveRef.current) {
          setState('listening');
        }
      }
    },
    [messages, playServerTTS, interruptPlayback]
  );

  // Continuous Speech Recognition setup with resilient restart loop
  const startSpeechRecognition = useCallback(() => {
    if (typeof window === 'undefined') return;

    const SpeechRecognitionCtor = (
      (window as unknown as Record<string, unknown>).SpeechRecognition ||
      (window as unknown as Record<string, unknown>).webkitSpeechRecognition
    ) as (new () => WebSpeechRecognition) | undefined;

    if (!SpeechRecognitionCtor) {
      console.warn('[STT] Web Speech API not supported in this browser.');
      return;
    }

    try {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch { /* expected if already stopped */ }
      }

      const recognition = new SpeechRecognitionCtor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        console.log('[STT] Speech recognition actively listening to microphone...');
        if (isCallActiveRef.current && !isSpeakingRef.current) {
          setState('listening');
        }
      };

      recognition.onresult = (event) => {
        // If assistant is currently speaking via TTS audio, ignore mic pickup to prevent loop
        if (isSpeakingRef.current) {
          return;
        }

        let currentInterim = '';
        let finalUtterance = '';

        for (let i = 0; i < event.results.length; ++i) {
          const res = event.results[i];
          if (res.isFinal) {
            finalUtterance += res[0].transcript + ' ';
          } else {
            currentInterim += res[0].transcript;
          }
        }

        const displayTranscript = (currentInterim || finalUtterance).trim();
        if (displayTranscript) {
          if (isAcousticEcho(displayTranscript, lastSpokenTextRef.current)) {
            return;
          }
          if (isCallActiveRef.current && state === 'speaking') {
            setState('listening');
          }
          setInterimTranscript(displayTranscript);
        }

        if (finalUtterance && finalUtterance.trim().length > 0) {
          const cleanedText = finalUtterance.trim();
          if (isAcousticEcho(cleanedText, lastSpokenTextRef.current)) {
            console.log('[STT] Filtered out speaker echo utterance:', cleanedText);
            setInterimTranscript('');
            return;
          }

          console.log(`[STT] Speech finalized: "${cleanedText}"`);
          setInterimTranscript('');
          interruptPlayback();

          // Restart recognition cleanly for next turn
          try {
            recognition.stop();
          } catch { /* expected */ }

          sendMessage(cleanedText);
        }
      };

      recognition.onerror = (e) => {
        if (e.error !== 'no-speech' && e.error !== 'aborted') {
          console.warn('[STT] Recognition event notice:', e.error);
        }
      };

      recognition.onend = () => {
        // Automatically restart speech recognition while call is active
        if (isCallActiveRef.current) {
          setTimeout(() => {
            if (isCallActiveRef.current) {
              try {
                recognition.start();
              } catch { /* expected */ }
            }
          }, 200);
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      console.warn('[STT] Speech recognition start error:', err);
    }
  }, [sendMessage, interruptPlayback, state]);

  // Connects Call: Connects LiveKit Room + Continuous Real-time Speech Recognition
  const startCall = async () => {
    try {
      isCallActiveRef.current = true;
      setState('connecting');
      setErrorMessage(null);

      // Unlock AudioContext for browser autoplay policy
      await getAudioContext();

      // 1. Request microphone permission
      let stream: MediaStream | null = null;
      try {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          mediaStreamRef.current = stream;
          startAudioAnalysis(stream);
        }
      } catch (micErr: unknown) {
        console.warn('[Microphone Permission Notice]', micErr);
        // Continue voice mode so user can interact and hear responses
      }

      // 2. Start Realtime Voice Recognition
      try {
        startSpeechRecognition();
      } catch (sttErr) {
        console.warn('[STT Notice]', sttErr);
      }

      // 3. Request LiveKit token from backend
      let tokenData: { token?: string; url?: string; roomName?: string; participantName?: string; mode?: string } = {};
      try {
        const res = await fetch('/api/livekit/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        if (res.ok) {
          tokenData = await res.json().catch(() => ({}));
        }
      } catch (tokenErr) {
        console.warn('[LiveKit Token Fetch Error]', tokenErr);
      }

      // 4. Connect to LiveKit Room if credentials available
      if (tokenData.token && tokenData.url) {
        try {
          const room = new Room({
            adaptiveStream: true,
            dynacast: true,
          });

          room.on(RoomEvent.Connected, () => {
            console.log('[LIVEKIT] Connected to LiveKit Room:', room.name);
            setState('listening');
          });

          room.on(RoomEvent.Disconnected, () => {
            console.log('[LIVEKIT] Disconnected from LiveKit Room');
          });

          // Remote Track Subscription (Plays the LiveKit Agent TTS Audio Track if agent is in room)
          room.on(
            RoomEvent.TrackSubscribed,
            (track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
              console.log(`[AUDIO] Remote track subscribed from participant ${participant.identity} (kind: ${track.kind})`);
              if (track.kind === Track.Kind.Audio) {
                const audioElement = track.attach();
                audioElement.id = `remote-audio-${participant.identity}`;
                audioElement.autoplay = true;
                audioElementsRef.current.push(audioElement);
                document.body.appendChild(audioElement);

                if (track.mediaStreamTrack) {
                  const remoteStream = new MediaStream([track.mediaStreamTrack]);
                  startRemoteAudioAnalysis(remoteStream);
                }
              }
            }
          );

          room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
            console.log('[AUDIO] Remote track unsubscribed');
            track.detach().forEach((el) => el.remove());
          });

          // Active Speaker Events
          room.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
            const isAgentSpeaking = speakers.some((p) => p !== room.localParticipant);
            if (isAgentSpeaking) {
              isSpeakingRef.current = true;
              setState('speaking');
            } else if (state === 'speaking') {
              isSpeakingRef.current = false;
              setState('listening');
            }
          });

          // Data Channel Transcripts & Citations published by LiveKit Agent
          room.on(RoomEvent.DataReceived, (payload: Uint8Array) => {
            try {
              const str = new TextDecoder().decode(payload);
              const parsed = JSON.parse(str);
              if (parsed.type === 'transcript_and_citation') {
                console.log('[DATA] Received transcript and citation payload from LiveKit Agent');
                setMessages((prev) => [
                  ...prev,
                  {
                    id: `livekit-${Date.now()}`,
                    sender: 'assistant',
                    text: parsed.answer || parsed.query,
                    citations: parsed.citations,
                    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                  },
                ]);
              }
            } catch (e) {
              console.warn('[LiveKit Data Decode Error]', e);
            }
          });

          await room.connect(tokenData.url, tokenData.token);
          await room.localParticipant.setMicrophoneEnabled(true);
          roomRef.current = room;
        } catch (livekitErr) {
          console.warn('[LiveKit Room Connection Notice]', livekitErr);
        }
      }

      setState('listening');
    } catch (err: unknown) {
      console.error('[Start Call Error]', err);
      isCallActiveRef.current = false;
      setErrorMessage('Could not initialize voice session. Please try again.');
      setState('error');
      stopAudioAnalysis();
    }
  };

  const endCall = () => {
    isCallActiveRef.current = false;
    interruptPlayback();
    if (roomRef.current) {
      roomRef.current.disconnect();
      roomRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch { /* expected */ }
      recognitionRef.current = null;
    }
    audioElementsRef.current.forEach((el) => el.remove());
    audioElementsRef.current = [];

    stopAudioAnalysis();
    setState('ended');
    setInterimTranscript('');
  };

  const resetSession = () => {
    endCall();
    setMessages([]);
    setErrorMessage(null);
    setState('idle');
  };

  const toggleMute = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);

    if (roomRef.current?.localParticipant) {
      roomRef.current.localParticipant.setMicrophoneEnabled(!nextMuted);
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = !nextMuted;
      });
    }
  };

  const openCitation = (c: CitationItem) => {
    setActiveCitation(c);
    setIsDrawerOpen(true);
  };

  const closeCitation = () => {
    setIsDrawerOpen(false);
  };

  return {
    state,
    messages,
    interimTranscript,
    audioLevel,
    isMuted,
    activeCitation,
    isDrawerOpen,
    errorMessage,
    startCall,
    endCall,
    resetSession,
    toggleMute,
    sendMessage,
    interruptPlayback,
    openCitation,
    closeCitation,
  };
}
