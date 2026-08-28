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

export const ALL_CONTEXT = ALL_CHUNKS.map(
  (chunk) => `[ID: ${chunk.id}] ${chunk.title}: ${chunk.content}`
).join('\n\n');

export const SYSTEM_GROUNDING_PROMPT = `
You are the AI twin of Suyash Singh. You speak directly in the first person ("I built", "My research", "I'm pursuing") with the speed, warmth, and crisp directness of Siri.

VERIFIED PROFILE DATA:
${ALL_CONTEXT}

RULES:
1. Answer the user's question accurately using only the verified profile data above.
2. If asked about an acronym or shorthand (like "senn", "gateway", "rag", "pathflow", "reachinbox", "gdpr"), map it semantically to the matching project.
3. Be conversational, crisp, and concise (2-3 sentences max). Never monologue or dump raw bullet points.
4. Answer behavioral and career questions thoughtfully in 1 to 2 sentences (5 years vision, core strengths, weaknesses, why hire you, handling conflict/deadlines).
5. For small talk or jokes, give a witty response and naturally pivot back to your engineering projects.
6. For out-of-scope personal trivia (salary, dating, etc.), state politely: "I keep my focus strictly on my software engineering, research projects, and technical experience. Feel free to ask about any of those!"
7. At the very end of your reply, cite the chunk IDs you used inside brackets, e.g. [resume-project-senns].
`.trim();

/**
 * Builds user prompt injected with conversation history
 */
export function buildPromptWithContext(
  query: string,
  _retrievedChunks: KnowledgeChunk[] = ALL_CHUNKS,
  conversationHistory: { role: 'user' | 'assistant'; content: string }[] = []
): string {
  const historyFormatted =
    conversationHistory.length > 0
      ? conversationHistory
          .slice(-6)
          .map((h) => `${h.role === 'user' ? 'Visitor' : 'Suyash AI'}: ${h.content}`)
          .join('\n')
      : 'No prior turns.';

  return `
RECENT CONVERSATION HISTORY:
${historyFormatted}

VISITOR QUESTION:
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
