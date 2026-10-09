const MODES = {
  Standard: "Rewrite the text naturally while keeping the original meaning intact.",
  Fluency: "Rewrite the text so it is smooth, clear, and easy to read.",
  Creative: "Rewrite the text in a unique and engaging way while keeping the meaning.",
  Formal: "Rewrite the text in a professional, formal tone.",
  Shorten: "Rewrite the text to be concise while keeping all key information.",
  Expand: "Rewrite the text by adding more detail and depth while keeping the meaning.",
  Summarize: "Summarize the text clearly. Keep the key points and do not add new facts.",
};

const MAX_CHARS = 20000;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 12;
const rateHits = new Map();

function clientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket?.remoteAddress || "unknown";
}

function rateLimit(ip) {
  const now = Date.now();
  const recent = (rateHits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX) {
    rateHits.set(ip, recent);
    return false;
  }
  recent.push(now);
  rateHits.set(ip, recent);
  return true;
}

const GEMINI_DEFAULT = "gemini-2.0-flash";
const GEMINI_FALLBACKS = ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-1.5-flash"];

const GEMINI_ALIASES = {
  "3.8 flash": GEMINI_DEFAULT,
  "3.8-flash": GEMINI_DEFAULT,
  "gemini-3.8-flash": GEMINI_DEFAULT,
  "gemini-3-flash": GEMINI_DEFAULT,
  "gemini-3.0-flash": GEMINI_DEFAULT,
  flash: GEMINI_DEFAULT,
  "gemini-flash": GEMINI_DEFAULT,
  "gemini-flash-latest": GEMINI_DEFAULT,
};

function wordCount(text) {
  const words = String(text).trim().match(/\S+/g);
  return words ? words.length : 0;
}

function parseBody(req) {
  const body = req.body;
  if (body == null || body === "") return {};
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return null;
    }
  }
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(body)) {
    try {
      const raw = body.toString("utf8").trim();
      return raw ? JSON.parse(raw) : {};
    } catch {
      return null;
    }
  }
  if (typeof body === "object") return body;
  return {};
}

function isGemini(baseUrl, model) {
  const url = String(baseUrl || "").toLowerCase();
  const name = String(model || "").toLowerCase();
  return url.includes("generativelanguage.googleapis.com") || name.includes("gemini") || name.includes("flash");
}

function resolveGeminiModel(model) {
  const raw = String(model || "").trim();
  if (!raw) return GEMINI_DEFAULT;
  const key = raw.toLowerCase();
  return GEMINI_ALIASES[key] || raw;
}

function geminiModelList(preferred) {
  const first = resolveGeminiModel(preferred);
  return [...new Set([first, ...GEMINI_FALLBACKS])];
}

function extractGeminiText(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts.map((part) => part?.text || "").join("").trim();
}

function geminiErrorMessage(status, body) {
  if (status === 400) return "Gemini rejected the request. Check USER_LLM_MODEL.";
  if (status === 403) return "Gemini API key is invalid or blocked.";
  if (status === 404) return "Gemini model not found. Use gemini-2.0-flash.";
  if (status === 429) return "Gemini rate limit reached. Wait a minute and try again.";
  return `Upstream API error: ${status}${body ? ` (${body})` : ""}`;
}

