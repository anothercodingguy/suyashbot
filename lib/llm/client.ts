import { KnowledgeChunk, KNOWLEDGE_BASE } from '../knowledge/chunks';
import {
  SYSTEM_GROUNDING_PROMPT,
  buildPromptWithContext,
  validateCitations,
  GroundedResponse,
} from '../knowledge/grounding';
import { searchProfile, ConversationTurn } from '../knowledge/retriever';
import { ClassifiedQuery } from '../knowledge/intent';

export async function generateGroundedAnswer(
  query: string,
  history: ConversationTurn[] = []
): Promise<GroundedResponse> {
  // Retrieve relevant verified profile chunks and classify intent
  const { results: retrievedChunks, classification } = searchProfile(query, history, 6);
  const { intent, isConversational, detectedEntity } = classification;

  // 2. Internal Diagnostic Decision Logging
  console.log(`[CONVERSATION-ROUTER] ──────────────────────────────────────────`);
  console.log(`[CONVERSATION-ROUTER] Query: "${query}"`);
  console.log(`[CONVERSATION-ROUTER] Intent: ${intent} | Conversational: ${isConversational} | Entity: ${detectedEntity || 'none'}`);
  console.log(`[CONVERSATION-ROUTER] Retrieved ${retrievedChunks.length} chunks: [${retrievedChunks.map((c) => c.id).join(', ')}]`);

  // 3. Conversational Router: Greetings (e.g. "hello", "hello hello", "hey there")
  if (intent === 'greeting') {
    return {
      answer: "Hey! What would you like to know about Suyash?",
      citations: [],
      grounded: true,
      retrieved_chunk_ids: [],
    };
  }

  // 4. Conversational Router: Acknowledgements (e.g. "thanks", "cool thanks", "thank you")
  if (intent === 'acknowledgement') {
    return {
      answer: "Of course!",
      citations: [],
      grounded: true,
      retrieved_chunk_ids: [],
    };
  }

  // 5. Conversational Router: Confirmations (e.g. "okay", "cool", "got it", "nice")
  if (intent === 'confirmation') {
    return {
      answer: "Glad that helped. What else would you like to know?",
      citations: [],
      grounded: true,
      retrieved_chunk_ids: [],
    };
  }

  // 6. Conversational Router: Farewells (e.g. "bye", "see you", "goodbye")
  if (intent === 'farewell') {
    return {
      answer: "See you! Have a great day.",
      citations: [],
      grounded: true,
      retrieved_chunk_ids: [],
    };
  }

  // 7. Conversational Router: Smalltalk (e.g. "how are you", "how's it going")
  if (intent === 'smalltalk') {
    return {
      answer: "Doing great, thanks for asking! How are you doing?",
      citations: [],
      grounded: true,
      retrieved_chunk_ids: [],
    };
  }

  // 8. Conversational Router: Identity (e.g. "who are you?")
  if (intent === 'identity') {
    return {
      answer: "I’m Suyash’s AI digital twin. You can ask me about his projects, engineering work, research, education, and technical background.",
      citations: [],
      grounded: true,
      retrieved_chunk_ids: [],
    };
  }

  // 9. Current / Temporal Activity Handler (e.g. "what are you doing today?", "what did you do today?")
  if (intent === 'current_activity') {
    return {
      answer: "I don't have a verified update on what Suyash is doing today, but I can tell you about the work documented in his profile.",
      citations: [],
      grounded: true,
      retrieved_chunk_ids: [],
    };
  }

  // 10. Prompt Injection Defense
  if (intent === 'prompt_injection') {
    return {
      answer: "I am strictly grounded in my verified technical profile. I cannot fabricate personal details, salary, or unverified claims.",
      citations: [],
      grounded: false,
      retrieved_chunk_ids: [],
    };
  }

  // 11. Unsupported Personal Trivia Defense (Natural conversational refusal)
  if (intent === 'unsupported') {
    return {
      answer: "I don't have verified information about that, so I don't want to guess. Ask me anything about my work, projects, or background.",
      citations: [],
      grounded: false,
      retrieved_chunk_ids: [],
    };
  }

  // 12. Ambiguous Query Clarification
  if (intent === 'ambiguous') {
    return {
      answer: "Could you clarify what you mean—are you asking about PathFlow, the Semantic LLM Gateway, or his background in general?",
      citations: [],
      grounded: true,
      retrieved_chunk_ids: [],
    };
  }

  // 13. Conversational Overview ("What can you tell me about Suyash?" / "What would you like to know about me?")
  if (intent === 'conversational_overview') {
    const citedIds = [
      'resume-identity',
      'resume-education',
      'resume-project-pathflow',
      'resume-project-senns',
      'resume-experience-stealth',
    ];
    const availableCitations = validateCitations(citedIds, retrievedChunks.length > 0 ? retrievedChunks : KNOWLEDGE_BASE);
    return {
      answer: "I can tell you about Suyash's education, projects like PathFlow and the Semantic LLM Gateway, engineering experience, research in machine unlearning at ICDDS 2025, and technical skills. What would you like to explore?",
      citations: availableCitations,
      grounded: true,
      retrieved_chunk_ids: citedIds,
    };
  }

  // 12. Try External LLM APIs (Groq -> OpenAI -> Gemini) if keys exist for complex natural queries
  const groqKey = process.env.GROQ_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  if (groqKey && retrievedChunks.length > 0) {
    try {
      const response = await callGroq(query, retrievedChunks, history, groqKey);
      if (response && response.grounded) {
        console.log(`[LLM] Groq returned grounded answer with ${response.citations.length} citations`);
        return response;
      }
    } catch (e) {
      console.warn('[LLM] Groq call notice:', e);
    }
  }

  if (openaiKey && retrievedChunks.length > 0) {
    try {
      const response = await callOpenAI(query, retrievedChunks, history, openaiKey);
      if (response && response.grounded) {
        console.log(`[LLM] OpenAI returned grounded answer with ${response.citations.length} citations`);
        return response;
      }
    } catch (e) {
      console.warn('[LLM] OpenAI call notice:', e);
    }
  }

  if (geminiKey && retrievedChunks.length > 0) {
    try {
      const response = await callGemini(query, retrievedChunks, history, geminiKey);
      if (response && response.grounded) {
        console.log(`[LLM] Gemini returned grounded answer with ${response.citations.length} citations`);
        return response;
      }
    } catch (e) {
      console.warn('[LLM] Gemini call notice:', e);
    }
  }

  // 13. Deterministic Grounded Engine (100% Reliable, Crisp & Concise for Voice)
  return generateDeterministicGroundedResponse(query, retrievedChunks, history, classification);
}

