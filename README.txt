FLAME INTELLIGENCE - website folder

index.html                      The whole website (what visitors see).
netlify/functions/ask.mjs       The small server program that talks to the AI. It holds no secrets.
netlify.toml                    Tells Netlify where the two things above are. Do not edit.

Your secret AI key is NOT in any of these files. You paste it into Netlify's settings
(Environment variables), so nobody who views your website can ever see it.

Settings to add in Netlify (Project configuration > Environment variables):
  GEMINI_API_KEY   = your key from https://aistudio.google.com/apikey      (required for the free option)
  AI_PROVIDER      = gemini            (optional; use "anthropic" plus ANTHROPIC_API_KEY to use Claude instead)
  AI_MODEL         = gemini-2.5-flash  (optional; change only if Google retires this model name)
  ALLOWED_ORIGIN   = https://YOUR-SITE.netlify.app   (optional; blocks other websites from using your key)
