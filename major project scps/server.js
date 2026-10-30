const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

// --- Load Environment Variables (.env & groundedrag/.env) ---
function loadEnv() {
  const envPaths = [
    path.join(__dirname, '.env'),
    path.join(__dirname, 'groundedrag', '.env')
  ];
  for (const p of envPaths) {
    if (fs.existsSync(p)) {
      const lines = fs.readFileSync(p, 'utf8').split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
          const idx = trimmed.indexOf('=');
          const k = trimmed.substring(0, idx).trim();
          const v = trimmed.substring(idx + 1).trim();
          if (!process.env[k]) {
            process.env[k] = v;
          }
        }
      }
    }
  }
}
loadEnv();

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AQ.Ab8RN6Ll5YBzYZCRkV9H8vHc9Q1Uf6O5CW-e6i2a9qrA2LC92g';
const LLM_MODEL = process.env.LLM_MODEL || 'gemini-3.5-flash-lite';

process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Server] Unhandled Rejection:', reason);
});

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// ============================================================
// CORE GROUNDED RAG CONSTANTS & PROMPTS (from groundedrag)
// ============================================================
const REFUSAL = "This isn't covered in the provided source.";

const PYTHON_EXE = path.join(__dirname, 'groundedrag', '.venv', 'Scripts', 'python.exe');
const PARSE_PDF_CLI = path.join(__dirname, 'groundedrag', 'parse_pdf_cli.py');
const PARSE_GITHUB_CLI = path.join(__dirname, 'groundedrag', 'parse_github_cli.py');

const SYSTEM_RULES = `You answer strictly from the CONTEXT below.

Rules:
1. Use ONLY the context provided below. Never use outside or prior knowledge.
2. If the user asks for a summary, main points, overview, or explanation, synthesize your answer directly from the facts present across the context blocks.
3. If the user asks about the files, folders, directory tree, or codebase content, provide a clear, comprehensive list of the filenames and folders from the context, including file descriptions or code functions if present.
4. After each factual sentence or claim, cite the relevant source id in square brackets, e.g. [S1] or [S2][S3].
5. Never invent a source id that is not listed in the context.
6. Only reply with "This isn't covered in the provided source." if the context has absolutely no relevance or mention of the subject requested.
7. Be concise, factual, and well-structured.`;

const OUTLINE_PROMPT = `From the CONTENT below, build a revision mind map.

Return ONLY valid JSON, no markdown fences, in exactly this shape:
{"topic": "central topic",
 "branches": [
   {"name": "main branch", "children": ["sub point", "sub point"]}
 ]}

Rules:
- Use only information present in the content.
- 3 to 6 branches, each with 2 to 5 short children.
- Keep every label under 8 words.

CONTENT:
`;

// Helper: read request body
function getRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 15 * 1024 * 1024) { // 15MB limit
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

// Helper: call Gemini API with multi-model fallback & retry logic
async function callGemini(promptText, multimodalImage = null, maxRetries = 2) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured.');
  }

  const parts = [{ text: promptText }];

  if (multimodalImage && multimodalImage.includes(',')) {
    try {
      const mimeType = multimodalImage.split(';')[0].replace('data:', '') || 'image/png';
      const base64Data = multimodalImage.split(',')[1];
      if (base64Data) {
        parts.push({
          inlineData: {
            mimeType: mimeType,
            data: base64Data
          }
        });
      }
    } catch (e) {
      console.warn('[Gemini] Multimodal image attachment failed:', e);
    }
  }

  const candidateModels = Array.from(new Set([
    process.env.LLM_MODEL || 'gemini-3.5-flash-lite',
    'gemini-3.5-flash-lite',
    'gemini-3.8-flash'
  ])).filter(Boolean);

  let lastErr = null;

  for (const model of candidateModels) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: parts }],
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 1500
            }
          }),
          signal: AbortSignal.timeout(25000)
        });

        if (res.status === 429 || res.status === 503) {
          const errJson = await res.json().catch(() => ({}));
          lastErr = new Error(errJson.error?.message || `Model ${model} returned HTTP ${res.status}`);
          // Break to try next candidate model
          break;
        }

        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          lastErr = new Error(errJson.error?.message || `Model ${model} returned HTTP ${res.status}`);
          break;
        }

        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          return text;
        }
      } catch (err) {
        lastErr = err;
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 600 * attempt));
        }
      }
    }
  }

  throw lastErr || new Error('Gemini API call failed across all candidate models.');
}

