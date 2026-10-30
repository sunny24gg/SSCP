/**
 * GroundRAG - Interactive Source-Grounded Mind Map Visualizer & Image Generator
 * Renders hierarchical concept graphs grounded in retrieved RAG citations or full PDF documents.
 * Supports pan, zoom, expand/collapse, click-to-verify source evidence, and high-res PNG/SVG image export.
 */

class GroundedMindMap {
  constructor(containerId, onNodeSelect) {
    this.container = document.getElementById(containerId);
    this.onNodeSelect = onNodeSelect || (() => {});
    this.scale = 1;
    this.panX = 50;
    this.panY = 180;
    this.isDragging = false;
    this.startX = 0;
    this.startY = 0;
    this.data = null;
    this.branchColors = [
      '#38bdf8', // Neon Sky Blue
      '#818cf8', // Indigo Purple
      '#34d399', // Emerald Green
      '#fbbf24', // Amber Gold
      '#f472b6', // Coral Pink
      '#a78bfa', // Lavender Violet
      '#2dd4bf'  // Cyan Teal
    ];

    this.init();
  }

  init() {
    if (!this.container) return;

    this.container.innerHTML = `
      <div class="mindmap-wrapper">
        <div class="mindmap-toolbar">
          <div class="mm-toolbar-group">
            <button class="mm-btn" id="mm-zoom-in" title="Zoom In (+)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
            </button>
            <button class="mm-btn" id="mm-zoom-out" title="Zoom Out (-)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
            </button>
            <button class="mm-btn" id="mm-reset" title="Reset View & Center">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
            </button>
            <span class="mm-zoom-level" id="mm-zoom-text">100%</span>
          </div>

          <div class="mm-toolbar-group mm-actions-group">
            <button class="mm-btn mm-btn-cta" id="mm-export-png" title="Generate & Download PNG Image">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
              <span>Export Image (PNG)</span>
            </button>
            <button class="mm-btn" id="mm-export-svg" title="Export as Scalable Vector Graphics">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              <span>SVG</span>
            </button>
          </div>
        </div>

        <div class="mindmap-canvas-area" id="mm-canvas-area">
          <svg id="mm-svg" class="mm-svg"></svg>
          <div class="mm-canvas-watermark" id="mm-watermark">
            <span>✨ Gemini Grounded Mind Map</span>
          </div>
        </div>

        <div class="mm-legend">
          <span class="legend-item"><span class="legend-dot root-dot"></span> Central Topic</span>
          <span class="legend-item"><span class="legend-dot branch-dot"></span> Core Branches</span>
          <span class="legend-item"><span class="legend-dot leaf-dot"></span> Grounded Evidence & Points</span>
          <span class="legend-tip">💡 Click any leaf to jump to verbatim source evidence</span>
        </div>
      </div>
    `;

    this.svg = document.getElementById('mm-svg');
    this.canvasArea = document.getElementById('mm-canvas-area');

    this.bindEvents();
  }

