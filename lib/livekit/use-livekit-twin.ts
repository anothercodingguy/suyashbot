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

  // Interruption handling
  const interruptPlayback = useCallback(() => {
    if (roomRef.current?.localParticipant) {
      // LiveKit VoiceAssistant automatically handles interruption via WebRTC audio stream and Silero VAD
      console.log('[AUDIO] Interruption triggered');
    }
  }, []);

  // Text message handler (for typed queries in transcript drawer)
  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

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

        const assistantMsg: ChatMessage = {
          id: `ai-${Date.now()}`,
          sender: 'assistant',
          text: data.answer || "I'm having trouble retrieving verified profile data.",
          citations: data.citations || [],
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };

        setMessages((prev) => [...prev, assistantMsg]);
      } catch (err: unknown) {
        console.error('[Chat Error]', err);
        setErrorMessage('Failed to receive answer.');
      }
    },
    [messages]
  );

  // Connects Call: Connects LiveKit Room exclusively via WebRTC audio
  const startCall = async () => {
    try {
      isCallActiveRef.current = true;
      setState('connecting');
      setErrorMessage(null);

      // Unlock AudioContext for browser autoplay policy
      await getAudioContext();

      // 1. Request microphone permission for local audio analysis and WebRTC transmission
      let stream: MediaStream | null = null;
      try {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          stream = await navigator.mediaDevices.getUserMedia({
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

      // 2. Request LiveKit token from backend
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

      // 3. Connect to LiveKit WebRTC room
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

          // Remote Track Subscription: LiveKit Agent TTS Audio is streamed directly over WebRTC
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
    interruptPlayback();
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
