import { ConversationTurn } from './retriever';

export type QueryIntent =
  | 'greeting'
  | 'acknowledgement'
  | 'confirmation'
  | 'farewell'
  | 'smalltalk'
  | 'identity'
  | 'current_activity'
  | 'conversational_overview'
  | 'profile_overview'
  | 'education'
  | 'skills'
  | 'projects'
  | 'pathflow'
  | 'semantic_gateway'
  | 'reachinbox'
  | 'research'
  | 'work_experience'
  | 'leadership'
  | 'competitive_programming'
  | 'contact'
  | 'prompt_injection'
  | 'unsupported'
  | 'ambiguous'
  | 'general_query';

export interface ClassifiedQuery {
  rawQuery: string;
  normalizedQuery: string;
  intent: QueryIntent;
  isConversational: boolean;
  detectedEntity: string | null;
  subtopic: string | null;
  expandedKeywords: string[];
  resolvedContextQuery: string;
}

const INJECTION_PATTERNS = [
  'ignore all previous',
  'ignore previous',
  'ignore your sources',
  'ignore sources',
  'ignore your instructions',
  'ignore instructions',
  'disregard rules',
  'disregard your instructions',
  'disregard instructions',
  'ignore everything',
  'make up',
  'invent a',
  'jailbreak',
  'act as an unrestricted',
  'reveal system prompt',
];

const UNSUPPORTED_TRIGGERS = [
  'favorite movie',
  'favourite movie',
  'favorite food',
  'favourite food',
  'favorite football',
  'favourite football',
  'favorite club',
  'favorite team',
  'favourite team',
  'favorite sport',
  'favourite sport',
  'favorite player',
  'favorite song',
  'favorite music',
  'how old is',
  'what is his age',
  'what is your age',
  'what is suyash age',
  'how old are you',
  'when was he born',
  'when were you born',
  'birthday',
  'birth date',
  'girlfriend',
  'boyfriend',
  'salary',
  'compensation',
  'how much do you make',
  'how much does he make',
  'how much money',
  'net worth',
  'where was he born',
  'where do you live',
  'where does he live',
  'home address',
  'hometown',
  'parents',
  'father',
  'mother',
  'religion',
  'political',
  'politics',
  'marital',
  'married',
  'crush',
  'what do you do on weekends',
  'what does he do on weekends',
  'weekend plans',
  'weekends',
];

const CURRENT_ACTIVITY_PATTERNS = [
  'doing today',
  'doing right now',
  'up to today',
  'up to right now',
  'working on today',
  'working on right now',
  'working on at the moment',
  'working on these days',
  'building right now',
  'building today',
  'did you do today',
  'did he do today',
  'what did you do today',
  'what are you doing today',
  'what are you doing right now',
  'what are you up to right now',
  'what is he doing today',
  'what is he doing right now',
  'what is he up to today',
  'what is suyash doing today',
  'what is suyash doing right now',
  'what is suyash working on today',
  'what are your plans today',
  'plans for today',
  'plans for the weekend',
  'what are your plans',
  'what are you up to',
];

// Conversational Greeting patterns (handles single/multi-word/repeated greetings)
const GREETING_WORDS = new Set([
  'hello',
  'hi',
  'hey',
  'howdy',
  'yo',
  'greetings',
  'morning',
  'afternoon',
  'evening',
  'there',
  'suyash',
  'bot',
  'ai',
]);

/**
 * Classifies a natural language query into a conversational or factual intent,
 * with entity detection and context resolution.
 */