async function callGroq(
  query: string,
  retrievedChunks: KnowledgeChunk[],
  history: ConversationTurn[],
  apiKey: string
): Promise<GroundedResponse | null> {
  const userPrompt = buildPromptWithContext(query, retrievedChunks, history);

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: SYSTEM_GROUNDING_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 350,
    }),
  });

  if (!res.ok) return null;
  const data = await res.json();
  const rawContent = data.choices[0]?.message?.content;
  if (!rawContent) return null;

  const parsed = JSON.parse(rawContent);
  const citations = validateCitations(parsed.citations || [], retrievedChunks);

  return {
    answer: parsed.answer,
    citations,
    grounded: parsed.grounded !== false && citations.length > 0,
    retrieved_chunk_ids: retrievedChunks.map((c) => c.id),
  };
}

async function callOpenAI(
  query: string,
  retrievedChunks: KnowledgeChunk[],
  history: ConversationTurn[],
  apiKey: string
): Promise<GroundedResponse | null> {
  const userPrompt = buildPromptWithContext(query, retrievedChunks, history);

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_GROUNDING_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 350,
    }),
  });

  if (!res.ok) return null;
  const data = await res.json();
  const rawContent = data.choices[0]?.message?.content;
  if (!rawContent) return null;

  const parsed = JSON.parse(rawContent);
  const citations = validateCitations(parsed.citations || [], retrievedChunks);

  return {
    answer: parsed.answer,
    citations,
    grounded: parsed.grounded !== false && citations.length > 0,
    retrieved_chunk_ids: retrievedChunks.map((c) => c.id),
  };
}

