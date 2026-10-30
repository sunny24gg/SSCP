/**
 * GroundRAG API Client
 * Clean frontend interface for all GroundedRAG backend endpoints:
 * - RAG Grounded Answer Generation (Gemini 3.6 Flash)
 * - Structured Mind Map Generation
 * - Multi-turn Query Condensation
 * - GitHub Repository Ingestion
 * - Webpage & Documentation Ingestion
 * - System Config & Health Check
 */

class GroundRAGAPI {
  static baseUrl = window.location.origin;

  /**
   * Check system health and LLM model status
   * @returns {Promise<{status: string, model: string, hasApiKey: boolean}>}
   */
  static async getConfig() {
    try {
      const res = await fetch(`${this.baseUrl}/api/config`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn('[GroundRAGAPI] getConfig error:', err);
      return { status: 'offline', model: 'local-fallback', hasApiKey: false };
    }
  }

  /**
   * Grounded Question Answering using Gemini 3.6 Flash with strict citation mapping
   * @param {Object} params
   * @param {string} params.question - The user query
   * @param {Array} params.chunks - The retrieved evidence chunks
   * @param {Array} [params.history] - Previous chat conversation turns
   * @param {string} [params.multimodalImage] - Optional base64 screenshot image for vision
   * @returns {Promise<{success: boolean, answer: string, answerHtml: string, citations: Array, faithfulness: Object, refused: boolean}>}
   */
  static async generateAnswer({ question, chunks, history = [], multimodalImage = null }) {
    if (!question) throw new Error('Question is required.');
    if (!chunks || chunks.length === 0) {
      return {
        success: true,
        answer: "This isn't covered in the provided source.",
        answerHtml: `<div class="answer-section">I could not find sufficiently grounded evidence across your active sources.<br><br>💡 <strong>Tip:</strong> Upload a PDF, GitHub repo, or Website URL, or capture your screen via Google Lens.</div>`,
        citations: [],
        refused: true,
        faithfulness: { overallScore: 0.0, percentage: 0, entailmentRate: "None", unverifiedCount: 0 }
      };
    }

    const res = await fetch(`${this.baseUrl}/api/rag/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, chunks, history, multimodalImage })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `RAG generation failed with HTTP ${res.status}`);
    }

    return await res.json();
  }

  /**
   * Generate structured JSON mind map from retrieved chunks or direct content (e.g. PDF)
   * @param {Object} params
   * @param {Array} [params.chunks]
   * @param {string} [params.content]
   * @param {string} [params.topic]
   * @returns {Promise<{success: boolean, topic: string, branches: Array}>}
   */
  static async generateMindMap({ chunks = null, content = null, topic = 'Grounded Knowledge' }) {
    if ((!chunks || chunks.length === 0) && !content) {
      throw new Error('Chunks or content are required to generate a mind map.');
    }

    const res = await fetch(`${this.baseUrl}/api/rag/mindmap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chunks, content, topic })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Mind map generation failed with HTTP ${res.status}`);
    }

    return await res.json();
  }

  /**
   * Generate visual concept diagram / infographic data from content
   * @param {Object} params
   * @param {string} params.content
   * @param {string} [params.topic]
   * @param {string} [params.filename]
   * @returns {Promise<{success: boolean, diagram: Object}>}
   */
  static async generateDiagram({ content, topic = '', filename = '' }) {
    if (!content) throw new Error('Content is required to generate diagram.');

    const res = await fetch(`${this.baseUrl}/api/rag/generate-diagram`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, topic, filename })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Diagram generation failed with HTTP ${res.status}`);
    }

    return await res.json();
  }

  /**
   * Condense a multi-turn follow-up question into a standalone search query
   * @param {Object} params
   * @param {string} params.question
   * @param {Array} params.history
   * @returns {Promise<string>} Standalone search query
   */
  static async condenseQuestion({ question, history = [] }) {
    if (!history || history.length === 0) return question;

    try {
      const res = await fetch(`${this.baseUrl}/api/rag/condense`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, history })
      });
      if (res.ok) {
        const data = await res.json();
        return data.standaloneQuestion || question;
      }
    } catch (_) {}
    return question;
  }

  /**
   * Fetch and ingest a GitHub repository or specific code file
   * @param {string} url - GitHub repo or file URL
   * @returns {Promise<{success: boolean, title: string, filename: string, content: string, chunks: Array, badge: string, type: string}>}
   */
  static async fetchGitHub(url) {
    if (!url) throw new Error('GitHub URL is required.');

    const res = await fetch(`${this.baseUrl}/api/fetch-github`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || `GitHub fetch failed with HTTP ${res.status}`);
    }

    return data;
  }

  /**
   * Fetch and scrape a live webpage or technical documentation
   * @param {string} url - Webpage URL
   * @returns {Promise<{success: boolean, title: string, url: string, content: string, chunks: Array, badge: string, type: string}>}
   */
  static async fetchWebpage(url) {
    if (!url) throw new Error('Webpage URL is required.');

    const res = await fetch(`${this.baseUrl}/api/fetch-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || `Webpage fetch failed with HTTP ${res.status}`);
    }

    return data;
  }

  /**
   * Parse a PDF document server-side using PyMuPDF for 100% accurate page & section chunking
   * @param {Object} params
   * @param {string} params.filename - The PDF file name
   * @param {string} params.fileData - Base64 data URL or raw base64 string
   * @returns {Promise<{success: boolean, filename: string, pageCount: number, chunkCount: number, fullText: string, chunks: Array}>}
   */
  static async parsePdf({ filename, fileData }) {
    if (!fileData) throw new Error('File data is required to parse PDF.');

    const res = await fetch(`${this.baseUrl}/api/parse-pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, fileData })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || `PDF parse failed with HTTP ${res.status}`);
    }

    return data;
  }
}

window.GroundRAGAPI = GroundRAGAPI;
