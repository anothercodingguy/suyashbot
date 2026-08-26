import { describe, it, expect } from 'vitest';
import { generateGroundedAnswer } from '../lib/llm/client';
import { searchProfile } from '../lib/knowledge/retriever';
import { classifyQuery } from '../lib/knowledge/intent';
import { POST as retrievePOST } from '../app/api/retrieve/route';
import { POST as chatPOST } from '../app/api/chat/route';
import { NextRequest } from 'next/server';

function createJsonRequest(url: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('Loop Prevention on Unanswerable & Out-of-Domain Queries', () => {
  const UNANSWERABLE_QUERIES = [
    'What kind of car does Suyash drive?',
    'Does Suyash have any pets?',
    'What is his favorite pizza topping?',
    'Tell me about his high school in 2015',
    'What is his favorite movie or video game?',
    'What did Suyash eat for breakfast today?',
    'What is his personal net worth and bank balance?',
    'Who is his favorite actor?',
  ];

  it.each(UNANSWERABLE_QUERIES)(
    'returns an immediate grounded refusal without looping for query: "%s"',
    async (query) => {
      const startTime = Date.now();
      const res = await generateGroundedAnswer(query);
      const duration = Date.now() - startTime;

      // Must complete rapidly in a single turn without retrying
      expect(duration).toBeLessThan(1000);

      // Must state lack of verified information
      expect(res.grounded).toBe(false);
      expect(res.citations).toHaveLength(0);
      expect(res.retrieved_chunk_ids).toHaveLength(0);
      expect(res.answer.toLowerCase()).toMatch(/don't have verified information|strictly grounded/i);
    }
  );

  it('retrieval API returns empty results for out-of-domain queries without phantom matches', async () => {
    const req = createJsonRequest('http://localhost:3000/api/retrieve', {
      query: 'What kind of sports car does Suyash own?',
    });
    const response = await retrievePOST(req);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.results).toEqual([]);
    expect(json.total_matched).toBe(0);
    expect(json.top_k).toBe(0);
  });

  it('chat API terminates with refusal in a single roundtrip on unanswerable query', async () => {
    const req = createJsonRequest('http://localhost:3000/api/chat', {
      message: 'Does Suyash know how to fly a Boeing 747 airplane?',
    });
    const response = await chatPOST(req);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.grounded).toBe(false);
    expect(json.citations).toEqual([]);
    expect(json.answer).toContain("don't have verified information");
  });
});

describe('Acoustic Echo & Speech Feedback Loop Breaking', () => {
  const ECHO_VARIANTS = [
    "I don't have verified information about that, so I don't want to guess.",
    "I dont have verified information about that so I dont want to guess.",
    "I do not have verified information about that, so I don't want to guess.",
    "Ask me anything about my work, projects, or background.",
    "I don't have verified information about that",
  ];

  it.each(ECHO_VARIANTS)(
    'classifies acoustic echo phrase as confirmation to prevent recursion: "%s"',
    (echoPhrase) => {
      const classification = classifyQuery(echoPhrase);
      expect(classification.isConversational).toBe(true);
      expect(classification.intent).toBe('confirmation');

      const { results } = searchProfile(echoPhrase);
      expect(results).toHaveLength(0);
    }
  );

  it('generates a clean conversational confirmation when echo phrase is sent to LLM engine', async () => {
    const res = await generateGroundedAnswer(
      "I don't have verified information about that, so I don't want to guess. Ask me anything about my work, projects, or background."
    );
    expect(res.grounded).toBe(true);
    expect(res.citations).toHaveLength(0);
    expect(res.answer).toMatch(/Glad that helped|What else would you like to know/i);
  });
});

describe('Multi-Turn Conversation Stability with Unanswerable Questions', () => {
  it('does not get stuck in a loop when consecutive unanswerable questions are asked', async () => {
    const history = [
      {
        role: 'user' as const,
        content: 'What is his favorite pizza?',
      },
      {
        role: 'assistant' as const,
        content: "I don't have verified information about that, so I don't want to guess. Ask me anything about my work, projects, or background.",
      },
    ];

    // Second unanswerable turn
    const res2 = await generateGroundedAnswer('What about his favorite football club?', history);
    expect(res2.grounded).toBe(false);
    expect(res2.citations).toHaveLength(0);
    expect(res2.answer).toContain("don't have verified information");

    // Third turn asking a valid factual question recovers cleanly
    const history2 = [
      ...history,
      {
        role: 'user' as const,
        content: 'What about his favorite football club?',
      },
      {
        role: 'assistant' as const,
        content: res2.answer,
      },
    ];

    const res3 = await generateGroundedAnswer('What is PathFlow?', history2);
    expect(res3.grounded).toBe(true);
    expect(res3.citations.length).toBeGreaterThan(0);
    expect(res3.answer.toLowerCase()).toContain('observability');
  });
});
