import { KNOWLEDGE_BASE, KnowledgeChunk } from './chunks';
import { classifyQuery, ClassifiedQuery } from './intent';

export interface RetrievalResult {
  chunk: KnowledgeChunk;
  score: number;
  matchedTerms: string[];
}

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  citedChunkIds?: string[];
}

export interface SearchProfileReturn {
  results: KnowledgeChunk[];
  allMatches: RetrievalResult[];
  queryUsed: string;
  classification: ClassifiedQuery;
}

// Common entity aliases and context keywords
const ENTITY_ALIASES: Record<string, string[]> = {
  'resume-project-pathflow': [
    'pathflow',
    'path flow',
    'path-flow',
    'path_flow',
    'strava for ai agents',
    'strava for ai',
    'strava',
    'agent observability',
    'observability',
    'execution tree',
    'dag visualizer',
    'dag',
    'visualization',
    'visualizer',
    'react flow',
    'opentelemetry',
    '@pf.trace',
    'benchmarking engine',
    'token velocity',
    'context volume',
  ],
  'resume-project-semantic-llm': [
    'semantic llm gateway',
    'routing proxy',
    'gateway',
    'proxy',
    'semantic caching',
    '50ms',
    'under 50ms',
    'intent routing',
    'circuit breaker',
    'circuit-breaker',
    'groq',
    'ollama',
    'qdrant',
  ],
  'resume-project-senns': [
    'senns',
    'senn',
    'self-erasing neural networks',
    'machine unlearning',
    'unlearning',
    'icdds',
    'icdds 2025',
    'gdpr',
    'research paper',
    'publication',
    'weight shifts',
  ],
  'resume-project-reachinbox': [
    'reachinbox',
    'email scheduler',
    'email scheduling',
    'distributed queues',
  ],
  'resume-experience-stealth': [
    'stealth startup',
    'stealth',
    'ai intern',
    'state machine',
    'inference pipelines',
    'multi-turn session',
  ],
  'resume-experience-ieee': [
    'ieee',
    'ieee computer society',
    'bangalore chapter',
    'r&d intern',
    'distributed nodes',
  ],
  'resume-education': [
    'education',
    'college',
    'university',
    'study',
    'studies',
    'degree',
    'btech',
    'b.tech',
    'manipal',
    'mit',
    'cgpa',
    'gpa',
    'graduation',
    '2027',
  ],
  'resume-skills-fundamentals': [
    'dsa',
    'data structures',
    'algorithms',
    'system design',
    'ood',
    'operating systems',
    'languages',
    'c++',
    'java',
    'python',
    'typescript',
    'javascript',
    'sql',
  ],
  'resume-skills-backend-cloud': [
    'backend',
    'cloud',
    'fastapi',
    'node',
    'express',
    'docker',
    'kubernetes',
    'k8s',
    'nats',
    'keda',
    'aws',
    'gcp',
    'redis',
    'postgres',
    'postgresql',
    'mongodb',
    'qdrant',
    'prometheus',
    'grafana',
    'upstash',
  ],
  'resume-skills-ml-cp': [
    'ml',
    'ai',
    'machine learning',
    'pytorch',
    'competitive programming',
    'leetcode',
    'codeforces',
    'codechef',
    'rating',
    'pupil',
    'solved',
  ],
  'resume-leadership-mbosc': [
    'mbosc',
    'manipal bengaluru open-source',
    'open source',
    'mentored 200+',
    'mentorship',
    'leadership',
  ],
  'resume-leadership-codex': [
    'codex',
    'competitive programming club',
  ],
  'resume-identity': [
    'who is suyash',
    'who is he',
    'tell me about suyash',
    'bio',
    'profile',
    'github',
    'linkedin',
    'email',
    'contact',
    'hire suyash',
    'why hire',
    'strongest technical areas',
    'what does he build',
    'what does he do',
    'what does suyash do',
  ],
};

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9+#.\-_@]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

/**
 * Searches the verified knowledge base and returns ranked chunks based on intent, entities, and keywords
 */