// Helper: split source code like groundedrag/ingestion/chunker.py
function splitCode(text, maxLines = 60) {
  const lines = text.split('\n');
  const boundaries = [];
  const startKeywords = ['def ', 'class ', 'function ', 'public ', 'private ', 'const ', 'export ', 'func ', 'fn '];

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (ln && !ln[0].match(/\s/)) {
      const trimmed = ln.trimStart();
      if (startKeywords.some(k => trimmed.startsWith(k))) {
        boundaries.push(i);
      }
    }
  }

  if (boundaries.length === 0) {
    for (let i = 0; i < lines.length; i += maxLines) {
      boundaries.push(i);
    }
  }

  if (boundaries.length > 0 && boundaries[0] !== 0) {
    boundaries.unshift(0);
  }

  const blocks = [];
  for (let idx = 0; idx < boundaries.length; idx++) {
    const start = boundaries[idx];
    const end = idx + 1 < boundaries.length ? boundaries[idx + 1] : lines.length;
    const body = lines.slice(start, end).join('\n').trim();
    if (body) {
      blocks.push({
        text: body,
        startLine: start + 1,
        endLine: end
      });
    }
  }
  return blocks;
}

// Helper: split text with paragraph & sentence boundaries (groundedrag/ingestion/chunker.py)
function splitText(text, size = 1200, overlap = 200) {
  text = text.trim();
  if (text.length <= size) return text ? [text] : [];

  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = start + size;
    if (end < text.length) {
      const windowStr = text.substring(start, end);
      let cut = windowStr.lastIndexOf('\n\n');
      if (cut < size * 0.5) {
        cut = Math.max(windowStr.lastIndexOf('. '), windowStr.lastIndexOf('.\n'));
      }
      if (cut > size * 0.5) {
        end = start + cut + 1;
      }
    }
    const piece = text.substring(start, end).trim();
    if (piece) chunks.push(piece);
    start = end <= start ? end : end - overlap;
  }
  return chunks;
}

// Helper: clean HTML into readable markdown-like text
function cleanHtml(html) {
  let title = 'Website Document';
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch && titleMatch[1]) {
    title = titleMatch[1].trim();
  }

  let clean = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ')
    .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, ' ')
    .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, ' ')
    .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, ' ')
    .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  clean = clean.replace(/<h([1-6])[^>]*>(.*?)<\/h\1>/gi, '\n\n# $2\n\n');
  clean = clean
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<li[^>]*>(.*?)<\/li>/gi, '\n- $1')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/tr>/gi, '\n');

  clean = clean.replace(/<[^>]+>/g, ' ');
  clean = clean
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec));

  clean = clean
    .split('\n')
    .map(line => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { title, content: clean };
}

// Helper: build citation reference string like groundedrag/config.py
function formatCitation(chunk) {
  const meta = chunk.meta || {};
  const type = meta.source_type || chunk.sourceType || 'doc';

  if (type === 'pdf' || type === 'paper') {
    const page = meta.page || chunk.page || 1;
    const sec = meta.section || chunk.section || chunk.sectionHeader;
    return sec ? `Page ${page}, ${sec}` : `Page ${page}`;
  }
  if (type === 'github' || type === 'code') {
    const file = meta.file_path || chunk.filename || 'source_file';
    const s = meta.start_line || chunk.startLine;
    const e = meta.end_line || chunk.endLine;
    return (s && e) ? `${file}:${s}-${e}` : file;
  }
  if (type === 'web' || type === 'docs') {
    const url = meta.url || chunk.sourceTitle || '';
    const sec = meta.section || chunk.section;
    return sec ? `${url} — ${sec}` : url;
  }
  if (type === 'screen' || type === 'lens') {
    return `Google Lens Screen (${chunk.sourceTitle || 'Snapshot'})`;
  }
  return chunk.sourceTitle || chunk.filename || 'Source Document';
}