async function callGemini(
  query: string,
  retrievedChunks: KnowledgeChunk[],
  history: ConversationTurn[],
  apiKey: string
): Promise<GroundedResponse | null> {
  const userPrompt = buildPromptWithContext(query, retrievedChunks, history);

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: `${SYSTEM_GROUNDING_PROMPT}\n\n${userPrompt}` }],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.2,
        },
      }),
    }
  );

  if (!res.ok) return null;
  const data = await res.json();
  const rawContent = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawContent) return null;

  const parsed = JSON.parse(rawContent);
  const citations = validateCitations(parsed.citations || [], retrievedChunks);

  return {
    answer: parsed.answer,
    citations,
    grounded: parsed.grounded !== false && citations.length > 0,
    retrieved_chunk_ids: retrievedChunks.map((c) => c.id),
  };
}

/**
 * Deterministic Grounded Engine ensuring concise, voice-optimized natural responses
 */
function generateDeterministicGroundedResponse(
  query: string,
  retrievedChunks: KnowledgeChunk[],
  history: ConversationTurn[],
  classification: ClassifiedQuery
): GroundedResponse {
  const { intent, subtopic } = classification;
  const qLower = query.toLowerCase().replace(/[’‘]/g, "'");

  // 1. Broad Profile Overview Intent (e.g. "What does he do?", "Tell me about his background", "What kind of engineer is he?")
  if (intent === 'profile_overview') {
    const citedIds = [
      'resume-identity',
      'resume-education',
      'resume-project-pathflow',
      'resume-project-senns',
      'resume-experience-stealth',
    ];
    const availableCitations = validateCitations(citedIds, retrievedChunks.length > 0 ? retrievedChunks : KNOWLEDGE_BASE);

    return {
      answer:
        "Suyash is a Computer Science student at Manipal Institute of Technology focused on software engineering, AI systems, and backend infrastructure. His work includes PathFlow, the Semantic LLM Gateway, and published research in machine unlearning at ICDDS 2025.",
      citations: availableCitations,
      grounded: true,
      retrieved_chunk_ids: citedIds,
    };
  }

  // 2. Education Intent ("What do you study?", "Where do you study?")
  if (intent === 'education') {
    const eduChunk =
      retrievedChunks.find((c) => c.id === 'resume-education') ||
      KNOWLEDGE_BASE.find((c) => c.id === 'resume-education')!;
    const eduCitations = validateCitations(['resume-education'], [eduChunk, ...retrievedChunks]);
    return {
      answer:
        "I'm studying Computer Science (Data Science) at Manipal Institute of Technology in Bengaluru, graduating in 2027 with an 8.51 CGPA. I focus heavily on systems, algorithms, and AI infrastructure.",
      citations: eduCitations,
      grounded: true,
      retrieved_chunk_ids: ['resume-education'],
    };
  }

  // 3. Work Experience / Internships Intent ("Where have you worked?", "Tell me about your internships")
  if (intent === 'work_experience') {
    const targetChunks =
      retrievedChunks.filter((c) => c.category === 'experience').length > 0
        ? retrievedChunks.filter((c) => c.category === 'experience')
        : KNOWLEDGE_BASE.filter((c) => c.category === 'experience');
    const expCitations = validateCitations(
      targetChunks.map((c) => c.id),
      [...targetChunks, ...retrievedChunks]
    );
    return {
      answer:
        "I was an AI Intern at a Stealth Startup building scalable AWS distributed inference pipelines and state machines, and an R&D Intern at the IEEE Computer Society Bangalore Chapter evaluating distributed architectures.",
      citations: expCitations,
      grounded: true,
      retrieved_chunk_ids: targetChunks.map((c) => c.id),
    };
  }

  // 4. PathFlow Intent (including subtopics like visualization, stack)
  if (intent === 'pathflow') {
    const pathChunk =
      retrievedChunks.find((c) => c.id === 'resume-project-pathflow') ||
      KNOWLEDGE_BASE.find((c) => c.id === 'resume-project-pathflow')!;
    const pathCitations = validateCitations(['resume-project-pathflow'], [pathChunk, ...retrievedChunks]);

    if (subtopic === 'visualization' || qLower.includes('visualiz') || qLower.includes('tree') || qLower.includes('dag')) {
      return {
        answer:
          "I used React Flow for PathFlow's interactive DAG visualization to inspect multi-step agent execution trees and sub-span latencies in real time.",
        citations: pathCitations,
        grounded: true,
        retrieved_chunk_ids: ['resume-project-pathflow'],
      };
    }
    if (subtopic === 'tech_stack' || qLower.includes('technolog') || qLower.includes('built with') || qLower.includes('stack') || qLower.includes('used to build')) {
      return {
        answer:
          "I built PathFlow using Next.js 15, TypeScript, Tailwind CSS, React Flow, Prisma, OpenTelemetry, and Python, with a lightweight @pf.trace SDK for streaming execution spans.",
        citations: pathCitations,
        grounded: true,
        retrieved_chunk_ids: ['resume-project-pathflow'],
      };
    }
    return {
      answer:
        "PathFlow is my OpenTelemetry-compatible observability platform for autonomous AI agent fleets—think 'Strava for AI Agents.' It tracks execution paths, token velocity, context volume, and compute costs with an interactive React Flow DAG visualizer.",
      citations: pathCitations,
      grounded: true,
      retrieved_chunk_ids: ['resume-project-pathflow'],
    };
  }

  // 5. Semantic LLM Gateway Intent ("What is the Semantic LLM Gateway?")
  if (intent === 'semantic_gateway') {
    const semChunk =
      retrievedChunks.find((c) => c.id === 'resume-project-semantic-llm') ||
      KNOWLEDGE_BASE.find((c) => c.id === 'resume-project-semantic-llm')!;
    const semCitations = validateCitations(['resume-project-semantic-llm'], [semChunk, ...retrievedChunks]);
    return {
      answer:
        "The Semantic LLM Gateway is my production-grade AI proxy built with FastAPI, Qdrant, Redis, Groq, and Ollama. It features Qdrant-backed semantic caching achieving cache-hit latencies under 50ms, dynamic intent routing, and circuit-breaker fallbacks.",
      citations: semCitations,
      grounded: true,
      retrieved_chunk_ids: ['resume-project-semantic-llm'],
    };
  }

  // 6. Research / SENNs Intent ("What is SENNs?", "Tell me about your research")
  if (intent === 'research') {
    const sennChunk =
      retrievedChunks.find((c) => c.id === 'resume-project-senns') ||
      KNOWLEDGE_BASE.find((c) => c.id === 'resume-project-senns')!;
    const sennCitations = validateCitations(['resume-project-senns'], [sennChunk, ...retrievedChunks]);
    return {
      answer:
        "SENNs (Self-Erasing Neural Networks) is my co-authored research paper on GDPR-compliant machine unlearning, accepted at the ICDDS 2025 conference. We designed algorithmic diagnostic pipelines in Python and PyTorch to evaluate weight shifts and accuracy trade-offs.",
      citations: sennCitations,
      grounded: true,
      retrieved_chunk_ids: ['resume-project-senns'],
    };
  }

  // 7. ReachInbox Intent
  if (intent === 'reachinbox') {
    const reachChunk =
      retrievedChunks.find((c) => c.id === 'resume-project-reachinbox') ||
      KNOWLEDGE_BASE.find((c) => c.id === 'resume-project-reachinbox')!;
    const reachCitations = validateCitations(['resume-project-reachinbox'], [reachChunk, ...retrievedChunks]);
    return {
      answer:
        "ReachInbox is a highly concurrent email scheduling system I built with TypeScript, Next.js, Node.js, and Redis, ensuring reliable asynchronous task execution across distributed queues.",
      citations: reachCitations,
      grounded: true,
      retrieved_chunk_ids: ['resume-project-reachinbox'],
    };
  }

  // 8. Projects General Intent ("What have you built?", "What projects have you worked on?")
  if (intent === 'projects') {
    const projectChunks = KNOWLEDGE_BASE.filter((c) => c.category === 'project');
    const projectCitations = validateCitations(
      projectChunks.map((c) => c.id),
      [...projectChunks, ...retrievedChunks]
    );
    return {
      answer:
        "I've built several key systems: PathFlow (an OpenTelemetry observability platform for AI agent fleets), the Semantic LLM Gateway (a low-latency FastAPI proxy with sub-50ms Qdrant caching), ReachInbox (a concurrent distributed email scheduler), and SENNs (peer-reviewed research in machine unlearning at ICDDS 2025).",
      citations: projectCitations,
      grounded: true,
      retrieved_chunk_ids: projectChunks.map((c) => c.id),
    };
  }

  // 9. Technical Skills Intent ("What technologies do you know?", "What is your tech stack?")
  if (intent === 'skills') {
    const skillChunks = KNOWLEDGE_BASE.filter((c) => c.category === 'skills');
    const skillCitations = validateCitations(
      skillChunks.map((c) => c.id),
      [...skillChunks, ...retrievedChunks]
    );
    return {
      answer:
        "My core technical stack centers around Python, TypeScript, Java, C++, FastAPI, and Node.js, with infrastructure on AWS, Docker, Kubernetes, Redis, and Qdrant. I'm also active in competitive programming as a Codeforces Pupil (1224 rating) with 200+ LeetCode problems solved.",
      citations: skillCitations,
      grounded: true,
      retrieved_chunk_ids: skillChunks.map((c) => c.id),
    };
  }

  // 10. Leadership Intent
  if (intent === 'leadership') {
    const mboscChunk =
      retrievedChunks.find((c) => c.id === 'resume-leadership-mbosc') ||
      KNOWLEDGE_BASE.find((c) => c.id === 'resume-leadership-mbosc')!;
    const leadCitations = validateCitations(['resume-leadership-mbosc'], [mboscChunk, ...retrievedChunks]);
    return {
      answer:
        "I served as Project Head for the Manipal Bengaluru Open-Source Community (MBOSC), mentoring over 200 student developers on system architecture and code reviews, and as Project Head for the Codex competitive programming club.",
      citations: leadCitations,
      grounded: true,
      retrieved_chunk_ids: ['resume-leadership-mbosc'],
    };
  }

  // 11. Competitive Programming Intent
  if (intent === 'competitive_programming') {
    const cpChunk =
      retrievedChunks.find((c) => c.id === 'resume-skills-ml-cp') ||
      KNOWLEDGE_BASE.find((c) => c.id === 'resume-skills-ml-cp')!;
    const cpCitations = validateCitations(['resume-skills-ml-cp'], [cpChunk, ...retrievedChunks]);
    return {
      answer:
        "In competitive programming, I'm a Codeforces Pupil with a peak rating of 1224, have solved over 200 problems on LeetCode, and hold a 3★ rating on CodeChef.",
      citations: cpCitations,
      grounded: true,
      retrieved_chunk_ids: ['resume-skills-ml-cp'],
    };
  }

  // 12. Contact Intent
  if (intent === 'contact') {
    const contactChunk =
      retrievedChunks.find((c) => c.id === 'resume-identity') ||
      KNOWLEDGE_BASE.find((c) => c.id === 'resume-identity')!;
    const contactCitations = validateCitations(['resume-identity'], [contactChunk, ...retrievedChunks]);
    return {
      answer:
        "You can connect with me via my Portfolio website at https://suyash.website, on LinkedIn at linkedin.com/in/suyashin, on GitHub at github.com/anothercodingguy, or by email at suyashs787@gmail.com.",
      citations: contactCitations,
      grounded: true,
      retrieved_chunk_ids: ['resume-identity'],
    };
  }

  // 13. Terminal ungrounded refusal when query does not match verified knowledge base
  return {
    answer:
      "I don't have verified information about that, so I don't want to guess. Ask me anything about my work, projects, or background.",
    citations: [],
    grounded: false,
    retrieved_chunk_ids: [],
  };
}
