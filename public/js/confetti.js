/* 
   Talkomatic Confetti - Bulletproof JavaScript Version
   ===================================================
   Uses JavaScript animations instead of CSS for guaranteed functionality
*/
class SimplifiedConfettiSystem {
  constructor() {
    this.isActive = false;
    this.container = null;
    this.fallingPieces = [];
    this.explosionPieces = [];
    this.fallInterval = null;
    this.animationFrame = null;
    this.socket = null; // Will be set when socket is available
    this.config = {
      colors: [
        "orange",
        "cyan",
        "red",
        "green",
        "blue",
        "purple",
        "yellow",
        "pink",
        "gold",
        "white",
      ],
      shapes: ["square", "rectangle", "circle", "triangle"],
      fallSpeed: 2, // Faster falling to prevent screen clog
      explosionSpeed: 4,
      gravity: 0.05,
      maxPieces: 300, // MASSIVE increase - 300 pieces on screen!
    };
    this.init();
  }

  init() {
    this.createContainer();
    this.addToggleUI();
    this.setupEvents();
    this.loadState();
    this.startAnimationLoop();
    this.connectToSocket();
  }

  createContainer() {
    const existing = document.getElementById("talkomatic-confetti-container");
    if (existing) existing.remove();
    this.container = document.createElement("div");
    this.container.id = "talkomatic-confetti-container";
    this.container.style.cssText = `
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      pointer-events: none !important;
      z-index: 998 !important;
      overflow: hidden !important;
    `;
    document.body.appendChild(this.container);
  }

  addToggleUI() {
    const knownAsSection = document.querySelector(".known-as-section");
    if (!knownAsSection) {
      console.error("❌ Could not find .known-as-section");
      return;
    }
    const existing = document.querySelector(".confetti-toggle-section");
    if (existing) existing.remove();
    const toggleSection = document.createElement("div");
    toggleSection.className = "confetti-toggle-section";
    toggleSection.innerHTML = `
      <p>🎉 1 Year Anniversary Confetti! </p>
      <label class="confetti-toggle">
        <input type="checkbox" id="confetti-toggle-checkbox">
        <span class="confetti-slider"></span>
      </label>
    `;
    knownAsSection.parentNode.insertBefore(toggleSection, knownAsSection);
  }

  setupEvents() {
    const toggle = document.getElementById("confetti-toggle-checkbox");
    if (toggle) {
      toggle.addEventListener("change", (e) => {
        if (e.target.checked) {
          this.start();
        } else {
          this.stop();
        }
        this.saveState(e.target.checked);
      });
    }
    // Click explosions
    document.addEventListener(
      "click",
      (e) => {
        if (!this.isActive || this.shouldIgnoreClick(e.target)) {
          return;
        }
        this.createExplosion(e.clientX, e.clientY);
      },
      true
    );
  }

  shouldIgnoreClick(target) {
    let element = target;
    while (element && element !== document.body) {
      const tagName = element.tagName.toLowerCase();
      if (
        tagName === "button" ||
        tagName === "input" ||
        tagName === "a" ||
        element.classList.contains("confetti-toggle") ||
        element.closest(".confetti-toggle-section")
      ) {
        return true;
      }
      element = element.parentElement;
    }
    return false;
  }

  start() {
    if (this.isActive) return;
    this.isActive = true;
    // Create initial burst - MASSIVE OPENING!
    for (let i = 0; i < 50; i++) {
      // HUGE opening burst!
      setTimeout(() => {
        this.createFallingPiece();
      }, i * 50); // Very fast initial spawning
    }
    // Start continuous generation - CONFETTI STORM MODE!
    this.fallInterval = setInterval(() => {
      if (this.fallingPieces.length < this.config.maxPieces) {
        // Create 15 pieces per interval for MASSIVE density
        for (let i = 0; i < 15; i++) {
          setTimeout(() => {
            this.createFallingPiece();
          }, i * 20); // Very fast staggering
        }
      }
    }, 200); // Generate every 0.2 seconds - CRAZY FAST!
    // BONUS: Additional wave generator for MAXIMUM INSANITY!
    this.bonusInterval = setInterval(() => {
      if (this.fallingPieces.length < this.config.maxPieces * 0.8) {
        // Create bonus wave
        for (let i = 0; i < 8; i++) {
          setTimeout(() => {
            this.createFallingPiece();
          }, i * 30);
        }
      }
    }, 150); // Even faster bonus waves!
  }

