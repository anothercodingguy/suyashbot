'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
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
  const isCallActiveRef = useRef<boolean>(false);
  const animFrameRef = useRef<number | null>(null);
  const audioElementsRef = useRef<HTMLMediaElement[]>([]);
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const recognitionRef = useRef<any>(null);
  const isAgentInRoomRef = useRef<boolean>(false);
  const speakingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize or resume the Web Audio Context for audio analysis
  const getAudioContext = useCallback(async (): Promise<AudioContext> => {
    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioContextRef.current = new AudioCtx();
    }
    if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume();
    }
    return audioContextRef.current;
  }, []);

  // Audio Level Analyser Loop for plasma visualizer
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
    if (speakingIntervalRef.current) {
      clearInterval(speakingIntervalRef.current);
      speakingIntervalRef.current = null;
    }
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

  // Simulates organic speech orb pulse when using browser SpeechSynthesis
  const startSpeakingVisualizer = () => {
    if (speakingIntervalRef.current) clearInterval(speakingIntervalRef.current);
    let step = 0;
    speakingIntervalRef.current = setInterval(() => {
      step += 0.2;
      const base = 0.4 + Math.sin(step) * 0.25 + Math.random() * 0.2;
      setAudioLevel(Math.min(1, Math.max(0.1, base)));
    }, 50);
  };

  const stopSpeakingVisualizer = () => {
    if (speakingIntervalRef.current) {
      clearInterval(speakingIntervalRef.current);
      speakingIntervalRef.current = null;
    }
    setAudioLevel(0);
  };

  // Interruption handling
  const interruptPlayback = useCallback(() => {
    console.log('[AUDIO] Interruption triggered');
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    if (activeAudioRef.current) {
      activeAudioRef.current.pause();
      activeAudioRef.current = null;
    }
    stopSpeakingVisualizer();
    if (isCallActiveRef.current) {
      setState('listening');
    }
  }, []);

  // Text-to-Speech Output Handler: Prefers server /api/tts (ElevenLabs/OpenAI), falls back to native Web Speech
  const speakAnswer = useCallback(async (textToSpeak: string) => {
    // If LiveKit agent is in the room and already streaming audio, let agent handle voice
    if (isAgentInRoomRef.current) {
      return;
    }

    // Strip bracketed citations e.g. [resume-project-senns] before speaking
    const cleanText = textToSpeak.replace(/\[(?:resume-[a-zA-Z0-9_-]+|[a-zA-Z0-9_-]+)\]/g, '').trim();
    if (!cleanText) return;

    interruptPlayback();
    setState('speaking');

    // 1. Try server-side TTS (/api/tts -> ElevenLabs Chris or OpenAI)
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: cleanText }),
      });

      if (res.ok && res.headers.get('content-type')?.includes('audio')) {
        const audioBlob = await res.blob();
        if (audioBlob.size > 200) {
          const audioUrl = URL.createObjectURL(audioBlob);
          const audio = new Audio(audioUrl);
          activeAudioRef.current = audio;

          startSpeakingVisualizer();

          audio.onended = () => {
            stopSpeakingVisualizer();
            activeAudioRef.current = null;
            URL.revokeObjectURL(audioUrl);
            if (isCallActiveRef.current) setState('listening');
          };

          audio.onerror = () => {
            stopSpeakingVisualizer();
            activeAudioRef.current = null;
            URL.revokeObjectURL(audioUrl);
            fallbackBrowserSpeech(cleanText);
          };

          await audio.play();
          return;
        }
      }
    } catch (_err) {
      console.warn('[TTS API Notice] Falling back to browser speech synthesis:', _err);
    }

    // 2. Browser Speech Synthesis Fallback (Zero configuration, natural local voice)
    fallbackBrowserSpeech(cleanText);
  }, [interruptPlayback]);

  const fallbackBrowserSpeech = (text: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      if (isCallActiveRef.current) setState('listening');
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.05;
    utterance.pitch = 1.0;

    const voices = window.speechSynthesis.getVoices();
    const preferredVoice = voices.find(
      (v) =>
        v.name.includes('Daniel') ||
        v.name.includes('Google US English') ||
        v.name.includes('Samantha') ||
        v.name.includes('Alex') ||
        (v.lang && v.lang.startsWith('en'))
    );
    if (preferredVoice) utterance.voice = preferredVoice;

    utterance.onstart = () => {
      setState('speaking');
      startSpeakingVisualizer();
    };

    utterance.onend = () => {
      stopSpeakingVisualizer();
      if (isCallActiveRef.current) setState('listening');
    };

    utterance.onerror = () => {
      stopSpeakingVisualizer();
      if (isCallActiveRef.current) setState('listening');
    };

    window.speechSynthesis.speak(utterance);
  };

  // Text message handler (for typed or transcribed queries)
  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      interruptPlayback();

      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        sender: 'user',
        text: trimmed,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages((prev) => [...prev, userMsg]);
      setInterimTranscript('');

      try {
        const historyPayload = messages.slice(-6).map((m) => ({
          role: m.sender,
          content: m.text,
        }));

        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: trimmed,
            history: historyPayload,
          }),
        });

        const data = await res.json();
        const answerText = data.answer || "I'm having trouble retrieving verified profile data.";

        const assistantMsg: ChatMessage = {
          id: `ai-${Date.now()}`,
          sender: 'assistant',
          text: answerText,
          citations: data.citations || [],
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };

        setMessages((prev) => [...prev, assistantMsg]);

        // Speak the answer aloud
        speakAnswer(answerText);
      } catch (err: unknown) {
        console.error('[Chat Error]', err);
        setErrorMessage('Failed to receive answer.');
        if (isCallActiveRef.current) setState('listening');
      }
    },
    [messages, interruptPlayback, speakAnswer]
  );

  // Starts Browser Speech-to-Text Recognition for instant client voice capture
  const startBrowserSTT = useCallback(() => {
    if (typeof window === 'undefined') return;

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('[STT] Browser SpeechRecognition not supported on this browser.');
      return;
    }

    try {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }

      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onresult = (event: any) => {
        // If agent is active over WebRTC, let WebRTC handle
        if (isAgentInRoomRef.current) return;

        let interim = '';
        let finalTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcript;
          } else {
            interim += transcript;
          }
        }

        if (interim) {
          setInterimTranscript(interim);
        }

        if (finalTranscript.trim()) {
          setInterimTranscript('');
          sendMessage(finalTranscript.trim());
        }
      };

      recognition.onerror = (event: any) => {
        if (event.error !== 'no-speech' && event.error !== 'aborted') {
          console.warn('[SpeechRecognition Notice]', event.error);
        }
      };

      recognition.onend = () => {
        if (isCallActiveRef.current && !isMuted) {
          try {
            recognition.start();
          } catch (_e) {}
        }
      };

      recognition.start();
      recognitionRef.current = recognition;
    } catch (e) {
      console.warn('[Speech Recognition Init Warning]', e);
    }
  }, [isMuted, sendMessage]);

  // Connects Call: Connects LiveKit Room and activates browser audio listeners
  const startCall = async () => {
    try {
      isCallActiveRef.current = true;
      setState('connecting');
      setErrorMessage(null);

      // Unlock AudioContext for browser autoplay policy
      await getAudioContext();

      // 1. Request microphone permission for local audio analysis and WebRTC transmission
      try {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          });
          mediaStreamRef.current = stream;
          startAudioAnalysis(stream);
        }
      } catch (micErr: unknown) {
        console.warn('[Microphone Permission Notice]', micErr);
      }

      // 2. Start browser Speech-to-Text listener
      startBrowserSTT();

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

      // 4. Connect to LiveKit WebRTC room
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

          room.on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) => {
            console.log('[LIVEKIT] Participant connected:', p.identity);
            if (p.identity.includes('agent') || p.identity.includes('suyash')) {
              isAgentInRoomRef.current = true;
            }
          });

          room.on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => {
            console.log('[LIVEKIT] Participant disconnected:', p.identity);
            if (p.identity.includes('agent') || p.identity.includes('suyash')) {
              isAgentInRoomRef.current = false;
            }
          });

          // Remote Track Subscription: LiveKit Agent TTS Audio is streamed directly over WebRTC
          room.on(
            RoomEvent.TrackSubscribed,
            (track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
              console.log(`[AUDIO] Remote track subscribed from participant ${participant.identity} (kind: ${track.kind})`);
              isAgentInRoomRef.current = true;
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

          // Active Speaker State Sync
          room.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
            const isAgentSpeaking = speakers.some((p) => p !== room.localParticipant);
            if (isAgentSpeaking) {
              setState('speaking');
            } else if (state === 'speaking') {
              setState('listening');
            }
          });

          // Data Channel Messages for Transcript & Citation Badges
          room.on(RoomEvent.DataReceived, (payload: Uint8Array) => {
            try {
              const str = new TextDecoder().decode(payload);
              const parsed = JSON.parse(str);
              if (parsed.type === 'transcript_and_citation') {
                console.log('[DATA] Received transcript payload from LiveKit Agent');
                setMessages((prev) => [
                  ...prev,
                  {
                    id: `livekit-${Date.now()}`,
                    sender: 'assistant',
                    text: parsed.answer || parsed.query,
                    citations: parsed.citations || [],
                    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                  },
                ]);
              }
            } catch (e) {
              console.warn('[LiveKit Data Decode Notice]', e);
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
    isAgentInRoomRef.current = false;
    interruptPlayback();

    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch (_e) {}
      recognitionRef.current = null;
    }

    if (roomRef.current) {
      roomRef.current.disconnect();
      roomRef.current = null;
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
    if (recognitionRef.current) {
      if (nextMuted) {
        try {
          recognitionRef.current.stop();
        } catch (_e) {}
      } else {
        try {
          recognitionRef.current.start();
        } catch (_e) {}
      }
    }
  };

  const openCitation = (c: CitationItem) => {
    setActiveCitation(c);
    setIsDrawerOpen(true);
  };

  const closeCitation = () => {
    setIsDrawerOpen(false);
  };

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch (_e) {}
      }
    };
  }, []);

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