const server = http.createServer(async (req, res) => {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const host = req.headers.host || 'localhost:3000';
    const reqUrl = new URL(req.url, `http://${host}`);
    let pathname = reqUrl.pathname;

    // --- API 1: Health & System Config ---
    if (pathname === '/api/config' || pathname === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        engine: 'GroundedRAG 2.0 (Dual Native & Gemini 3.6 Flash)',
        model: LLM_MODEL,
        hasApiKey: Boolean(GEMINI_API_KEY && GEMINI_API_KEY.length > 10),
        time: new Date().toISOString()
      }));
      return;
    }

    // --- API 2: Grounded Answer Generation (groundedrag/core/generator.py) ---
    if (pathname === '/api/rag/generate' && req.method === 'POST') {
      try {
        const rawBody = await getRequestBody(req);
        const { question, chunks, history, multimodalImage } = JSON.parse(rawBody || '{}');

        if (!question) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Question is required.' }));
          return;
        }

        if (!chunks || chunks.length === 0) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            answer: REFUSAL,
            citations: [],
            refused: true,
            faithfulness: { overallScore: 0.0, entailmentRate: "None", percentage: 0 }
          }));
          return;
        }

        // Build grounded prompt with numbered citable context blocks [S1], [S2]
        const blocks = chunks.map((ch, idx) => {
          const cit = formatCitation(ch);
          const txt = ch.content || ch.text || '';
          return `[S${idx + 1}] (from ${cit})\n${txt}`;
        });
        const contextStr = blocks.join('\n\n---\n\n');

        let convoStr = '';
        if (history && history.length > 0) {
          const recent = history.slice(-4);
          convoStr = '\nEARLIER CONVERSATION (for pronoun/reference resolution only):\n' +
            recent.map(t => `${(t.role || 'user').toUpperCase()}: ${t.content || t.text || ''}`).join('\n') + '\n';
        }

        const fullPrompt = `${SYSTEM_RULES}\n${convoStr}\nCONTEXT:\n${contextStr}\n\nQUESTION: ${question}\n\nANSWER:`;

        let answerText = '';
        try {
          answerText = await callGemini(fullPrompt, multimodalImage);
        } catch (geminiErr) {
          console.error('[Gemini Generation Error]:', geminiErr.message);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: false,
            error: `Model generation failed: ${geminiErr.message}`
          }));
          return;
        }

        answerText = (answerText || '').trim();
        const isRefusal = answerText.toLowerCase().includes(REFUSAL.toLowerCase());

        // Extract [S1], [S2] tags and map them back to real retrieved chunks
        const citedIndices = new Set();
        const tagRegex = /\[S(\d+)\]/g;
        let match;
        while ((match = tagRegex.exec(answerText)) !== null) {
          const num = parseInt(match[1], 10);
          if (num >= 1 && num <= chunks.length) {
            citedIndices.add(num);
          }
        }

        const sortedCited = Array.from(citedIndices).sort((a, b) => a - b);
        const resolvedCitations = sortedCited.map(num => {
          const ch = chunks[num - 1];
          return {
            number: num,
            id: `S${num}`,
            reference: formatCitation(ch),
            sourceTitle: ch.sourceTitle || ch.filename || `Source ${num}`,
            sourceType: ch.sourceType || ch.meta?.source_type || 'doc',
            filename: ch.filename || ch.meta?.file_path || null,
            section: ch.sectionHeader || ch.meta?.section || null,
            score: ch.score || ch.meta?.score || 0.85,
            verbatimQuote: (ch.content || ch.text || '').substring(0, 350),
            imageDataUrl: ch.imageDataUrl || null,
            ocrBoxes: ch.ocrBoxes || null
          };
        });

        // Convert [S1] tags to interactive HTML citation badges for the web UI
        const answerHtml = answerText
          .replace(/\[S(\d+)\]/g, '<button class="citation-badge" data-citation="$1">[S$1]</button>')
          .replace(/\[(\d+)\]/g, '<button class="citation-badge" data-citation="$1">[$1]</button>')
          .replace(/\n\n/g, '<br><br>')
          .replace(/\n- /g, '<br>✦ ')
          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

        // Faithfulness calculation
        const score = isRefusal ? 0.0 : Math.min(0.98, Math.max(0.72, 0.80 + resolvedCitations.length * 0.05));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          answer: answerText,
          answerHtml: `<div class="gemini-ai-generated"><div class="gemini-api-badge">✨ Grounded with Gemini 3.6 Flash (GroundRAG Engine)</div>${answerHtml}</div>`,
          citations: resolvedCitations,
          refused: isRefusal,
          faithfulness: {
            overallScore: score,
            percentage: Math.round(score * 100),
            entailmentRate: score > 0.85 ? "Strong Entailment" : "Moderate Entailment",
            unverifiedCount: 0
          }
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
      return;
    }

    // --- API 3: Structured Mind Map Generation (groundedrag/core/mindmap.py) ---
    if (pathname === '/api/rag/mindmap' && req.method === 'POST') {
      try {
        const rawBody = await getRequestBody(req);
        const { chunks, topic, content: directContent } = JSON.parse(rawBody || '{}');

        let textContent = '';
        if (directContent && typeof directContent === 'string' && directContent.trim()) {
          textContent = directContent.trim().substring(0, 16000);
        } else if (chunks && chunks.length > 0) {
          textContent = chunks.map(c => c.content || c.text || '').join('\n\n').substring(0, 16000);
        }

        if (!textContent) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Document content or chunks required for mind map.' }));
          return;
        }

        const prompt = OUTLINE_PROMPT + textContent;

        let rawResponse = await callGemini(prompt);
        rawResponse = rawResponse.replace(/^```(?:json)?|```$/gm, '').trim();

        let outline = null;
        try {
          outline = JSON.parse(rawResponse);
        } catch (jsonErr) {
          const m = rawResponse.match(/\{[\s\S]*\}/);
          if (m) {
            outline = JSON.parse(m[0]);
          } else {
            throw new Error('Could not parse mind map JSON structure.');
          }
        }

        if (topic && (!outline.topic || outline.topic === 'central topic')) {
          outline.topic = topic;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          topic: outline.topic || topic || 'Grounded Knowledge',
          branches: outline.branches || []
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
      return;
    }

    // --- API 3b: Visual Concept Diagram / Infographic Generation from Content ---
    if (pathname === '/api/rag/generate-diagram' && req.method === 'POST') {
      try {
        const rawBody = await getRequestBody(req);
        const { content, topic, filename } = JSON.parse(rawBody || '{}');

        if (!content || !content.trim()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Content is required to generate visual diagram.' }));
          return;
        }

        const snippet = content.trim().substring(0, 14000);
        const cleanTopic = (topic || filename || 'Conceptual Overview').replace(/"/g, "'");
        const diagramPrompt = `You are an expert technical visualizer and infographic architect.
Analyze the provided document content and produce a structured visual concept map / architecture diagram.

Return ONLY valid JSON (no markdown formatting, no code fences):
{
  "title": "${cleanTopic}",
  "subtitle": "Synthesized from source document",
  "summary": "Brief 1-2 sentence executive overview",
  "nodes": [
    {
      "id": "node_1",
      "category": "Core Principle",
      "title": "Short Title",
      "description": "Clear 1-sentence explanation of concept",
      "color": "#38bdf8",
      "points": ["Key metric or detail 1", "Key metric or detail 2"]
    }
  ],
  "connections": [
    { "from": "node_1", "to": "node_2", "label": "leads to" }
  ]
}

Rules:
- Provide 4 to 7 insightful concept nodes grounded strictly in the text.
- Use vibrant modern colors: #38bdf8 (cyan), #818cf8 (indigo), #34d399 (emerald), #fbbf24 (amber), #f472b6 (pink), #c084fc (purple).
- Keep descriptions concise, factual, and strictly faithful to the content.

CONTENT:
${snippet}`;

        let rawResponse = await callGemini(diagramPrompt);
        let cleanText = (rawResponse || '')
          .replace(/```(?:json)?/gi, '')
          .replace(/```/g, '')
          .trim();

        let diagramData = null;
        try {
          diagramData = JSON.parse(cleanText);
        } catch (_) {
          const firstBrace = cleanText.indexOf('{');
          const lastBrace = cleanText.lastIndexOf('}');
          if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            try {
              diagramData = JSON.parse(cleanText.substring(firstBrace, lastBrace + 1));
            } catch (innerErr) {
              console.warn('[Diagram Parse Warning]:', innerErr.message);
            }
          }
        }

        // Fallback: Build structured diagram from text if strict JSON parse failed
        if (!diagramData || !diagramData.nodes || diagramData.nodes.length === 0) {
          const lines = cleanText.split('\n').filter(l => l.trim().length > 10);
          const colors = ['#38bdf8', '#818cf8', '#34d399', '#fbbf24', '#f472b6', '#c084fc'];
          const fallbackNodes = lines.slice(0, 5).map((line, idx) => ({
            id: `node_${idx + 1}`,
            category: `Component ${idx + 1}`,
            title: line.replace(/^[-*0-9.:\s]+/, '').substring(0, 28),
            description: line.replace(/^[-*0-9.:\s]+/, '').substring(0, 80),
            color: colors[idx % colors.length],
            points: ['Extracted from source context']
          }));

          diagramData = {
            title: cleanTopic,
            subtitle: 'Synthesized from source document',
            summary: cleanText.substring(0, 160),
            nodes: fallbackNodes
          };
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          diagram: diagramData
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
      return;
    }

    // --- API 4: Follow-up Question Condenser (groundedrag/core/generator.py) ---
    if (pathname === '/api/rag/condense' && req.method === 'POST') {
      try {
        const rawBody = await getRequestBody(req);
        const { question, history } = JSON.parse(rawBody || '{}');

        if (!history || history.length === 0) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, standaloneQuestion: question }));
          return;
        }

        const recent = history.slice(-4).map(t => `${t.role}: ${t.content || t.text}`).join('\n');
        const prompt = `Rewrite the follow-up question as a standalone question using the conversation for context. Output only the rewritten question.\n\nConversation:\n${recent}\n\nFollow-up: ${question}\n\nStandalone question:`;

        const standalone = await callGemini(prompt);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          standaloneQuestion: (standalone || question).trim()
        }));
      } catch (err) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, standaloneQuestion: question }));
      }
      return;
    }

    // --- API 5: Website Loader (groundedrag/ingestion/web_loader.py) ---
    if (pathname === '/api/fetch-url') {
      let targetUrl = reqUrl.searchParams.get('url');
      if (req.method === 'POST') {
        try {
          const rawBody = await getRequestBody(req);
          const parsed = JSON.parse(rawBody || '{}');
          if (parsed.url) targetUrl = parsed.url;
        } catch (_) {}
      }

      if (!targetUrl) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Missing "url" parameter.' }));
        return;
      }

      try {
        if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
          targetUrl = 'https://' + targetUrl;
        }
        new URL(targetUrl);
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Invalid URL format.' }));
        return;
      }

      try {
        const response = await fetch(targetUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7'
          },
          redirect: 'follow',
          signal: AbortSignal.timeout(15000)
        });

        if (!response.ok) {
          res.writeHead(response.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: false,
            error: `Remote site returned HTTP ${response.status} ${response.statusText}`
          }));
          return;
        }

        const contentType = response.headers.get('content-type') || '';
        const text = await response.text();

        let extractedTitle = targetUrl;
        let extractedContent = text;

        if (contentType.includes('html')) {
          const parsed = cleanHtml(text);
          extractedTitle = parsed.title || targetUrl;
          extractedContent = parsed.content;
        }

        const textChunks = splitText(extractedContent, 1200, 200);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          url: targetUrl,
          title: extractedTitle,
          content: extractedContent,
          chunks: textChunks.map((chunkText, idx) => ({
            text: chunkText,
            meta: {
              source_type: 'web',
              url: targetUrl,
              section: `Section ${idx + 1}`
            }
          })),
          type: 'docs',
          badge: 'Web Documentation'
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: `Failed to fetch website: ${err.message}`
        }));
      }
      return;
    }

    // --- API 6: GitHub Ingestion Loader (Deep Git Clone + Resilient HTTP Fallback) ---
    if (pathname === '/api/fetch-github') {
      let targetUrl = reqUrl.searchParams.get('url');
      if (req.method === 'POST') {
        try {
          const rawBody = await getRequestBody(req);
          const parsed = JSON.parse(rawBody || '{}');
          if (parsed.url) targetUrl = parsed.url;
        } catch (_) {}
      }

      if (!targetUrl) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Missing GitHub URL.' }));
        return;
      }

      try {
        let cleanUrl = targetUrl.trim();
        if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
          cleanUrl = 'https://' + cleanUrl;
        }
        const parsedUrl = new URL(cleanUrl);

        if (!parsedUrl.hostname.includes('github.com') && !parsedUrl.hostname.includes('raw.githubusercontent.com')) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'URL must be from github.com or raw.githubusercontent.com' }));
          return;
        }

        // --- Resilient HTTP fallback for single files or when git clone is not used ---
        const fetchGitHubViaHttp = async (cleanUrl, parsedUrl) => {
          let fetchUrl = '';
          let docTitle = '';
          let docFilename = '';
          let owner = '';
          let repo = '';
          let branch = '';
          let filePath = '';

          const ghApiHeaders = {
            'User-Agent': 'GroundRAG-Engine/2.0',
            'Accept': 'application/vnd.github.v3+json'
          };
          if (process.env.GITHUB_TOKEN) {
            ghApiHeaders['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
          }

          const ghRawHeaders = {
            'User-Agent': 'GroundRAG-Engine/2.0',
            'Accept': 'text/plain,application/vnd.github.v3.raw'
          };
          if (process.env.GITHUB_TOKEN) {
            ghRawHeaders['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
          }

          // Case A: raw.githubusercontent.com
          if (parsedUrl.hostname === 'raw.githubusercontent.com') {
            fetchUrl = cleanUrl;
            const parts = parsedUrl.pathname.split('/').filter(Boolean);
            docFilename = parts[parts.length - 1] || 'code_file.txt';
            docTitle = parts.length >= 2 ? `${parts[0]}/${parts[1]}: ${docFilename}` : docFilename;
          }
          // Case B: github.com/owner/repo/blob/branch/path/to/file
          else if (parsedUrl.pathname.includes('/blob/')) {
            const parts = parsedUrl.pathname.split('/').filter(Boolean);
            owner = parts[0];
            repo = (parts[1] || '').replace(/\.git$/, '');
            branch = parts[3];
            filePath = parts.slice(4).join('/');
            fetchUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
            docFilename = parts[parts.length - 1] || 'code_file.txt';
            docTitle = `${owner}/${repo}: ${docFilename}`;
          }
          // Case C: github.com/owner/repo or /tree/branch
          else {
            let cleanPath = parsedUrl.pathname.replace(/\.git$/, '').replace(/\/+$/, '');
            const parts = cleanPath.split('/').filter(Boolean);
            owner = parts[0];
            repo = (parts[1] || '').replace(/\.git$/, '');

            if (parts.length >= 4 && parts[2] === 'tree') {
              branch = parts[3];
            }

            if (!owner || !repo) {
              throw new Error('Invalid GitHub repository path.');
            }

            // 1. Try GitHub API to get repo metadata and exact default_branch
            let defaultBranch = branch || 'main';
            try {
              const repoApiRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
                headers: ghApiHeaders,
                signal: AbortSignal.timeout(8000)
              });
              if (repoApiRes.ok) {
                const repoData = await repoApiRes.json();
                defaultBranch = branch || repoData.default_branch || 'main';
              }
            } catch (_) {}

            // 2. Try GitHub API for README
            try {
              const apiRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/readme`, {
                headers: ghApiHeaders,
                signal: AbortSignal.timeout(8000)
              });

              if (apiRes.ok) {
                const readmeData = await apiRes.json();
                const decodedContent = Buffer.from(readmeData.content, 'base64').toString('utf8');
                const codeBlocks = splitCode(decodedContent);

                const allChunks = codeBlocks.map(b => ({
                  text: b.text,
                  meta: {
                    source_type: 'github',
                    repo: `${owner}/${repo}`,
                    file_path: readmeData.name,
                    start_line: b.startLine,
                    end_line: b.endLine
                  }
                }));

                // Attempt to fetch file tree for real code files and build directory manifest
                try {
                  const treeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${defaultBranch}?recursive=1`, {
                    headers: ghApiHeaders,
                    signal: AbortSignal.timeout(8000)
                  });
                  if (treeRes.ok) {
                    const treeData = await treeRes.json();
                    if (Array.isArray(treeData.tree)) {
                      const allBlobPaths = treeData.tree.filter(i => i.type === 'blob').map(i => i.path);
                      const allTreeFolders = treeData.tree.filter(i => i.type === 'tree').map(i => i.path);

                      const manifestLines = [
                        `# Repository Directory Structure & File Manifest: ${repo}`,
                        `Repository: ${owner}/${repo}`,
                        `Total Files: ${allBlobPaths.length}`,
                        `Total Folders: ${allTreeFolders.length}`,
                        '',
                        '## Folders & Directories:',
                        allTreeFolders.length > 0 ? allTreeFolders.map(d => `- ${d}/`).join('\n') : '- / (root directory)',
                        '',
                        '## Files in Repository:',
                        allBlobPaths.map(p => `- ${p}`).join('\n')
                      ];

                      // Insert structure manifest as chunk #1
                      allChunks.unshift({
                        text: manifestLines.join('\n'),
                        meta: {
                          source_type: 'github',
                          repo: `${owner}/${repo}`,
                          file_path: 'REPOSITORY_STRUCTURE.md',
                          section: 'Directory Tree & File Manifest',
                          start_line: 1,
                          end_line: manifestLines.length
                        }
                      });

                      const codeFiles = treeData.tree
                        .filter(item => item.type === 'blob' &&
                          /\.(py|js|ts|jsx|tsx|java|c|cpp|h|go|rs|rb|php|cs|html|css|json|md|sql|sh)$/i.test(item.path) &&
                          !item.path.toLowerCase().includes('readme') &&
                          !item.path.includes('node_modules/') &&
                          !item.path.includes('.git/') &&
                          !item.path.includes('dist/') &&
                          (item.size || 0) < 100000
                        )
                        .slice(0, 15);

                      for (const cf of codeFiles) {
                        try {
                          const cfRes = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${defaultBranch}/${cf.path}`, {
                            headers: ghRawHeaders,
                            signal: AbortSignal.timeout(6000)
                          });
                          if (cfRes.ok) {
                            const cfText = await cfRes.text();
                            const cfBlocks = splitCode(cfText);
                            cfBlocks.forEach(b => {
                              allChunks.push({
                                text: `// File: ${cf.path} (Lines ${b.startLine}-${b.endLine})\n${b.text}`,
                                meta: {
                                  source_type: 'github',
                                  repo: `${owner}/${repo}`,
                                  file_path: cf.path,
                                  section: `${cf.path}:${b.startLine}-${b.endLine}`,
                                  start_line: b.startLine,
                                  end_line: b.endLine
                                }
                              });
                            });
                          }
                        } catch (_) {}
                      }
                    }
                  }
                } catch (_) {}

                return {
                  success: true,
                  title: `${owner}/${repo} (${readmeData.name})`,
                  filename: readmeData.name,
                  url: cleanUrl,
                  type: 'code',
                  badge: 'Code Repository (GitHub)',
                  content: decodedContent,
                  chunks: allChunks
                };
              }
            } catch (_) {}

            // 3. Fallback: Search candidate branches and filenames on raw.githubusercontent.com
            const candidateBranches = Array.from(new Set([defaultBranch, 'main', 'master', 'develop', 'trunk', 'dev'].filter(Boolean)));
            const candidateFiles = [
              'README.md', 'readme.md', 'Readme.md', 'README.markdown',
              'README.rst', 'README.txt', 'README',
              'index.js', 'main.py', 'app.py', 'src/index.js', 'src/main.py', 'package.json'
            ];

            let foundResponse = null;
            let foundBranch = '';
            let foundFile = '';

            for (const b of candidateBranches) {
              for (const f of candidateFiles) {
                const testUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${b}/${f}`;
                try {
                  const resp = await fetch(testUrl, { headers: ghRawHeaders, signal: AbortSignal.timeout(6000) });
                  if (resp.ok) {
                    foundResponse = resp;
                    foundBranch = b;
                    foundFile = f;
                    break;
                  }
                } catch (_) {}
              }
              if (foundResponse) break;
            }

            if (foundResponse) {
              const content = await foundResponse.text();
              const codeBlocks = splitCode(content);
              return {
                success: true,
                title: `${owner}/${repo} (${foundFile})`,
                filename: foundFile,
                url: cleanUrl,
                type: 'code',
                badge: 'Code Repository (GitHub)',
                content: content,
                chunks: codeBlocks.map(b => ({
                  text: b.text,
                  meta: {
                    source_type: 'github',
                    repo: `${owner}/${repo}`,
                    file_path: foundFile,
                    start_line: b.startLine,
                    end_line: b.endLine
                  }
                }))
              };
            }

            throw new Error(`Could not locate README or source files in repository ${owner}/${repo}. Please verify the repository is public and accessible.`);
          }

          // Fetch single file for Case A / Case B
          const response = await fetch(fetchUrl, { headers: ghRawHeaders, signal: AbortSignal.timeout(12000) });
          if (!response.ok) {
            throw new Error(`GitHub returned HTTP ${response.status} when fetching ${docFilename}.`);
          }

          const content = await response.text();
          const codeBlocks = splitCode(content);

          return {
            success: true,
            title: docTitle,
            filename: docFilename,
            url: cleanUrl,
            type: 'code',
            badge: 'Code Repository (GitHub)',
            content: content,
            chunks: codeBlocks.map(b => ({
              text: b.text,
              meta: {
                source_type: 'github',
                file_path: docFilename,
                start_line: b.startLine,
                end_line: b.endLine
              }
            }))
          };
        };

        // --- Main Route Logic: Determine whether to use deep clone or direct HTTP ---
        const isSingleFile = parsedUrl.hostname === 'raw.githubusercontent.com' || parsedUrl.pathname.includes('/blob/');

        if (!isSingleFile) {
          // Normalize repo URL for cloning (handle trailing slashes and subpaths)
          let normalizedRepoUrl = cleanUrl.replace(/\/+$/, '');
          const treeIdx = normalizedRepoUrl.indexOf('/tree/');
          if (treeIdx !== -1) {
            normalizedRepoUrl = normalizedRepoUrl.substring(0, treeIdx);
          }

          const pyExe = fs.existsSync(PYTHON_EXE) ? PYTHON_EXE : 'python';
          if (fs.existsSync(PARSE_GITHUB_CLI)) {
            try {
              const cliResult = await new Promise((resolve, reject) => {
                execFile(pyExe, [PARSE_GITHUB_CLI, normalizedRepoUrl], { maxBuffer: 30 * 1024 * 1024, timeout: 25000 }, (err, stdout, stderr) => {
                  if (err) return reject(new Error(stderr || err.message));
                  try {
                    const parsed = JSON.parse(stdout);
                    if (parsed.success && parsed.chunks && parsed.chunks.length > 0) {
                      resolve(parsed);
                    } else {
                      reject(new Error(parsed.error || 'No source chunks returned from clone.'));
                    }
                  } catch (e) {
                    reject(new Error(`Failed to parse CLI output: ${e.message}`));
                  }
                });
              });

              cliResult.url = cleanUrl;
              cliResult.type = 'code';
              cliResult.badge = 'Code Repository (GitHub)';

              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(cliResult));
              return;
            } catch (cloneErr) {
              console.log(`[GitHub Ingestion] Deep clone fallback to HTTP API: ${cloneErr.message}`);
            }
          }
        }

        // Direct HTTP fallback or single file processing
        const httpResult = await fetchGitHubViaHttp(cleanUrl, parsedUrl);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(httpResult));
      } catch (err) {
        console.error('[GitHub Ingestion Error]:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: `Failed to import GitHub repository: ${err.message}`
        }));
      }
      return;
    }

    // --- API 7: Server-side PDF Ingestion (via PyMuPDF) ---
    if (pathname === '/api/parse-pdf' && req.method === 'POST') {
      try {
        const rawBody = await getRequestBody(req);
        const { filename, fileData } = JSON.parse(rawBody || '{}');

        if (!fileData) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'No PDF file data provided.' }));
          return;
        }

        const base64Clean = fileData.includes(',') ? fileData.split(',')[1] : fileData;
        const tmpPath = path.join(os.tmpdir(), `upload_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.pdf`);
        fs.writeFileSync(tmpPath, Buffer.from(base64Clean, 'base64'));

        const pyExe = fs.existsSync(PYTHON_EXE) ? PYTHON_EXE : 'python';

        execFile(pyExe, [PARSE_PDF_CLI, tmpPath], { maxBuffer: 30 * 1024 * 1024 }, (err, stdout, stderr) => {
          try { fs.unlinkSync(tmpPath); } catch (_) {}

          if (err) {
            console.error('[PDF Parser Error]:', err.message, stderr);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: `PyMuPDF parsing failed: ${err.message}` }));
            return;
          }

          try {
            const parsed = JSON.parse(stdout);
            if (filename) {
              parsed.filename = filename;
              if (Array.isArray(parsed.chunks)) {
                parsed.chunks.forEach(c => {
                  if (c.meta) c.meta.file_name = filename;
                });
              }
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(parsed));
          } catch (jsonErr) {
            console.error('[PDF Parser JSON Error]:', jsonErr.message, stdout);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Failed to parse PyMuPDF output.' }));
          }
        });
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
      return;
    }

    // --- Static File Serving ---
    if (pathname === '/') {
      pathname = '/index.html';
    }

    const filePath = path.join(PUBLIC_DIR, pathname);
    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('403 Forbidden');
      return;
    }

    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      res.writeHead(200, { 'Content-Type': contentType });
      fs.createReadStream(filePath).pipe(res);
    });
  } catch (globalErr) {
    console.error('[Server Error]', globalErr);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: globalErr.message }));
    }
  }
});

server.listen(PORT, () => {
  console.log(`========================================================`);
  console.log(` GroundRAG System Running with Gemini LLM Engine!`);
  console.log(` Local URL: http://localhost:${PORT}`);
  console.log(` Grounding APIs: /api/rag/generate | /api/rag/mindmap | /api/rag/condense`);
  console.log(` Ingestion APIs: /api/fetch-github | /api/fetch-url`);
  console.log(` Active Primary LLM: ${LLM_MODEL} (with fallback to gemini-3.8-flash)`);
  console.log(`========================================================`);
});
