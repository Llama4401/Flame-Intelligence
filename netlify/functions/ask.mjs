// FLAME INTELLIGENCE: server-side AI helper.
// The website sends a question here; this file adds your secret API keys and asks the AI.
// Keys live in Netlify's settings, never in the website code, so visitors cannot see them.
// Order: Gemini first (if GEMINI_API_KEY is set), then Groq as the backup (if GROQ_API_KEY is set).
// Set AI_PROVIDER to "groq" to try Groq first, or "anthropic" to use Claude.

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const TOTAL_MS = 25000; // Netlify stops a function at about 30 seconds.

// Groq's free plan allows only a few thousand tokens per minute, so send it fewer records.
function shorten(prompt, keep) {
  const start = prompt.indexOf("EVIDENCE RECORDS");
  const end = prompt.indexOf("\n\nCONVERSATION");
  if (start < 0 || end < 0) return prompt.slice(0, 14000);
  const lines = prompt.slice(start, end).split("\n");
  return prompt.slice(0, start) + lines.slice(0, keep + 1).join("\n") + prompt.slice(end);
}

async function askGemini(prompt, apiKey, deadline) {
  const models = [...new Set([process.env.AI_MODEL, "gemini-3.8-flash", "gemini-flash-latest"].filter(Boolean))];
  let error = "No Gemini model could be reached.", status = 502;
  for (const m of models) {
    const left = deadline - Date.now();
    if (left < 3000) break;
    let r;
    try {
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 4000, thinkingConfig: { thinkingLevel: "low" } },
        }),
        signal: AbortSignal.timeout(left),
      });
    } catch (e) { error = `Google did not answer in time (model ${m}).`; status = 504; continue; }
    const data = await r.json().catch(() => ({}));
    if (r.ok) {
      const text = ((data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [])
        .filter((p) => !p.thought).map((p) => p.text || "").join("");
      if (text.trim()) return { text };
      error = "Gemini returned an empty answer."; continue;
    }
    error = (data.error && data.error.message) || `Gemini error ${r.status}`;
    status = r.status === 429 ? 429 : 502;
    const modelProblem = r.status === 404 || /no longer available|not found|not supported|deprecated|thinking/i.test(error);
    if (!modelProblem) break;
  }
  return { error, status };
}

async function askGroq(prompt, apiKey, deadline) {
  const models = [...new Set([process.env.GROQ_MODEL, "meta-llama/llama-4-scout-17b-16e-instruct", "openai/gpt-oss-120b", "llama-3.3-70b-versatile"].filter(Boolean))];
  const short = shorten(prompt, 12);
  let error = "No Groq model could be reached.", status = 502;
  for (const m of models) {
    const left = deadline - Date.now();
    if (left < 2000) break;
    let r;
    try {
      r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model: m, messages: [{ role: "user", content: short }], max_tokens: 1200, temperature: 0.2 }),
        signal: AbortSignal.timeout(left),
      });
    } catch (e) { error = `Groq did not answer in time (model ${m}).`; status = 504; continue; }
    const data = await r.json().catch(() => ({}));
    if (r.ok) {
      const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "";
      if (text.trim()) return { text };
      error = "Groq returned an empty answer."; continue;
    }
    error = (data.error && data.error.message) || `Groq error ${r.status}`;
    status = r.status === 429 ? 429 : 502;
    // A wrong key fails the same way on every model, so stop. Anything else: try the next model.
    if (r.status === 401 || r.status === 403) break;
  }
  return { error, status };
}

async function askClaude(prompt, apiKey, deadline) {
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: process.env.AI_MODEL || "claude-sonnet-5-5", max_tokens: 900, messages: [{ role: "user", content: prompt }] }),
      signal: AbortSignal.timeout(Math.max(deadline - Date.now(), 1000)),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return { error: (data.error && data.error.message) || `Claude error ${r.status}`, status: r.status === 429 ? 429 : 502 };
    const text = (data.content || []).map((b) => b.text || "").join("");
    return text.trim() ? { text } : { error: "Claude returned an empty answer.", status: 502 };
  } catch (e) { return { error: "Claude did not answer in time.", status: 504 }; }
}

export default async (req) => {
  const first = (process.env.AI_PROVIDER || "gemini").toLowerCase();
  const keys = { gemini: process.env.GEMINI_API_KEY, groq: process.env.GROQ_API_KEY, anthropic: process.env.ANTHROPIC_API_KEY };
  // The chosen provider goes first; the others with a key follow as backups.
  const order = [first, "gemini", "groq", "anthropic"].filter((p, i, a) => keys[p] && a.indexOf(p) === i);

  // The page calls this once on load to find out whether AI is switched on.
  if (req.method === "GET") return json({ ok: true, provider: order[0] || first, backups: order.slice(1), configured: order.length > 0 });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  if (!order.length) return json({ error: "No API key found in Netlify settings (GEMINI_API_KEY or GROQ_API_KEY)." }, 500);

  // Optional: only answer requests that come from your own site.
  const allowed = process.env.ALLOWED_ORIGIN;
  const origin = req.headers.get("origin") || "";
  if (allowed && origin && origin !== allowed) return json({ error: "Origin not allowed." }, 403);

  let body;
  try { body = await req.json(); } catch { return json({ error: "Request was not valid JSON." }, 400); }
  const prompt = String((body && body.prompt) || "");
  if (!prompt || prompt.length > 80000) return json({ error: "Prompt is missing or too long." }, 400);

  const end = Date.now() + TOTAL_MS;
  const errors = [];
  let status = 502;
  for (let i = 0; i < order.length; i++) {
    const p = order[i];
    // Leave time for the backups: a provider with backups behind it gets at most 12 seconds.
    const deadline = i < order.length - 1 ? Math.min(end, Date.now() + 12000) : end;
    const fn = p === "groq" ? askGroq : p === "anthropic" ? askClaude : askGemini;
    const out = await fn(prompt, keys[p], deadline).catch(() => ({ error: `Could not reach ${p}.`, status: 502 }));
    if (out.text) return json({ text: out.text, provider: p });
    errors.push(`${p}: ${out.error}`);
    status = out.status || 502;
    if (end - Date.now() < 2000) break;
  }
  return json({ error: errors.join(" | ") }, order.length > 1 ? 502 : status);
};
