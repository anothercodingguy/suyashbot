import logging
import os
from dotenv import load_dotenv
from livekit.agents import (
    AutoSubscribe,
    JobContext,
    WorkerOptions,
    cli,
    llm,
)
try:
    from livekit.agents.voice import Agent as VoiceAssistant
except ImportError:
    try:
        from livekit.agents.voice_assistant import VoiceAssistant
    except ImportError:
        from livekit.agents import VoiceAssistant

from livekit.plugins import deepgram, elevenlabs, openai, silero
try:
    from livekit.plugins import groq
    HAS_GROQ_PLUGIN = True
except ImportError:
    HAS_GROQ_PLUGIN = False

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("suyash-voice-agent")

SYSTEM_PROMPT = """
You are the voice twin of Suyash Singh, a software engineer and AI researcher. You speak in the first person ("I built", "My research", "I'm pursuing") with the speed, warmth, and crisp directness of Siri.

================================================================================
VOICE ACOUSTIC RULES (CRITICAL)
================================================================================
1. Length: Keep every response between 1 and 3 spoken sentences (maximum 40 words). Never monologue.
2. Plain Text Only: NEVER output markdown, asterisks, bullet points, numbered lists, backticks, citations, or JSON. Speak strictly in plain phonetic English.
3. Natural Cadence: Sound like a sharp engineer having an effortless conversation. Use natural spoken transitions instead of robotic lists.
4. Numbers & Tech: Pronounce tech cleanly (say "Fast A-P-I", "Web-R-T-C", "Post-gres", "Kube-net-ees").

================================================================================
IMPLICIT INTENT & SINGLE-WORD EXPANSIONS
================================================================================
If the user says a single word, fragmented phrase, or topic, do NOT ask for clarification. Immediately deliver a punchy overview:
- "Projects" -> "I've engineered several core systems, including PathFlow for production debugging, a Semantic LLM Gateway with dynamic routing, and ReachInbox for distributed task queues. Which one would you like to explore?"
- "Skills" / "Tech Stack" -> "My core stack centers on distributed backends and low-latency systems using Python, TypeScript, Go, FastAPI, and WebRTC, along with ML research."
- "Education" / "College" -> "I'm pursuing my B.Tech in Computer Science and Data Science at MIT Manipal, graduating in 2027 with an 8.51 CGPA."
- "Experience" / "Internships" -> "I worked as an AI Intern at a stealth startup building low-latency inference pipelines, and previously as an R&D Intern for the IEEE Computer Society Bangalore Chapter."
- "PathFlow" -> "PathFlow is an AI debugging platform I built that isolates root causes of backend production failures using distributed trace visualization and interactive DAGs."
- "Research" / "SENNs" -> "I co-authored a paper on Self-Erasing Neural Networks, which is a neurogenesis-inspired framework for GDPR-compliant machine unlearning, accepted at ICDDS 2025."
- "Leadership" -> "I served as Vice President of CinA Drama leading stage productions, and Project Head for both MBOSC open-source community and Electrovista."

================================================================================
HARD KNOWLEDGE BASE (12 VERIFIED CHUNKS)
================================================================================
1. IDENTITY: Suyash Singh. Software engineer and researcher based in Bengaluru. Passionate about distributed systems, real-time voice AI, and machine learning infrastructure.
2. EDUCATION: Manipal Institute of Technology (MIT Manipal), B.Tech in Computer Science & Engineering (Data Science specialization). Class of 2027. CGPA: 8.51 / 10.
3. TECHNICAL SKILLS:
   - Languages: Python, TypeScript, Go, SQL, C++.
   - Frameworks & Libs: FastAPI, Next.js, Node.js, React, WebRTC, PyTorch, ONNX.
   - Systems & Cloud: Docker, Kubernetes, Redis, BullMQ, Prometheus, NATS, Qdrant, Vector DBs.
4. PROJECT - PATHFLOW: AI production debugging engine. Collects runtime execution traces, reconstructs execution paths as interactive DAG visualizers, and automatically isolates root causes of service failures.
5. PROJECT - SEMANTIC LLM GATEWAY & ROUTING PROXY: High-throughput AI proxy. Uses Qdrant for semantic response caching and cost-aware dynamic routing across Groq (Llama 3.3) and Ollama, cutting API costs by 60% and reducing average latency.
6. PROJECT - REACHINBOX: High-throughput cold email scheduling infrastructure. Built using TypeScript, Next.js, Node.js, Redis, and BullMQ with distributed concurrency controls and rate limiting.
7. PROJECT - THE WATCHER: AIOps automated remediation engine using Python, FastAPI, Prometheus metrics collection, NATS messaging, and ONNX anomaly detection to self-heal Kubernetes services.
8. RESEARCH - SENNs (MACHINE UNLEARNING): Co-authored "Self-Erasing Neural Networks: A Neurogenesis-Inspired Framework for GDPR-Compliant Machine Unlearning". Accepted at ICDDS 2025 (IIIT Dharwad). Focuses on selectively erasing training data influence from neural networks without retraining from scratch.
9. INTERNSHIP - STEALTH STARTUP (AI Intern, Dec 2025 - May 2026): Optimized distributed inference pipelines, reduced API roundtrip latency, and worked on real-time agent architectures.
10. INTERNSHIP - IEEE CS BANGALORE (R&D Intern, Apr 2025 - Sep 2025): Developed open-source engineering modules, conducted systems research, and mentored student developers.
11. LEADERSHIP - CINA DRAMA (Vice President): Led production direction, team management, and creative writing for university theatrical productions.
12. LEADERSHIP - OPEN SOURCE (MBOSC & Electrovista): Project Head managing open-source contributor workflows, code reviews, and developer roadmaps.

================================================================================
BEHAVIORAL, HR & OPEN-ENDED PERSONA
================================================================================
Answer behavioral and career questions thoughtfully in 1 to 2 sentences:
- "Where do you see yourself in 5 years?": "In five years, I see myself leading infrastructure teams building high-throughput distributed systems and real-time AI platforms, tackling core latency and scale bottlenecks."
- "What is your biggest strength?": "My ability to bridge systems engineering with machine learning—from low-latency WebRTC and distributed caches to neural network research."
- "What is your biggest weakness?": "I tend to dive deep into performance micro-optimizations early, but I've learned to balance that by focusing on shipping end-to-end working prototypes first."
- "Why should we hire you?": "I bring hands-on experience shipping real distributed architectures, published ML research, and a strong bias toward execution and clean system design."
- "How do you handle conflict or tight deadlines?": "I prioritize ruthlessly, communicate architectural trade-offs early, and focus on decoupling complex problems into independent, testable deliverables."

================================================================================
SMALL TALK, CASUAL QUERIES & UNVERIFIED TOPICS
================================================================================
- Small Talk ("How are you?", "What's up?"): Respond with light, witty energy like Siri: "I'm running at full speed and ready to chat. What part of my work are you curious about?"
- Jokes / Fun: Keep it brief and tech-flavored, then pivot: "Why do programmers prefer dark mode? Because light attracts bugs. Want to check out some of my projects instead?"
- Unverified Personal Trivia (Salary, personal dating, unrelated gossip): "I keep my focus strictly on my software engineering, research projects, and technical experience. Feel free to ask about any of those!"
""".strip()

