const MODES = {
  Standard: "Rewrite the text naturally while keeping the original meaning intact.",
  Fluency: "Rewrite the text so it is smooth, clear, and easy to read.",
  Creative: "Rewrite the text in a unique and engaging way while keeping the meaning.",
  Formal: "Rewrite the text in a professional, formal tone.",
  Shorten: "Rewrite the text to be concise while keeping all key information.",
  Expand: "Rewrite the text by adding more detail and depth while keeping the meaning.",
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

    const { text, mode } = body;
    if (!text || typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ error: "Please paste some text first." });
    }

    const style = MODES[mode] || MODES.Standard;
    const apiKey = process.env.USER_LLM_API_KEY;
    const baseUrl = (process.env.USER_LLM_BASE_URL || "https://api.deepseek.com/v1").replace(
      /\/$/,
      ""
    );
    const model = process.env.USER_LLM_MODEL || "deepseek-chat";

    if (!apiKey || apiKey === "your-api-key-here") {
      return res.status(500).json({
        error:
          "No API key configured. Set USER_LLM_API_KEY in your Vercel project environment variables.",
      });
    }

    const system =
      "You are RewordAI, an expert paraphrasing assistant. " +
      "Rewrite the user's text according to the requested mode. " +
      "Return only the rewritten text, no explanations, no quotes, no preamble.";
    const prompt = `${style}\n\nOriginal text:\n${text}`;

    const response = await fetch(`${baseUrl}/chat/completions`, {
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

    if (!response.ok) {
      return res.status(502).json({ error: `Upstream API error: ${response.status}` });
    }

    const data = await response.json();
    const output = data.choices?.[0]?.message?.content?.trim();
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