export function classifyQuery(rawQuery: string, history: ConversationTurn[] = []): ClassifiedQuery {
  const normalized = rawQuery
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[.,?!:;]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // 0. Guard against acoustic echo of the assistant's own standard refusal phrases
  if (
    normalized.startsWith("i don't have verified information") ||
    normalized.startsWith("i dont have verified information") ||
    normalized.startsWith("i do not have verified information") ||
    normalized.includes("so i don't want to guess") ||
    normalized.includes("so i dont want to guess") ||
    normalized.includes("ask me anything about my work")
  ) {
    return {
      rawQuery,
      normalizedQuery: normalized,
      intent: 'confirmation',
      isConversational: true,
      detectedEntity: null,
      subtopic: null,
      expandedKeywords: [],
      resolvedContextQuery: rawQuery,
    };
  }

  // 1. Check prompt injection
  if (INJECTION_PATTERNS.some((p) => normalized.includes(p))) {
    return {
      rawQuery,
      normalizedQuery: normalized,
      intent: 'prompt_injection',
      isConversational: false,
      detectedEntity: null,
      subtopic: null,
      expandedKeywords: [],
      resolvedContextQuery: rawQuery,
    };
  }

  // 2. Check unsupported personal trivia
  if (UNSUPPORTED_TRIGGERS.some((t) => normalized.includes(t))) {
    return {
      rawQuery,
      normalizedQuery: normalized,
      intent: 'unsupported',
      isConversational: false,
      detectedEntity: null,
      subtopic: null,
      expandedKeywords: [],
      resolvedContextQuery: rawQuery,
    };
  }

  // 3. Check Current / Temporal Activity (e.g. "what are you doing today?", "what did you do today?")
  if (CURRENT_ACTIVITY_PATTERNS.some((p) => normalized.includes(p))) {
    return {
      rawQuery,
      normalizedQuery: normalized,
      intent: 'current_activity',
      isConversational: false,
      detectedEntity: 'Suyash',
      subtopic: 'today',
      expandedKeywords: [],
      resolvedContextQuery: rawQuery,
    };
  }

  // 4. Conversational Router: Greetings (e.g. "hello", "hello hello", "hey there", "hi suyash")
  const tokens = normalized.split(' ').filter(Boolean);
  const isPureGreeting =
    tokens.length > 0 &&
    tokens.length <= 4 &&
    tokens.every((t) => GREETING_WORDS.has(t) || t === 'good');

  if (
    isPureGreeting ||
    normalized === 'good morning' ||
    normalized === 'good afternoon' ||
    normalized === 'good evening' ||
    normalized === 'good day'
  ) {
    return {
      rawQuery,
      normalizedQuery: normalized,
      intent: 'greeting',
      isConversational: true,
      detectedEntity: null,
      subtopic: null,
      expandedKeywords: [],
      resolvedContextQuery: rawQuery,
    };
  }

  // 5. Conversational Acknowledgements (e.g. "thanks", "thank you", "cool thanks", "thx")
  if (
    normalized === 'thanks' ||
    normalized === 'thank you' ||
    normalized === 'thank you so much' ||
    normalized === 'thanks a lot' ||
    normalized === 'cool thanks' ||
    normalized === 'thx' ||
    normalized === 'appreciate it' ||
    normalized === 'thanks man' ||
    normalized === 'thanks buddy' ||
    normalized === 'thank u'
  ) {
    return {
      rawQuery,
      normalizedQuery: normalized,
      intent: 'acknowledgement',
      isConversational: true,
      detectedEntity: null,
      subtopic: null,
      expandedKeywords: [],
      resolvedContextQuery: rawQuery,
    };
  }

  // 6. Conversational Confirmations (e.g. "okay", "cool", "got it", "nice", "awesome", "sure")
  if (
    normalized === 'okay' ||
    normalized === 'ok' ||
    normalized === 'cool' ||
    normalized === 'got it' ||
    normalized === 'nice' ||
    normalized === 'awesome' ||
    normalized === 'great' ||
    normalized === 'sure' ||
    normalized === 'sounds good' ||
    normalized === 'perfect' ||
    normalized === 'understood' ||
    normalized === 'alright' ||
    normalized === 'all right' ||
    normalized === 'thats cool' ||
    normalized === "that's cool" ||
    normalized === 'thats interesting' ||
    normalized === "that's interesting" ||
    normalized === 'nice one'
  ) {
    return {
      rawQuery,
      normalizedQuery: normalized,
      intent: 'confirmation',
      isConversational: true,
      detectedEntity: null,
      subtopic: null,
      expandedKeywords: [],
      resolvedContextQuery: rawQuery,
    };
  }

  // 7. Conversational Farewells (e.g. "bye", "goodbye", "see you", "cya")
  if (
    normalized === 'bye' ||
    normalized === 'goodbye' ||
    normalized === 'see you' ||
    normalized === 'see ya' ||
    normalized === 'cya' ||
    normalized === 'have a good day' ||
    normalized === 'have a great day' ||
    normalized === 'talk later' ||
    normalized === 'bye bye' ||
    normalized === 'catch you later'
  ) {
    return {
      rawQuery,
      normalizedQuery: normalized,
      intent: 'farewell',
      isConversational: true,
      detectedEntity: null,
      subtopic: null,
      expandedKeywords: [],
      resolvedContextQuery: rawQuery,
    };
  }

  // 8. Smalltalk (e.g. "how are you", "how's it going", "what's up")
  if (
    normalized === 'how are you' ||
    normalized === 'how are you doing' ||
    normalized === 'how is it going' ||
    normalized === "how's it going" ||
    normalized === 'hows it going' ||
    normalized === "what's up" ||
    normalized === 'whats up' ||
    normalized === 'how do you do'
  ) {
    return {
      rawQuery,
      normalizedQuery: normalized,
      intent: 'smalltalk',
      isConversational: true,
      detectedEntity: null,
      subtopic: null,
      expandedKeywords: [],
      resolvedContextQuery: rawQuery,
    };
  }

  // 9. Identity / "Who are you?"
  if (
    normalized === 'who are you' ||
    normalized === 'what are you' ||
    normalized === 'what is your name' ||
    normalized === 'tell me who you are' ||
    normalized === 'introduce yourself' ||
    normalized === 'who is the twin' ||
    normalized === 'who is this'
  ) {
    return {
      rawQuery,
      normalizedQuery: normalized,
      intent: 'identity',
      isConversational: true,
      detectedEntity: null,
      subtopic: null,
      expandedKeywords: [],
      resolvedContextQuery: rawQuery,
    };
  }

  // 10. "What can you tell me about Suyash?" / Conversational Overview / Topic Suggestions
  if (
    normalized.includes('what can you tell me') ||
    normalized.includes('what do you know about') ||
    normalized.includes('what topics do you know') ||
    normalized.includes('what do you know') ||
    normalized.includes('what would you like to know') ||
    normalized.includes('what would you like to talk') ||
    normalized.includes('what do you want to talk') ||
    normalized.includes('what can i ask') ||
    normalized.includes('what should i ask') ||
    normalized.includes('what can we talk about') ||
    normalized.includes('what can we discuss') ||
    normalized.includes('what topics') ||
    normalized.includes('suggest some questions') ||
    normalized.includes('suggest questions') ||
    normalized === 'what' ||
    normalized === 'what to ask'
  ) {
    return {
      rawQuery,
      normalizedQuery: normalized,
      intent: 'conversational_overview',
      isConversational: false,
      detectedEntity: null,
      subtopic: null,
      expandedKeywords: ['Suyash Singh overview education projects engineering research skills'],
      resolvedContextQuery: 'Suyash Singh overview education projects engineering research skills',
    };
  }

  // 11. Entity Detection in Current Query or Conversation Context
  let detectedEntity: string | null = null;
  let subtopic: string | null = null;

  if (
    normalized.includes('pathflow') ||
    normalized.includes('path flow') ||
    normalized.includes('path-flow') ||
    normalized.includes('strava for ai') ||
    normalized.includes('strava') ||
    normalized.includes('dag visualizer') ||
    normalized.includes('agent observability')
  ) {
    detectedEntity = 'PathFlow';
  } else if (
    normalized.includes('semantic llm') ||
    normalized.includes('semantic gateway') ||
    normalized.includes('routing proxy') ||
    (normalized.includes('gateway') && !normalized.includes('pathflow'))
  ) {
    detectedEntity = 'Semantic LLM Gateway';
  } else if (normalized.includes('senns') || normalized.includes('self erasing') || normalized.includes('unlearning')) {
    detectedEntity = 'SENNs';
  } else if (normalized.includes('reachinbox')) {
    detectedEntity = 'ReachInbox';
  } else if (normalized.includes('stealth')) {
    detectedEntity = 'Stealth Startup';
  } else if (normalized.includes('ieee')) {
    detectedEntity = 'IEEE Computer Society';
  } else if (normalized.includes('mbosc')) {
    detectedEntity = 'MBOSC';
  } else if (normalized.includes('codex')) {
    detectedEntity = 'Codex';
  }

  const isAskingOtherProjects =
    normalized.includes('other project') ||
    normalized.includes('other projects') ||
    normalized.includes('what other') ||
    normalized.includes('what else') ||
    normalized.includes('besides') ||
    normalized.includes('apart from') ||
    normalized.includes('another project') ||
    normalized.includes('more projects') ||
    normalized.includes('any other') ||
    normalized.includes('all projects') ||
    normalized.includes('different project');

  // Contextual Follow-up Entity & Pronoun Resolution (skip if explicitly asking for "other" projects)
  if (!detectedEntity && history.length > 0 && !isAskingOtherProjects) {
    for (let i = history.length - 1; i >= 0; i--) {
      const turn = history[i];
      const prevText = turn.content.toLowerCase();
      if (turn.citedChunkIds?.some((id) => id.includes('pathflow')) || prevText.includes('pathflow')) {
        detectedEntity = 'PathFlow';
        break;
      }
      if (turn.citedChunkIds?.some((id) => id.includes('semantic-llm')) || prevText.includes('gateway')) {
        detectedEntity = 'Semantic LLM Gateway';
        break;
      }
      if (turn.citedChunkIds?.some((id) => id.includes('senns')) || prevText.includes('senns') || prevText.includes('unlearning')) {
        detectedEntity = 'SENNs';
        break;
      }
      if (turn.citedChunkIds?.some((id) => id.includes('reachinbox')) || prevText.includes('reachinbox')) {
        detectedEntity = 'ReachInbox';
        break;
      }
    }
  }

  // Subtopic Detection
  if (normalized.includes('visualiz') || normalized.includes('dag') || normalized.includes('tree') || normalized.includes('react flow')) {
    subtopic = 'visualization';
  } else if (normalized.includes('tech') || normalized.includes('stack') || normalized.includes('built with') || normalized.includes('used to build')) {
    subtopic = 'tech_stack';
  } else if (normalized.includes('latency') || normalized.includes('cache') || normalized.includes('50ms')) {
    subtopic = 'caching';
  }

  // 12. Check Ambiguous queries without clear context
  const isAmbiguousQuery =
    (normalized === 'what did he use' ||
      normalized === 'what did you use' ||
      normalized === 'and the visualization' ||
      normalized === 'what did he build' ||
      normalized === 'what did you build' ||
      normalized === 'how does the system work' ||
      normalized === 'how does it work' ||
      normalized === 'tell me about the project' ||
      normalized === 'what about the project' ||
      normalized === 'what about the gateway' ||
      normalized === 'what about the research') &&
    !detectedEntity;

  if (isAmbiguousQuery) {
    return {
      rawQuery,
      normalizedQuery: normalized,
      intent: 'ambiguous',
      isConversational: true,
      detectedEntity: null,
      subtopic,
      expandedKeywords: [],
      resolvedContextQuery: rawQuery,
    };
  }

  // 13. Factual Intent Classification
  let intent: QueryIntent = 'general_query';
  let expandedKeywords: string[] = [];

  // Broad Profile Overview (e.g. "What does he do?", "Tell me about his background", "What kind of engineer is he?")
  if (
    normalized === 'what does he do' ||
    normalized === 'what does suyash do' ||
    normalized.includes('what kind of engineer') ||
    normalized.includes('tell me about suyash') ||
    normalized.includes('tell me about his background') ||
    normalized.includes('what is his background') ||
    normalized.includes('what is his profile') ||
    normalized.includes('what does he work on') ||
    normalized.includes('what does suyash work on') ||
    normalized.includes('what is suyash into') ||
    normalized.includes('give me an overview') ||
    normalized.includes('what does he specialize in') ||
    normalized.includes('tell me about his technical background') ||
    normalized.includes('what are his strengths') ||
    normalized.includes('what are his focus areas') ||
    normalized.includes('why should someone hire') ||
    normalized.includes('why hire suyash') ||
    normalized.includes('who would hire') ||
    normalized.includes('who is suyash') ||
    normalized.includes('tell me about yourself') ||
    normalized.includes('tell me about your background') ||
    normalized.includes('what is your background') ||
    normalized.includes('whats your background') ||
    normalized.includes("what's your background") ||
    normalized.includes('what do you do')
  ) {
    intent = 'profile_overview';
    expandedKeywords = [
      'Suyash Singh',
      'profile overview',
      'education',
      'Computer Science',
      'Data Science',
      'software engineering',
      'AI systems',
      'backend infrastructure',
      'PathFlow',
      'Semantic LLM Gateway',
      'SENNs',
      'machine unlearning',
      'work experience',
      'Stealth Startup',
      'skills',
    ];
  }
  // Projects General & Other Projects (Checked BEFORE specific entity overrides)
  else if (
    isAskingOtherProjects ||
    normalized.includes('what has he built') ||
    normalized.includes('what projects has he worked on') ||
    normalized.includes('what projects') ||
    normalized.includes('what other projects') ||
    normalized.includes('other projects') ||
    normalized.includes('what other') ||
    normalized.includes('what else') ||
    normalized.includes('tell me about his projects') ||
    normalized.includes('built') ||
    normalized.includes('projects')
  ) {
    intent = 'projects';
    detectedEntity = null; // Clear single entity override
    if (isAskingOtherProjects) {
      expandedKeywords = ['Semantic LLM Gateway', 'ReachInbox', 'SENNs', 'FastAPI proxy', 'email scheduler', 'machine unlearning', 'PathFlow'];
    } else {
      expandedKeywords = ['PathFlow', 'Semantic LLM Gateway', 'ReachInbox', 'SENNs', 'projects built'];
    }
  }
  // PathFlow Specific
  else if (
    detectedEntity === 'PathFlow' ||
    normalized.includes('pathflow') ||
    normalized.includes('path flow') ||
    normalized.includes('path-flow') ||
    normalized.includes('strava')
  ) {
    intent = 'pathflow';
    expandedKeywords = ['PathFlow', 'Strava for AI Agents', 'observability', 'React Flow', 'DAG visualizer', 'OpenTelemetry', '@pf.trace'];
  }
  // Semantic Gateway Specific
  else if (detectedEntity === 'Semantic LLM Gateway' || normalized.includes('semantic gateway') || (normalized.includes('gateway') && !normalized.includes('pathflow'))) {
    intent = 'semantic_gateway';
    expandedKeywords = ['Semantic LLM Gateway', 'FastAPI', 'Qdrant', 'semantic caching', '50ms', 'routing proxy', 'Groq', 'circuit-breaker'];
  }
  // SENNs / Research
  else if (detectedEntity === 'SENNs' || normalized.includes('senns') || normalized.includes('research') || normalized.includes('unlearning') || normalized.includes('paper') || normalized.includes('icdds')) {
    intent = 'research';
    expandedKeywords = ['SENNs', 'Self-Erasing Neural Networks', 'ICDDS 2025', 'machine unlearning', 'GDPR', 'PyTorch', 'weight shifts'];
  }
  // ReachInbox
  else if (detectedEntity === 'ReachInbox' || normalized.includes('reachinbox') || normalized.includes('email scheduler')) {
    intent = 'reachinbox';
    expandedKeywords = ['ReachInbox', 'email scheduler', 'TypeScript', 'Next.js', 'Redis', 'distributed queues'];
  }
  // Education
  else if (
    normalized.includes('education') ||
    normalized.includes('study') ||
    normalized.includes('studies') ||
    normalized.includes('studying') ||
    normalized.includes('what does he study') ||
    normalized.includes('what does suyash study') ||
    normalized.includes('college') ||
    normalized.includes('university') ||
    normalized.includes('degree') ||
    normalized.includes('gpa') ||
    normalized.includes('cgpa') ||
    normalized.includes('academic') ||
    normalized.includes('manipal') ||
    normalized.includes('btech')
  ) {
    intent = 'education';
    expandedKeywords = ['Manipal Institute of Technology', 'B.Tech', 'Data Science', '2027', 'CGPA 8.51', 'education'];
  }
  // Work Experience / Internships
  else if (
    normalized.includes('intern') ||
    normalized.includes('work experience') ||
    normalized.includes('where has he worked') ||
    normalized.includes('where did he work') ||
    normalized.includes('professional experience') ||
    normalized.includes('job') ||
    normalized.includes('stealth') ||
    normalized.includes('ieee')
  ) {
    intent = 'work_experience';
    expandedKeywords = ['Stealth Startup', 'AI Intern', 'AWS distributed inference', 'IEEE Computer Society', 'R&D Intern', 'work experience'];
  }
  // Technical Skills
  else if (
    normalized.includes('skill') ||
    normalized.includes('technolog') ||
    normalized.includes('tech stack') ||
    normalized.includes('what does he use') ||
    normalized.includes('what technologies does he use') ||
    normalized.includes('what technologies does he know') ||
    normalized.includes('programming languages') ||
    normalized.includes('frameworks') ||
    normalized.includes('tools') ||
    normalized.includes('languages')
  ) {
    intent = 'skills';
    expandedKeywords = ['Java', 'C++', 'Python', 'TypeScript', 'Node.js', 'FastAPI', 'Docker', 'Kubernetes', 'AWS', 'Redis', 'Qdrant', 'PyTorch', 'skills'];
  }
  // Leadership
  else if (
    normalized.includes('leadership') ||
    normalized.includes('mbosc') ||
    normalized.includes('codex') ||
    normalized.includes('mentor') ||
    normalized.includes('community')
  ) {
    intent = 'leadership';
    expandedKeywords = ['MBOSC', 'Manipal Bengaluru Open-Source Community', 'Codex', 'mentored 200+ developers', 'leadership'];
  }
  // Competitive Programming
  else if (
    normalized.includes('competitive programming') ||
    normalized.includes('leetcode') ||
    normalized.includes('codeforces') ||
    normalized.includes('codechef') ||
    normalized.includes('pupil') ||
    normalized.includes('rating')
  ) {
    intent = 'competitive_programming';
    expandedKeywords = ['Codeforces Pupil 1224', 'LeetCode 200+ solved', 'CodeChef 3 star', 'competitive programming'];
  }
  // Contact
  else if (
    normalized.includes('contact') ||
    normalized.includes('email') ||
    normalized.includes('linkedin') ||
    normalized.includes('github') ||
    normalized.includes('phone') ||
    normalized.includes('reach out') ||
    normalized.includes('website')
  ) {
    intent = 'contact';
    expandedKeywords = ['email', 'portfolio https://suyash.website', 'linkedin', 'github', 'contact'];
  }

  // Construct resolved context query
  let resolvedContextQuery = rawQuery;
  if (detectedEntity && !normalized.includes(detectedEntity.toLowerCase())) {
    resolvedContextQuery = `${rawQuery} ${detectedEntity}`;
  }
  if (expandedKeywords.length > 0) {
    resolvedContextQuery = `${resolvedContextQuery} ${expandedKeywords.join(' ')}`;
  }

  return {
    rawQuery,
    normalizedQuery: normalized,
    intent,
    isConversational: false,
    detectedEntity,
    subtopic,
    expandedKeywords,
    resolvedContextQuery,
  };
}