  stop() {
    if (!this.isActive) return;
    this.isActive = false;
    if (this.fallInterval) {
      clearInterval(this.fallInterval);
      this.fallInterval = null;
    }
    if (this.bonusInterval) {
      clearInterval(this.bonusInterval);
      this.bonusInterval = null;
    }
  }

  startAnimationLoop() {
    const animate = () => {
      this.updatePieces();
      this.animationFrame = requestAnimationFrame(animate);
    };
    animate();
  }

  updatePieces() {
    // Update falling pieces
    this.fallingPieces = this.fallingPieces.filter((piece) => {
      piece.y += piece.speed;
      piece.rotation += piece.rotationSpeed;
      piece.x += piece.drift;
      // Apply position
      piece.element.style.transform = `translateX(${piece.x}px) translateY(${piece.y}px) rotate(${piece.rotation}deg)`;
      piece.element.style.opacity = Math.max(
        0,
        1 - piece.y / window.innerHeight
      );
      // Remove if off screen
      if (piece.y > window.innerHeight + 50) {
        if (piece.element.parentNode) {
          piece.element.parentNode.removeChild(piece.element);
        }
        return false;
      }
      return true;
    });
    // Update explosion pieces
    this.explosionPieces = this.explosionPieces.filter((piece) => {
      piece.x += piece.velocityX;
      piece.y += piece.velocityY;
      piece.velocityY += this.config.gravity; // Gravity
      piece.rotation += piece.rotationSpeed;
      piece.life--;
      // Apply position
      piece.element.style.transform = `translateX(${piece.x}px) translateY(${piece.y}px) rotate(${piece.rotation}deg)`;
      piece.element.style.opacity = Math.max(0, piece.life / piece.maxLife);
      // Remove if life is over
      if (piece.life <= 0) {
        if (piece.element.parentNode) {
          piece.element.parentNode.removeChild(piece.element);
        }
        return false;
      }
      return true;
    });
  }

  createFallingPiece() {
    const element = this.createConfettiElement();
    const piece = {
      element: element,
      x: Math.random() * (window.innerWidth - 50),
      y: -50 - Math.random() * 100, // Vary starting height for more chaos
      speed: 1 + Math.random() * 4, // Wide speed range for visual variety
      rotation: Math.random() * 360,
      rotationSpeed: (Math.random() - 0.5) * 12, // Faster rotation for more energy
      drift: (Math.random() - 0.5) * 4, // More horizontal movement
    };
    // Set initial position
    element.style.position = "absolute";
    element.style.left = "0px";
    element.style.top = "0px";
    element.style.transform = `translateX(${piece.x}px) translateY(${piece.y}px) rotate(${piece.rotation}deg)`;
    this.container.appendChild(element);
    this.fallingPieces.push(piece);
  }

  createExplosion(centerX, centerY) {
    // Create ripple effect
    this.createRipple(centerX, centerY);
    // Create explosion pieces - MASSIVE EXPLOSIONS!
    const numPieces = 40; // HUGE explosions - 40 pieces per click!
    for (let i = 0; i < numPieces; i++) {
      const angle = (i / numPieces) * Math.PI * 2;
      const speed = 4 + Math.random() * 6; // Much more explosive force!
      const element = this.createConfettiElement();
      const piece = {
        element: element,
        x: centerX,
        y: centerY,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - Math.random() * 2, // Some upward velocity
        rotation: Math.random() * 360,
        rotationSpeed: (Math.random() - 0.5) * 15,
        life: 120, // frames
        maxLife: 120,
      };
      // Set initial position
      element.style.position = "absolute";
      element.style.left = "0px";
      element.style.top = "0px";
      element.style.transform = `translateX(${piece.x}px) translateY(${piece.y}px) rotate(${piece.rotation}deg)`;
      this.container.appendChild(element);
      this.explosionPieces.push(piece);
    }
  }

  createRipple(x, y) {
    const ripple = document.createElement("div");
    ripple.style.cssText = `
      position: absolute !important;
      left: ${x - 25}px !important;
      top: ${y - 25}px !important;
      width: 50px !important;
      height: 50px !important;
      border-radius: 50% !important;
      background: radial-gradient(circle, rgba(255, 152, 0, 0.6) 0%, transparent 70%) !important;
      pointer-events: none !important;
      z-index: 997 !important;
    `;
    this.container.appendChild(ripple);
    // Animate ripple with JavaScript
    let scale = 0;
    let opacity = 1;
    const animate = () => {
      scale += 0.15;
      opacity -= 0.03;
      ripple.style.transform = `scale(${scale})`;
      ripple.style.opacity = Math.max(0, opacity);
      if (opacity > 0) {
        requestAnimationFrame(animate);
      } else {
        if (ripple.parentNode) {
          ripple.parentNode.removeChild(ripple);
        }
      }
    };
    requestAnimationFrame(animate);
  }