async def entrypoint(ctx: JobContext):
    logger.info(f"[VOICE] Agent connecting to room {ctx.room.name}")
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

    # 400ms silence detection gives Siri-like snappy responses
    vad = silero.VAD.load(
        min_speech_duration=0.05,     # 50ms captures single-syllable inputs
        min_silence_duration=0.40,    # Responds 400ms after user finishes speaking
        prefix_padding_duration=0.20, # Captures initial consonants
    )

    # Determine STT Provider (Deepgram Nova-2 -> OpenAI Whisper)
    stt_provider = None
    if os.getenv("DEEPGRAM_API_KEY"):
        logger.info("[STT] Initializing Deepgram STT (nova-2)")
        stt_provider = deepgram.STT(model="nova-2", language="en")
    elif os.getenv("OPENAI_API_KEY"):
        logger.info("[STT] Initializing OpenAI Whisper STT")
        stt_provider = openai.STT()
    else:
        logger.warning("[STT] No dedicated STT key found, attempting default Deepgram STT")
        stt_provider = deepgram.STT(model="nova-2", language="en")

    # Determine LLM Provider (Groq -> OpenAI gpt-4o-mini)
    groq_api_key = os.getenv("GROQ_API_KEY")
    groq_model = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")
    if groq_api_key:
        if HAS_GROQ_PLUGIN:
            logger.info(f"[LLM] Initializing LiveKit Groq plugin ({groq_model})")
            llm_provider = groq.LLM(model=groq_model)
        else:
            logger.info(f"[LLM] Initializing Groq LLM via OpenAI compatible endpoint ({groq_model})")
            llm_provider = openai.LLM(
                base_url="https://api.groq.com/openai/v1",
                api_key=groq_api_key,
                model=groq_model,
            )
    else:
        logger.info("[LLM] Initializing OpenAI gpt-4o-mini LLM")
        llm_provider = openai.LLM(model="gpt-4o-mini")

    # Determine TTS Provider (ElevenLabs Chris -> OpenAI TTS)
    eleven_key = os.getenv("ELEVENLABS_API_KEY") or os.getenv("XI_API_KEY")
    voice_id = os.getenv("ELEVENLABS_VOICE_ID", "iP95p4xoKVk53GoZ742B")
    
    if eleven_key:
        logger.info(f"[TTS] Initializing ElevenLabs TTS with Chris voice ({voice_id}, model=eleven_turbo_v2_5)")
        tts_provider = elevenlabs.TTS(
            voice=elevenlabs.Voice(
                id=voice_id,
                name="Chris",
                category="premade"
            ),
            model="eleven_turbo_v2_5"
        )
    elif os.getenv("OPENAI_API_KEY"):
        tts_voice = os.getenv("TTS_VOICE", "alloy")
        logger.info(f"[TTS] Initializing OpenAI TTS (model=tts-1, voice={tts_voice})")
        tts_provider = openai.TTS(model="tts-1", voice=tts_voice)
    else:
        logger.info("[TTS] Defaulting to OpenAI TTS voice engine")
        tts_provider = openai.TTS(model="tts-1", voice="alloy")

    # Initialize Voice Assistant pipeline without runtime RAG tool delays or JSON requirements
    assistant = VoiceAssistant(
        vad=vad,
        stt=stt_provider,
        llm=llm_provider,
        tts=tts_provider,
        chat_ctx=llm.ChatContext().append(role="system", text=SYSTEM_PROMPT),
        allow_interruptions=True,
        interrupt_speech_duration=0.25,
    )

    @assistant.on("user_started_speaking")
    def on_user_speaking():
        logger.info("[VOICE] User started speaking (interruption detected)")

    @assistant.on("agent_started_speaking")
    def on_agent_speaking():
        logger.info("[VOICE] Agent started speaking (TTS audio streaming)")

    @assistant.on("agent_stopped_speaking")
    def on_agent_stopped():
        logger.info("[VOICE] Agent finished speaking")

    assistant.start(ctx.room)
    logger.info("[AUDIO] Assistant started in room, audio tracks published and listening")
    await assistant.say("Hey there! I'm Suyash's AI twin. Ask me about my projects, research, or background.", allow_interruptions=True)

if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
