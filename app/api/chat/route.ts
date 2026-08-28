import { NextRequest, NextResponse } from 'next/server';
import { generateGroundedAnswer } from '@/lib/llm/client';

// Simple in-memory sliding window rate limiter
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 40;
const RATE_LIMIT_CLEANUP_INTERVAL = 5 * 60 * 1000; // Prune stale entries every 5 minutes
let lastCleanupTime = Date.now();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();

  // Periodic cleanup of expired entries to prevent unbounded Map growth
  if (now - lastCleanupTime > RATE_LIMIT_CLEANUP_INTERVAL) {
    for (const [key, entry] of rateLimitMap) {
      if (now > entry.resetTime) rateLimitMap.delete(key);
    }
    lastCleanupTime = now;
  }

  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  if (entry.count >= MAX_REQUESTS_PER_WINDOW) {
    return false;
  }

  entry.count += 1;
  return true;
}

export async function POST(req: NextRequest) {
  const forwarded = req.headers.get('x-forwarded-for') || '';
  const ip = (forwarded.split(',')[0] || '127.0.0.1').trim();

  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please wait a moment before asking another question.' },
      { status: 429 }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    let message = body.message || body.query;
    let history = body.history || body.conversationHistory || [];

    // Support standard OpenAI/Chat completions messages array
    if (!message && Array.isArray(body.messages) && body.messages.length > 0) {
      const lastMsg = body.messages[body.messages.length - 1];
      message = lastMsg.content || lastMsg.text || '';
      history = body.messages.slice(0, -1).map((m: any) => ({
        role: m.role || (m.sender === 'user' ? 'user' : 'assistant'),
        content: m.content || m.text || '',
      }));
    }

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return NextResponse.json({ error: 'Message cannot be empty.' }, { status: 400 });
    }

    if (message.length > 800) {
      return NextResponse.json({ error: 'Message exceeds maximum length of 800 characters.' }, { status: 400 });
    }

    const startTime = Date.now();
    const result = await generateGroundedAnswer(message.trim(), history);
    const latency_ms = Date.now() - startTime;

    return NextResponse.json({
      answer: result.answer,
      citations: result.citations,
      grounded: result.grounded,
      retrieved_chunk_ids: result.retrieved_chunk_ids,
      latency_ms,
    });
  } catch (error) {
    console.error('[Chat API Error]', error);
    return NextResponse.json(
      {
        answer: "I'm having trouble accessing my verified profile information right now, so I don't want to guess.",
        citations: [],
        grounded: false,
        error: 'Failed to process request',
      },
      { status: 500 }
    );
  }
}
