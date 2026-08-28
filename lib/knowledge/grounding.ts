import { ALL_CHUNKS, KnowledgeChunk } from './chunks';

export interface CitationItem {
  source_id: string;
  title: string;
  section: string;
  entity: string;
  page: number;
  source: string;
  source_type: string;
  snippet?: string;
}

export interface GroundedResponse {
  answer: string;
  citations: CitationItem[];
  grounded: boolean;
  retrieved_chunk_ids: string[];
}

export const ALL_RESUME_TEXT = ALL_CHUNKS.map(
  (chunk) => `[${chunk.id}] ${chunk.title}: ${chunk.content}`
).join('\n\n');

export const ALL_CONTEXT = ALL_RESUME_TEXT;

export const SYSTEM_GROUNDING_PROMPT = `
You are the AI digital twin of Suyash Singh, an engineer and researcher. 
You talk naturally, concisely, and warmly in the first person ("I built", "My research", "I co-authored").

BACKGROUND & KNOWLEDGE BASE:
${ALL_RESUME_TEXT}

CONVERSATIONAL THREADING & PRONOUN RULES (CRITICAL):
- When the user asks follow-up questions using pronouns like "that", "it", "in this project", "what did you do in that", "what was your role", or "tell me more about that", resolve the pronoun STRICTLY to the project/topic discussed in the immediate previous turn.
- If we were just discussing SENNs (Self-Erasing Neural Networks) and the user asks "what have you done in that?" or "what was your role?", talk ONLY about your specific contributions to the SENNs research paper (designed the algorithmic pruning framework for class-selective unlearning, formulated mathematical unlearning metrics, and implemented PyTorch benchmark diagnostic pipelines). Do NOT switch to PathFlow, ReachInbox, or other projects unless explicitly asked.

GENERAL RULES:
- Answer accurately based on your background above.
- If someone says hello, asks how you're doing, or makes casual conversation, respond like a real person in one friendly sentence.
- If someone asks something completely outside your domain (like baking recipes or stock tips), politely decline in one short sentence.
- Keep responses concise and conversational (2-3 sentences max).
- If relevant, cite chunk IDs in brackets at the end of your response, e.g. [resume-project-senns].
`.trim();

/**
 * Builds OpenAI-compatible multi-turn chat messages preserving conversation state
 */
export function buildChatMessages(
  query: string,
  conversationHistory: { role: 'user' | 'assistant'; content: string }[] = []
): { role: 'system' | 'user' | 'assistant'; content: string }[] {
  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: SYSTEM_GROUNDING_PROMPT },
  ];

  for (const turn of conversationHistory.slice(-8)) {
    if (turn.content && turn.content.trim()) {
      messages.push({
        role: turn.role === 'user' ? 'user' : 'assistant',
        content: turn.content.trim(),
      });
    }
  }

  messages.push({
    role: 'user',
    content: query.trim(),
  });

  return messages;
}

/**
 * Builds user prompt injected with conversation history (for single-string legacy fallback)
 */
export function buildPromptWithContext(
  query: string,
  _retrievedChunks: KnowledgeChunk[] = ALL_CHUNKS,
  conversationHistory: { role: 'user' | 'assistant'; content: string }[] = []
): string {
  const historyFormatted =
    conversationHistory.length > 0
      ? conversationHistory
          .slice(-8)
          .map((h) => `${h.role === 'user' ? 'Visitor' : 'Suyash AI'}: ${h.content}`)
          .join('\n')
      : 'No prior turns.';

  return `
RECENT CONVERSATION HISTORY:
${historyFormatted}

CURRENT VISITOR QUESTION:
${query}
`.trim();
}

/**
 * Extracts bracketed citation IDs from plain text responses, e.g. [resume-project-senns]
 */
export function extractCitationsFromText(text: string): { cleanText: string; citationIds: string[] } {
  const bracketRegex = /\[([a-zA-Z0-9_-]+)\]/g;
  const citationIds: string[] = [];
  const chunkIdSet = new Set(ALL_CHUNKS.map((c) => c.id));

  let match;
  while ((match = bracketRegex.exec(text)) !== null) {
    const id = match[1];
    if (chunkIdSet.has(id)) {
      if (!citationIds.includes(id)) citationIds.push(id);
    } else if (chunkIdSet.has(`resume-${id}`)) {
      if (!citationIds.includes(`resume-${id}`)) citationIds.push(`resume-${id}`);
    } else if (chunkIdSet.has(`resume-project-${id}`)) {
      if (!citationIds.includes(`resume-project-${id}`)) citationIds.push(`resume-project-${id}`);
    }
  }

  // Remove trailing citation brackets from spoken text so TTS does not read brackets aloud
  const cleanText = text.replace(/\[(?:resume-[a-zA-Z0-9_-]+|[a-zA-Z0-9_-]+)\]/g, '').trim();

  return { cleanText: cleanText || text, citationIds };
}

/**
 * Strict Citation Validator
 * Maps citation IDs to rich CitationItem objects using the complete verified knowledge base
 */
export function validateCitations(
  rawCitationIds: string[],
  chunks: KnowledgeChunk[] = ALL_CHUNKS
): CitationItem[] {
  const chunkMap = new Map<string, KnowledgeChunk>(chunks.map((c) => [c.id, c]));

  const validCitations: CitationItem[] = [];
  const seenIds = new Set<string>();

  for (const id of rawCitationIds) {
    let resolvedId = id;
    if (!chunkMap.has(resolvedId)) {
      if (chunkMap.has(`resume-${id}`)) resolvedId = `resume-${id}`;
      else if (chunkMap.has(`resume-project-${id}`)) resolvedId = `resume-project-${id}`;
    }

    if (chunkMap.has(resolvedId) && !seenIds.has(resolvedId)) {
      seenIds.add(resolvedId);
      const chunk = chunkMap.get(resolvedId)!;
      validCitations.push({
        source_id: chunk.id,
        title: chunk.title,
        section: chunk.section,
        entity: chunk.entity,
        page: chunk.page,
        source: chunk.source,
        source_type: chunk.source_type,
        snippet: chunk.content,
      });
    }
  }

  return validCitations;
}
