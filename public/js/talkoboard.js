// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  talkoboard.js v2 — Collaborative Infinite Whiteboard for Talkomatic    ║
// ║                                                                         ║
// ║  v2 improvements:                                                       ║
// ║  • Stroke lifecycle protocol (start/move/end) — no gaps between batches ║
// ║  • Server-side stroke storage — new joiners see existing drawings       ║
// ║  • Quadratic bezier smoothing on full redraws                           ║
// ║  • Incremental rendering for live strokes (no full-canvas redraws)      ║
// ║  • Distance-based point filtering to reduce network traffic             ║
// ║  • Clear board button                                                   ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

class Talkoboard {
  constructor(socketRef, userId, username) {
    this.socket = socketRef;
    this.userId = userId;
    this.username = username || "Anonymous";
    this.isOpen = false;

    // ── Canvas state ────────────────────────────────────────────────
    this.canvas = null;
    this.ctx = null;
    this.drawing = false;
    this.lastPoint = null;

    // ── Infinite canvas: pan & zoom ─────────────────────────────────
    this.panX = 0;
    this.panY = 0;
    this.zoom = 1;
    this.isPanning = false;
    this.panStart = null;
    this.MIN_ZOOM = 0.2;
    this.MAX_ZOOM = 5;

    // ── Completed strokes (for redraw on pan/zoom) ──────────────────
    this.strokes = [];

    // ── Current local stroke being drawn ────────────────────────────
    this.currentStroke = null;

    // ── Remote active strokes: userId → stroke object ───────────────
    this.remoteActiveStrokes = new Map();

    // ── Tools ───────────────────────────────────────────────────────
    this.color = "#000000";
    this.size = 3;
    this.eraser = false;

    // ── Network batching ────────────────────────────────────────────
    this.pointBuffer = [];
    this.flushTimer = null;
    this.FLUSH_INTERVAL = 25;

    // ── Point simplification ────────────────────────────────────────
    this.MIN_POINT_DISTANCE_SQ = 2.25; // 1.5px squared

    // ── Live cursors ────────────────────────────────────────────────
    this.remoteCursors = new Map();
    this.cursorThrottle = 0;
    this.CURSOR_SEND_INTERVAL = 50;

    // ── Chat ────────────────────────────────────────────────────────
    this.chatMessages = [];
    this.MAX_CHAT_MESSAGES = 50;

    // ── Saved chat text ─────────────────────────────────────────────
    this.savedChatText = "";

    // ── Display dimensions (set in resizeCanvas) ────────────────────
    this.displayWidth = 0;
    this.displayHeight = 0;
    this.dpr = 1;

    // ── Build everything ────────────────────────────────────────────
    this.modal = null;
    this.buildModal();
    this.setupSocketListeners();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BUILD MODAL & UI
  // ═══════════════════════════════════════════════════════════════════════════

  buildModal() {
    this.modal = document.createElement("div");
    this.modal.id = "talkoboardModal";
    this.modal.className = "tb-overlay";

    const container = document.createElement("div");
    container.className = "tb-container";

    // ── Header / Toolbar ────────────────────────────────────────────
    const header = document.createElement("div");
    header.className = "tb-header";

    const title = document.createElement("span");
    title.className = "tb-title";
    title.textContent = "Talkoboard";

    const tools = document.createElement("div");
    tools.className = "tb-tools";

    // Color picker
    const colorWrap = document.createElement("label");
    colorWrap.className = "tb-color-wrap";
    this.colorInput = document.createElement("input");
    this.colorInput.type = "color";
    this.colorInput.value = this.color;
    this.colorInput.title = "Brush color";
    const colorSwatch = document.createElement("span");
    colorSwatch.className = "tb-color-swatch";
    colorSwatch.style.background = this.color;
    colorWrap.appendChild(this.colorInput);
    colorWrap.appendChild(colorSwatch);

    this.colorInput.addEventListener("input", (e) => {
      this.color = e.target.value;
      colorSwatch.style.background = e.target.value;
      this.eraser = false;
      this.eraserBtn.classList.remove("active");
      this.updateCursor();
    });

    // Size slider
    const sizeWrap = document.createElement("div");
    sizeWrap.className = "tb-size-wrap";
    const sizeIcon = document.createElement("span");
    sizeIcon.className = "tb-size-icon";
    sizeIcon.textContent = "\u25CF";
    this.sizeInput = document.createElement("input");
    this.sizeInput.type = "range";
    this.sizeInput.min = "1";
    this.sizeInput.max = "30";
    this.sizeInput.value = String(this.size);
    this.sizeLabel = document.createElement("span");
    this.sizeLabel.className = "tb-size-label";
    this.sizeLabel.textContent = String(this.size);
    sizeWrap.appendChild(sizeIcon);
    sizeWrap.appendChild(this.sizeInput);
    sizeWrap.appendChild(this.sizeLabel);

    this.sizeInput.addEventListener("input", (e) => {
      this.size = parseInt(e.target.value);
      this.sizeLabel.textContent = String(this.size);
      this.updateCursor();
    });

    // Eraser button
    this.eraserBtn = document.createElement("button");
    this.eraserBtn.className = "tb-tool-btn";
    this.eraserBtn.textContent = "Eraser";
    this.eraserBtn.title = "Toggle eraser";
    this.eraserBtn.addEventListener("click", () => {
      this.eraser = !this.eraser;
      this.eraserBtn.classList.toggle("active", this.eraser);
      this.updateCursor();
    });

    // Clear button
    this.clearBtn = document.createElement("button");
    this.clearBtn.className = "tb-tool-btn";
    this.clearBtn.textContent = "Clear";
    this.clearBtn.title = "Clear entire board";
    this.clearBtn.addEventListener("click", () => {
      if (confirm("Clear the entire board for everyone?")) {
        this.strokes = [];
        this.currentStroke = null;
        this.remoteActiveStrokes.clear();
        this.socket.emit("board clear");
        this.redraw();
      }
    });

    // Zoom controls
    const zoomWrap = document.createElement("div");
    zoomWrap.className = "tb-zoom-wrap";
    const zoomOut = document.createElement("button");
    zoomOut.className = "tb-tool-btn tb-zoom-btn";
    zoomOut.textContent = "\u2212";
    zoomOut.title = "Zoom out";
    this.zoomLabel = document.createElement("span");
    this.zoomLabel.className = "tb-zoom-label";
    this.zoomLabel.textContent = "100%";
    const zoomIn = document.createElement("button");
    zoomIn.className = "tb-tool-btn tb-zoom-btn";
    zoomIn.textContent = "+";
    zoomIn.title = "Zoom in";
    const zoomReset = document.createElement("button");
    zoomReset.className = "tb-tool-btn";
    zoomReset.textContent = "Reset";
    zoomReset.title = "Reset view";

    zoomOut.addEventListener("click", () => this.adjustZoom(-0.15));
    zoomIn.addEventListener("click", () => this.adjustZoom(0.15));
    zoomReset.addEventListener("click", () => this.resetView());

    zoomWrap.appendChild(zoomOut);
    zoomWrap.appendChild(this.zoomLabel);
    zoomWrap.appendChild(zoomIn);
    zoomWrap.appendChild(zoomReset);

    tools.appendChild(colorWrap);
    tools.appendChild(sizeWrap);
    tools.appendChild(this.eraserBtn);
    tools.appendChild(this.clearBtn);
    tools.appendChild(zoomWrap);

    // Close button
    const closeBtn = document.createElement("button");
    closeBtn.className = "tb-close";
    closeBtn.textContent = "\u00D7";
    closeBtn.addEventListener("click", () => this.close());

    header.appendChild(title);
    header.appendChild(tools);
    header.appendChild(closeBtn);

    // ── Canvas area ─────────────────────────────────────────────────
    const canvasWrap = document.createElement("div");
    canvasWrap.className = "tb-canvas-wrap";

    this.canvas = document.createElement("canvas");
    this.canvas.id = "tbCanvas";
    this.ctx = this.canvas.getContext("2d");

    // Cursor layer for remote cursors
    this.cursorLayer = document.createElement("div");
    this.cursorLayer.className = "tb-cursor-layer";

    canvasWrap.appendChild(this.canvas);
    canvasWrap.appendChild(this.cursorLayer);
    this.canvasWrap = canvasWrap;

    // ── Chat panel ──────────────────────────────────────────────────
    const chat = document.createElement("div");
    chat.className = "tb-chat";

    const chatHeader = document.createElement("div");
    chatHeader.className = "tb-chat-header";
    chatHeader.textContent = "Chat";

    this.chatLog = document.createElement("div");
    this.chatLog.className = "tb-chat-log";

    const chatInputWrap = document.createElement("div");
    chatInputWrap.className = "tb-chat-input-wrap";
    this.chatInput = document.createElement("input");
    this.chatInput.type = "text";
    this.chatInput.className = "tb-chat-input";
    this.chatInput.placeholder = "Type a message...";
    this.chatInput.maxLength = 200;
    this.chatInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && this.chatInput.value.trim()) {
        this.sendChat(this.chatInput.value.trim());
        this.chatInput.value = "";
      }
      e.stopPropagation();
    });

    chatInputWrap.appendChild(this.chatInput);
    chat.appendChild(chatHeader);
    chat.appendChild(this.chatLog);
    chat.appendChild(chatInputWrap);

    // ── Assemble ────────────────────────────────────────────────────
    container.appendChild(header);
    container.appendChild(canvasWrap);
    container.appendChild(chat);
    this.modal.appendChild(container);
    document.body.appendChild(this.modal);

    // ── Canvas pointer events ───────────────────────────────────────
    this.canvas.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    this.canvas.addEventListener("pointermove", (e) => this.onPointerMove(e));
    this.canvas.addEventListener("pointerup", (e) => this.onPointerUp(e));
    this.canvas.addEventListener("pointerleave", (e) => this.onPointerUp(e));
    this.canvas.addEventListener("pointercancel", (e) => this.onPointerUp(e));

    this.canvas.addEventListener(
      "touchstart",
      (e) => {
        if (e.touches.length < 2) e.preventDefault();
      },
      { passive: false },
    );
    this.canvas.addEventListener("touchmove", (e) => e.preventDefault(), {
      passive: false,
    });

    // Wheel zoom
    this.canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.08 : 0.08;
        this.adjustZoom(delta, e);
      },
      { passive: false },
    );

    // Middle-click pan
    this.canvas.addEventListener("mousedown", (e) => {
      if (e.button === 1) {
        e.preventDefault();
        this.isPanning = true;
        this.panStart = {
          x: e.clientX,
          y: e.clientY,
          px: this.panX,
          py: this.panY,
        };
      }
    });
    window.addEventListener("mousemove", (e) => {
      if (this.isPanning && this.panStart) {
        this.panX = this.panStart.px + (e.clientX - this.panStart.x);
        this.panY = this.panStart.py + (e.clientY - this.panStart.y);
        this.redraw();
      }
    });
    window.addEventListener("mouseup", (e) => {
      if (e.button === 1) this.isPanning = false;
    });

    // Two-finger pan on touch
    let lastTouches = null;
    this.canvas.addEventListener(
      "touchstart",
      (e) => {
        if (e.touches.length === 2) {
          lastTouches = this.getTouchCenter(e.touches);
          this.isPanning = true;
        }
      },
      { passive: true },
    );
    this.canvas.addEventListener(
      "touchmove",
      (e) => {
        if (e.touches.length === 2 && lastTouches) {
          const center = this.getTouchCenter(e.touches);
          this.panX += center.x - lastTouches.x;
          this.panY += center.y - lastTouches.y;
          lastTouches = center;
          this.redraw();
        }
      },
      { passive: true },
    );
    this.canvas.addEventListener(
      "touchend",
      () => {
        if (lastTouches) {
          lastTouches = null;
          this.isPanning = false;
        }
      },
      { passive: true },
    );

    // Escape to close
    this._escHandler = (e) => {
      if (e.key === "Escape" && this.isOpen) this.close();
    };
    document.addEventListener("keydown", this._escHandler);

    // Space to pan
    this._spaceDown = false;
    this._spaceHandler = (e) => {
      if (!this.isOpen) return;
      if (e.target === this.chatInput) return;
      if (e.key === " ") {
        e.preventDefault();
        this._spaceDown = e.type === "keydown";
        this.updateCursor();
      }
    };
    document.addEventListener("keydown", this._spaceHandler);
    document.addEventListener("keyup", this._spaceHandler);

    // Resize
    this._resizeHandler = () => {
      if (this.isOpen) {
        this.resizeCanvas();
        this.redraw();
      }
    };
    window.addEventListener("resize", this._resizeHandler);
  }

  getTouchCenter(touches) {
    return {
      x: (touches[0].clientX + touches[1].clientX) / 2,
      y: (touches[0].clientY + touches[1].clientY) / 2,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // OPEN / CLOSE
  // ═══════════════════════════════════════════════════════════════════════════

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.modal.classList.add("show");
    this.resizeCanvas();
    this.redraw();
    this.updateCursor();

    this.socket.emit("board open");

    this.savedChatText = typeof selfRawText === "string" ? selfRawText : "";
    if (typeof socket !== "undefined") {
      socket.emit("chat update", {
        diff: {
          type: "full-replace",
          text: "\uD83C\uDFA8 Using Talkoboard \u2014 press Apps (top right) > Talkoboard to join!",
        },
      });
    }
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;

    // End any in-progress local stroke
    if (this.drawing) {
      this.flush();
      this.socket.emit("board stroke end");
      if (this.currentStroke) {
        this.strokes.push(this.currentStroke);
        this.currentStroke = null;
      }
      this.drawing = false;
      this.lastPoint = null;
    }

    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    this.modal.classList.remove("show");
    this.socket.emit("board close");

    if (typeof socket !== "undefined") {
      socket.emit("chat update", {
        diff: { type: "full-replace", text: this.savedChatText },
      });
    }

    if (typeof chatInput !== "undefined" && chatInput) {
      setTimeout(() => chatInput.focus(), 50);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CANVAS SETUP
  // ═══════════════════════════════════════════════════════════════════════════

  resizeCanvas() {
    const wrap = this.canvasWrap;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.canvas.style.width = rect.width + "px";
    this.canvas.style.height = rect.height + "px";

    this.displayWidth = rect.width;
    this.displayHeight = rect.height;
    this.dpr = dpr;
  }

  updateCursor() {
    if (!this.canvas) return;
    this.canvas.style.cursor = this._spaceDown ? "grab" : "crosshair";
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // COORDINATE TRANSFORMS (screen <-> world)
  // ═══════════════════════════════════════════════════════════════════════════

  screenToWorld(sx, sy) {
    return {
      x: (sx - this.panX) / this.zoom,
      y: (sy - this.panY) / this.zoom,
    };
  }

  worldToScreen(wx, wy) {
    return {
      x: wx * this.zoom + this.panX,
      y: wy * this.zoom + this.panY,
    };
  }

  getCanvasPoint(e) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    return this.screenToWorld(sx, sy);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PAN & ZOOM
  // ═══════════════════════════════════════════════════════════════════════════

  adjustZoom(delta, e) {
    const oldZoom = this.zoom;
    this.zoom = Math.min(
      this.MAX_ZOOM,
      Math.max(this.MIN_ZOOM, this.zoom + delta),
    );

    if (e) {
      const rect = this.canvas.getBoundingClientRect();
      const mx = (e.clientX || rect.width / 2) - rect.left;
      const my = (e.clientY || rect.height / 2) - rect.top;
      this.panX = mx - (mx - this.panX) * (this.zoom / oldZoom);
      this.panY = my - (my - this.panY) * (this.zoom / oldZoom);
    }

    this.zoomLabel.textContent = Math.round(this.zoom * 100) + "%";
    this.redraw();
  }

  resetView() {
    this.panX = 0;
    this.panY = 0;
    this.zoom = 1;
    this.zoomLabel.textContent = "100%";
    this.redraw();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DRAWING — FULL REDRAW (pan/zoom/resize triggers this)
  // ═══════════════════════════════════════════════════════════════════════════

  redraw() {
    const ctx = this.ctx;
    const dpr = this.dpr;
    const w = this.displayWidth;
    const h = this.displayHeight;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // White background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(this.panX, this.panY);
    ctx.scale(this.zoom, this.zoom);

    // Grid
    this.drawGrid(ctx, w, h);

    // All completed strokes (bezier-smoothed)
    for (const stroke of this.strokes) {
      this.renderStrokeSmooth(ctx, stroke);
    }

    // Remote active strokes (bezier-smoothed)
    for (const [, stroke] of this.remoteActiveStrokes) {
      this.renderStrokeSmooth(ctx, stroke);
    }

    // Current local in-progress stroke (bezier-smoothed)
    if (this.currentStroke) {
      this.renderStrokeSmooth(ctx, this.currentStroke);
    }

    ctx.restore();
  }

  drawGrid(ctx, screenW, screenH) {
    const spacing = 40;
    const tl = this.screenToWorld(0, 0);
    const br = this.screenToWorld(screenW, screenH);

    ctx.fillStyle = "#ddd";
    const startX = Math.floor(tl.x / spacing) * spacing;
    const startY = Math.floor(tl.y / spacing) * spacing;

    for (let x = startX; x < br.x; x += spacing) {
      for (let y = startY; y < br.y; y += spacing) {
        ctx.beginPath();
        ctx.arc(x, y, 1, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STROKE RENDERING — BEZIER SMOOTH (used in full redraws)
  // ═══════════════════════════════════════════════════════════════════════════

  renderStrokeSmooth(ctx, stroke) {
    const pts = stroke.points;
    if (!pts || pts.length === 0) return;

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = stroke.size;

    if (stroke.eraser) {
      ctx.globalCompositeOperation = "destination-out";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = stroke.color;
    }

    if (pts.length === 1) {
      // Single dot
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, stroke.size / 2, 0, Math.PI * 2);
      ctx.fillStyle = stroke.eraser ? "rgba(0,0,0,1)" : stroke.color;
      ctx.fill();
    } else if (pts.length === 2) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      ctx.lineTo(pts[1].x, pts[1].y);
      ctx.stroke();
    } else {
      // Quadratic bezier through midpoints for smooth curves
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);

      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i].x + pts[i + 1].x) * 0.5;
        const my = (pts[i].y + pts[i + 1].y) * 0.5;
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
      }

      // Final segment to last point
      const last = pts[pts.length - 1];
      ctx.lineTo(last.x, last.y);
      ctx.stroke();
    }

    ctx.restore();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STROKE RENDERING — INCREMENTAL (used during live drawing, no full redraw)
  // Draws only from fromIndex onward, connecting to existing canvas content.
  // ═══════════════════════════════════════════════════════════════════════════

  drawSegmentsIncremental(stroke, fromIndex) {
    if (!this.isOpen) return;
    const pts = stroke.points;
    if (fromIndex >= pts.length) return;

    const ctx = this.ctx;
    const dpr = this.dpr;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.save();
    ctx.translate(this.panX, this.panY);
    ctx.scale(this.zoom, this.zoom);

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = stroke.size;

    if (stroke.eraser) {
      ctx.globalCompositeOperation = "destination-out";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = stroke.color;
    }

    // Start from the point just before the new segment to bridge the gap
    const start = Math.max(0, fromIndex);
    ctx.beginPath();
    ctx.moveTo(pts[start].x, pts[start].y);
    for (let i = start + 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.stroke();

    ctx.restore();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // POINTER HANDLING
  // ═══════════════════════════════════════════════════════════════════════════

  onPointerDown(e) {
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);

    // Space + click = pan
    if (this._spaceDown || e.button === 1) {
      this.isPanning = true;
      this.panStart = {
        x: e.clientX,
        y: e.clientY,
        px: this.panX,
        py: this.panY,
      };
      this.canvas.style.cursor = "grabbing";
      return;
    }

    if (e.button !== 0) return;

    this.drawing = true;
    const pt = this.getCanvasPoint(e);
    this.lastPoint = pt;

    // Start a new local stroke
    this.currentStroke = {
      points: [pt],
      color: this.color,
      size: this.size,
      eraser: this.eraser,
    };

    // Emit stroke start to server
    this.socket.emit("board stroke start", {
      point: pt,
      color: this.color,
      size: this.size,
      eraser: this.eraser,
    });

    // Begin network flush timer
    this.pointBuffer = [];
    if (!this.flushTimer) {
      this.flushTimer = setInterval(() => this.flush(), this.FLUSH_INTERVAL);
    }
  }

  onPointerMove(e) {
    // Send cursor position to others
    this.sendCursorPosition(e);

    if (this.isPanning && this.panStart) {
      this.panX = this.panStart.px + (e.clientX - this.panStart.x);
      this.panY = this.panStart.py + (e.clientY - this.panStart.y);
      this.redraw();
      return;
    }

    if (!this.drawing) return;
    e.preventDefault();

    const pt = this.getCanvasPoint(e);

    // Distance-based filtering: skip points too close to the last one
    if (this.currentStroke && this.currentStroke.points.length > 0) {
      const last =
        this.currentStroke.points[this.currentStroke.points.length - 1];
      const dx = pt.x - last.x;
      const dy = pt.y - last.y;
      if (dx * dx + dy * dy < this.MIN_POINT_DISTANCE_SQ) return;
    }

    // Draw locally immediately (zero-latency feedback)
    this.drawSegmentsIncremental(
      {
        points: [this.lastPoint, pt],
        color: this.color,
        size: this.size,
        eraser: this.eraser,
      },
      0,
    );
    this.lastPoint = pt;

    // Store in current stroke
    if (this.currentStroke) {
      this.currentStroke.points.push(pt);
    }

    // Buffer for network
    this.pointBuffer.push(pt);
  }

  onPointerUp(e) {
    if (this.isPanning) {
      this.isPanning = false;
      this.panStart = null;
      this.updateCursor();
      return;
    }

    if (!this.drawing) return;
    this.drawing = false;
    this.lastPoint = null;

    // Flush remaining points
    this.flush();

    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // Tell server the stroke is done
    this.socket.emit("board stroke end");

    // Move completed stroke to storage
    if (this.currentStroke) {
      this.strokes.push(this.currentStroke);
      this.currentStroke = null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // NETWORK
  // ═══════════════════════════════════════════════════════════════════════════

  flush() {
    if (this.pointBuffer.length === 0) return;
    const points = this.pointBuffer.splice(0);
    this.socket.emit("board stroke move", { points });
  }

  sendCursorPosition(e) {
    const now = Date.now();
    if (now - this.cursorThrottle < this.CURSOR_SEND_INTERVAL) return;
    this.cursorThrottle = now;
    const pt = this.getCanvasPoint(e);
    this.socket.emit("board cursor", { x: pt.x, y: pt.y });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REMOTE STROKE HANDLING
  // ═══════════════════════════════════════════════════════════════════════════

  handleRemoteStrokeStart(data) {
    if (data.userId === this.userId) return;

    // Create a new active stroke for this remote user
    const stroke = {
      points: [data.point],
      color: data.color || "#000000",
      size: data.size || 3,
      eraser: !!data.eraser,
    };

    // If they had an unfinished stroke, finalize it
    this.finalizeRemoteStroke(data.userId);

    this.remoteActiveStrokes.set(data.userId, stroke);

    // Render the initial dot
    if (this.isOpen) {
      const ctx = this.ctx;
      const dpr = this.dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.save();
      ctx.translate(this.panX, this.panY);
      ctx.scale(this.zoom, this.zoom);

      ctx.beginPath();
      ctx.arc(data.point.x, data.point.y, stroke.size / 2, 0, Math.PI * 2);
      if (stroke.eraser) {
        ctx.globalCompositeOperation = "destination-out";
        ctx.fillStyle = "rgba(0,0,0,1)";
      } else {
        ctx.fillStyle = stroke.color;
      }
      ctx.fill();
      ctx.restore();
    }
  }

  handleRemoteStrokeMove(data) {
    if (data.userId === this.userId) return;

    const stroke = this.remoteActiveStrokes.get(data.userId);
    if (!stroke) return;

    const prevLen = stroke.points.length;
    for (const p of data.points) {
      stroke.points.push(p);
    }

    // Incremental render: draw from the last existing point through new points
    // This bridges the gap between batches — the key smoothness fix
    if (this.isOpen && prevLen > 0) {
      this.drawSegmentsIncremental(stroke, prevLen - 1);
    }
  }

  handleRemoteStrokeEnd(data) {
    if (data.userId === this.userId) return;
    this.finalizeRemoteStroke(data.userId);
  }

  /**
   * Move a remote user's active stroke into completed strokes.
   */
  finalizeRemoteStroke(userId) {
    const stroke = this.remoteActiveStrokes.get(userId);
    if (stroke && stroke.points.length > 0) {
      this.strokes.push(stroke);
    }
    this.remoteActiveStrokes.delete(userId);
  }

  /**
   * Load full board state from server (on open or reconnect).
   */
  handleBoardState(data) {
    // Replace local state with server truth
    this.strokes = [];
    this.remoteActiveStrokes.clear();

    if (data.strokes && Array.isArray(data.strokes)) {
      for (const s of data.strokes) {
        if (s && s.points && s.points.length > 0) {
          this.strokes.push(s);
        }
      }
    }

    if (data.active && typeof data.active === "object") {
      for (const [uid, s] of Object.entries(data.active)) {
        if (uid !== this.userId && s && s.points && s.points.length > 0) {
          this.remoteActiveStrokes.set(uid, s);
        }
      }
    }

    if (this.isOpen) this.redraw();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LIVE CURSORS
  // ═══════════════════════════════════════════════════════════════════════════

  updateRemoteCursor(data) {
    let cursor = this.remoteCursors.get(data.userId);

    if (!cursor) {
      const el = document.createElement("div");
      el.className = "tb-remote-cursor";

      const dot = document.createElement("div");
      dot.className = "tb-cursor-dot";

      const label = document.createElement("span");
      label.className = "tb-cursor-label";
      label.textContent = data.username;

      el.appendChild(dot);
      el.appendChild(label);
      this.cursorLayer.appendChild(el);

      cursor = { el, x: 0, y: 0, username: data.username };
      this.remoteCursors.set(data.userId, cursor);
    }

    cursor.x = data.x;
    cursor.y = data.y;

    const screen = this.worldToScreen(data.x, data.y);
    cursor.el.style.transform = `translate(${screen.x}px, ${screen.y}px)`;

    const visible =
      screen.x >= -50 &&
      screen.x <= this.displayWidth + 50 &&
      screen.y >= -50 &&
      screen.y <= this.displayHeight + 50;
    cursor.el.style.display = visible ? "block" : "none";

    if (cursor.timeout) clearTimeout(cursor.timeout);
    cursor.timeout = setTimeout(() => {
      cursor.el.style.display = "none";
    }, 3000);
  }

  removeRemoteCursor(userId) {
    const cursor = this.remoteCursors.get(userId);
    if (cursor) {
      if (cursor.timeout) clearTimeout(cursor.timeout);
      if (cursor.el.parentNode) cursor.el.parentNode.removeChild(cursor.el);
      this.remoteCursors.delete(userId);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CHAT
  // ═══════════════════════════════════════════════════════════════════════════

  sendChat(text) {
    this.socket.emit("board chat", { text });
  }

  addChatMessage(data) {
    this.chatMessages.push(data);
    if (this.chatMessages.length > this.MAX_CHAT_MESSAGES) {
      this.chatMessages.shift();
      if (this.chatLog.firstChild)
        this.chatLog.removeChild(this.chatLog.firstChild);
    }

    const msg = document.createElement("div");
    msg.className = "tb-chat-msg";
    if (data.userId === this.userId) msg.classList.add("tb-chat-self");

    const name = document.createElement("span");
    name.className = "tb-chat-name";
    name.textContent = data.username;

    const text = document.createElement("span");
    text.className = "tb-chat-text";
    text.textContent = data.text;

    msg.appendChild(name);
    msg.appendChild(text);
    this.chatLog.appendChild(msg);
    this.chatLog.scrollTop = this.chatLog.scrollHeight;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SOCKET LISTENERS
  // ═══════════════════════════════════════════════════════════════════════════

  setupSocketListeners() {
    // ── Stroke lifecycle (v2) ────────────────────────────────────────
    this.socket.on("board stroke start", (data) =>
      this.handleRemoteStrokeStart(data),
    );
    this.socket.on("board stroke move", (data) =>
      this.handleRemoteStrokeMove(data),
    );
    this.socket.on("board stroke end", (data) =>
      this.handleRemoteStrokeEnd(data),
    );

    // ── Full state sync ─────────────────────────────────────────────
    this.socket.on("board state", (data) => this.handleBoardState(data));

    // ── Clear ────────────────────────────────────────────────────────
    this.socket.on("board clear", () => {
      this.strokes = [];
      this.currentStroke = null;
      this.remoteActiveStrokes.clear();
      if (this.isOpen) this.redraw();
    });

    // ── Cursors ──────────────────────────────────────────────────────
    this.socket.on("board cursor", (data) => {
      if (data.userId === this.userId) return;
      this.updateRemoteCursor(data);
    });

    // ── Chat ─────────────────────────────────────────────────────────
    this.socket.on("board chat", (data) => {
      this.addChatMessage(data);
    });

    // ── User left room ──────────────────────────────────────────────
    this.socket.on("user left", (userId) => {
      this.removeRemoteCursor(userId);
      this.finalizeRemoteStroke(userId);
    });

    this.socket.on("board user status", (data) => {
      if (!data.open) {
        this.removeRemoteCursor(data.userId);
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CLEANUP
  // ═══════════════════════════════════════════════════════════════════════════

  destroy() {
    if (this.isOpen) this.close();
    if (this.flushTimer) clearInterval(this.flushTimer);
    document.removeEventListener("keydown", this._escHandler);
    document.removeEventListener("keydown", this._spaceHandler);
    document.removeEventListener("keyup", this._spaceHandler);
    window.removeEventListener("resize", this._resizeHandler);
    for (const [, cursor] of this.remoteCursors) {
      if (cursor.timeout) clearTimeout(cursor.timeout);
    }
    if (this.modal && this.modal.parentNode) {
      this.modal.parentNode.removeChild(this.modal);
    }
  }
}

window.Talkoboard = Talkoboard;