export function searchProfile(
  rawQuery: string,
  history: ConversationTurn[] = [],
  topK: number = 4
): SearchProfileReturn {
  const classification = classifyQuery(rawQuery, history);
  const { intent, detectedEntity, resolvedContextQuery } = classification;
  const qLower = resolvedContextQuery.toLowerCase();
  const queryTokens = tokenize(resolvedContextQuery);

  // 1. Fast path for Conversational Intents (greetings, smalltalk, acknowledgements, farewells, identity, current_activity, unsupported, injections, ambiguous)
  if (
    classification.isConversational ||
    intent === 'current_activity' ||
    intent === 'unsupported' ||
    intent === 'prompt_injection' ||
    intent === 'ambiguous'
  ) {
    return {
      results: [],
      allMatches: [],
      queryUsed: rawQuery,
      classification,
    };
  }

  // 2. Multi-domain Chunks for Broad Profile Overview & "What can you tell me"
  if (intent === 'profile_overview' || intent === 'conversational_overview') {
    const overviewIds = [
      'resume-identity',
      'resume-education',
      'resume-skills-fundamentals',
      'resume-project-pathflow',
      'resume-project-semantic-llm',
      'resume-project-senns',
      'resume-experience-stealth',
    ];

    const results = KNOWLEDGE_BASE.filter((c) => overviewIds.includes(c.id));
    const allMatches: RetrievalResult[] = results.map((c) => ({
      chunk: c,
      score: 100,
      matchedTerms: ['profile_overview', c.category, c.entity],
    }));

    return {
      results,
      allMatches,
      queryUsed: resolvedContextQuery,
      classification,
    };
  }

  // 3. Intent-Specific Multi-Chunk Pre-Filtering
  const scored: RetrievalResult[] = KNOWLEDGE_BASE.map((chunk) => {
    let score = 0;
    const matchedTerms: string[] = [];

    // Direct Intent Alignment Boosts
    switch (intent) {
      case 'education':
        if (chunk.id === 'resume-education') {
          score += 50;
          matchedTerms.push('intent:education');
        }
        break;

      case 'skills':
        if (chunk.category === 'skills') {
          score += 40;
          matchedTerms.push('intent:skills');
        }
        break;

      case 'work_experience':
        if (chunk.category === 'experience') {
          score += 45;
          matchedTerms.push('intent:work_experience');
        }
        break;

      case 'pathflow':
        if (chunk.id === 'resume-project-pathflow') {
          score += 60;
          matchedTerms.push('intent:pathflow');
        }
        break;

      case 'semantic_gateway':
        if (chunk.id === 'resume-project-semantic-llm') {
          score += 60;
          matchedTerms.push('intent:semantic_gateway');
        }
        break;

      case 'research':
        if (chunk.id === 'resume-project-senns') {
          score += 60;
          matchedTerms.push('intent:research');
        }
        break;

      case 'reachinbox':
        if (chunk.id === 'resume-project-reachinbox') {
          score += 60;
          matchedTerms.push('intent:reachinbox');
        }
        break;

      case 'projects':
        if (chunk.category === 'project') {
          score += 35;
          matchedTerms.push('intent:projects');
          const isAskingOther =
            qLower.includes('other') ||
            qLower.includes('else') ||
            qLower.includes('besides') ||
            qLower.includes('more') ||
            qLower.includes('another');
          if (isAskingOther && chunk.id !== 'resume-project-pathflow') {
            score += 25;
            matchedTerms.push('other_projects_boost');
          }
        }
        break;

      case 'leadership':
        if (chunk.category === 'leadership') {
          score += 40;
          matchedTerms.push('intent:leadership');
        }
        break;

      case 'competitive_programming':
        if (chunk.id === 'resume-skills-ml-cp') {
          score += 45;
          matchedTerms.push('intent:competitive_programming');
        }
        break;

      case 'contact':
        if (chunk.id === 'resume-identity') {
          score += 50;
          matchedTerms.push('intent:contact');
        }
        break;
    }

    // Detected Entity Matching
    if (detectedEntity && chunk.entity.toLowerCase().includes(detectedEntity.toLowerCase())) {
      score += 30;
      matchedTerms.push(`entity:${detectedEntity}`);
    }

    // Entity & Alias matching
    const aliases = ENTITY_ALIASES[chunk.id] || [];
    for (const alias of aliases) {
      if (qLower.includes(alias.toLowerCase())) {
        score += 15;
        matchedTerms.push(alias);
      }
    }

    // Keyword exact matching
    for (const kw of chunk.keywords) {
      const kwLower = kw.toLowerCase();
      if (qLower.includes(kwLower)) {
        score += 8;
        matchedTerms.push(kw);
      }
    }

    // Technologies matching
    if (chunk.technologies) {
      for (const tech of chunk.technologies) {
        const tLower = tech.toLowerCase();
        if (qLower.includes(tLower) || queryTokens.includes(tLower)) {
          score += 6;
          matchedTerms.push(tech);
        }
      }
    }

    // Token Overlap Scoring
    const chunkTokens = tokenize(
      `${chunk.title} ${chunk.section} ${chunk.entity} ${chunk.content}`
    );
    const tokenSet = new Set(chunkTokens);

    for (const token of queryTokens) {
      if (tokenSet.has(token)) {
        score += 2;
        matchedTerms.push(token);
      }
    }

    return {
      chunk,
      score,
      matchedTerms: Array.from(new Set(matchedTerms)),
    };
  });

  // Filter by relevance threshold (requires intentional match, not random word overlap)
  const RELEVANCE_THRESHOLD = 5;
  const filtered = scored.filter((item) => item.score >= RELEVANCE_THRESHOLD).sort((a, b) => b.score - a.score);

  if (filtered.length === 0) {
    return {
      results: [],
      allMatches: [],
      queryUsed: resolvedContextQuery,
      classification,
    };
  }

  const topResults = filtered.slice(0, topK);

  return {
    results: topResults.map((item) => item.chunk),
    allMatches: topResults,
    queryUsed: resolvedContextQuery,
    classification,
  };
}