  bindEvents() {
    document.getElementById('mm-zoom-in')?.addEventListener('click', () => this.zoom(0.15));
    document.getElementById('mm-zoom-out')?.addEventListener('click', () => this.zoom(-0.15));
    document.getElementById('mm-reset')?.addEventListener('click', () => this.resetView());
    document.getElementById('mm-export-png')?.addEventListener('click', () => this.exportAsImage('png'));
    document.getElementById('mm-export-svg')?.addEventListener('click', () => this.exportAsSvg());

    // Pan interactions
    this.canvasArea.addEventListener('mousedown', (e) => {
      if (e.target.closest('.mm-node')) return;
      this.isDragging = true;
      this.startX = e.clientX - this.panX;
      this.startY = e.clientY - this.panY;
      this.canvasArea.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      this.panX = e.clientX - this.startX;
      this.panY = e.clientY - this.startY;
      this.applyTransform();
    });

    window.addEventListener('mouseup', () => {
      if (this.isDragging) {
        this.isDragging = false;
        this.canvasArea.style.cursor = 'grab';
      }
    });

    // Zoom on mouse wheel
    this.canvasArea.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.1 : -0.1;
      this.zoom(delta);
    }, { passive: false });
  }

  zoom(factor) {
    this.scale = Math.min(2.5, Math.max(0.35, this.scale + factor));
    const zoomText = document.getElementById('mm-zoom-text');
    if (zoomText) zoomText.innerText = `${Math.round(this.scale * 100)}%`;
    this.applyTransform();
  }

  resetView() {
    this.scale = 1;
    this.panX = 50;
    this.panY = 180;
    const zoomText = document.getElementById('mm-zoom-text');
    if (zoomText) zoomText.innerText = `100%`;
    this.applyTransform();
  }

  applyTransform() {
    const g = this.svg?.querySelector('g.mm-viewport');
    if (g) {
      g.setAttribute('transform', `translate(${this.panX}, ${this.panY}) scale(${this.scale})`);
    }
  }

  /**
   * Universal data normalizer:
   * Translates any input structure (raw outline, categories, branches, or root)
   * into a standardized internal representation.
   */
  normalizeData(rawData) {
    if (!rawData) return null;

    let rootTitle = 'Grounded Knowledge';
    let branches = [];

    // Format 1: Already has root and branches
    if (rawData.root && Array.isArray(rawData.branches)) {
      rootTitle = rawData.root.title || rawData.root.topic || rootTitle;
      branches = rawData.branches;
    }
    // Format 2: Direct backend schema { topic: "...", branches: [{ name, children: [...] }] }
    else if (rawData.topic && Array.isArray(rawData.branches)) {
      rootTitle = rawData.topic;
      branches = rawData.branches.map((b, bIdx) => ({
        title: b.name || b.title || `Branch ${bIdx + 1}`,
        citationNumber: bIdx + 1,
        score: 0.95,
        children: (b.children || []).map((ch, cIdx) => {
          if (typeof ch === 'string') {
            return {
              text: ch,
              citationNumber: bIdx + 1,
              sourceTitle: rootTitle
            };
          }
          return {
            text: ch.text || ch.label || ch.name || 'Detail point',
            citationNumber: ch.citationNumber || ch.citation || (bIdx + 1),
            sourceTitle: ch.sourceTitle || rootTitle
          };
        })
      }));
    }
    // Format 3: Local engine categories format { title: "...", categories: [{ name, nodes: [...] }] }
    else if (rawData.title && Array.isArray(rawData.categories)) {
      rootTitle = rawData.title;
      branches = rawData.categories.map((cat, catIdx) => ({
        title: cat.name || `Topic ${catIdx + 1}`,
        citationNumber: catIdx + 1,
        score: 0.92,
        children: (cat.nodes || []).map((node, nIdx) => ({
          text: node.label || node.text || 'Detail',
          citationNumber: node.citation || (catIdx + 1),
          sourceTitle: node.source || rootTitle
        }))
      }));
    }
    // Format 4: Plain array of branches
    else if (Array.isArray(rawData)) {
      branches = rawData.map((item, idx) => ({
        title: item.title || item.name || `Branch ${idx + 1}`,
        citationNumber: idx + 1,
        score: 0.9,
        children: (item.children || []).map(ch => ({
          text: typeof ch === 'string' ? ch : (ch.text || ch.label || ''),
          citationNumber: idx + 1
        }))
      }));
    }

    return {
      root: {
        title: rootTitle,
        totalCitations: branches.length
      },
      branches: branches
    };
  }

  render(rawMindMapData) {
    if (!rawMindMapData || !this.svg) return;

    const normalized = this.normalizeData(rawMindMapData);
    if (!normalized || !normalized.branches || normalized.branches.length === 0) return;
    this.data = normalized;

    // Clear svg
    this.svg.innerHTML = '';

    const root = normalized.root;
    const branches = normalized.branches;

    const rootX = 140;
    const rootY = 200;
    const branchSpacingY = 140;

    this.svg.setAttribute('width', '100%');
    this.svg.setAttribute('height', '100%');

    // Create main viewport group
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'mm-viewport');
    g.setAttribute('transform', `translate(${this.panX}, ${this.panY}) scale(${this.scale})`);

    // Draw defs for gradients, filters, and markers
    g.innerHTML = `
      <defs>
        <linearGradient id="mmRootGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#1e3a8a"/>
          <stop offset="50%" stop-color="#0284c7"/>
          <stop offset="100%" stop-color="#38bdf8"/>
        </linearGradient>
        <filter id="mmGlow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="6" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over"/>
        </filter>
        <filter id="mmDropShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="6" stdDeviation="6" flood-color="#000000" flood-opacity="0.6"/>
        </filter>
      </defs>
      <g class="mm-edges"></g>
      <g class="mm-nodes"></g>
    `;

    this.svg.appendChild(g);

    const edgesGroup = g.querySelector('.mm-edges');
    const nodesGroup = g.querySelector('.mm-nodes');

    // Node layout vertical distribution
    let branchStartY = rootY - ((branches.length - 1) * branchSpacingY) / 2;

    // 1. Draw Root Node
    const rootNodeEl = this.createRootNode(rootX, rootY, root);
    nodesGroup.appendChild(rootNodeEl);

    // 2. Draw Branches and Leaves
    branches.forEach((branch, bIdx) => {
      const branchColor = this.branchColors[bIdx % this.branchColors.length];
      const branchX = rootX + 270;
      const branchY = branchStartY + (bIdx * branchSpacingY);

      // Edge from Root to Branch
      const rootToBranchEdge = this.createBezierEdge(
        rootX + 105, rootY,
        branchX - 95, branchY,
        branchColor, 2.5
      );
      edgesGroup.appendChild(rootToBranchEdge);

      // Branch Node Element
      const branchEl = this.createBranchNode(branchX, branchY, branch, branchColor);
      nodesGroup.appendChild(branchEl);

      // Draw Leaf Nodes for this branch
      const leaves = branch.children || [];
      const leafSpacingY = 52;
      let leafStartY = branchY - ((leaves.length - 1) * leafSpacingY) / 2;

      leaves.forEach((leaf, lIdx) => {
        const leafX = branchX + 290;
        const leafY = leafStartY + (lIdx * leafSpacingY);

        // Edge from Branch to Leaf
        const branchToLeafEdge = this.createBezierEdge(
          branchX + 95, branchY,
          leafX - 110, leafY,
          branchColor, 1.4, true
        );
        edgesGroup.appendChild(branchToLeafEdge);

        // Leaf Node Element
        const leafEl = this.createLeafNode(leafX, leafY, leaf, branchColor);
        nodesGroup.appendChild(leafEl);
      });
    });

    this.applyTransform();
  }

  createBezierEdge(x1, y1, x2, y2, color = '#38bdf8', strokeWidth = 2, isDashed = false) {
    const dx = (x2 - x1) * 0.55;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', strokeWidth);
    path.setAttribute('stroke-opacity', '0.75');
    if (isDashed) {
      path.setAttribute('stroke-dasharray', '4,3');
    }
    return path;
  }

  createRootNode(x, y, data) {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'mm-node mm-root-node');
    g.setAttribute('transform', `translate(${x}, ${y})`);
    g.style.cursor = 'pointer';

    const title = (data && data.title) || 'Central Topic';
    const displayTitle = title.length > 28 ? title.substring(0, 26) + '..' : title;
    const count = (data && data.totalCitations) || 0;

    g.innerHTML = `
      <rect x="-105" y="-34" width="210" height="68" rx="16" 
            fill="url(#mmRootGrad)" stroke="#38bdf8" stroke-width="2.5" filter="url(#mmGlow)"/>
      <text x="0" y="-6" text-anchor="middle" fill="#ffffff" font-size="13" font-weight="800" font-family="'Plus Jakarta Sans', sans-serif">
        ${this.escapeXml(displayTitle)}
      </text>
      <text x="0" y="15" text-anchor="middle" fill="#bae6fd" font-size="9.5" font-weight="600" font-family="'Plus Jakarta Sans', sans-serif">
        ✨ Grounded Concept Map (${count} Branches)
      </text>
    `;

    return g;
  }

  createBranchNode(x, y, branch, color) {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'mm-node mm-branch-node');
    g.setAttribute('transform', `translate(${x}, ${y})`);
    g.style.cursor = 'pointer';

    const title = branch.title || branch.name || 'Main Branch';
    const shortTitle = title.length > 22 ? title.substring(0, 20) + '..' : title;
    const citation = branch.citationNumber || 'S';

    g.innerHTML = `
      <rect x="-95" y="-25" width="190" height="50" rx="12" 
            fill="#0b1120" stroke="${color}" stroke-width="2" filter="url(#mmDropShadow)"/>
      <rect x="-90" y="-19" width="24" height="18" rx="5" fill="${color}" fill-opacity="0.25" stroke="${color}" stroke-width="1"/>
      <text x="-78" y="-6.5" text-anchor="middle" fill="${color}" font-size="9" font-weight="bold" font-family="'JetBrains Mono', monospace">
        [${citation}]
      </text>
      <text x="-58" y="-6.5" fill="#f8fafc" font-size="11" font-weight="700" font-family="'Plus Jakarta Sans', sans-serif">
        ${this.escapeXml(shortTitle)}
      </text>
      <text x="-58" y="11" fill="#94a3b8" font-size="8.5" font-family="'Plus Jakarta Sans', sans-serif">
        ${(branch.children || []).length} key sub-points
      </text>
    `;

    g.addEventListener('click', () => {
      this.onNodeSelect({
        type: 'branch',
        citationNumber: branch.citationNumber,
        title: title,
        sourceTitle: branch.sourceTitle
      });
    });

    return g;
  }

  createLeafNode(x, y, leaf, color) {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'mm-node mm-leaf-node');
    g.setAttribute('transform', `translate(${x}, ${y})`);
    g.style.cursor = 'pointer';

    const leafText = typeof leaf === 'string' ? leaf : (leaf.text || leaf.label || '');
    const shortText = leafText.length > 32 ? leafText.substring(0, 30) + '..' : leafText;
    const citation = (leaf && leaf.citationNumber) || (leaf && leaf.citation) || '';

    g.innerHTML = `
      <rect x="-115" y="-18" width="230" height="36" rx="8" 
            fill="#080e1a" stroke="rgba(255,255,255,0.12)" stroke-width="1.2" class="leaf-rect" filter="url(#mmDropShadow)"/>
      <circle cx="-101" cy="0" r="4.5" fill="${color}"/>
      <text x="-90" y="4" fill="#e2e8f0" font-size="9.5" font-family="'Plus Jakarta Sans', sans-serif">
        ${this.escapeXml(shortText)}
      </text>
      ${citation ? `
        <text x="104" y="4" text-anchor="end" fill="${color}" font-size="8.5" font-weight="bold" font-family="'JetBrains Mono', monospace">
          [S${citation}]
        </text>
      ` : ''}
    `;

    g.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.leaf-rect').forEach(r => r.setAttribute('stroke', 'rgba(255,255,255,0.12)'));
      g.querySelector('.leaf-rect')?.setAttribute('stroke', color);

      this.onNodeSelect({
        type: 'leaf',
        citationNumber: citation,
        text: leafText,
        sourceTitle: leaf.sourceTitle
      });
    });

    return g;
  }

  /**
   * Export the rendered Mind Map to a High-Resolution PNG Image
   * Renders the entire SVG scene onto an HTML5 canvas at 2x scale
   * with professional dark background and title watermarks.
   */
  async exportAsImage(format = 'png') {
    if (!this.svg) return;

    try {
      // Find bounding box of content
      const viewport = this.svg.querySelector('g.mm-viewport');
      if (!viewport) return;

      const bbox = viewport.getBBox();
      const padding = 60;
      const width = Math.max(800, bbox.width + padding * 2);
      const height = Math.max(500, bbox.height + padding * 2);

      // Clone SVG for rendering
      const clonedSvg = this.svg.cloneNode(true);
      clonedSvg.setAttribute('width', width);
      clonedSvg.setAttribute('height', height);
      clonedSvg.setAttribute('viewBox', `${bbox.x - padding} ${bbox.y - padding} ${width} ${height}`);

      // Ensure inline styles are present for canvas rendering
      const styleEl = document.createElement('style');
      styleEl.textContent = `
        text { font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif; }
      `;
      clonedSvg.insertBefore(styleEl, clonedSvg.firstChild);

      const serializer = new XMLSerializer();
      let svgString = serializer.serializeToString(clonedSvg);

      // Fix namespaces
      if (!svgString.match(/^<svg[^>]+xmlns="http\:\/\/www\.w3\.org\/2000\/svg"/)) {
        svgString = svgString.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
      }

      const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const blobUrl = URL.createObjectURL(svgBlob);

      const img = new Image();
      img.onload = () => {
        // High-DPI canvas (2x)
        const scale = 2;
        const canvas = document.createElement('canvas');
        canvas.width = width * scale;
        canvas.height = height * scale;
        const ctx = canvas.getContext('2d');
        ctx.scale(scale, scale);

        // 1. Draw sleek dark obsidian background
        const grad = ctx.createLinearGradient(0, 0, width, height);
        grad.addColorStop(0, '#070a12');
        grad.addColorStop(0.5, '#0c1322');
        grad.addColorStop(1, '#050811');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, width, height);

        // 2. Subtle tech dot grid
        ctx.fillStyle = 'rgba(56, 189, 248, 0.05)';
        for (let x = 0; x < width; x += 30) {
          for (let y = 0; y < height; y += 30) {
            ctx.beginPath();
            ctx.arc(x, y, 1, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        // 3. Draw SVG graph
        ctx.drawImage(img, 0, 0, width, height);

        // 4. Header title badge
        ctx.font = 'bold 12px "Plus Jakarta Sans", sans-serif';
        ctx.fillStyle = '#38bdf8';
        ctx.fillText('✨ GroundRAG Knowledge Mind Map', 24, 30);

        ctx.font = '10px "Plus Jakarta Sans", sans-serif';
        ctx.fillStyle = '#64748b';
        ctx.fillText(`Generated on ${new Date().toLocaleDateString()} • Verified Grounded References`, 24, 46);

        URL.revokeObjectURL(blobUrl);

        // Download PNG
        const pngUrl = canvas.toDataURL('image/png');
        const a = document.createElement('a');
        const filename = (this.data?.root?.title || 'mindmap').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 30);
        a.download = `MindMap_${filename}.png`;
        a.href = pngUrl;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      };

      img.src = blobUrl;
    } catch (err) {
      console.error('[MindMap Export Error]:', err);
      alert('Failed to export image: ' + err.message);
    }
  }

  /**
   * Export the rendered Mind Map directly as an SVG vector file
   */
  exportAsSvg() {
    if (!this.svg) return;

    try {
      const serializer = new XMLSerializer();
      let source = serializer.serializeToString(this.svg);

      if (!source.match(/^<svg[^>]+xmlns="http\:\/\/www\.w3\.org\/2000\/svg"/)) {
        source = source.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
      }

      const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const filename = (this.data?.root?.title || 'mindmap').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 30);
      a.download = `MindMap_${filename}.svg`;
      a.href = url;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[SVG Export Error]:', err);
    }
  }

  escapeXml(unsafe) {
    return (unsafe || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}

// Attach to window
window.GroundedMindMap = GroundedMindMap;
