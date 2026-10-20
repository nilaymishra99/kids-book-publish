// Model connections. Images and face finding use Google Gemini (set
// GEMINI_API_KEY); stories use Anthropic Claude (set ANTHROPIC_API_KEY).
// Set IMAGE_PROVIDER=openai to draw pages with OpenAI instead (OPENAI_API_KEY).
//
// Model ids can be changed in Vercel without a code change:
//   IMAGE_MODEL       default gemini-3.1-flash-image
//   DETECT_MODEL      default gemini-2.5-flash
//   STORY_MODEL       default claude-sonnet-5-5
// Check the ids against each provider's current model list before launch.

const GEMINI = "https://generativelanguage.googleapis.com/v1beta/models";

function imageProvider() {
  return (process.env.IMAGE_PROVIDER || "gemini").toLowerCase() === "openai" ? "openai" : "gemini";
}

function imageReady() {
  return Boolean(imageProvider() === "openai" ? process.env.OPENAI_API_KEY : process.env.GEMINI_API_KEY);
}

function storyReady() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// Returns { image: "data:...;base64,..." } or { error, status }.
async function drawImage({ prompt, refs = [] }) {
  if (imageProvider() === "openai") return drawWithOpenAI({ prompt, refs });
  const model = process.env.IMAGE_MODEL || "gemini-3.1-flash-image";
  const parts = [{ text: prompt }];
  for (const ref of refs) parts.push({ inlineData: { mimeType: ref.type, data: ref.buf.toString("base64") } });
  const res = await fetch(`${GEMINI}/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": process.env.GEMINI_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: "1:1" } },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("Gemini image error:", res.status, JSON.stringify(data?.error || data).slice(0, 400));
    return { error: "The illustrator is busy right now.", status: 502 };
  }
  const part = (data?.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData?.data);
  if (!part) {
    const reason = data?.candidates?.[0]?.finishReason || data?.promptFeedback?.blockReason || "no image";
    console.error("Gemini returned no image:", reason);
    return { error: "The illustrator couldn't draw that. Please try again.", status: 502, blocked: /SAFETY|BLOCK|PROHIBITED/i.test(reason) };
  }
  return { image: `data:${part.inlineData.mimeType || "image/png"};base64,${part.inlineData.data}` };
}

async function drawWithOpenAI({ prompt, refs }) {
  const model = process.env.IMAGE_MODEL_OPENAI || "gpt-image-1";
  const common = { model, prompt, size: "1024x1024", quality: process.env.IMAGE_QUALITY || "medium", output_format: "jpeg", n: "1" };
  let res;
  if (!refs.length) {
    res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(common),
    });
  } else {
    const form = new FormData();
    for (const [k, v] of Object.entries(common)) form.append(k, v);
    refs.forEach((ref, i) => form.append("image[]", new Blob([ref.buf], { type: ref.type }), `ref-${i + 1}.jpg`));
    res = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
    });
  }
  const data = await res.json().catch(() => ({}));
  const b64 = data?.data?.[0]?.b64_json;
  if (!res.ok || !b64) return { error: "The illustrator is busy right now.", status: 502 };
  return { image: `data:image/jpeg;base64,${b64}` };
}

// JSON answer from Gemini about one image (used for face finding).
async function looksAtPhoto({ system, question, photo }) {
  const model = process.env.DETECT_MODEL || "gemini-2.5-flash";
  const res = await fetch(`${GEMINI}/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": process.env.GEMINI_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: question }, { inlineData: { mimeType: photo.type, data: photo.buf.toString("base64") } }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return null;
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "{}";
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Text answer from Claude as JSON (used for story writing).
async function writesJson({ system, user, maxTokens = 6000 }) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.STORY_MODEL || "claude-sonnet-5-5",
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("Claude error:", res.status, JSON.stringify(data?.error || data).slice(0, 300));
    return null;
  }
  const text = (data.content || []).map((b) => b.text || "").join("");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

module.exports = { imageProvider, imageReady, storyReady, drawImage, looksAtPhoto, writesJson };
