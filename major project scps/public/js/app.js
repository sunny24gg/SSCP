/**
 * GroundRAG - Main Client Controller
 * Multi-source ingestion (PDF upload, GitHub URL, Website URL, Paste text),
 * RAG retrieval engine, Evidence Inspector, and the Grounded Mind Map.
 */

document.addEventListener('DOMContentLoaded', () => {
  // 1. Initialize RAG Engine
  const ragEngine = new GroundRAGEngine();
  if (window.DEFAULT_SOURCES && window.DEFAULT_SOURCES.length > 0) {
    ragEngine.loadSources(window.DEFAULT_SOURCES);
  }

  // 2. DOM Elements
  const appSidebar = document.getElementById('app-sidebar');
  const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
  const btnHeaderNewChat = document.getElementById('btn-header-new-chat');
  const btnNewChat = document.getElementById('btn-new-chat');
  const chatHeroContainer = document.getElementById('chat-hero-container');
  const btnSidebarAddSource = document.getElementById('btn-sidebar-add-source');
  const btnToggleSourcesDrawer = document.getElementById('btn-toggle-sources-drawer');
  const btnToggleMindmapDrawer = document.getElementById('btn-toggle-mindmap-drawer');
  const btnCloseDrawer = document.getElementById('btn-close-drawer');

  const sourcesListEl = document.getElementById('sources-list');
  const sourcesCountEl = document.getElementById('sources-count');
  const btnClearAllSources = document.getElementById('btn-clear-all-sources');
  const chatMessagesEl = document.getElementById('chat-messages');
  const chatInputEl = document.getElementById('chat-input');
  const chatSendBtnEl = document.getElementById('chat-send-btn');
  const quickPromptChips = document.querySelectorAll('.quick-prompt-chip');

  // Grounding controls: enhanced TOP_K and sensitive threshold
  const RAG_TOP_K = 5;
  const RAG_THRESHOLD = 0.08;
  const RAG_FILTER_TYPE = 'all';

  const tabBtnInspector = document.getElementById('tab-btn-inspector');
  const tabBtnMindmap = document.getElementById('tab-btn-mindmap');
  const paneInspector = document.getElementById('pane-inspector');
  const paneMindmap = document.getElementById('pane-mindmap');
  const appRightPanel = document.getElementById('app-right-panel');
  const btnToggleExpand = document.getElementById('btn-toggle-expand');
  const inspectorChunksContainer = document.getElementById('inspector-chunks-container');

  // Modal Ingestion Elements
  const modalAddSource = document.getElementById('modal-add-source');
  const btnOpenAddSource = document.getElementById('btn-open-add-source');
  const modalBtnClose = document.getElementById('modal-btn-close');
  const modalBtnCancel = document.getElementById('modal-btn-cancel');
  const modalBtnSubmit = document.getElementById('modal-btn-submit');
  const submitBtnText = document.getElementById('submit-btn-text');
  const ingestStatusMsg = document.getElementById('ingest-status-msg');

  // Modal Tabs & Panes
  const modalTabBtns = document.querySelectorAll('.modal-tab-btn');
  const ingestPanes = document.querySelectorAll('.ingest-pane');
  let activeIngestTab = 'tab-upload';

  // File Upload Elements
  const fileDropZone = document.getElementById('file-drop-zone');
  const fileInput = document.getElementById('file-input');
  const fileInfoPreview = document.getElementById('file-info-preview');
  const previewFileName = document.getElementById('preview-file-name');
  const previewFileSize = document.getElementById('preview-file-size');
  let selectedFile = null;
  let parsedFileContent = '';
  let parsedPdfChunks = null;

  // Inputs
  const githubUrlInput = document.getElementById('github-url-input');
  const websiteUrlInput = document.getElementById('website-url-input');
  const docTitleInput = document.getElementById('doc-title-input');
  const docTypeInput = document.getElementById('doc-type-input');
  const docContentInput = document.getElementById('doc-content-input');

  // State
  let currentCitations = [];
  let latestMindMapData = null;
  let conversationHistory = [];

  // 3. Initialize Mind Map
  const mindMapInstance = new GroundedMindMap('mindmap-container', (selectedNode) => {
    if (selectedNode.citationNumber) {
      switchTab('inspector');
      highlightEvidenceCard(selectedNode.citationNumber);
    }
  });

  // 4. Render Active Sources in Sidebar
  function renderSourcesList() {
    sourcesListEl.innerHTML = '';
    const totalSources = ragEngine.sources.length;
    sourcesCountEl.innerText = totalSources;

    if (totalSources === 0) {
      if (btnClearAllSources) btnClearAllSources.style.display = 'none';
      sourcesListEl.innerHTML = `
        <div class="empty-sources-card">
          <div style="font-size: 1.8rem; margin-bottom: 8px;">📂</div>
          <div class="empty-sources-text">
            No knowledge sources indexed yet. Add a PDF paper, GitHub repo, or website link to start!
          </div>
          <button class="btn-load-sample-sources" id="btn-empty-add-source">
            + Ingest Knowledge Source
          </button>
        </div>
      `;

      document.getElementById('btn-empty-add-source')?.addEventListener('click', () => {
        modalAddSource.classList.add('active');
        clearIngestStatus();
      });
      return;
    }

    btnClearAllSources.style.display = 'inline-block';

    ragEngine.sources.forEach(src => {
      const item = document.createElement('div');
      item.className = 'source-item';
      item.dataset.sourceId = src.id;

      let badgeBg = 'rgba(37, 99, 235, 0.2)';
      let badgeColor = '#38bdf8';
      if (src.type === 'code') {
        badgeBg = 'rgba(16, 185, 129, 0.2)';
        badgeColor = '#34d399';
      } else if (src.type === 'docs') {
        badgeBg = 'rgba(139, 92, 246, 0.2)';
        badgeColor = '#c084fc';
      }

      item.innerHTML = `
        <div class="source-item-top">
          <span class="source-badge-tag" style="background: ${badgeBg}; color: ${badgeColor}; border: 1px solid ${badgeColor};">
            ${escapeHtml(src.badge || 'Document')}
          </span>
          <button class="source-remove-btn" title="Delete this source" data-remove-id="${src.id}">&times;</button>
        </div>
        <div class="source-item-title">${escapeHtml(src.title)}</div>
        <div class="source-item-meta">${escapeHtml(src.filename || src.title)}</div>
        <div class="source-card-actions">
          <button class="source-action-pill btn-src-mindmap" title="Generate Mind Map from this document">
            🧠 Mind Map
          </button>
          <button class="source-action-pill pill-img btn-src-diagram" title="Generate Concept Diagram Image from this document">
            🖼️ Diagram
          </button>
        </div>
      `;

      // Mind map button click
      item.querySelector('.btn-src-mindmap')?.addEventListener('click', (e) => {
        e.stopPropagation();
        generateMindMapForSource(src);
      });

      // Concept diagram button click
      item.querySelector('.btn-src-diagram')?.addEventListener('click', (e) => {
        e.stopPropagation();
        generateDiagramForSource(src);
      });

      // Select and preview source
      item.addEventListener('click', (e) => {
        if (e.target.closest('.source-remove-btn') || e.target.closest('.source-action-pill')) return;
        document.querySelectorAll('.source-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        displaySourcePreview(src);
      });

      // Remove single source
      item.querySelector('.source-remove-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        ragEngine.removeSource(src.id);
        renderSourcesList();
        appendMessage('bot', `Removed **${src.title}** from active knowledge bases.`);
      });

      sourcesListEl.appendChild(item);
    });
  }

  btnClearAllSources?.addEventListener('click', () => {
    if (confirm('Are you sure you want to remove all knowledge sources?')) {
      ragEngine.clearSources();
      renderSourcesList();
      appendMessage('bot', 'Cleared all sources from GroundRAG knowledge base.');
    }
  });

  function displaySourcePreview(source) {
    openDrawer('inspector');
    inspectorChunksContainer.innerHTML = `
      <div style="margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px solid var(--border-subtle);">
        <span class="source-badge-tag" style="background: rgba(37,99,235,0.2); color: var(--blue-neon); border: 1px solid var(--blue-neon);">
          ${escapeHtml(source.badge || 'Document')}
        </span>
        <h4 style="font-size: 0.9rem; color: #fff; margin-top: 6px;">${escapeHtml(source.title)}</h4>
        <div style="font-size: 0.72rem; color: var(--text-dim); margin-top: 2px;">${escapeHtml(source.filename || source.title)}</div>
      </div>
      <div class="evidence-chunk-card">
        <div class="chunk-header">
          <span class="chunk-title">Full Document Preview</span>
          <span class="chunk-badge">RAW</span>
        </div>
        <pre class="chunk-verbatim-text" style="max-height: 450px; overflow-y: auto;">${escapeHtml(source.content)}</pre>
      </div>
    `;
  }

  // 5. Controls — removed from UI, defaults used at query time

  // 6. Tab Navigation & Slide-Over Drawer Controller
  function switchTab(tabName) {
    if (tabName === 'inspector') {
      tabBtnInspector.classList.add('active');
      tabBtnMindmap.classList.remove('active');
      paneInspector.classList.add('active');
      paneMindmap.classList.remove('active');
    } else if (tabName === 'mindmap') {
      tabBtnInspector.classList.remove('active');
      tabBtnMindmap.classList.add('active');
      paneInspector.classList.remove('active');
      paneMindmap.classList.add('active');

      if (latestMindMapData) {
        setTimeout(() => mindMapInstance.render(latestMindMapData), 60);
      }
    }
  }

  function openDrawer(tab = 'inspector') {
    switchTab(tab);
    appRightPanel.classList.add('open');
    if (tab === 'inspector') {
      btnToggleSourcesDrawer?.classList.add('active');
      btnToggleMindmapDrawer?.classList.remove('active');
    } else {
      btnToggleMindmapDrawer?.classList.add('active');
      btnToggleSourcesDrawer?.classList.remove('active');
    }
  }

  function closeDrawer() {
    appRightPanel.classList.remove('open');
    appRightPanel.classList.remove('active');
    appRightPanel.classList.remove('expanded');
    btnToggleSourcesDrawer?.classList.remove('active');
    btnToggleMindmapDrawer?.classList.remove('active');
  }

  function toggleDrawer(tab = 'inspector') {
    const isCurrentlyOpen = appRightPanel.classList.contains('open') || appRightPanel.classList.contains('active');
    const isCurrentTab = (tab === 'inspector' && tabBtnInspector.classList.contains('active')) ||
      (tab === 'mindmap' && tabBtnMindmap.classList.contains('active'));
    if (isCurrentlyOpen && isCurrentTab) {
      closeDrawer();
    } else {
      openDrawer(tab);
    }
  }

  tabBtnInspector.addEventListener('click', () => switchTab('inspector'));
  tabBtnMindmap.addEventListener('click', () => switchTab('mindmap'));
  btnCloseDrawer?.addEventListener('click', (e) => {
    e.stopPropagation();
    closeDrawer();
  });
  btnToggleSourcesDrawer?.addEventListener('click', () => toggleDrawer('inspector'));
  btnToggleMindmapDrawer?.addEventListener('click', () => toggleDrawer('mindmap'));

  // Global Escape key listener to close drawer & modals
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (modalAddSource?.classList.contains('active')) {
        closeModal();
      } else if (modalGeminiKey?.classList.contains('active')) {
        modalGeminiKey.classList.remove('active');
      } else if (appRightPanel.classList.contains('open') || appRightPanel.classList.contains('active') || appRightPanel.classList.contains('expanded')) {
        closeDrawer();
      }
    }
  });

  // Expand / collapse drawer width
  btnToggleExpand.addEventListener('click', (e) => {
    e.stopPropagation();
    appRightPanel.classList.toggle('expanded');
    if (latestMindMapData && tabBtnMindmap.classList.contains('active')) {
      setTimeout(() => mindMapInstance.render(latestMindMapData), 300);
    }
  });

  // Sidebar collapse toggle
  btnToggleSidebar?.addEventListener('click', () => {
    appSidebar?.classList.toggle('collapsed');
  });

  // New Chat Handler (ChatGPT / Gemini reset)
  function startNewChat() {
    chatMessagesEl.innerHTML = '';
    chatMessagesEl.style.display = 'none';
    if (chatHeroContainer) chatHeroContainer.style.display = 'flex';
    currentCitations = [];
    latestMindMapData = null;
    conversationHistory = [];
    closeDrawer();
    chatInputEl.value = '';
    chatInputEl.focus();
  }

  btnNewChat?.addEventListener('click', startNewChat);
  btnHeaderNewChat?.addEventListener('click', startNewChat);

  // 7. Ingestion Modal Tabs
  modalTabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      modalTabBtns.forEach(b => b.classList.remove('active'));
      ingestPanes.forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      activeIngestTab = btn.getAttribute('data-ingest-tab');
      document.getElementById(`pane-${activeIngestTab}`)?.classList.add('active');
      clearIngestStatus();
    });
  });

  // File Upload Handlers (Click + Drag & Drop)
  fileDropZone.addEventListener('click', () => fileInput.click());

  fileDropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    fileDropZone.classList.add('dragover');
  });

  fileDropZone.addEventListener('dragleave', () => {
    fileDropZone.classList.remove('dragover');
  });

  fileDropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    fileDropZone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileSelected(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileSelected(e.target.files[0]);
    }
  });

  async function handleFileSelected(file) {
    selectedFile = file;
    parsedPdfChunks = null;
    fileInfoPreview.style.display = 'block';
    previewFileName.innerText = file.name;
    previewFileSize.innerText = `${(file.size / 1024).toFixed(1)} KB`;

    showIngestStatus('Parsing document contents...', 'loading');

    try {
      if (file.name.toLowerCase().endsWith('.pdf')) {
        // Attempt 1: Server-side PyMuPDF (100% accurate page & section chunking)
        try {
          const reader = new FileReader();
          const base64Data = await new Promise((resolve, reject) => {
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });

          const serverPdfResult = await GroundRAGAPI.parsePdf({
            filename: file.name,
            fileData: base64Data
          });

          if (serverPdfResult && serverPdfResult.success && serverPdfResult.chunks && serverPdfResult.chunks.length > 0) {
            parsedFileContent = serverPdfResult.fullText;
            parsedPdfChunks = serverPdfResult.chunks;
            showIngestStatus(`Ready to index! Extracted ${serverPdfResult.pageCount} pages (${serverPdfResult.chunks.length} structured chunks via PyMuPDF).`, 'success');
            return;
          }
        } catch (serverErr) {
          console.warn('[PDF] Server PyMuPDF parse error, falling back to PDF.js:', serverErr);
        }

        // Attempt 2: Client-side PDF.js fallback
        parsedFileContent = await parsePdfFile(file);
      } else {
        // Plain text, markdown, code
        parsedFileContent = await file.text();
      }

      showIngestStatus(`Ready to index! Extracted ${parsedFileContent.length} characters.`, 'success');
    } catch (err) {
      console.error('File parse error:', err);
      showIngestStatus(`Error reading file: ${err.message}. Please try paste text mode if PDF is restricted.`, 'error');
    }
  }

  // Helper: Client-side PDF text extraction via PDF.js
  async function parsePdfFile(file) {
    if (!window.pdfjsLib) {
      // Fallback if CDN failed
      const text = await file.text();
      return text;
    }

    if (!window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(item => item.str).join(' ');
      fullText += `\n\n--- Page ${pageNum} ---\n` + pageText;
    }

    return fullText.trim();
  }

  function showIngestStatus(msg, type = 'info') {
    ingestStatusMsg.style.display = 'block';
    ingestStatusMsg.innerText = msg;
    if (type === 'error') {
      ingestStatusMsg.style.background = 'rgba(239, 68, 68, 0.15)';
      ingestStatusMsg.style.border = '1px solid rgba(239, 68, 68, 0.4)';
      ingestStatusMsg.style.color = '#fca5a5';
    } else if (type === 'success') {
      ingestStatusMsg.style.background = 'rgba(16, 185, 129, 0.15)';
      ingestStatusMsg.style.border = '1px solid rgba(16, 185, 129, 0.4)';
      ingestStatusMsg.style.color = '#6ee7b7';
    } else {
      ingestStatusMsg.style.background = 'rgba(37, 99, 235, 0.15)';
      ingestStatusMsg.style.border = '1px solid rgba(56, 189, 248, 0.4)';
      ingestStatusMsg.style.color = '#93c5fd';
    }
  }

  function clearIngestStatus() {
    ingestStatusMsg.style.display = 'none';
    ingestStatusMsg.innerText = '';
  }

  // 8. Submit Ingestion
  modalBtnSubmit.addEventListener('click', async () => {
    clearIngestStatus();

    // Mode 1: File Upload
    if (activeIngestTab === 'tab-upload') {
      if (!selectedFile || !parsedFileContent) {
        showIngestStatus('Please select a file first.', 'error');
        return;
      }

      let fileType = 'paper';
      let badge = 'Academic Paper (PDF)';
      let badgeColor = '#3b82f6';
      const lowerName = selectedFile.name.toLowerCase();

      if (lowerName.endsWith('.py') || lowerName.endsWith('.js') || lowerName.endsWith('.ts') || lowerName.endsWith('.cpp') || lowerName.endsWith('.java')) {
        fileType = 'code';
        badge = 'Code Repository';
        badgeColor = '#10b981';
      } else if (lowerName.endsWith('.md') || lowerName.endsWith('.txt') || lowerName.endsWith('.html')) {
        fileType = 'docs';
        badge = 'Technical Documentation';
        badgeColor = '#8b5cf6';
      }

      const newSource = {
        id: `source-${Date.now()}`,
        title: selectedFile.name,
        type: fileType,
        badge: badge,
        badgeColor: badgeColor,
        filename: selectedFile.name,
        authors: "User Upload",
        year: new Date().getFullYear().toString(),
        content: parsedFileContent,
        chunks: parsedPdfChunks || null
      };

      ragEngine.addSource(newSource);
      renderSourcesList();
      closeModal();
      appendMessage('bot', `Successfully ingested and indexed **${selectedFile.name}** (${fileType.toUpperCase()}) with ${parsedPdfChunks ? parsedPdfChunks.length : 'full'} verifiable chunk citations!`);
    }

    // Mode 2: GitHub Link (Calls /api/fetch-github)
    else if (activeIngestTab === 'tab-github') {
      const ghUrl = githubUrlInput.value.trim();
      if (!ghUrl) {
        showIngestStatus('Please enter a GitHub repository or file URL.', 'error');
        return;
      }

      submitBtnText.innerText = 'Fetching GitHub...';
      modalBtnSubmit.disabled = true;
      showIngestStatus('Connecting to GitHub API...', 'loading');

      try {
        const data = await GroundRAGAPI.fetchGitHub(ghUrl);

        const newSource = {
          id: `source-${Date.now()}`,
          title: data.title,
          type: 'code',
          badge: 'Code Repository (GitHub)',
          badgeColor: '#10b981',
          filename: data.filename || data.title,
          authors: "GitHub",
          year: new Date().getFullYear().toString(),
          content: data.content,
          chunks: data.chunks || null
        };

        ragEngine.addSource(newSource);
        renderSourcesList();
        closeModal();
        appendMessage('bot', `Successfully imported GitHub repository/file: **${data.title}**! Line-level provenance and function boundaries are active.`);
      } catch (err) {
        showIngestStatus(`Error: ${err.message}`, 'error');
      } finally {
        submitBtnText.innerText = 'Index & Ingest';
        modalBtnSubmit.disabled = false;
      }
    }

    // Mode 3: Website Link (Calls GroundRAGAPI.fetchWebpage)
    else if (activeIngestTab === 'tab-website') {
      const webUrl = websiteUrlInput.value.trim();
      if (!webUrl) {
        showIngestStatus('Please enter a website URL.', 'error');
        return;
      }

      submitBtnText.innerText = 'Fetching Webpage...';
      modalBtnSubmit.disabled = true;
      showIngestStatus('Fetching webpage & extracting readable text...', 'loading');

      try {
        const data = await GroundRAGAPI.fetchWebpage(webUrl);

        const newSource = {
          id: `source-${Date.now()}`,
          title: data.title || webUrl,
          type: 'docs',
          badge: 'Website / Documentation',
          badgeColor: '#8b5cf6',
          filename: webUrl,
          authors: "Web Source",
          year: new Date().getFullYear().toString(),
          content: data.content,
          chunks: data.chunks || null
        };

        ragEngine.addSource(newSource);
        renderSourcesList();
        closeModal();
        appendMessage('bot', `Successfully ingested webpage: **${data.title}**! Ready for grounded retrieval.`);
      } catch (err) {
        showIngestStatus(`Error: ${err.message}`, 'error');
      } finally {
        submitBtnText.innerText = 'Index & Ingest';
        modalBtnSubmit.disabled = false;
      }
    }

    // Mode 4: Paste Raw Text
    else if (activeIngestTab === 'tab-paste') {
      const title = docTitleInput.value.trim();
      const type = docTypeInput.value;
      const content = docContentInput.value.trim();

      if (!title || !content) {
        showIngestStatus('Please provide both a document title and text content.', 'error');
        return;
      }

      let badge = "Technical Document";
      let badgeColor = "#8b5cf6";
      if (type === 'paper') {
        badge = "Academic Paper (PDF)";
        badgeColor = "#3b82f6";
      } else if (type === 'code') {
        badge = "Code Repository (GitHub)";
        badgeColor = "#10b981";
      }

      const newSource = {
        id: `source-${Date.now()}`,
        title: title,
        type: type,
        badge: badge,
        badgeColor: badgeColor,
        filename: title,
        authors: "Pasted Text",
        year: new Date().getFullYear().toString(),
        content: content
      };

      ragEngine.addSource(newSource);
      renderSourcesList();
      closeModal();
      appendMessage('bot', `Indexed raw source **${title}** into GroundRAG!`);
    }
  });

  // Modal Open / Close
  btnOpenAddSource?.addEventListener('click', () => {
    modalAddSource.classList.add('active');
    clearIngestStatus();
  });
  btnSidebarAddSource?.addEventListener('click', () => openIngestModalTab('tab-upload'));

  function openIngestModalTab(tabId) {
    modalAddSource.classList.add('active');
    clearIngestStatus();
    modalTabBtns.forEach(b => b.classList.remove('active'));
    ingestPanes.forEach(p => p.classList.remove('active'));
    activeIngestTab = tabId;
    document.querySelector(`[data-ingest-tab="${tabId}"]`)?.classList.add('active');
    document.getElementById(`pane-${tabId}`)?.classList.add('active');
    if (tabId === 'tab-github') setTimeout(() => githubUrlInput.focus(), 120);
    if (tabId === 'tab-website') setTimeout(() => websiteUrlInput.focus(), 120);
  }

  // Quick In-Pill Ingest Shortcuts
  document.getElementById('btn-pill-upload-pdf')?.addEventListener('click', () => openIngestModalTab('tab-upload'));
  document.getElementById('btn-pill-github')?.addEventListener('click', () => openIngestModalTab('tab-github'));
  document.getElementById('btn-pill-website')?.addEventListener('click', () => openIngestModalTab('tab-website'));

  // Hero Welcome Starter Cards (Gemini style)
  document.getElementById('card-hero-upload-pdf')?.addEventListener('click', () => openIngestModalTab('tab-upload'));
  document.getElementById('card-hero-github')?.addEventListener('click', () => openIngestModalTab('tab-github'));
  document.getElementById('card-hero-website')?.addEventListener('click', () => openIngestModalTab('tab-website'));
  document.getElementById('card-hero-mindmap')?.addEventListener('click', () => openDrawer('mindmap'));

  // Gemini API Key Config Modal
  const modalGeminiKey = document.getElementById('modal-gemini-key');
  const btnOpenGeminiKey = document.getElementById('btn-open-gemini-key');
  const modalGeminiClose = document.getElementById('modal-gemini-close');
  const geminiApiKeyInput = document.getElementById('gemini-api-key-input');
  const btnGeminiSaveKey = document.getElementById('btn-gemini-save-key');
  const btnGeminiClearKey = document.getElementById('btn-gemini-clear-key');
  const geminiKeyStatus = document.getElementById('gemini-key-status');
  const engineStatusText = document.getElementById('engine-status-text');

  async function updateEngineStatus() {
    const key = localStorage.getItem('gemini_api_key');
    if (key && key.trim()) {
      if (engineStatusText) engineStatusText.innerHTML = `Grounding: <strong>Gemini 3.6 Flash ✨</strong>`;
      if (btnOpenGeminiKey) btnOpenGeminiKey.innerText = '✨ Gemini Connected';
      return;
    }

    try {
      const cfg = await GroundRAGAPI.getConfig();
      if (cfg && cfg.hasApiKey) {
        if (engineStatusText) engineStatusText.innerHTML = `Grounding: <strong>Gemini 3.6 Flash ✨</strong>`;
        if (btnOpenGeminiKey) btnOpenGeminiKey.innerText = '✨ Gemini 3.6 Connected';
      } else {
        if (engineStatusText) engineStatusText.innerHTML = `Grounding: <strong>Local Smart RAG</strong>`;
        if (btnOpenGeminiKey) btnOpenGeminiKey.innerText = '✨ Gemini API';
      }
    } catch (_) {
      if (engineStatusText) engineStatusText.innerHTML = `Grounding: <strong>Local Smart RAG</strong>`;
      if (btnOpenGeminiKey) btnOpenGeminiKey.innerText = '✨ Gemini API';
    }
  }
  updateEngineStatus();

  if (btnOpenGeminiKey) {
    btnOpenGeminiKey.addEventListener('click', () => {
      const savedKey = localStorage.getItem('gemini_api_key') || '';
      geminiApiKeyInput.value = savedKey;
      geminiKeyStatus.style.display = 'none';
      modalGeminiKey.classList.add('active');
    });
  }

  if (modalGeminiClose) {
    modalGeminiClose.addEventListener('click', () => modalGeminiKey.classList.remove('active'));
  }

  modalGeminiKey?.addEventListener('click', (e) => {
    if (e.target === modalGeminiKey) modalGeminiKey.classList.remove('active');
  });

  btnGeminiSaveKey?.addEventListener('click', () => {
    const key = geminiApiKeyInput.value.trim();
    if (!key) {
      alert('Please enter a valid Gemini API key.');
      return;
    }
    localStorage.setItem('gemini_api_key', key);
    updateEngineStatus();
    geminiKeyStatus.style.display = 'block';
    geminiKeyStatus.style.background = 'rgba(16, 185, 129, 0.15)';
    geminiKeyStatus.style.color = '#6ee7b7';
    geminiKeyStatus.innerText = 'Gemini API key saved! GroundRAG is now powered by Gemini 1.5 Flash with source-grounding.';
    setTimeout(() => modalGeminiKey.classList.remove('active'), 1200);
  });

  btnGeminiClearKey?.addEventListener('click', () => {
    localStorage.removeItem('gemini_api_key');
    geminiApiKeyInput.value = '';
    updateEngineStatus();
    geminiKeyStatus.style.display = 'block';
    geminiKeyStatus.style.background = 'rgba(37, 99, 235, 0.15)';
    geminiKeyStatus.style.color = '#93c5fd';
    geminiKeyStatus.innerText = 'API key removed. Switched to built-in Local Smart Grounding Engine.';
    setTimeout(() => modalGeminiKey.classList.remove('active'), 1000);
  });

  function closeModal() {
    modalAddSource.classList.remove('active');
    clearIngestStatus();
    selectedFile = null;
    parsedFileContent = '';
    parsedPdfChunks = null;
    fileInfoPreview.style.display = 'none';
    fileInput.value = '';
    githubUrlInput.value = '';
    websiteUrlInput.value = '';
    docTitleInput.value = '';
    docContentInput.value = '';
  }

  modalBtnClose.addEventListener('click', closeModal);
  modalBtnCancel.addEventListener('click', closeModal);
  modalAddSource.addEventListener('click', (e) => {
    if (e.target === modalAddSource) closeModal();
  });

  // 9. Chat Submission & RAG Execution
  async function handleSendMessage() {
    const query = chatInputEl.value.trim();
    if (!query) return;

    if (chatHeroContainer) chatHeroContainer.style.display = 'none';
    chatMessagesEl.style.display = 'flex';

    appendMessage('user', query);
    chatInputEl.value = '';

    if (ragEngine.sources.length === 0) {
      setTimeout(() => {
        appendMessage('bot', `⚠️ **No sources loaded yet**: GroundRAG strictly generates answers grounded in verified references. Please click **"+ Add Source"** or one of the attachment shortcuts below to upload a PDF paper, import a GitHub repository, or fetch a website.`);
      }, 250);
      return;
    }

    // Direct intent routing for Mind Map and Diagram/Image Generation
    const lowerQ = query.toLowerCase();
    if ((lowerQ.includes('mind map') || lowerQ.includes('mindmap') || lowerQ.includes('concept map')) && ragEngine.sources.length > 0) {
      const targetSrc = ragEngine.sources.find(s => s.filename?.toLowerCase().endsWith('.pdf') || s.type === 'paper') || ragEngine.sources[0];
      generateMindMapForSource(targetSrc);
      return;
    }

    if ((lowerQ.includes('diagram') || lowerQ.includes('infographic') || (lowerQ.includes('image') && !lowerQ.includes('screen'))) && ragEngine.sources.length > 0) {
      const targetSrc = ragEngine.sources.find(s => s.filename?.toLowerCase().endsWith('.pdf') || s.type === 'paper') || ragEngine.sources[0];
      generateDiagramForSource(targetSrc);
      return;
    }

    // Temporary Gemini thinking indicator
    const thinkingRow = document.createElement('div');
    thinkingRow.className = 'message-row bot-row thinking-row';
    thinkingRow.innerHTML = `
      <div class="message-avatar" style="background: var(--gemini-gradient); box-shadow: 0 0 16px rgba(129, 140, 248, 0.45);">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M12 2C12 7.52 7.52 12 2 12C7.52 12 12 16.48 12 22C12 16.48 16.48 12 22 12C16.48 12 12 7.52 12 2Z"/></svg>
      </div>
      <div class="message-content-box">
        <div class="message-bubble" style="color: var(--text-muted); display: flex; align-items: center; gap: 8px;">
          <span>Retrieving verified chunks & grounding evidence</span>
          <span class="streaming-cursor"></span>
        </div>
      </div>
    `;
    chatMessagesEl.appendChild(thinkingRow);
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;

    const options = {
      topK: RAG_TOP_K,
      threshold: RAG_THRESHOLD,
      filterType: RAG_FILTER_TYPE
    };

    setTimeout(async () => {
      // GroundedRAG 2.0: Multi-turn question condensation (ported from groundedrag/core/generator.py)
      let effectiveQuery = query;
      if (conversationHistory.length > 0) {
        try {
          effectiveQuery = await GroundRAGAPI.condenseQuestion({ question: query, history: conversationHistory });
        } catch (_) { }
      }

      const retrievedChunks = ragEngine.retrieve(effectiveQuery, options);

      // Add user turn to conversation history
      conversationHistory.push({ role: 'user', content: query });

      const ragResponse = await ragEngine.generateAnswerAsync(query, retrievedChunks, conversationHistory);

      // Add assistant turn to conversation history
      if (ragResponse.answerText) {
        conversationHistory.push({ role: 'assistant', content: ragResponse.answerText });
      }

      // Remove thinking indicator
      thinkingRow.remove();

      currentCitations = ragResponse.citations;
      latestMindMapData = ragResponse.mindMapData;

      appendGroundedBotMessage(ragResponse, query);
      renderEvidenceInspector(ragResponse.citations);

      if (latestMindMapData) {
        mindMapInstance.render(latestMindMapData);
      }
    }, 280);
  }

  function appendMessage(role, text) {
    const row = document.createElement('div');
    row.className = `message-row ${role}-row`;
    const avatar = role === 'user'
      ? 'YOU'
      : `<svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M12 2C12 7.52 7.52 12 2 12C7.52 12 12 16.48 12 22C12 16.48 16.48 12 22 12C16.48 12 12 7.52 12 2Z"/></svg>`;

    const avatarStyle = role === 'bot'
      ? 'style="background: var(--gemini-gradient); box-shadow: 0 0 16px rgba(129, 140, 248, 0.45);"'
      : '';

    row.innerHTML = `
      <div class="message-avatar" ${avatarStyle}>${avatar}</div>
      <div class="message-content-box">
        <div class="message-bubble">${escapeHtml(text)}</div>
      </div>
    `;

    chatMessagesEl.appendChild(row);
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  }

  function appendGroundedBotMessage(ragResponse, originalQuery) {
    const row = document.createElement('div');
    row.className = 'message-row bot-row';

    const faithfulness = ragResponse.faithfulness;
    const citationsCount = ragResponse.citations.length;

    let entailmentColor = '#38bdf8';
    if (faithfulness.percentage >= 80) entailmentColor = '#34d399';
    else if (faithfulness.percentage < 65) entailmentColor = '#f59e0b';

    row.innerHTML = `
      <div class="message-avatar" style="background: var(--gemini-gradient); box-shadow: 0 0 16px rgba(129, 140, 248, 0.45);">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M12 2C12 7.52 7.52 12 2 12C7.52 12 12 16.48 12 22C12 16.48 16.48 12 22 12C16.48 12 12 7.52 12 2Z"/></svg>
      </div>
      <div class="message-content-box">
        <div class="message-bubble">
          ${ragResponse.answerHtml}
          
          <div class="msg-action-bar">
            <button class="msg-action-tool btn-copy-answer" title="Copy answer">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              <span>Copy</span>
            </button>
            <button class="msg-action-tool btn-view-evidence" title="View backing citations">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              <span>Inspect (${citationsCount})</span>
            </button>
            <button class="msg-action-tool btn-view-mindmap" title="Open interactive mind map">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
              <span>Mind Map</span>
            </button>
          </div>
        </div>

        ${citationsCount > 0 ? `
          <div class="verification-card">
            <div class="verification-metrics">
              <div class="metric-pill">
                <span>Grounding:</span>
                <strong style="color: ${entailmentColor};">${faithfulness.entailmentRate} (${faithfulness.percentage}%)</strong>
              </div>
              <div class="metric-pill">
                <span>Verified Sources:</span>
                <strong>${citationsCount}</strong>
              </div>
              <div class="metric-pill">
                <span>Lexical Overlap:</span>
                <strong>${faithfulness.lexicalOverlap}</strong>
              </div>
            </div>

            <div class="action-tools-group">
              <button class="mini-action-btn btn-view-evidence">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                Inspect Sources
              </button>
              <button class="mini-action-btn btn-view-mindmap" style="background: rgba(37,99,235,0.4); border-color: var(--blue-neon); color: #fff;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                Mind Map
              </button>
            </div>
          </div>
        ` : ''}
      </div>
    `;

    // Copy action
    const btnCopy = row.querySelector('.btn-copy-answer');
    if (btnCopy) {
      btnCopy.addEventListener('click', () => {
        const textToCopy = row.querySelector('.message-bubble').innerText;
        navigator.clipboard.writeText(textToCopy).then(() => {
          btnCopy.classList.add('copied');
          btnCopy.innerHTML = `<span>Copied! ✓</span>`;
          setTimeout(() => {
            btnCopy.classList.remove('copied');
            btnCopy.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg><span>Copy</span>`;
          }, 2000);
        });
      });
    }

    row.querySelectorAll('.btn-view-evidence').forEach(btn => {
      btn.addEventListener('click', () => openDrawer('inspector'));
    });

    row.querySelectorAll('.btn-view-mindmap').forEach(btn => {
      btn.addEventListener('click', () => {
        openDrawer('mindmap');
        if (!appRightPanel.classList.contains('expanded')) {
          appRightPanel.classList.add('expanded');
          setTimeout(() => mindMapInstance.render(latestMindMapData), 250);
        }
      });
    });

    row.querySelectorAll('.citation-badge').forEach(badge => {
      badge.addEventListener('click', () => {
        const citNum = parseInt(badge.getAttribute('data-citation'), 10);
        openDrawer('inspector');
        highlightEvidenceCard(citNum);
      });
    });

    chatMessagesEl.appendChild(row);
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  }

  // 10. Populate Evidence Inspector Cards
  function renderEvidenceInspector(citations) {
    if (!citations || citations.length === 0) {
      inspectorChunksContainer.innerHTML = `
        <div style="text-align: center; color: var(--text-dim); padding: 40px 20px; font-size: 0.82rem;">
          No retrieved chunks for the current query.
        </div>
      `;
      return;
    }

    inspectorChunksContainer.innerHTML = `
      <div style="margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center;">
        <span style="font-size: 0.78rem; font-weight: 700; color: var(--blue-neon);">
          ${citations.length} Grounded References
        </span>
        <span style="font-size: 0.72rem; color: var(--text-dim);">Click citation in chat to jump</span>
      </div>
    `;

    citations.forEach(cit => {
      const card = document.createElement('div');
      card.className = 'evidence-chunk-card';
      card.id = `evidence-card-${cit.number}`;

      card.innerHTML = `
        <div class="chunk-header">
          <div class="chunk-title">
            <span class="chunk-badge">[${cit.number}]</span>
            <span>${escapeHtml(cit.section || 'Verbatim Evidence')}</span>
          </div>
          <span style="font-size: 0.72rem; color: var(--cyan-accent); font-family: 'JetBrains Mono', monospace; font-weight: 600;">
            Match: ${Math.round(cit.score * 100)}%
          </span>
        </div>
        <div class="chunk-verbatim-text">${escapeHtml(cit.verbatimQuote)}</div>
        <div class="chunk-footer">
          <span>📁 ${escapeHtml(cit.filename)}</span>
          <span>Chars: ${cit.startOffset} - ${cit.endOffset}</span>
        </div>
      `;

      inspectorChunksContainer.appendChild(card);
    });
  }

  function highlightEvidenceCard(citationNumber) {
    const allCards = document.querySelectorAll('.evidence-chunk-card');
    allCards.forEach(c => c.classList.remove('highlighted'));

    const targetCard = document.getElementById(`evidence-card-${citationNumber}`);
    if (targetCard) {
      targetCard.classList.add('highlighted');
      targetCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  // Quick Prompts Clicking
  quickPromptChips.forEach(chip => {
    chip.addEventListener('click', () => {
      const promptText = chip.getAttribute('data-prompt');
      chatInputEl.value = promptText;
      handleSendMessage();
    });
  });

  chatSendBtnEl.addEventListener('click', handleSendMessage);
  chatInputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSendMessage();
    }
  });

  // Helper escape
  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Initial render of sources
  renderSourcesList();

  // ============================================================
  // DEDICATED MIND MAP & VISUAL CONCEPT DIAGRAM GENERATION
  // ============================================================

  // Generate Grounded Mind Map from PDF or active source
  async function generateMindMapForSource(source = null) {
    if (!source) {
      source = ragEngine.sources.find(s => s.filename?.toLowerCase().endsWith('.pdf') || s.type === 'paper') || ragEngine.sources[0];
    }

    if (!source) {
      alert('Please upload a PDF document or ingest a knowledge source first!');
      openIngestModalTab('tab-upload');
      return;
    }

    if (chatHeroContainer) chatHeroContainer.style.display = 'none';
    chatMessagesEl.style.display = 'flex';

    appendMessage('user', `🧠 Generate interactive Mind Map from **${source.title}**`);

    const thinkingRow = document.createElement('div');
    thinkingRow.className = 'message-row bot-row thinking-row';
    thinkingRow.innerHTML = `
      <div class="message-avatar" style="background: var(--gemini-gradient); box-shadow: 0 0 16px rgba(129, 140, 248, 0.45);">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M12 2C12 7.52 7.52 12 2 12C7.52 12 12 16.48 12 22C12 16.48 16.48 12 22 12C16.48 12 12 7.52 12 2Z"/></svg>
      </div>
      <div class="message-content-box">
        <div class="message-bubble" style="color: var(--text-muted); display: flex; align-items: center; gap: 8px;">
          <span>Analyzing document structure & synthesizing hierarchical concept tree...</span>
          <span class="streaming-cursor"></span>
        </div>
      </div>
    `;
    chatMessagesEl.appendChild(thinkingRow);
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;

    try {
      const data = await GroundRAGAPI.generateMindMap({
        content: source.content,
        chunks: source.chunks,
        topic: source.title
      });

      thinkingRow.remove();

      if (data && (data.branches || data.topic)) {
        latestMindMapData = data;

        // Open Mind Map drawer and expand
        openDrawer('mindmap');
        if (!appRightPanel.classList.contains('expanded')) {
          appRightPanel.classList.add('expanded');
        }
        setTimeout(() => mindMapInstance.render(data), 260);

        // Append Bot card in chat
        const cardRow = document.createElement('div');
        cardRow.className = 'message-row bot-row';
        cardRow.innerHTML = `
          <div class="message-avatar" style="background: var(--gemini-gradient); box-shadow: 0 0 16px rgba(129, 140, 248, 0.45);">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M12 2C12 7.52 7.52 12 2 12C7.52 12 12 16.48 12 22C12 16.48 16.48 12 22 12C16.48 12 12 7.52 12 2Z"/></svg>
          </div>
          <div class="message-content-box" style="width: 100%; max-width: 680px;">
            <div class="message-bubble" style="width: 100%;">
              <div style="font-weight: 700; color: #38bdf8; font-size: 0.94rem; margin-bottom: 6px; display: flex; align-items: center; gap: 8px;">
                <span>🧠 Grounded Mind Map Generated:</span>
                <span style="color: #fff;">${escapeHtml(data.topic || source.title)}</span>
              </div>
              <p style="font-size: 0.8rem; color: #94a3b8; line-height: 1.5; margin-bottom: 12px;">
                Successfully extracted <strong>${(data.branches || []).length} core concept branches</strong> with traceable evidence points directly from <em>${escapeHtml(source.filename || source.title)}</em>. The interactive graph has opened on your right canvas!
              </p>
              <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                <button class="mini-action-btn btn-open-mm-drawer" style="background: rgba(37,99,235,0.4); border-color: #38bdf8; color: #fff; padding: 6px 14px; font-size: 0.78rem;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                  View Interactive Canvas
                </button>
                <button class="mini-action-btn btn-download-mm-png" style="background: rgba(16,185,129,0.2); border-color: #34d399; color: #34d399; padding: 6px 14px; font-size: 0.78rem;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                  📸 Export Image (PNG)
                </button>
              </div>
            </div>
          </div>
        `;

        cardRow.querySelector('.btn-open-mm-drawer')?.addEventListener('click', () => {
          openDrawer('mindmap');
          if (!appRightPanel.classList.contains('expanded')) appRightPanel.classList.add('expanded');
          setTimeout(() => mindMapInstance.render(data), 150);
        });

        cardRow.querySelector('.btn-download-mm-png')?.addEventListener('click', () => {
          mindMapInstance.exportAsImage('png');
        });

        chatMessagesEl.appendChild(cardRow);
        chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
      }
    } catch (err) {
      thinkingRow.remove();
      appendMessage('bot', `⚠️ Could not generate Mind Map: ${err.message}`);
    }
  }

  // Generate Visual Concept Diagram & Infographic Image from Content
  async function generateDiagramForSource(source = null) {
    if (!source) {
      source = ragEngine.sources.find(s => s.filename?.toLowerCase().endsWith('.pdf') || s.type === 'paper') || ragEngine.sources[0];
    }

    if (!source) {
      alert('Please upload a PDF document or ingest a knowledge source first!');
      openIngestModalTab('tab-upload');
      return;
    }

    if (chatHeroContainer) chatHeroContainer.style.display = 'none';
    chatMessagesEl.style.display = 'flex';

    appendMessage('user', `🖼️ Generate Visual Concept Diagram Image for **${source.title}**`);

    const thinkingRow = document.createElement('div');
    thinkingRow.className = 'message-row bot-row thinking-row';
    thinkingRow.innerHTML = `
      <div class="message-avatar" style="background: var(--gemini-gradient); box-shadow: 0 0 16px rgba(129, 140, 248, 0.45);">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M12 2C12 7.52 7.52 12 2 12C7.52 12 12 16.48 12 22C12 16.48 16.48 12 22 12C16.48 12 12 7.52 12 2Z"/></svg>
      </div>
      <div class="message-content-box">
        <div class="message-bubble" style="color: var(--text-muted); display: flex; align-items: center; gap: 8px;">
          <span>Synthesizing visual concept nodes, color schemes, and infographics...</span>
          <span class="streaming-cursor"></span>
        </div>
      </div>
    `;
    chatMessagesEl.appendChild(thinkingRow);
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;

    try {
      const res = await GroundRAGAPI.generateDiagram({
        content: source.content,
        topic: source.title,
        filename: source.filename
      });

      thinkingRow.remove();

      if (res && res.diagram) {
        const d = res.diagram;
        const row = document.createElement('div');
        row.className = 'message-row bot-row';

        const nodesHtml = (d.nodes || []).map(n => `
          <div class="concept-node-box" style="border-left-color: ${n.color || '#38bdf8'};">
            <div class="concept-node-cat" style="color: ${n.color || '#38bdf8'};">${escapeHtml(n.category || 'Concept')}</div>
            <div class="concept-node-title">${escapeHtml(n.title)}</div>
            <div class="concept-node-desc">${escapeHtml(n.description)}</div>
            ${(n.points && n.points.length > 0) ? `
              <ul class="concept-node-points">
                ${n.points.map(pt => `<li>${escapeHtml(pt)}</li>`).join('')}
              </ul>
            ` : ''}
          </div>
        `).join('');

        row.innerHTML = `
          <div class="message-avatar" style="background: var(--gemini-gradient); box-shadow: 0 0 16px rgba(129, 140, 248, 0.45);">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M12 2C12 7.52 7.52 12 2 12C7.52 12 12 16.48 12 22C12 16.48 16.48 12 22 12C16.48 12 12 7.52 12 2Z"/></svg>
          </div>
          <div class="message-content-box" style="width: 100%; max-width: 780px;">
            <div class="concept-diagram-card" id="diagram-${Date.now()}">
              <div class="concept-diagram-header">
                <div class="concept-diagram-title">
                  <span>🖼️ ${escapeHtml(d.title || source.title)}</span>
                  <span class="concept-diagram-badge">Visual Concept Infographic</span>
                </div>
                <button class="btn-diagram-export" title="Download High-Res PNG Image">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  <span>Download Image (PNG)</span>
                </button>
              </div>
              <div class="concept-diagram-summary">
                ${escapeHtml(d.summary || 'Visual concept architecture extracted from document.')}
              </div>
              <div class="concept-nodes-grid">
                ${nodesHtml}
              </div>
              <div class="concept-diagram-footer">
                <span style="font-size: 0.72rem; color: #64748b;">Source Grounded: <strong>${escapeHtml(source.filename || source.title)}</strong></span>
                <button class="source-action-pill pill-mm btn-inline-mindmap" title="Switch to Tree Mind Map">
                  🧠 Open as Mind Map Tree
                </button>
              </div>
            </div>
          </div>
        `;

        row.querySelector('.btn-diagram-export')?.addEventListener('click', () => {
          exportDiagramCardToImage(d, source.title);
        });

        row.querySelector('.btn-inline-mindmap')?.addEventListener('click', () => {
          generateMindMapForSource(source);
        });

        chatMessagesEl.appendChild(row);
        chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
      }
    } catch (err) {
      thinkingRow.remove();
      appendMessage('bot', `⚠️ Could not generate Concept Diagram: ${err.message}`);
    }
  }

  // Export Concept Diagram Card to Crisp PNG Image
  function exportDiagramCardToImage(diagram, docTitle) {
    const canvas = document.createElement('canvas');
    const width = 1100;
    const nodes = diagram.nodes || [];
    const rows = Math.ceil(nodes.length / 3);
    const height = 240 + rows * 180;
    const scale = 2;

    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);

    // Dark sleek background
    const bgGrad = ctx.createLinearGradient(0, 0, width, height);
    bgGrad.addColorStop(0, '#070a12');
    bgGrad.addColorStop(1, '#0c1322');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    // Decorative grid pattern
    ctx.fillStyle = 'rgba(56, 189, 248, 0.04)';
    for (let x = 0; x < width; x += 25) {
      for (let y = 0; y < height; y += 25) {
        ctx.beginPath();
        ctx.arc(x, y, 1, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Top Header Banner
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 22px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(diagram.title || docTitle || 'Conceptual Diagram', 40, 52);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '13px "Plus Jakarta Sans", sans-serif';
    const summary = diagram.summary || 'Source Grounded System Concept Map';
    ctx.fillText(summary.length > 110 ? summary.substring(0, 107) + '...' : summary, 40, 80);

    // Draw Nodes Grid
    const colWidth = 320;
    const rowHeight = 150;
    const startX = 40;
    const startY = 115;

    nodes.forEach((node, idx) => {
      const col = idx % 3;
      const row = Math.floor(idx / 3);
      const x = startX + col * (colWidth + 20);
      const y = startY + row * (rowHeight + 20);
      const nodeColor = node.color || '#38bdf8';

      // Card box
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(x, y, colWidth, rowHeight, 10);
      ctx.fill();
      ctx.stroke();

      // Left Accent bar
      ctx.fillStyle = nodeColor;
      ctx.beginPath();
      ctx.roundRect(x, y, 6, rowHeight, [10, 0, 0, 10]);
      ctx.fill();

      // Category tag
      ctx.fillStyle = nodeColor;
      ctx.font = 'bold 10px "Plus Jakarta Sans", sans-serif';
      ctx.fillText((node.category || 'CONCEPT').toUpperCase(), x + 18, y + 26);

      // Node Title
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 14px "Plus Jakarta Sans", sans-serif';
      const nodeTitle = node.title || 'Concept Node';
      ctx.fillText(nodeTitle.length > 28 ? nodeTitle.substring(0, 26) + '..' : nodeTitle, x + 18, y + 48);

      // Description
      ctx.fillStyle = '#94a3b8';
      ctx.font = '11px "Plus Jakarta Sans", sans-serif';
      const desc = node.description || '';
      ctx.fillText(desc.length > 44 ? desc.substring(0, 42) + '...' : desc, x + 18, y + 72);

      // Bullet points
      if (node.points && node.points.length > 0) {
        ctx.fillStyle = '#cbd5e1';
        ctx.font = '10px "Plus Jakarta Sans", sans-serif';
        node.points.slice(0, 2).forEach((pt, pIdx) => {
          ctx.fillText(`✦ ${pt.length > 42 ? pt.substring(0, 40) + '..' : pt}`, x + 18, y + 96 + pIdx * 18);
        });
      }
    });

    // Footer Watermark
    ctx.fillStyle = '#64748b';
    ctx.font = '11px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(`✨ Generated by GroundRAG • Strict Source Grounding • ${new Date().toLocaleDateString()}`, 40, height - 20);

    const pngUrl = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.download = `Diagram_${(docTitle || 'concept').replace(/[^a-zA-Z0-9_-]/g, '_')}.png`;
    a.href = pngUrl;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // Quick Action Buttons in Drawer Header
  document.getElementById('btn-quick-gen-mindmap')?.addEventListener('click', () => generateMindMapForSource());
  document.getElementById('btn-quick-gen-diagram')?.addEventListener('click', () => generateDiagramForSource());

  // ============================================================
  // OVERLAY MODE — True Cross-Tab Floating Window
  // Uses Document Picture-in-Picture API (Chrome 116+) for a
  // genuine always-on-top window that overlays other tabs/apps.
  // Falls back to window.open() popup on unsupported browsers.
  // ============================================================
  const btnToggleOverlay = document.getElementById('btn-toggle-overlay-mode');
  const floatingBubble = document.getElementById('floating-assistant-bubble');

  let overlayPipWindow = null; // Document PiP window reference
  let overlayPopupWindow = null; // window.open() fallback reference

  /**
   * Build the mini HTML document content for the overlay window.
   * This is a self-contained chat interface that postMessages
   * queries back to the parent page (which runs the RAG engine).
   */
  function buildOverlayHTML() {
    const cssHref = window.location.origin + '/css/style.css';
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>GroundRAG Overlay</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-main:#070a12;--bg-card:rgba(14,20,34,.8);--bg-input:rgba(15,23,42,.9);
      --border-subtle:rgba(99,102,241,.18);--border-glow:rgba(56,189,248,.45);
      --gemini-blue:#38bdf8;--gemini-purple:#818cf8;--gemini-violet:#c084fc;
      --gemini-gradient:linear-gradient(135deg,#38bdf8 0%,#818cf8 50%,#c084fc 100%);
      --blue-neon:#38bdf8;--cyan-accent:#00f2fe;
      --text-main:#f8fafc;--text-muted:#94a3b8;--text-dim:#64748b;
      --danger:#ef4444;--success:#10b981;--warning:#f59e0b;
    }
    *{box-sizing:border-box;margin:0;padding:0}
    html,body{
      width:100%;height:100%;overflow:hidden;
      font-family:'Plus Jakarta Sans',-apple-system,sans-serif;
      background:var(--bg-main);color:var(--text-main);
      -webkit-font-smoothing:antialiased;
      display:flex;flex-direction:column;
    }
    ::-webkit-scrollbar{width:4px}
    ::-webkit-scrollbar-thumb{background:rgba(56,189,248,.25);border-radius:4px}

    /* Mini header */
    .ov-header{
      display:flex;align-items:center;justify-content:space-between;
      padding:8px 12px;
      background:rgba(8,12,20,.95);
      border-bottom:1px solid var(--border-subtle);
      flex-shrink:0;
      -webkit-app-region:drag; /* draggable in PiP */
    }
    .ov-brand{
      display:flex;align-items:center;gap:8px;
      font-size:.82rem;font-weight:700;
      background:var(--gemini-gradient);
      -webkit-background-clip:text;background-clip:text;
      -webkit-text-fill-color:transparent;
    }
    .ov-brand svg{flex-shrink:0}
    .ov-controls{display:flex;gap:5px;-webkit-app-region:no-drag}
    .ov-ctrl{
      width:18px;height:18px;border-radius:50%;border:none;
      cursor:pointer;font-size:.55rem;font-weight:900;color:#000;
      display:flex;align-items:center;justify-content:center;
      transition:transform .15s;
    }
    .ov-ctrl:hover{transform:scale(1.15)}
    .ov-minimize{background:#fbbf24}
    .ov-close{background:#f87171}

    /* Messages area */
    .ov-messages{
      flex:1;overflow-y:auto;padding:10px;
      display:flex;flex-direction:column;gap:10px;
    }
    .ov-msg{display:flex;gap:8px;align-items:flex-start}
    .ov-avatar{
      width:26px;height:26px;border-radius:50%;flex-shrink:0;
      display:flex;align-items:center;justify-content:center;
      font-size:.6rem;font-weight:700;
    }
    .ov-avatar-bot{background:var(--gemini-gradient);box-shadow:0 0 10px rgba(129,140,248,.4)}
    .ov-avatar-user{background:rgba(37,99,235,.4);border:1px solid rgba(56,189,248,.4);color:var(--blue-neon);font-size:.55rem}
    .ov-bubble{
      background:rgba(14,20,34,.8);border:1px solid var(--border-subtle);
      border-radius:10px;padding:8px 12px;font-size:.78rem;line-height:1.55;
      color:#e2e8f0;max-width:calc(100% - 42px);word-break:break-word;
    }
    .ov-bubble.user-bubble{
      background:rgba(29,78,216,.15);border-color:rgba(56,189,248,.25);
    }
    .ov-thinking{
      display:flex;align-items:center;gap:6px;
      font-size:.72rem;color:var(--text-dim);padding:6px 0;
    }
    .ov-dot{
      width:6px;height:6px;border-radius:50%;background:var(--gemini-blue);
      animation:ovDotPulse 1.2s infinite ease-in-out;
    }
    .ov-dot:nth-child(2){animation-delay:.2s}
    .ov-dot:nth-child(3){animation-delay:.4s}
    @keyframes ovDotPulse{0%,80%,100%{transform:scale(0.7);opacity:.4}40%{transform:scale(1);opacity:1}}

    /* No sources state */
    .ov-no-sources{
      flex:1;display:flex;flex-direction:column;align-items:center;
      justify-content:center;gap:8px;text-align:center;padding:20px;
    }
    .ov-no-sources-icon{font-size:2rem}
    .ov-no-sources-text{font-size:.72rem;color:var(--text-dim);line-height:1.5}

    /* Input area */
    .ov-input-wrap{
      padding:8px;border-top:1px solid var(--border-subtle);
      background:rgba(8,12,20,.92);flex-shrink:0;
    }
    .ov-input-row{
      display:flex;align-items:flex-end;gap:6px;
      background:rgba(13,18,32,.9);
      border:1px solid rgba(129,140,248,.25);
      border-radius:22px;padding:6px 8px;
    }
    .ov-input-row:focus-within{border-color:rgba(56,189,248,.6)}
    .ov-lens-btn{
      background:rgba(251,191,36,.15);border:1px solid rgba(251,191,36,.4);
      color:#fbbf24;border-radius:50%;width:28px;height:28px;flex-shrink:0;
      font-size:.75rem;cursor:pointer;display:flex;align-items:center;
      justify-content:center;transition:all .18s;
    }
    .ov-lens-btn:hover{background:rgba(251,191,36,.3);box-shadow:0 0 8px rgba(251,191,36,.4)}
    .ov-textarea{
      flex:1;background:transparent;border:none;color:#fff;
      font-size:.78rem;font-family:inherit;outline:none;
      resize:none;max-height:80px;line-height:1.45;padding:2px 0;
    }
    .ov-textarea::placeholder{color:var(--text-dim)}
    .ov-send{
      background:var(--gemini-gradient);border:none;color:#fff;
      width:28px;height:28px;border-radius:50%;cursor:pointer;flex-shrink:0;
      display:flex;align-items:center;justify-content:center;
      transition:transform .15s,box-shadow .15s;
    }
    .ov-send:hover{transform:scale(1.1);box-shadow:0 0 12px rgba(56,189,248,.5)}
    .ov-send:disabled{opacity:.4;cursor:default;transform:none}

    /* Citation badge */
    .ov-citation{
      display:inline-block;background:rgba(37,99,235,.3);border:1px solid var(--blue-neon);
      color:var(--blue-neon);font-size:.65rem;font-weight:700;
      padding:0 4px;border-radius:4px;margin:0 2px;
      font-family:'JetBrains Mono',monospace;
    }
    /* Sources count pill */
    .ov-sources-pill{
      font-size:.6rem;background:rgba(16,185,129,.15);border:1px solid rgba(16,185,129,.4);
      color:#34d399;padding:2px 7px;border-radius:10px;font-weight:600;
    }
    .ov-cta-scan-btn{
      margin-top:12px;background:var(--gemini-gradient);border:none;color:#fff;
      font-weight:700;font-size:.78rem;padding:9px 18px;border-radius:20px;
      cursor:pointer;display:inline-flex;align-items:center;gap:6px;
      box-shadow:0 0 15px rgba(56,189,248,.35);transition:all .2s;
    }
    .ov-cta-scan-btn:hover{transform:scale(1.05);box-shadow:0 0 20px rgba(56,189,248,.6)}
    .ov-hdr-scan-btn{
      background:rgba(251,191,36,.15);border:1px solid rgba(251,191,36,.4);
      color:#fbbf24;font-size:.65rem;font-weight:700;padding:3px 9px;
      border-radius:12px;cursor:pointer;margin-right:8px;-webkit-app-region:no-drag;
      transition:all .15s;display:flex;align-items:center;gap:4px;
    }
    .ov-hdr-scan-btn:hover{background:rgba(251,191,36,.3);transform:scale(1.04)}
    /* Lens suggest chips */
    .ov-lens-chips{display:flex;flex-wrap:wrap;gap:4px;padding:4px 8px 2px}
    .ov-lens-chip{
      background:rgba(251,191,36,.12);border:1px solid rgba(251,191,36,.35);
      color:#fbbf24;font-size:.65rem;padding:3px 8px;border-radius:14px;
      cursor:pointer;transition:all .15s;font-weight:500;
    }
    .ov-lens-chip:hover{background:rgba(251,191,36,.25)}
  </style>
</head>
<body>
  <div class="ov-header">
    <div class="ov-brand">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="url(#gg)">
        <defs>
          <linearGradient id="gg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#38bdf8"/>
            <stop offset="50%" stop-color="#818cf8"/>
            <stop offset="100%" stop-color="#c084fc"/>
          </linearGradient>
        </defs>
        <path d="M12 2C12 7.52 7.52 12 2 12C7.52 12 12 16.48 12 22C12 16.48 16.48 12 22 12C16.48 12 12 7.52 12 2Z"/>
      </svg>
      GroundRAG
      <span class="ov-sources-pill" id="ov-src-count">0 sources</span>
    </div>
    <div class="ov-controls">
      <button class="ov-hdr-scan-btn" id="ov-hdr-scan-btn" title="Scan what is on your screen and answer">
        📷 Scan Screen
      </button>
      <button class="ov-ctrl ov-minimize" id="ov-minimize-btn" title="Minimize">—</button>
      <button class="ov-ctrl ov-close"    id="ov-close-btn"    title="Close">✕</button>
    </div>
  </div>

  <div class="ov-messages" id="ov-messages">
    <div class="ov-no-sources" id="ov-no-sources">
      <div class="ov-no-sources-icon">📷</div>
      <div class="ov-no-sources-text">
        <strong>Ready to scan your screen!</strong><br>
        Click below to capture what's on your screen and GroundRAG will analyze and answer presenting it.
      </div>
      <button class="ov-cta-scan-btn" id="ov-cta-scan-btn">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M3 9V5a2 2 0 0 1 2-2h4M19 3h4a2 2 0 0 1 2 2v4M21 15v4a2 2 0 0 1-2 2h-4M5 21H3a2 2 0 0 1-2-2v-4"/></svg>
        Scan Screen & Answer
      </button>
    </div>
  </div>

  <div id="ov-lens-chips-area"></div>

  <div class="ov-input-wrap">
    <div class="ov-input-row">
      <button class="ov-lens-btn" id="ov-lens-btn" title="Google Lens — scan screen and answer">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3"/>
          <path d="M3 9V5a2 2 0 0 1 2-2h4M19 3h4a2 2 0 0 1 2 2v4M21 15v4a2 2 0 0 1-2 2h-4M5 21H3a2 2 0 0 1-2-2v-4"/>
        </svg>
      </button>
      <textarea class="ov-textarea" id="ov-query-input" placeholder="Ask anything about what's on screen..." rows="1"></textarea>
      <button class="ov-send" id="ov-send-btn" title="Send">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
        </svg>
      </button>
    </div>
  </div>

  <script>
    const messagesEl   = document.getElementById('ov-messages');
    const noSourcesEl  = document.getElementById('ov-no-sources');
    const queryInput   = document.getElementById('ov-query-input');
    const sendBtn      = document.getElementById('ov-send-btn');
    const lensBtn      = document.getElementById('ov-lens-btn');
    const srcCountEl   = document.getElementById('ov-src-count');
    const lensChipsArea = document.getElementById('ov-lens-chips-area');
    let isBusy = false;

    function postToParent(msg) {
      try {
        if (window._groundRagParent && !window._groundRagParent.closed) {
          window._groundRagParent.postMessage(msg, '*');
          return;
        }
      } catch (_) {}
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(msg, '*');
          return;
        }
      } catch (_) {}
      try {
        window.postMessage(msg, '*');
      } catch (_) {}
    }

    function triggerScreenScan() {
      if (isBusy) return;
      isBusy = true;
      sendBtn.disabled = true;
      noSourcesEl?.remove();
      lensChipsArea.innerHTML = '';
      appendUserMessage('📷 Scan Screen: What is currently presenting on this screen?');
      appendThinking('Scanning screen with Gemini Multimodal Vision...');
      postToParent({ type: 'GROUNDRAG_LENS_CAPTURE', autoAnswer: true });
    }

    // Auto-grow textarea
    queryInput.addEventListener('input', () => {
      queryInput.style.height = 'auto';
      queryInput.style.height = Math.min(queryInput.scrollHeight, 80) + 'px';
    });

    // Receive messages from parent (RAG answers, source updates)
    window.addEventListener('message', (e) => {
      if (!e.data || !e.data.type) return;
      if (e.data.type === 'GROUNDRAG_ANSWER') {
        removeThinking();
        appendBotMessage(e.data.answer, e.data.citations || []);
        isBusy = false;
        sendBtn.disabled = false;
      }
      if (e.data.type === 'GROUNDRAG_SOURCES_UPDATE') {
        const count = e.data.count || 0;
        srcCountEl.textContent = count + ' source' + (count !== 1 ? 's' : '');
        if (count > 0 && noSourcesEl && noSourcesEl.parentNode) noSourcesEl.remove();
      }
      if (e.data.type === 'GROUNDRAG_LENS_RESULT') {
        // Show follow-up suggestion chips (answer was already delivered via GROUNDRAG_ANSWER)
        showLensChips();
      }
      if (e.data.type === 'GROUNDRAG_THINKING') {
        // Update the thinking spinner label while parent is working
        removeThinking();
        appendThinking(e.data.message || 'Analyzing...');
      }
      if (e.data.type === 'GROUNDRAG_LENS_CANCELLED') {
        removeThinking();
        appendBotMessage('Screen capture was cancelled. Click the 📷 button anytime to scan your screen.', []);
        isBusy = false;
        sendBtn.disabled = false;
      }
    });

    function appendUserMessage(text) {
      noSourcesEl?.remove();
      const row = document.createElement('div');
      row.className = 'ov-msg';
      row.innerHTML = '<div class="ov-avatar ov-avatar-user">YOU</div>'
        + '<div class="ov-bubble user-bubble">' + escHtml(text) + '</div>';
      messagesEl.appendChild(row);
      messagesEl.scrollTop = 9999;
    }

    function appendThinking(label = 'Grounding answer...') {
      removeThinking();
      const row = document.createElement('div');
      row.className = 'ov-msg ov-thinking-row';
      row.innerHTML = '<div class="ov-avatar ov-avatar-bot">'
        + '<svg width="12" height="12" viewBox="0 0 24 24" fill="white"><path d="M12 2C12 7.52 7.52 12 2 12C7.52 12 12 16.48 12 22C12 16.48 16.48 12 22 12C16.48 12 12 7.52 12 2Z"/></svg>'
        + '</div>'
        + '<div class="ov-thinking"><div class="ov-dot"></div><div class="ov-dot"></div><div class="ov-dot"></div><span>' + escHtml(label) + '</span></div>';
      messagesEl.appendChild(row);
      messagesEl.scrollTop = 9999;
    }

    function removeThinking() {
      document.querySelector('.ov-thinking-row')?.remove();
    }

    function appendBotMessage(text, citations) {
      const row = document.createElement('div');
      row.className = 'ov-msg';
      // Replace citation markers [N] with styled badges
      let html = escHtml(text).replace(/\\[([0-9]+)\\]/g, '<span class="ov-citation">[$1]</span>');
      // Convert **bold** markdown
      html = html.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
      // Format line breaks and bullet points
      html = html.replace(/\n- /g, '<br>• ').replace(/\n\n/g, '<br><br>').replace(/\n/g, '<br>');
      row.innerHTML = '<div class="ov-avatar ov-avatar-bot">'
        + '<svg width="12" height="12" viewBox="0 0 24 24" fill="white"><path d="M12 2C12 7.52 7.52 12 2 12C7.52 12 12 16.48 12 22C12 16.48 16.48 12 22 12C16.48 12 12 7.52 12 2Z"/></svg>'
        + '</div>'
        + '<div class="ov-bubble">' + html + '</div>';
      messagesEl.appendChild(row);
      messagesEl.scrollTop = 9999;
    }

    function sendQuery() {
      const query = queryInput.value.trim();
      if (!query || isBusy) return;
      isBusy = true;
      sendBtn.disabled = true;
      lensChipsArea.innerHTML = '';
      appendUserMessage(query);
      queryInput.value = '';
      queryInput.style.height = 'auto';
      appendThinking('Grounding answer with active sources...');
      postToParent({ type: 'GROUNDRAG_QUERY', query });
    }

    function showLensChips() {
      lensChipsArea.innerHTML = '';
      const chips = [
        '🔍 Explain this in detail',
        '📋 Extract code & text',
        '🐛 Explain any errors shown',
        '💡 What should I do next?'
      ];
      const wrap = document.createElement('div');
      wrap.className = 'ov-lens-chips';
      chips.forEach(text => {
        const btn = document.createElement('button');
        btn.className = 'ov-lens-chip';
        btn.textContent = text;
        btn.onclick = () => {
          queryInput.value = text.replace(/^[^\w]+/, '');
          lensChipsArea.innerHTML = '';
          sendQuery();
        };
        wrap.appendChild(btn);
      });
      lensChipsArea.appendChild(wrap);
      messagesEl.scrollTop = 9999;
    }

    function escHtml(str) {
      if (!str) return '';
      return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    sendBtn.addEventListener('click', sendQuery);
    queryInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendQuery(); }
    });

    lensBtn.addEventListener('click', triggerScreenScan);
    document.getElementById('ov-hdr-scan-btn')?.addEventListener('click', triggerScreenScan);
    document.getElementById('ov-cta-scan-btn')?.addEventListener('click', triggerScreenScan);

    document.getElementById('ov-minimize-btn').addEventListener('click', () => {
      postToParent({ type: 'GROUNDRAG_OVERLAY_MINIMIZE' });
      window.close();
    });
    document.getElementById('ov-close-btn').addEventListener('click', () => {
      postToParent({ type: 'GROUNDRAG_OVERLAY_CLOSE' });
      window.close();
    });

    // Tell parent we're ready and request current source count
    postToParent({ type: 'GROUNDRAG_OVERLAY_READY' });
  </script>
</body>
</html>`;
  }

  /** Launch true floating overlay using Document Picture-in-Picture or popup */
  async function launchOverlayWindow() {
    // If already open, focus it
    if (overlayPipWindow && !overlayPipWindow.closed) {
      overlayPipWindow.focus();
      return;
    }
    if (overlayPopupWindow && !overlayPopupWindow.closed) {
      overlayPopupWindow.focus();
      return;
    }

    const overlayHtml = buildOverlayHTML();

    // --- Method 1: Document Picture-in-Picture (Chrome 116+, always-on-top) ---
    if ('documentPictureInPicture' in window) {
      try {
        const pipWin = await window.documentPictureInPicture.requestWindow({
          width: 420,
          height: 620,
          disallowReturnToOpener: false,
        });

        // Write content into PiP window
        pipWin.document.open();
        pipWin.document.write(overlayHtml);
        pipWin.document.close();

        // Bridge: Document PiP has no window.opener; set parent reference directly
        pipWin._groundRagParent = window;

        overlayPipWindow = pipWin;
        btnToggleOverlay?.classList.add('active');
        floatingBubble.style.display = 'none';

        // Handle PiP close
        pipWin.addEventListener('pagehide', () => {
          overlayPipWindow = null;
          btnToggleOverlay?.classList.remove('active');
          floatingBubble.style.display = 'none';
        });

        return;
      } catch (err) {
        console.warn('Document PiP failed, falling back to popup:', err);
      }
    }

    // --- Method 2: window.open() popup (works on all browsers) ---
    const screenW = window.screen.availWidth;
    const screenH = window.screen.availHeight;
    const popW = 430, popH = 630;
    const popX = screenW - popW - 20;
    const popY = screenH - popH - 60;

    const popup = window.open(
      '',
      'groundrag-overlay',
      `width=${popW},height=${popH},left=${popX},top=${popY},` +
      `resizable=yes,scrollbars=no,toolbar=no,menubar=no,location=no,status=no`
    );

    if (!popup) {
      alert('GroundRAG Overlay: Please allow pop-ups for this site to use the floating overlay assistant.');
      return;
    }

    popup.document.open();
    popup.document.write(overlayHtml);
    popup.document.close();

    // Bridge: Set parent reference so postToParent() works in popup context
    popup._groundRagParent = window;

    overlayPopupWindow = popup;
    btnToggleOverlay?.classList.add('active');
    floatingBubble.style.display = 'none';

    // Monitor popup closed
    const pollClose = setInterval(() => {
      if (popup.closed) {
        clearInterval(pollClose);
        overlayPopupWindow = null;
        btnToggleOverlay?.classList.remove('active');
        floatingBubble.style.display = 'none';
      }
    }, 800);
  }

  function closeOverlayWindow() {
    overlayPipWindow?.close();
    overlayPopupWindow?.close();
    overlayPipWindow = null;
    overlayPopupWindow = null;
    btnToggleOverlay?.classList.remove('active');
    floatingBubble.style.display = 'none';
  }

  function getOverlayWindow() {
    if (overlayPipWindow && !overlayPipWindow.closed) return overlayPipWindow;
    if (overlayPopupWindow && !overlayPopupWindow.closed) return overlayPopupWindow;
    return null;
  }

  // Listen to messages FROM the overlay window
  window.addEventListener('message', async (e) => {
    if (!e.data || !e.data.type) return;

    if (e.data.type === 'GROUNDRAG_OVERLAY_READY') {
      // Send current source count to the overlay
      const ow = getOverlayWindow();
      ow?.postMessage({ type: 'GROUNDRAG_SOURCES_UPDATE', count: ragEngine.sources.length }, '*');
    }

    if (e.data.type === 'GROUNDRAG_QUERY') {
      const query = e.data.query;
      if (!query) return;
      const ow = getOverlayWindow();

      if (ragEngine.sources.length === 0) {
        ow?.postMessage({
          type: 'GROUNDRAG_ANSWER',
          answer: '⚠️ No sources loaded. Add a PDF, GitHub link or website in the main GroundRAG window first.',
          citations: []
        }, '*');
        return;
      }

      const options = {
        topK: parseInt(controlTopK.value, 10),
        threshold: parseFloat(controlThreshold.value),
        filterType: controlFilterType.value
      };

      const chunks = ragEngine.retrieve(query, options);
      conversationHistory.push({ role: 'user', content: query });
      const response = await ragEngine.generateAnswerAsync(query, chunks, conversationHistory);
      if (response.answerText) {
        conversationHistory.push({ role: 'assistant', content: response.answerText });
      }

      // Also mirror the conversation in the main window chat
      if (chatHeroContainer) chatHeroContainer.style.display = 'none';
      chatMessagesEl.style.display = 'flex';
      appendMessage('user', query);
      currentCitations = response.citations;
      latestMindMapData = response.mindMapData;
      appendGroundedBotMessage(response, query);
      renderEvidenceInspector(response.citations);

      ow?.postMessage({
        type: 'GROUNDRAG_ANSWER',
        answer: response.answerText || response.answerHtml?.replace(/<[^>]+>/g, '') || '',
        citations: response.citations
      }, '*');
    }

    if (e.data.type === 'GROUNDRAG_LENS_CAPTURE') {
      // Trigger screen capture in parent; after capture auto-generate grounded answer
      if (screenLens) {
        const ow = getOverlayWindow();

        // Notify overlay that scan is in progress
        ow?.postMessage({ type: 'GROUNDRAG_THINKING', message: '📷 Scanning screen with Gemini Vision...' }, '*');

        try {
          const result = await screenLens.captureLiveScreen();
          if (!result) {
            ow?.postMessage({ type: 'GROUNDRAG_ANSWER', answer: '⚠️ Screen capture was cancelled or failed. Please try again.', citations: [] }, '*');
            return;
          }

          // Notify overlay capture succeeded, now generating answer
          ow?.postMessage({ type: 'GROUNDRAG_THINKING', message: '✨ Analyzing screen with Gemini Vision...' }, '*');

          // Build prompt grounded in the screen
          const screenQuery = e.data.query || 'What is currently presenting on this screen? Describe in detail the main window, application, code, errors, UI elements, and any key information visible.';

          const options = {
            topK: parseInt(controlTopK?.value ?? '5', 10),
            threshold: parseFloat(controlThreshold?.value ?? '0.08'),
            filterType: controlFilterType?.value ?? 'all'
          };
          const chunks = ragEngine.retrieve(screenQuery, options);

          conversationHistory.push({ role: 'user', content: screenQuery });
          const response = await ragEngine.generateAnswerAsync(screenQuery, chunks, conversationHistory);
          if (response.answerText) {
            conversationHistory.push({ role: 'assistant', content: response.answerText });
          }

          // Mirror in main window chat
          if (chatHeroContainer) chatHeroContainer.style.display = 'none';
          chatMessagesEl.style.display = 'flex';
          appendMessage('user', '📷 ' + screenQuery);
          currentCitations = response.citations;
          latestMindMapData = response.mindMapData;
          appendGroundedBotMessage(response, screenQuery);
          renderEvidenceInspector(response.citations);

          // Send answer + lens result back to overlay
          ow?.postMessage({
            type: 'GROUNDRAG_ANSWER',
            answer: response.answerText || response.answerHtml?.replace(/<[^>]+>/g, '') || '(No answer generated)',
            citations: response.citations
          }, '*');
          ow?.postMessage({ type: 'GROUNDRAG_LENS_RESULT' }, '*');

        } catch (lensErr) {
          console.error('[Lens Capture Error]', lensErr);
          getOverlayWindow()?.postMessage({ type: 'GROUNDRAG_ANSWER', answer: `⚠️ Screen scan error: ${lensErr.message}`, citations: [] }, '*');
        }
      }
    }

    if (e.data.type === 'GROUNDRAG_OVERLAY_MINIMIZE') {
      floatingBubble.style.display = 'flex';
      overlayPipWindow = null;
      overlayPopupWindow = null;
      btnToggleOverlay?.classList.remove('active');
    }

    if (e.data.type === 'GROUNDRAG_OVERLAY_CLOSE') {
      closeOverlayWindow();
    }
  });

  // Sync source count to overlay whenever sources change
  const _origAddSource = ragEngine.addSource.bind(ragEngine);
  ragEngine.addSource = function (src) {
    _origAddSource(src);
    getOverlayWindow()?.postMessage({ type: 'GROUNDRAG_SOURCES_UPDATE', count: ragEngine.sources.length }, '*');
  };
  const _origRemoveSource = ragEngine.removeSource.bind(ragEngine);
  ragEngine.removeSource = function (id) {
    _origRemoveSource(id);
    getOverlayWindow()?.postMessage({ type: 'GROUNDRAG_SOURCES_UPDATE', count: ragEngine.sources.length }, '*');
  };

  btnToggleOverlay?.addEventListener('click', () => {
    const ow = getOverlayWindow();
    if (ow) closeOverlayWindow();
    else launchOverlayWindow();
  });

  floatingBubble?.addEventListener('click', launchOverlayWindow);

  // ============================================================
  // GOOGLE LENS SCREEN VISION
  // ============================================================
  const btnHeaderScreenLens = document.getElementById('btn-header-screen-lens');

  // Show lens suggest chips in the input area after a screen capture
  function showLensSuggestChips() {
    // Remove any existing chips
    document.querySelectorAll('.lens-suggest-chips').forEach(c => c.remove());

    const chipsContainer = document.createElement('div');
    chipsContainer.className = 'lens-suggest-chips';
    const suggestions = [
      '🔍 What is on my screen?',
      '📋 Extract all text & code',
      '🐛 Explain errors shown',
      '📊 Summarize this window'
    ];
    suggestions.forEach(text => {
      const chip = document.createElement('button');
      chip.className = 'lens-suggest-chip';
      chip.innerText = text;
      chip.addEventListener('click', () => {
        chatInputEl.value = text.replace(/^[^\w]+/, '');
        chipsContainer.remove();
        handleSendMessage();
      });
      chipsContainer.appendChild(chip);
    });

    // Insert above the input capsule
    const capsule = document.querySelector('.prompt-input-capsule');
    if (capsule) capsule.parentNode.insertBefore(chipsContainer, capsule);
  }

  // Initialize Screen Lens engine
  let screenLens = null;
  if (window.GoogleScreenLens) {
    screenLens = new window.GoogleScreenLens({
      onSourceExtracted: (sourceObj) => {
        // Add to RAG engine
        ragEngine.addSource(sourceObj);
        renderSourcesList();

        // Show Hero -> Chat transition
        if (chatHeroContainer) chatHeroContainer.style.display = 'none';
        chatMessagesEl.style.display = 'flex';

        // Notify user
        appendMessage('bot',
          `📷 **Screen captured via Google Lens!**\n\n` +
          `Indexed "${sourceObj.title}" — extracted ${sourceObj.content.length} characters ` +
          `(${sourceObj.ocrBoxes?.length || 0} text elements detected).\n\n` +
          `Select a quick suggestion below or ask your own question about what's on screen.`
        );

        // Show suggest chips
        showLensSuggestChips();

        // Focus input
        setTimeout(() => chatInputEl.focus(), 150);
      }
    });
  }

  // Header Screen Lens button
  btnHeaderScreenLens?.addEventListener('click', () => {
    if (!screenLens) {
      alert('Screen Lens is not available in this browser.');
      return;
    }
    screenLens.captureLiveScreen();
  });

  // Hero card for Google Lens
  document.getElementById('card-hero-screen-lens')?.addEventListener('click', () => {
    if (!screenLens) {
      alert('Screen Lens is not available in this browser.');
      return;
    }
    screenLens.captureLiveScreen();
  });

  // Pill shortcut for Lens (in capsule)
  document.getElementById('btn-pill-screen-lens')?.addEventListener('click', () => {
    if (screenLens) screenLens.captureLiveScreen();
  });
});
