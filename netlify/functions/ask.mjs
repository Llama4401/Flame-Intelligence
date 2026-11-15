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
          generationConfig: { maxOutputTokens: 4000, thinkingConfig:
