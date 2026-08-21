import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import serverless from "serverless-http";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const file = path.join(__dirname, ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnv();

const MODES = {
  Standard: "Rewrite the text naturally while keeping the original meaning intact.",
  Fluency: "Rewrite the text so it is smooth, clear, and easy to read.",
  Creative: "Rewrite the text in a unique and engaging way while keeping the meaning.",
  Formal: "Rewrite the text in a professional, formal tone.",
  Shorten: "Rewrite the text to be concise while keeping all key information.",
  Expand: "Rewrite the text by adding more detail and depth while keeping the meaning.",
};

const PORT = Number(process.env.PORT || 3000);
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

function wordCount(text) {
  const words = text.trim().match(/\S+/g);
  return words ? words.length : 0;
}

app.post("/api/paraphrase", async (req, res) => {
  const { text, mode } = req.body || {};
  if (!text || typeof text !== "string" || !text.trim()) {
    return res.status(400).json({ error: "Please paste some text first." });
  }
  const style = MODES[mode] || MODES.Standard;

  const apiKey = process.env.USER_LLM_API_KEY;
  const baseUrl = process.env.USER_LLM_BASE_URL || "https://api.deepseek.com/v1";
  const model = process.env.USER_LLM_MODEL || "deepseek-chat";

  if (!apiKey || apiKey === "your-api-key-here") {
    return res.status(500).json({
      error:
        "No API key configured. Copy .env.example to .env and set USER_LLM_API_KEY.",
    });
  }

  const system =
    "You are RewordAI, an expert paraphrasing assistant. " +
    "Rewrite the user's text according to the requested mode. " +
    "Return only the rewritten text, no explanations, no quotes, no preamble.";

  const prompt = `${style}\n\nOriginal text:\n${text}`;

  try {
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
      const detail = await response.text();
      return res.status(502).json({ error: `Upstream API error: ${response.status}` });
    }

    const data = await response.json();
    const output = data.choices?.[0]?.message?.content?.trim();
    if (!output) return res.status(502).json({ error: "Empty response from upstream API." });

    res.json({
      output,
      inputWords: wordCount(text),
      outputWords: wordCount(output),
    });
  } catch (err) {
    res.status(502).json({ error: "Failed to reach the upstream API." });
  }
});

export const handler = serverless(app);

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`RewordAI running at http://localhost:${PORT}`);
  });
}