async function callGemini({ apiKey, baseUrl, model, system, prompt }) {
  const root = (baseUrl || "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
  const endpoint = `${root}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  return fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.8 },
    }),
  });
}

async function paraphraseWithGemini({ apiKey, baseUrl, model, system, prompt }) {
  const models = geminiModelList(model);
  let lastStatus = 0;
  let lastSnippet = "";

  for (const candidate of models) {
    const response = await callGemini({ apiKey, baseUrl, model: candidate, system, prompt });
    if (response.ok) {
      return { response, extract: extractGeminiText };
    }
    lastStatus = response.status;
    const errText = await response.text();
    lastSnippet = errText.slice(0, 120);
    if (response.status !== 404) {
      const fake = {
        ok: false,
        status: response.status,
        errorMessage: geminiErrorMessage(response.status, lastSnippet),
      };
      return { response: fake, extract: extractGeminiText };
    }
  }

  return {
    response: {
      ok: false,
      status: lastStatus || 404,
      errorMessage: geminiErrorMessage(lastStatus || 404, lastSnippet),
    },
    extract: extractGeminiText,
  };
}

async function paraphraseWithOpenAI({ apiKey, baseUrl, model, system, prompt }) {
  const root = (baseUrl || "https://api.deepseek.com/v1").replace(/\/$/, "");
  const response = await fetch(`${root}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      temperature: 0.8,
      stream: false,
    }),
  });
  return {
    response,
    extract: (data) => data.choices?.[0]?.message?.content?.trim() || "",
  };
}

export default async function handler(req, res) {
  try {
    res.setHeader("Content-Type", "application/json; charset=utf-8");

    if (req.method === "OPTIONS") {
      res.setHeader("Allow", "POST, OPTIONS");
      return res.status(204).end();
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "POST, OPTIONS");
      return res.status(405).json({ error: "Method not allowed." });
    }

    const body = parseBody(req);
    if (body === null) {
      return res.status(400).json({ error: "Invalid JSON body." });
    }

    if (!rateLimit(clientIp(req))) {
      res.setHeader("Retry-After", "60");
      return res.status(429).json({ error: "Too many requests. Wait a minute and try again." });
    }

    const { text, mode } = body;
    if (!text || typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ error: "Please paste some text first." });
    }
    if (text.length > MAX_CHARS) {
      return res.status(400).json({ error: `Text is too long. Keep it under ${MAX_CHARS} characters.` });
    }

    const style = MODES[mode] || MODES.Standard;
    const apiKey = process.env.USER_LLM_API_KEY;
    const configuredUrl = process.env.USER_LLM_BASE_URL;
    const configuredModel = process.env.USER_LLM_MODEL;
    const gemini = isGemini(configuredUrl, configuredModel);
    const baseUrl = (
      configuredUrl ||
      (gemini
        ? "https://generativelanguage.googleapis.com/v1beta"
        : "https://api.deepseek.com/v1")
    ).replace(/\/$/, "");
    const model = configuredModel || (gemini ? GEMINI_DEFAULT : "deepseek-chat");

    if (!apiKey || apiKey === "your-api-key-here" || apiKey === "your-gemini-api-key-here") {
      return res.status(500).json({
        error:
          "No API key configured. Set USER_LLM_API_KEY in your Vercel project environment variables.",
      });
    }

    const summarize = mode === "Summarize";
    const system = summarize
      ? "You are RewordAI. Summarize the user's text. Keep the key points. Do not add new facts. Return only the summary, no explanations, no quotes, no preamble."
      : "You are RewordAI, an expert paraphrasing assistant. " +
        "Rewrite the user's text according to the requested mode. " +
        "Return only the rewritten text, no explanations, no quotes, no preamble.";
    const prompt = `${style}\n\nOriginal text:\n${text}`;

    const { response, extract } = gemini
      ? await paraphraseWithGemini({ apiKey, baseUrl, model, system, prompt })
      : await paraphraseWithOpenAI({ apiKey, baseUrl, model, system, prompt });

    if (!response.ok) {
      return res.status(502).json({
        error: response.errorMessage || `Upstream API error: ${response.status}`,
      });
    }

    const data = await response.json();
    const output = extract(data);
    if (!output) {
      return res.status(502).json({ error: "Empty response from upstream API." });
    }

    return res.status(200).json({
      output,
      inputWords: wordCount(text),
      outputWords: wordCount(output),
    });
  } catch {
    if (!res.headersSent) {
      return res.status(502).json({ error: "Failed to reach the upstream API." });
    }
  }
}
