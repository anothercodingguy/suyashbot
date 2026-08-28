'use client';

import React, { useEffect, useRef } from 'react';
import { VoiceState } from './AudioOrb';

interface InteractivePlasmaOrbProps {
  state?: VoiceState;
  audioLevel?: number;
  onClick?: () => void;
  className?: string;
}

export function InteractivePlasmaOrb({
  state = 'idle',
  audioLevel = 0,
  onClick,
  className = '',
}: InteractivePlasmaOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const audioLevelRef = useRef(audioLevel);
  const smoothAudioRef = useRef(0);
  const stateRef = useRef(state);

  useEffect(() => {
    audioLevelRef.current = audioLevel;
  }, [audioLevel]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl', {
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
    });

    if (!gl) {
      console.warn('[WebGL] WebGL not supported on this device');
      return;
    }

    // Vertex Shader
    const vsSource = `
      attribute vec2 a_position;
      varying vec2 v_uv;
      void main() {
        v_uv = a_position * 0.5 + 0.5;
        gl_Position = vec4(a_position, 0.0, 1.0);
      }
    `;

    // Fragment Shader: Apple Siri-style waveform animation
    // Multiple overlapping sinusoidal waves with gaussian envelope, all in blue
    const fsSource = `
      precision highp float;
      varying vec2 v_uv;

      uniform vec2 u_resolution;
      uniform float u_time;
      uniform float u_audio;
      uniform float u_state; // 0=idle, 1=listening, 2=thinking, 3=speaking, 4=connecting

      #define PI 3.14159265359
      #define NUM_WAVES 6

      // Soft gaussian bell curve for the horizontal waveform envelope
      float gaussian(float x, float center, float spread) {
        float d = (x - center) / spread;
        return exp(-0.5 * d * d);
      }

      // Hash for pseudo-random per-wave variation
      float hash(float n) {
        return fract(sin(n) * 43758.5453123);
      }

      void main() {
        vec2 uv = gl_FragCoord.xy / u_resolution.xy;
        // Center coordinates: x in [-aspect, +aspect], y in [-1, 1]
        float aspect = u_resolution.x / u_resolution.y;
        vec2 st = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);

        float audioAmp = clamp(u_audio, 0.0, 1.0);

        // Base idle breathing (subtle sine pulse so it's never fully static)
        float idleBreath = 0.03 + 0.015 * sin(u_time * 1.6);

        // Overall wave amplitude — blends idle breathing with audio reactivity
        float globalAmp = idleBreath + audioAmp * 0.22;

        // Horizontal envelope: gaussian centered at x=0
        // Wider when speaking/listening, tighter when idle
        float envelopeWidth = 0.28 + audioAmp * 0.18;
        float envelope = gaussian(st.x, 0.0, envelopeWidth);

        // Time factor — speed up slightly when speaking
        float t = u_time * (0.8 + audioAmp * 0.6);

        // Accumulate color from layered waves
        vec3 col = vec3(0.0);
        float totalAlpha = 0.0;

        // Blue palette — each wave gets a slightly different blue hue
        // Ranging from deep indigo to bright cyan
        vec3 waveColors[6];
        waveColors[0] = vec3(0.10, 0.40, 1.00); // Royal blue
        waveColors[1] = vec3(0.05, 0.65, 1.00); // Sky blue
        waveColors[2] = vec3(0.15, 0.85, 1.00); // Bright cyan
        waveColors[3] = vec3(0.20, 0.55, 0.95); // Medium blue
        waveColors[4] = vec3(0.08, 0.75, 0.95); // Cyan-blue
        waveColors[5] = vec3(0.55, 0.85, 1.00); // Ice blue / white-blue

        for (int i = 0; i < NUM_WAVES; i++) {
          float fi = float(i);
          float phase = fi * 1.047 + hash(fi) * 6.28; // Spread phases evenly + random offset

          // Each wave has different frequency, amplitude, and speed
          float freq = 4.0 + fi * 1.8 + sin(t * 0.3 + fi) * 0.8;
          float speed = t * (1.2 + fi * 0.35 + hash(fi + 7.0) * 0.4);
          float waveAmp = globalAmp * (1.0 - fi * 0.08); // Slightly smaller for higher harmonics

          // Secondary modulation — audio reactive wobble
          float audioMod = audioAmp * sin(st.x * 12.0 + t * 3.0 + fi * 2.1) * 0.04;

          // The wave function: composite of two sine waves for organic feel
          float wave = sin(st.x * freq * PI + speed + phase) * 0.6
                     + sin(st.x * freq * PI * 1.7 + speed * 1.3 - phase * 0.5) * 0.4;
          wave *= waveAmp * envelope;
          wave += audioMod * envelope;

          // Distance from pixel to this wave's y-position
          float dist = abs(st.y - wave);

          // Wave thickness — thinner for higher harmonics, thicker with audio
          float thickness = 0.006 + audioAmp * 0.004 - fi * 0.0003;

          // Soft glow around the wave line
          float glow = thickness / (dist + 0.001);
          glow = pow(clamp(glow, 0.0, 1.0), 1.8);

          // Inner bright core
          float core = smoothstep(thickness * 1.5, 0.0, dist);

          // Opacity: each successive wave slightly more transparent
          float waveOpacity = (0.65 - fi * 0.06);

          vec3 waveColor = waveColors[i];

          // Add bright white core to make it pop (Siri-like luminous center)
          vec3 coreColor = mix(waveColor, vec3(0.92, 0.97, 1.0), core * 0.7);

          col += coreColor * glow * waveOpacity;
          totalAlpha += glow * waveOpacity;
        }

        // Central glow orb behind the waveform (Siri-style diffuse backlight)
        float orbDist = length(st * vec2(1.0, 1.8)); // Slightly oval
        float orbGlow = 0.08 / (orbDist + 0.15);
        orbGlow *= orbGlow;
        orbGlow *= (0.3 + audioAmp * 0.7);
        vec3 orbColor = vec3(0.08, 0.45, 1.0); // Deep blue center glow
        col += orbColor * orbGlow * 0.4;
        totalAlpha += orbGlow * 0.2;

        // Subtle outer halo bloom
        float halo = gaussian(orbDist, 0.0, 0.25 + audioAmp * 0.15);
        col += vec3(0.05, 0.30, 0.85) * halo * 0.12 * (1.0 + audioAmp);

        // Thinking state: pulsing shimmer overlay
        if (u_state > 1.5 && u_state < 2.5) {
          float pulse = 0.5 + 0.5 * sin(u_time * 4.0);
          col *= 0.7 + 0.3 * pulse;
        }

        // Connecting state: slow breathe
        if (u_state > 3.5) {
          float breathe = 0.6 + 0.4 * sin(u_time * 2.0);
          col *= breathe;
          totalAlpha *= breathe;
        }

        // Clamp and output with premultiplied alpha
        col = clamp(col, 0.0, 1.0);
        totalAlpha = clamp(totalAlpha, 0.0, 1.0);

        // Fade edges to transparent
        float edgeFade = smoothstep(0.5, 0.42, abs(st.x) / aspect)
                       * smoothstep(0.5, 0.35, abs(st.y));
        col *= edgeFade;
        totalAlpha *= edgeFade;

        gl_FragColor = vec4(col * totalAlpha, totalAlpha);
      }
    `;

    const createShader = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('[Shader Error]', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };

    const vertShader = createShader(gl.VERTEX_SHADER, vsSource);
    const fragShader = createShader(gl.FRAGMENT_SHADER, fsSource);

    if (!vertShader || !fragShader) return;

    const program = gl.createProgram();
    if (!program) return;

    gl.attachShader(program, vertShader);
    gl.attachShader(program, fragShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('[Program Link Error]', gl.getProgramInfoLog(program));
      return;
    }

    gl.useProgram(program);

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );

    const positionLocation = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    const resolutionLocation = gl.getUniformLocation(program, 'u_resolution');
    const timeLocation = gl.getUniformLocation(program, 'u_time');
    const audioLocation = gl.getUniformLocation(program, 'u_audio');
    const stateLocation = gl.getUniformLocation(program, 'u_state');

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    let animId: number;
    const startTime = performance.now();

    const resize = () => {
      if (!canvas || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.floor(rect.width * dpr);
      const height = Math.floor(rect.height * dpr);

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
      }
    };

    window.addEventListener('resize', resize);
    resize();

    const render = (time: number) => {
      resize();

      const elapsed = (time - startTime) * 0.001;

      // Smooth interpolation for audio level to avoid abrupt frame-to-frame jumps
      const targetAudio = audioLevelRef.current;
      smoothAudioRef.current += (targetAudio - smoothAudioRef.current) * 0.15;

      let stateNum = 0.0;
      if (stateRef.current === 'listening') stateNum = 1.0;
      else if (stateRef.current === 'thinking') stateNum = 2.0;
      else if (stateRef.current === 'speaking') stateNum = 3.0;
      else if (stateRef.current === 'connecting' || stateRef.current === 'reconnecting') stateNum = 4.0;

      gl.clearColor(0.0, 0.0, 0.0, 0.0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.useProgram(program);
      gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
      gl.uniform1f(timeLocation, elapsed);
      gl.uniform1f(audioLocation, smoothAudioRef.current);
      gl.uniform1f(stateLocation, stateNum);

      gl.drawArrays(gl.TRIANGLES, 0, 6);

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
      gl.deleteProgram(program);
      gl.deleteShader(vertShader);
      gl.deleteShader(fragShader);
      gl.deleteBuffer(positionBuffer);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      onClick={onClick}
      className={`relative w-full h-full flex items-center justify-center cursor-pointer select-none transition-transform duration-300 active:scale-98 ${className}`}
    >
      {/* Background Soft Atmospheric Glow Bloom */}
      <div className="absolute inset-0 bg-radial from-[#1E88E5]/12 via-[#0D47A1]/5 to-transparent blur-3xl pointer-events-none rounded-full" />

      {/* WebGL Siri Waveform Canvas */}
      <canvas
        ref={canvasRef}
        className="w-full h-full max-w-[700px] max-h-[700px] object-contain pointer-events-none"
      />
    </div>
  );
}
