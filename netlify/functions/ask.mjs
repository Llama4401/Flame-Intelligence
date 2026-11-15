// FLAME INTELLIGENCE: server-side AI helper.
// The website sends a question here; this file adds your secret API key and asks the AI.
// The key lives in Netlify's settings, never in the website code, so visitors cannot see it.

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export default async (req) => {
  const provider = (process.env.AI_PROVIDER || "gemini").toLowerCase();
  const keyName = provider === "anthropic" ? "ANTHROPIC_API_KEY" : "GEMINI_API_KEY";
  const apiKey = process.env[keyName];

  // The page calls this once on load to find out whether AI is switched on.
  if (req.method === "GET") return json({ ok: true, provider, configured: Boolean(apiKey) });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  if (!apiKey) return json({ error: `Missing ${keyName} in Netlify settings.` }, 500);

  // Optional: only answer requests that come from your own site.
  const allowed = process.env.ALLOWED_ORIGIN;
  const origin = req.headers.get("origin") || "";
  if (allowed && origin && origin !== allowed) return json({ error: "Origin not allowed." }, 403);

  let body;
  try { body = await req.json(); } catch { return json({ error: "Request was not valid JSON." }, 400); }
  const prompt = String((body && body.prompt) || "");
  if (!prompt || prompt.length > 80000) return json({ error: "Prompt is missing or too long." }, 400);

  const model = process.env.AI_MODEL || (provider === "anthropic" ? "claude-sonnet-5-5" : "gemini-3.8-flash");

  try {
    let text = "";
    if (provider === "anthropic") {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model, max_tokens: 900, messages: [{ role: "user", content: prompt }] }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return json({ error: (data.error && data.error.message) || `AI provider error ${r.status}` }, r.status === 429 ? 429 : 502);
      text = (data.content || []).map((b) => b.text || "").join("");
    } else {
      // Google retires model names over time. Try the configured one first, then newer names.
      const candidates = [process.env.AI_MODEL, "gemini-3.8-flash", "gemini-flash-latest"].filter(Boolean);
      const tried = [...new Set(candidates)];
      let lastError = "No Gemini model could be reached.";
      let lastStatus = 502;
      for (const m of tried) {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
          method: "POST",
          headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 4000, temperature: 0.2 },
          }),
        });
        const data = await r.json().catch(() => ({}));
        if (r.ok) {
          text = ((data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [])
            .map((p) => p.text || "").join("");
          if (text.trim()) break;
          lastError = "The AI returned an empty answer. Try again.";
          continue;
        }
        lastError = (data.error && data.error.message) || `AI provider error ${r.status}`;
        lastStatus = r.status === 429 ? 429 : 502;
        // Only move on to the next model name when the problem is the model itself.
        const modelProblem = r.status === 404 || /no longer available|not found|not supported|deprecated/i.test(lastError);
        if (!modelProblem) break;
      }
      if (!text.trim()) return json({ error: lastError }, lastStatus);
    }
    if (!text.trim()) return json({ error: "The AI returned an empty answer. Try again." }, 502);
    return json({ text });
  } catch (e) {
    return json({ error: "Could not reach the AI provider." }, 502);
  }
};