  createConfettiElement() {
    const piece = document.createElement("div");
    const color =
      this.config.colors[Math.floor(Math.random() * this.config.colors.length)];
    const shape =
      this.config.shapes[Math.floor(Math.random() * this.config.shapes.length)];
    piece.className = `confetti-piece confetti-${shape} confetti-${color}`;
    // Force styles for guaranteed visibility
    piece.style.position = "absolute";
    piece.style.pointerEvents = "none";
    piece.style.zIndex = "998";
    const colorHex = this.getColorHex(color);
    switch (shape) {
      case "square":
        piece.style.width = "12px";
        piece.style.height = "12px";
        piece.style.backgroundColor = colorHex;
        piece.style.borderRadius = "2px";
        break;
      case "rectangle":
        piece.style.width = "20px";
        piece.style.height = "8px";
        piece.style.backgroundColor = colorHex;
        piece.style.borderRadius = "1px";
        break;
      case "circle":
        piece.style.width = "10px";
        piece.style.height = "10px";
        piece.style.backgroundColor = colorHex;
        piece.style.borderRadius = "50%";
        break;
      case "triangle":
        piece.style.width = "0";
        piece.style.height = "0";
        piece.style.borderLeft = "6px solid transparent";
        piece.style.borderRight = "6px solid transparent";
        piece.style.borderBottom = `12px solid ${colorHex}`;
        piece.style.backgroundColor = "transparent";
        break;
    }
    // Add shadow for visibility
    piece.style.boxShadow = "0 2px 4px rgba(0, 0, 0, 0.3)";
    return piece;
  }

  getColorHex(colorName) {
    const colors = {
      orange: "#ff9800",
      cyan: "#00ffff",
      red: "#ff4444",
      green: "#44ff44",
      blue: "#4488ff",
      purple: "#ff44ff",
      yellow: "#ffff44",
      pink: "#ff69b4",
      gold: "#ffd700",
      white: "#ffffff",
    };
    return colors[colorName] || "#ff9800";
  }

  connectToSocket() {
    // Socket connection logic would go here if needed
    // This is a placeholder for when socket functionality is added
  }

  saveState(enabled) {
    try {
      localStorage.setItem("talkomatic-confetti-enabled", enabled.toString());
    } catch (e) {
      console.error("Could not save confetti state");
    }
  }

  loadState() {
    try {
      const saved = localStorage.getItem("talkomatic-confetti-enabled");
      if (saved === "true") {
        const toggle = document.getElementById("confetti-toggle-checkbox");
        if (toggle) {
          toggle.checked = true;
          this.start();
        }
      }
    } catch (e) {
      console.error("Could not load confetti state");
    }
  }

  // Public API
  toggle() {
    const toggle = document.getElementById("confetti-toggle-checkbox");
    if (toggle) {
      toggle.checked = !toggle.checked;
      toggle.dispatchEvent(new Event("change"));
    }
  }

  explodeAt(x, y) {
    if (this.isActive) {
      this.createExplosion(x, y);
    }
  }

  testExplosion() {
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;
    this.createExplosion(centerX, centerY);
  }

  getStats() {
    return {
      isActive: this.isActive,
      fallingPieces: this.fallingPieces.length,
      explosionPieces: this.explosionPieces.length,
      totalPieces: this.fallingPieces.length + this.explosionPieces.length,
    };
  }

  destroy() {
    this.stop();
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
    }
    if (this.bonusInterval) {
      clearInterval(this.bonusInterval);
    }
    // Clean up all pieces
    [...this.fallingPieces, ...this.explosionPieces].forEach((piece) => {
      if (piece.element && piece.element.parentNode) {
        piece.element.parentNode.removeChild(piece.element);
      }
    });
    this.fallingPieces = [];
    this.explosionPieces = [];
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
  }
}

// Initialize
let confettiSystem = null;

function initConfettiSystem() {
  if (confettiSystem) {
    return;
  }
  try {
    confettiSystem = new SimplifiedConfettiSystem();
    window.ConfettiSystem = confettiSystem;
    console.log("🎉 Confetti system initialized successfully!");
  } catch (error) {
    console.error("❌ Error initializing confetti:", error);
  }
}

// Auto-initialize
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initConfettiSystem);
} else {
  initConfettiSystem();
}

// Cleanup
window.addEventListener("beforeunload", () => {
  if (confettiSystem) {
    confettiSystem.destroy();
  }
});
