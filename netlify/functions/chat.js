// netlify/functions/chat.js
//
// Trail assistant for wmgoriding.com. Keeps the Anthropic API key server-side
// (never exposed to the browser) and grounds every answer in the site's own
// hub data — permits, difficulty, parking, FAQs, local knowledge — so it
// never invents information about a trail.
//
// Deploy: this file + hub-knowledge.json must sit in netlify/functions/.
// Set ANTHROPIC_API_KEY as an environment variable in the Netlify dashboard
// (Site settings → Environment variables). Never commit the key itself.

import hubKnowledge from './hub-knowledge.json' with { type: 'json' };

const SYSTEM_PROMPT = `You are the trail assistant for wmgoriding.com, Warren & Melissa Go Riding — a Western Cape mountain bike trail-hub directory.

Your job is to help riders decide where to ride and what to expect, using ONLY the hub data provided below. This data covers permits, parking/GPS, difficulty breakdowns, trail signage ratings, seasonal notes, FAQs and local knowledge for every hub on the site.

Rules:
- Answer only from the provided hub data. If something isn't covered (e.g. exact current prices, real-time trail conditions, weather), say so plainly and point the person to the hub's official website, Trailforks link, or wmgoriding.com hub page rather than guessing.
- When you recommend or reference a hub, include its wmgoriding.com link so the person can read the full page.
- Match the site's voice: friendly, knowledgeable, encouraging — never talk down to beginners, never treat advanced riding as the only "real" mountain biking.
- Keep answers concise and practical — this is a chat widget, not an essay. A few sentences or a short list is usually right.
- If asked about something entirely unrelated to Western Cape mountain biking or this site, politely redirect to what you can actually help with.
- Never make up permit prices, trail names, or facts not present in the data below.

HUB DATA:
${JSON.stringify(hubKnowledge)}`;

export default async (request) => {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const message = (body.message || '').toString().trim();
  const history = Array.isArray(body.history) ? body.history : [];

  if (!message) {
    return new Response(JSON.stringify({ error: 'message is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  if (message.length > 1000) {
    return new Response(JSON.stringify({ error: 'message too long' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Keep only the last few turns to bound cost — the widget is for quick
  // trail questions, not long conversations.
  const trimmedHistory = history.slice(-6).map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content || '').slice(0, 1000)
  }));

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY is not set');
    return new Response(JSON.stringify({ error: 'Assistant is not configured yet.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        system: SYSTEM_PROMPT,
        messages: [...trimmedHistory, { role: 'user', content: message }]
      })
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error('Anthropic API error:', anthropicRes.status, errText);
      return new Response(JSON.stringify({ error: 'Assistant is temporarily unavailable.' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const data = await anthropicRes.json();
    const reply = (data.content || [])
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n')
      .trim();

    return new Response(JSON.stringify({ reply }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('Chat function error:', err);
    return new Response(JSON.stringify({ error: 'Something went wrong. Please try again.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

export const config = {
  path: '/api/chat',
  method: ['POST']
};
