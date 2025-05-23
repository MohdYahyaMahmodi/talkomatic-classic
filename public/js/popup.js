/**
 * Talkomatic Update Popup Manager
 * Handles showing update popups based on version changes and time intervals
 */
class TalkomaticPopupManager {
  constructor() {
    // Current version - update this when you release new versions
    this.currentVersion = "3.2.1";
    // Cookie names
    this.cookieNames = {
      lastShown: "talkomatic_popup_last_shown",
      lastVersion: "talkomatic_popup_last_version",
    };
    // Time intervals (in milliseconds)
    this.intervals = {
      thirtyDays: 30 * 24 * 60 * 60 * 1000, // 30 days in milliseconds
    };
    this.popupContainer = null;
    this.isPopupVisible = false;
  }

  /**
   * Initialize the popup manager - call this on page load
   */
  init() {
    // Wait for DOM to be ready
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () =>
        this.checkAndShowPopup()
      );
    } else {
      this.checkAndShowPopup();
    }
  }

  /**
   * Check if popup should be shown and display it if needed
   */
  checkAndShowPopup() {
    if (this.shouldShowPopup()) {
      this.createAndShowPopup();
    }
  }

  /**
   * Determine if the popup should be shown
   * @returns {boolean} - true if popup should be shown
   */
  shouldShowPopup() {
    const lastShown = this.getCookie(this.cookieNames.lastShown);
    const lastVersion = this.getCookie(this.cookieNames.lastVersion);
    // If no cookies exist, this is a first visit - show popup
    if (!lastShown || !lastVersion) {
      return true;
    }
    // If version has changed, show popup regardless of time
    if (lastVersion !== this.currentVersion) {
      return true;
    }
    // If same version, check if 30 days have passed
    const lastShownDate = new Date(parseInt(lastShown));
    const now = new Date();
    const timeDifference = now.getTime() - lastShownDate.getTime();
    return timeDifference >= this.intervals.thirtyDays;
  }

  /**
   * Create popup styles
   */
  createPopupStyles() {
    const styleId = "talkomatic-popup-styles";
    if (document.getElementById(styleId)) {
      return; // Styles already added
    }
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
            /* Talkomatic Popup Styles */
            .talkomatic-popup-overlay {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background-color: rgba(0, 0, 0, 0.85);
                z-index: 999999;
                display: flex;
                justify-content: center;
                align-items: center;
                padding: 20px;
                box-sizing: border-box;
                animation: talkomaticFadeIn 0.3s ease-in-out;
            }
            @keyframes talkomaticFadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            @keyframes talkomaticFadeOut {
                from { opacity: 1; }
                to { opacity: 0; }
            }
            @keyframes talkomaticSlideIn {
                from { 
                    transform: translateY(-30px);
                    opacity: 0;
                }
                to { 
                    transform: translateY(0);
                    opacity: 1;
                }
            }
            .talkomatic-popup-content {
                background-color: #202020;
                border: 1px solid #616161;
                border-radius: 2px;
                max-width: 950px;
                width: 100%;
                max-height: 90vh;
                overflow-y: auto;
                position: relative;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
                color: white;
                font-family: Arial, sans-serif;
                animation: talkomaticSlideIn 0.3s ease-out;
            }
            .talkomatic-popup-header {
                background: linear-gradient(to bottom, #616161, #303030);
                padding: 2rem;
                position: relative;
                border-bottom: 1px solid #616161;
            }
            .talkomatic-popup-close {
                position: absolute;
                right: 1rem;
                top: 1rem;
                font-size: 1.8rem;
                cursor: pointer;
                color: #FF9800;
                transition: all 0.2s;
                width: 32px;
                height: 32px;
                display: flex;
                align-items: center;
                justify-content: center;
                border: 1px solid #616161;
                border-radius: 2px;
                background-color: #000000;
            }
            .talkomatic-popup-close:hover {
                background-color: #FF9800;
                color: #000000;
                transform: scale(1.1);
            }
            .talkomatic-popup-title {
                margin: 0;
                font-size: 26px;
                font-weight: bold;
                color: #FF9800;
                margin-bottom: 0.5rem;
                padding-right: 40px;
                text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
            }
            .talkomatic-popup-version {
                margin: 0;
                font-size: 14px;
                color: #ffffff;
                opacity: 0.9;
                font-weight: 500;
            }
            .talkomatic-popup-body {
                padding: 2rem;
                line-height: 1.6;
            }
            .talkomatic-update-section {
                margin-bottom: 3rem;
            }
            .talkomatic-update-section h3 {
                color: #FF9800;
                margin-bottom: 1.5rem;
                font-size: 22px;
                font-weight: bold;
                border-bottom: 2px solid #FF9800;
                padding-bottom: 0.5rem;
            }
            .talkomatic-feature-list {
                list-style: none;
                padding: 0;
                margin-bottom: 1rem;
            }
            .talkomatic-feature-list li {
                padding: 15px 0;
                border-bottom: 1px solid #404040;
                position: relative;
                padding-left: 30px;
                color: #ffffff;
                font-size: 15px;
                transition: background-color 0.2s ease;
            }
            .talkomatic-feature-list li:hover {
                background-color: rgba(255, 152, 0, 0.05);
                border-radius: 2px;
                margin: 0 -10px;
                padding-left: 40px;
                padding-right: 10px;
            }
            .talkomatic-feature-list li:before {
                content: "•";
                color: #FF9800;
                font-weight: bold;
                position: absolute;
                left: 0;
                font-size: 20px;
            }
            .talkomatic-feature-list li:last-child {
                border-bottom: none;
            }
            .talkomatic-badge {
                display: inline-block;
                padding: 4px 10px;
                border-radius: 2px;
                font-size: 11px;
                font-weight: bold;
                margin-left: 12px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            .talkomatic-badge.new { 
                background: #FF9800; 
                color: #000000; 
                box-shadow: 0 2px 4px rgba(255, 152, 0, 0.3);
            }
            .talkomatic-badge.improved { 
                background: #01ffff; 
                color: #000000; 
                box-shadow: 0 2px 4px rgba(1, 255, 255, 0.3);
            }
            .talkomatic-badge.fixed { 
                background: #616161; 
                color: #ffffff; 
                box-shadow: 0 2px 4px rgba(97, 97, 97, 0.3);
            }
            .talkomatic-feature-grid {
                display: grid;
                gap: 1.5rem;
                margin-top: 1rem;
            }
            .talkomatic-feature-item {
                background-color: #000000;
                padding: 2rem;
                border-radius: 2px;
                border: 1px solid #616161;
                transition: all 0.3s ease;
                text-align: center;
            }
            .talkomatic-feature-item:hover {
                border-color: #FF9800;
                transform: translateY(-4px);
                box-shadow: 0 8px 20px rgba(255, 152, 0, 0.15);
            }
            .talkomatic-feature-icon {
                width: 56px;
                height: 56px;
                margin: 0 auto 1.5rem;
                background: linear-gradient(135deg, #FF9800, #ff8c42);
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 28px;
                color: #000000;
                box-shadow: 0 4px 12px rgba(255, 152, 0, 0.3);
            }
            .talkomatic-feature-item h4 {
                margin: 0.5rem 0 1rem 0;
                color: #FF9800;
                font-size: 18px;
                font-weight: bold;
            }
            .talkomatic-feature-item p {
                margin: 0;
                color: #cccccc;
                font-size: 15px;
                line-height: 1.6;
            }
            .talkomatic-highlight-box {
                background: linear-gradient(135deg, #000000, #1a1a1a);
                border: 2px solid #FF9800;
                border-radius: 2px;
                padding: 2rem;
                margin: 2rem 0;
                position: relative;
                overflow: hidden;
            }
            .talkomatic-highlight-box:before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                height: 4px;
                background: linear-gradient(90deg, #FF9800, #ff8c42, #FF9800);
            }
            .talkomatic-highlight-box h4 {
                color: #FF9800;
                margin-bottom: 1rem;
                font-size: 20px;
                font-weight: bold;
            }
            .talkomatic-highlight-box p {
                color: #ffffff;
                margin: 0;
                font-size: 16px;
                line-height: 1.6;
            }
            .talkomatic-image-container {
                margin: 2rem 0;
                text-align: center;
            }
            .talkomatic-update-image {
                max-width: 100%;
                height: auto;
                border-radius: 2px;
                border: 1px solid #616161;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
                transition: transform 0.3s ease;
            }
            .talkomatic-update-image:hover {
                transform: scale(1.02);
                border-color: #FF9800;
            }
            .talkomatic-image-caption {
                margin-top: 1rem;
                font-size: 14px;
                color: #01ffff;
                font-style: italic;
                text-align: center;
            }
            .talkomatic-two-column {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 2rem;
                align-items: center;
                margin: 2rem 0;
            }
            .talkomatic-popup-footer {
                padding: 24px 2rem;
                background: linear-gradient(to bottom, #000000, #1a1a1a);
                border-radius: 0 0 2px 2px;
                border-top: 1px solid #616161;
                text-align: center;
            }
            .talkomatic-popup-footer button {
                padding: 14px 24px;
                background-color: #000000;
                color: white;
                border: 2px solid #FF9800;
                border-radius: 2px;
                cursor: pointer;
                font-size: 16px;
                font-weight: bold;
                transition: all 0.3s ease;
                font-family: inherit;
                text-transform: uppercase;
                letter-spacing: 1px;
            }
            .talkomatic-popup-footer button:hover {
                background-color: #FF9800;
                color: #000000;
                transform: translateY(-2px);
                box-shadow: 0 6px 16px rgba(255, 152, 0, 0.4);
            }
            .talkomatic-link-button {
                display: inline-block;
                padding: 14px 24px;
                background: linear-gradient(135deg, #000000, #1a1a1a);
                color: white;
                border: 2px solid #FF9800;
                border-radius: 2px;
                text-decoration: none;
                font-size: 16px;
                font-weight: bold;
                transition: all 0.3s ease;
                font-family: inherit;
                text-transform: uppercase;
                letter-spacing: 1px;
            }
            .talkomatic-link-button:hover {
                background: linear-gradient(135deg, #FF9800, #ff8c42);
                color: #000000;
                transform: translateY(-3px);
                box-shadow: 0 8px 20px rgba(255, 152, 0, 0.4);
            }
            .talkomatic-link-button:visited {
                color: white;
            }
            .talkomatic-link-button:visited:hover {
                color: #000000;
            }
            .talkomatic-popup-content::-webkit-scrollbar {
                width: 12px;
            }
            .talkomatic-popup-content::-webkit-scrollbar-track {
                background: #202020;
            }
            .talkomatic-popup-content::-webkit-scrollbar-thumb {
                background:#FF9800;
                border-radius: 2px;
            }
            .talkomatic-popup-content::-webkit-scrollbar-thumb:hover {
                background: #FF9800;
            }
            @media (min-width: 768px) {
                .talkomatic-feature-grid {
                    grid-template-columns: repeat(2, 1fr);
                }
            }
            @media (min-width: 992px) {
                .talkomatic-feature-grid {
                    grid-template-columns: repeat(3, 1fr);
                }
            }
            @media (max-width: 767px) {
                .talkomatic-popup-content {
                    width: 95%;
                    margin: 1rem;
                    max-height: 95vh;
                }
                
                .talkomatic-popup-header {
                    padding: 1.5rem;
                }
                
                .talkomatic-popup-body {
                    padding: 1.5rem;
                }
                
                .talkomatic-popup-title {
                    font-size: 22px;
                    margin-bottom: 1rem;
                }
                
                .talkomatic-update-section h3 {
                    font-size: 20px;
                    margin-bottom: 1rem;
                }
                
                .talkomatic-feature-item {
                    padding: 1.5rem;
                }
                
                .talkomatic-feature-item h4 {
                    font-size: 16px;
                }
                
                .talkomatic-feature-item p {
                    font-size: 14px;
                }
                
                .talkomatic-popup-close {
                    right: 0.5rem;
                    top: 0.5rem;
                }
                
                .talkomatic-two-column {
                    grid-template-columns: 1fr;
                    gap: 1.5rem;
                }
                
                .talkomatic-feature-grid {
                    grid-template-columns: 1fr;
                }
            }
            @media (max-width: 600px) {
                .talkomatic-link-button {
                    padding: 12px 20px;
                    font-size: 14px;
                }
                
                .talkomatic-popup-footer button {
                    padding: 12px 20px;
                    font-size: 14px;
                }
            }
        `;
    document.head.appendChild(style);
  }

  /**
   * Create popup HTML content
   */
  createPopupHTML() {
    const currentDate = new Date().toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });
    return `
            <div class="talkomatic-popup-overlay">
                <div class="talkomatic-popup-content">
                    <div class="talkomatic-popup-header">
                        <button class="talkomatic-popup-close" data-action="close">&times;</button>
                        <h2 class="talkomatic-popup-title">🎉 Talkomatic v${this.currentVersion} is Here!</h2>
                        <p class="talkomatic-popup-version">Major Update - ${currentDate}</p>
                    </div>
                    
                    <div class="talkomatic-popup-body">
                        <!-- App Directory Introduction -->
                        <div class="talkomatic-update-section">
                            <h3>Introducing the App Directory</h3>
                            <div class="talkomatic-two-column">
                                <div>
                                    <div class="talkomatic-highlight-box">
                                        <h4>Transform Your Chat Experience</h4>
                                        <p>We've revolutionized Talkomatic with a brand new App Directory! Now you can enhance your conversations with interactive apps, games, and collaborative tools - all accessible directly from your chat rooms.</p>
                                    </div>
                                </div>
                                <div class="talkomatic-image-container">
                                    <!-- Add your app directory screenshot here -->
                                    <img src="images/updates/app-directory-room.png" alt="App Directory Interface" class="talkomatic-update-image" >
                                    <!-- Placeholder for when you add the image -->

                                    <div class="talkomatic-image-caption">The new App Directory in action</div>
                                </div>
                            </div>
                        </div>

                        <!-- WatchParty Feature -->
                        <div class="talkomatic-update-section">
                            <h3>🍿 WatchParty by Talkomatic</h3>
                            <div class="talkomatic-highlight-box">
                                <h4>Watch YouTube Videos Together!</h4>
                                <p>Our first app is here! WatchParty lets you create synchronized viewing sessions where you can watch YouTube videos together in perfect sync while chatting in real-time. It's like having a movie night with friends from anywhere in the world.</p>
                                <div style="text-align: center; margin-top: 1.5rem;">
                                    <a href="https://watchparty.talkomatic.co/" target="_blank" class="talkomatic-link-button">
                                        🎬 Launch WatchParty
                                    </a>
                                </div>
                            </div>
                            
                            <!-- WatchParty Image -->
                            <div class="talkomatic-image-container">
                                <img src="https://watchparty.talkomatic.co/images/logo.png" alt="WatchParty Logo" style="max-height: 120px; background: white; padding: 20px; border-radius: 2px; border: 1px solid #616161;">
                                <div class="talkomatic-image-caption">WatchParty - Synchronized video watching made easy</div>
                            </div>
                        </div>

                        <!-- What's New -->
                        <div class="talkomatic-update-section">
                            <h3>✨ Major New Features</h3>
                            <ul class="talkomatic-feature-list">
                                <li>Complete App Directory system integrated into all chat rooms <span class="talkomatic-badge new">NEW</span></li>
                                <li>WatchParty app for synchronized YouTube viewing <span class="talkomatic-badge new">NEW</span></li>
                                <li>Beautiful app discovery interface with real app icons <span class="talkomatic-badge new">NEW</span></li>
                                <li>Seamless app launching directly from chat rooms <span class="talkomatic-badge new">NEW</span></li>
                                <li>Professional app grid layout with hover effects <span class="talkomatic-badge new">NEW</span></li>
                                <li>Mobile-responsive app directory design <span class="talkomatic-badge improved">IMPROVED</span></li>
                            </ul>
                        </div>

                        <!-- Room Improvements -->
                        <div class="talkomatic-update-section">
                            <h3>🏠 Room Experience Enhancements</h3>
                            <div class="talkomatic-feature-grid">
                                <div class="talkomatic-feature-item">
                                    <div class="talkomatic-feature-icon">📱</div>
                                    <h4>Apps Button</h4>
                                    <p>Every room now has a dedicated Apps button in the navigation bar for quick access to the directory.</p>
                                </div>
                                <div class="talkomatic-feature-item">
                                    <div class="talkomatic-feature-icon">🎨</div>
                                    <h4>Visual Redesign</h4>
                                    <p>Consistent 2px border radius throughout the interface for a modern, polished look.</p>
                                </div>
                                <div class="talkomatic-feature-item">
                                    <div class="talkomatic-feature-icon">⚡</div>
                                    <h4>Better Performance</h4>
                                    <p>Improved room loading times and smoother user interface interactions.</p>
                                </div>
                            </div>
                        </div>

                        <!-- Technical Improvements -->
                        <div class="talkomatic-update-section">
                            <h3>🔧 Under the Hood</h3>
                            <ul class="talkomatic-feature-list">
                                <li>Fixed rooms not loading properly on slower connections <span class="talkomatic-badge fixed">FIXED</span></li>
                                <li>Enhanced auto-moderation with better word filtering <span class="talkomatic-badge improved">IMPROVED</span></li>
                                <li>Resolved rate limiting issues causing error pages <span class="talkomatic-badge fixed">FIXED</span></li>
                                <li>Improved mobile responsiveness across all interfaces <span class="talkomatic-badge improved">IMPROVED</span></li>
                                <li>Better error handling and user feedback messages <span class="talkomatic-badge improved">IMPROVED</span></li>
                            </ul>
                        </div>

                        <!-- Coming Soon -->
                        <div class="talkomatic-update-section">
                            <h3>🔮 Coming Soon to App Directory</h3>
                            <div class="talkomatic-feature-grid">
                                <div class="talkomatic-feature-item">
                                    <div class="talkomatic-feature-icon">🎨</div>
                                    <h4>InfiniteBoard</h4>
                                    <p>Collaborative whiteboard for drawing, brainstorming, and visual communication in real-time.</p>
                                </div>
                                <div class="talkomatic-feature-item">
                                    <div class="talkomatic-feature-icon">🎮</div>
                                    <h4>Mini Games</h4>
                                    <p>Play Uno, Hangman, Tic Tac Toe, and other classic games directly in your chat rooms.</p>
                                </div>
                                <div class="talkomatic-feature-item">
                                    <div class="talkomatic-feature-icon">📁</div>
                                    <h4>File Share</h4>
                                    <p>Secure file and image sharing with drag-and-drop functionality for easy collaboration.</p>
                                </div>
                            </div>
                        </div>

                        <!-- How to Access -->
                        <div class="talkomatic-update-section">
                            <h3>🎯 How to Access Apps</h3>
                            <div class="talkomatic-highlight-box">
                                <h4>It's Simple!</h4>
                                <p><strong>In Chat Rooms:</strong> Look for the "Apps" button in the top navigation bar. Click it to see all available apps and launch them instantly.</p>
                                <p style="margin-top: 1rem;"><strong>From Lobby:</strong> Check out the full app directory from the main lobby for detailed descriptions and features of each app.</p>
                            </div>
                        </div>

                        <!-- Developer Note -->
                        <div class="talkomatic-update-section">
                            <h3>👨‍💻 For Developers</h3>
                            <div class="talkomatic-two-column">
                                <div>
                                    <div class="talkomatic-highlight-box">
                                        <h4>Build Your Own Apps</h4>
                                        <p>Interested in creating apps for Talkomatic? We're working on developer APIs and tools. Contact us to learn about becoming a Talkomatic app developer!</p>
                                    </div>
                                </div>
                                <div class="talkomatic-image-container">
                                    <!-- Developer placeholder -->
                                    <div style="background: linear-gradient(135deg, #1a1a1a, #000); color: #FF9800; padding: 2rem; border-radius: 2px; border: 1px solid #616161; text-align: center; font-family: monospace;">
                                        <div style="font-size: 24px; margin-bottom: 1rem;">{ }</div>
                                        <div style="font-size: 16px;">API Coming Soon</div>
                                    </div>
                                    <div class="talkomatic-image-caption">Developer tools in development</div>
                                </div>
                            </div>
                        </div>

                        <!-- Privacy & Security -->
                        <div class="talkomatic-update-section">
                            <h3>🛡️ Privacy & Security</h3>
                            <div class="talkomatic-highlight-box">
                                <h4>Your Safety Comes First</h4>
                                <p>All apps in our directory are carefully vetted for security and privacy. We maintain the same high standards for apps as we do for our core chat platform. Your conversations and data remain private and secure.</p>
                            </div>
                        </div>
                    </div>
                    
                    <div class="talkomatic-popup-footer">
                        <button data-action="close">Continue to Talkomatic</button>
                    </div>
                </div>
            </div>
        `;
  }

  /**
   * Create and show the popup
   */
  createAndShowPopup() {
    try {
      // Create styles first
      this.createPopupStyles();
      // Create popup container
      this.createPopupContainer();
      // Add HTML content
      this.popupContainer.innerHTML = this.createPopupHTML();
      // Add to document body
      document.body.appendChild(this.popupContainer);
      // Show the popup
      this.showPopup();
      // Set up event handlers
      this.setupEventHandlers();
      this.isPopupVisible = true;
    } catch (error) {
      console.error("Error creating popup:", error);
    }
  }

  /**
   * Create the popup container element
   */
  createPopupContainer() {
    this.popupContainer = document.createElement("div");
    this.popupContainer.id = "talkomatic-popup-container";
    this.popupContainer.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: 999999;
            pointer-events: all;
        `;
  }

  /**
   * Show the popup with animation
   */
  showPopup() {
    if (this.popupContainer) {
      this.popupContainer.style.display = "block";
      // Prevent body scrolling while popup is open
      document.body.style.overflow = "hidden";
    }
  }

  /**
   * Set up event handlers for closing the popup
   */
  setupEventHandlers() {
    // Event delegation for close buttons
    this.popupContainer.addEventListener("click", (e) => {
      if (e.target.dataset.action === "close") {
        this.closePopup();
      }
      // Click outside to close
      if (e.target.classList.contains("talkomatic-popup-overlay")) {
        this.closePopup();
      }
    });
    // Escape key to close
    this.keyHandler = (e) => {
      if (e.key === "Escape" && this.isPopupVisible) {
        this.closePopup();
      }
    };
    document.addEventListener("keydown", this.keyHandler);
  }

  /**
   * Close the popup and save the state
   */
  closePopup() {
    if (!this.isPopupVisible) return;
    const popupElement = this.popupContainer?.querySelector(
      ".talkomatic-popup-overlay"
    );
    if (popupElement) {
      // Animate out
      popupElement.style.animation = "talkomaticFadeOut 0.3s ease-in-out";
      setTimeout(() => {
        // Remove from DOM
        if (this.popupContainer && this.popupContainer.parentNode) {
          this.popupContainer.parentNode.removeChild(this.popupContainer);
        }
        // Restore body scrolling
        document.body.style.overflow = "";
        // Save state to cookies
        this.savePopupState();
        // Clean up event listeners
        if (this.keyHandler) {
          document.removeEventListener("keydown", this.keyHandler);
          this.keyHandler = null;
        }
        this.isPopupVisible = false;
        this.popupContainer = null;
      }, 300);
    }
  }

  /**
   * Save the current state to cookies
   */
  savePopupState() {
    const now = new Date().getTime();
    const expiryDate = new Date();
    expiryDate.setFullYear(expiryDate.getFullYear() + 1); // Expire in 1 year
    this.setCookie(this.cookieNames.lastShown, now.toString(), expiryDate);
    this.setCookie(
      this.cookieNames.lastVersion,
      this.currentVersion,
      expiryDate
    );
  }

  /**
   * Set a cookie
   * @param {string} name - Cookie name
   * @param {string} value - Cookie value
   * @param {Date} expiry - Expiry date
   */
  setCookie(name, value, expiry) {
    const expires = expiry ? "; expires=" + expiry.toUTCString() : "";
    document.cookie = `${name}=${value}${expires}; path=/; SameSite=Lax`;
  }

  /**
   * Get a cookie value
   * @param {string} name - Cookie name
   * @returns {string|null} - Cookie value or null if not found
   */
  getCookie(name) {
    const nameEQ = name + "=";
    const ca = document.cookie.split(";");
    for (let i = 0; i < ca.length; i++) {
      let c = ca[i];
      while (c.charAt(0) === " ") c = c.substring(1, c.length);
      if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
    }
    return null;
  }

  /**
   * Manually show the popup (for testing or admin purposes)
   */
  forceShowPopup() {
    this.createAndShowPopup();
  }

  /**
   * Reset popup state (clear cookies)
   */
  resetPopupState() {
    document.cookie = `${this.cookieNames.lastShown}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
    document.cookie = `${this.cookieNames.lastVersion}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
  }

  /**
   * Update the current version (call this when deploying new versions)
   * @param {string} newVersion - The new version string
   */
  updateVersion(newVersion) {
    this.currentVersion = newVersion;
  }
}

// Auto-initialize when script loads
const talkomaticPopup = new TalkomaticPopupManager();

// Initialize on DOM ready
talkomaticPopup.init();

// Expose to global scope for manual control if needed
window.TalkomaticPopup = talkomaticPopup;
