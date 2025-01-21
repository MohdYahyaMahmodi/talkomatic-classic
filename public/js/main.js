/* main.js */
// MarkdownBook Main JavaScript (Combined Version: Custom Blockquotes + Correct Page TOC)

/* Ensure that Prism.js, Marked, and other dependencies are loaded before this script */

class MarkdownBook {
  constructor(config) {
    this.config = config;
    this.currentPage = null;
    this.pages = new Map(); // Cache for loaded pages
    this.init();
  }

  init() {
    console.log('[MarkdownBook] Initializing...');
    this.initializeBranding();
    this.initializeTheme();
    this.initializeMobileMenu();
    this.loadTableOfContents();

    // Handle #hash changes (including sub-hash for heading links)
    window.addEventListener('hashchange', () => this.handleHashChange());
    this.handleHashChange();
  }

  handleHashChange() {
    // If the URL is #page#heading, the first part is the page name
    const fullHash = window.location.hash.slice(1);
    if (!fullHash) {
      // Default to "welcome.md" if no hash
      this.loadPage(`${this.config.content.defaultPage || 'welcome.md'}`);
      return;
    }

    // Split on the first "#" to separate page vs. heading
    const parts = fullHash.split('#');
    const pageName = parts[0] || 'welcome';
    const pagePath = `${pageName}.md`;

    this.loadPage(pagePath).then(() => {
      // If there's a second part in the hash, it's the heading ID
      if (parts[1]) {
        const headingId = parts[1];
        const target = document.getElementById(headingId);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    });
  }

  initializeMobileMenu() {
    const menuToggle = document.querySelector('.mobile-menu-toggle');
    const sidebar = document.querySelector('.sidebar');

    if (menuToggle && sidebar) {
      menuToggle.addEventListener('click', () => {
        sidebar.classList.toggle('active');
        const body = document.body;
        const isOpen = sidebar.classList.contains('active');

        if (isOpen) {
          body.classList.add('no-scroll');
          menuToggle.querySelector('i').className = 'fa-solid fa-xmark';
        } else {
          body.classList.remove('no-scroll');
          menuToggle.querySelector('i').className = 'fa-solid fa-bars';
        }
      });

      // Close sidebar if user clicks outside
      document.addEventListener('click', (e) => {
        if (
          sidebar.classList.contains('active') &&
          !sidebar.contains(e.target) &&
          !menuToggle.contains(e.target)
        ) {
          sidebar.classList.remove('active');
          menuToggle.querySelector('i').className = 'fa-solid fa-bars';
          document.body.classList.remove('no-scroll');
        }
      });
    }
  }

  initializeBranding() {
    const logoElement = document.getElementById('brand-logo');
    logoElement.src = this.config.logo.path;
    logoElement.alt = this.config.logo.altText;

    document.getElementById('brand-title').textContent = this.config.title.navbar;
    document.title = this.config.title.website;

    if (this.config.logo.useFavicon) {
      const favicon = document.getElementById('favicon');
      favicon.href = this.config.logo.path;
    }
  }

  initializeTheme() {
    const themeToggle = document.querySelector('.theme-toggle');
    const themeIcon = themeToggle.querySelector('i');

    // Load saved theme or use default
    const savedTheme = localStorage.getItem('theme') || this.config.theme.default;
    if (savedTheme === 'dark') {
      document.documentElement.classList.add('dark-theme');
      themeIcon.className = 'fa-solid fa-moon';
    }

    themeToggle.addEventListener('click', () => {
      document.documentElement.classList.toggle('dark-theme');
      const isDark = document.documentElement.classList.contains('dark-theme');
      themeIcon.className = isDark ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
      localStorage.setItem('theme', isDark ? 'dark' : 'light');

      // If there's a search modal or other modal, you could also toggle its theme here
    });
  }

  // Utility to strip HTML tags
  stripHtml(html) {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    return tempDiv.textContent || tempDiv.innerText || '';
  }

  // Utility to extract the first heading as a potential title
  extractTitle(markdown) {
    const lines = markdown.split('\n');
    for (let line of lines) {
      if (line.startsWith('# ')) {
        return line.replace('# ', '').trim();
      }
    }
    return null;
  }

  async loadTableOfContents() {
    try {
      const response = await fetch(this.config.content.tocPath);
      const tocMarkdown = await response.text();
      const tocData = this.parseTocMarkdown(tocMarkdown);
      this.generateTableOfContents(tocData);

      if (this.config.content.defaultPage) {
        this.loadPage(this.config.content.defaultPage);
      }
    } catch (error) {
      console.error('Error loading table of contents:', error);
    }
  }

  parseTocMarkdown(markdown) {
    const lines = markdown.split('\n');
    const tocData = [];
    let currentSection = null;

    const parseIcon = (text) => {
      const iconMatch = text.match(/\[icon:(fa|img|gif):([^\]]+)\]/);
      if (iconMatch) {
        const [fullMatch, type, value] = iconMatch;
        return { type, value, original: fullMatch };
      }
      return null;
    };

    lines.forEach((line) => {
      if (line.startsWith('**')) {
        // Section header
        const iconInfo = parseIcon(line);
        const title = line
          .replace(/\*\*/g, '')
          .replace(/\[icon:[^\]]+\]/, '')
          .trim();
        currentSection = {
          title,
          items: [],
          icon: iconInfo,
        };
        tocData.push(currentSection);
      } else if (line.startsWith('# ')) {
        // Page link
        const iconInfo = parseIcon(line);
        const title = line
          .replace('# ', '')
          .replace(/\[icon:[^\]]+\]/, '')
          .trim();
        const id = title.toLowerCase().replace(/\s+/g, '-');
        const item = {
          title,
          id,
          path: `${id}.md`,
          icon: iconInfo || { type: 'fa', value: 'fa-solid fa-hashtag' },
        };

        if (currentSection) {
          currentSection.items.push(item);
        } else {
          tocData.push(item);
        }
      }
    });

    return tocData;
  }

  createIcon(iconInfo) {
    if (!iconInfo) return null;
    const container = document.createElement('span');
    container.className = 'icon-container';

    switch (iconInfo.type) {
      case 'fa': {
        const icon = document.createElement('i');
        icon.className = iconInfo.value;
        container.appendChild(icon);
        return container;
      }
      case 'img':
      case 'gif': {
        const img = document.createElement('img');
        img.src = iconInfo.value;
        img.alt = 'icon';
        container.appendChild(img);
        return container;
      }
      default:
        return null;
    }
  }

  generateTableOfContents(tocData) {
    const toc = document.getElementById('toc');
    const ul = document.createElement('ul');

    tocData.forEach((item) => {
      if (item.items) {
        // Section header
        const sectionHeader = document.createElement('li');
        sectionHeader.className = 'toc-section';

        if (item.icon) {
          const iconEl = this.createIcon(item.icon);
          if (iconEl) sectionHeader.appendChild(iconEl);
        }
        sectionHeader.appendChild(document.createTextNode(item.title));
        ul.appendChild(sectionHeader);

        item.items.forEach((subItem) => {
          this.createTocItem(subItem, ul);
        });
      } else {
        this.createTocItem(item, ul);
      }
    });

    toc.appendChild(ul);
  }

  createTocItem(item, parent) {
    const li = document.createElement('li');
    const a = document.createElement('a');

    if (item.icon) {
      const iconEl = this.createIcon(item.icon);
      if (iconEl) a.appendChild(iconEl);
    }

    a.href = `#${item.id}`;
    a.appendChild(document.createTextNode(item.title));
    a.dataset.path = item.path;

    a.addEventListener('click', (e) => {
      e.preventDefault();
      this.loadPage(item.path);
    });

    li.appendChild(a);
    parent.appendChild(li);
  }

  generatePageToc() {
    const pageToc = document.getElementById('page-toc');
    const headers = document.querySelectorAll('#markdown-content h2');

    if (!headers.length) {
      pageToc.innerHTML = '<p class="no-headers">No sections found</p>';
      return;
    }

    const ul = document.createElement('ul');
    headers.forEach((header) => {
      const headerId = header.id; // we assigned this in loadPage()
      const text = header.textContent;
      const li = document.createElement('li');
      const a = document.createElement('a');
      const baseName = this.currentPage.replace('.md', '');

      a.href = `#${baseName}#${headerId}`;
      a.textContent = text;

      a.addEventListener('click', (e) => {
        e.preventDefault();
        const target = document.getElementById(headerId);
        if (target) {
          history.pushState(null, '', `#${baseName}#${headerId}`);
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });

          document
            .querySelectorAll('.page-table-of-contents a')
            .forEach((link) => link.classList.remove('active'));
          a.classList.add('active');
        }
      });

      li.appendChild(a);
      ul.appendChild(li);
    });

    pageToc.innerHTML = '';
    pageToc.appendChild(ul);

    // Scroll spy
    const observerCallback = (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const id = entry.target.id;
          const currentPageBase = this.currentPage.replace('.md', '');
          document.querySelectorAll('.page-table-of-contents a').forEach((link) => {
            const isActive = link.getAttribute('href') === `#${currentPageBase}#${id}`;
            link.classList.toggle('active', isActive);
            if (isActive && entry.intersectionRatio > 0.5) {
              history.replaceState(null, '', `#${currentPageBase}#${id}`);
            }
          });
        }
      });
    };

    const observer = new IntersectionObserver(observerCallback, {
      rootMargin: '-20% 0px -80% 0px',
      threshold: [0, 0.5, 1],
    });
    headers.forEach((header) => observer.observe(header));
  }

  // Helper to convert raw blockquote content (string/array/object) into a plain string
  ensureString(input) {
    if (typeof input === 'string') return input;
    if (Array.isArray(input)) {
      return input.map((item) => this.ensureString(item)).join('');
    }
    if (input && typeof input === 'object' && 'text' in input) {
      return this.ensureString(input.text);
    }
    return String(input);
  }

  async loadPage(path) {
    try {
      if (!this.pages.has(path)) {
        const response = await fetch(`${this.config.content.basePath}/${path}`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const markdown = await response.text();
        this.pages.set(path, markdown);
      }

      const content = this.pages.get(path);

      // Configure marked to handle custom blockquote styles (Note, Warning, Tip, etc.)
      const renderer = new marked.Renderer();
      renderer.blockquote = (rawQuote) => {
        let quoteText = this.ensureString(rawQuote);
        let type = 'default';

        const detectAndRemovePrefix = (pattern, newType) => {
          if (pattern.test(quoteText)) {
            type = newType;
            quoteText = quoteText.replace(pattern, '');
          }
        };

        detectAndRemovePrefix(/\*\*Note:\*\*/i, 'note');
        detectAndRemovePrefix(/<strong>Note:<\/strong>/i, 'note');

        detectAndRemovePrefix(/\*\*Warning:\*\*/i, 'warning');
        detectAndRemovePrefix(/<strong>Warning:<\/strong>/i, 'warning');

        detectAndRemovePrefix(/\*\*Info:\*\*/i, 'info');
        detectAndRemovePrefix(/<strong>Info:<\/strong>/i, 'info');

        detectAndRemovePrefix(/\*\*Tip:\*\*/i, 'tip');
        detectAndRemovePrefix(/<strong>Tip:<\/strong>/i, 'tip');

        return `<blockquote class="${type}">${quoteText.trim()}</blockquote>`;
      };

      marked.setOptions({
        renderer,
        headerIds: false, // We'll assign IDs ourselves
        mangle: false,
        gfm: true,
        breaks: true,
        silent: true,
      });

      const htmlContent = marked.parse(content);

      // Temporary container to adjust links/code blocks/headings
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = htmlContent;

      // Convert .md links to #hash links
      tempDiv.querySelectorAll('a').forEach((link) => {
        if (link.href.endsWith('.md')) {
          const pageName = link.href.split('/').pop().replace('.md', '');
          link.href = `#${pageName}`;
        }
      });

      // Ensure code blocks have a language for Prism
      tempDiv.querySelectorAll('pre code').forEach((block) => {
        const hasLang = Array.from(block.classList).some((c) => c.startsWith('language-'));
        if (!hasLang) {
          block.classList.add('language-plaintext');
        }
      });

      // Assign IDs to headings (h1...h6) from text
      tempDiv.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((header) => {
        const headerId = header.textContent
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '');
        header.id = headerId;
      });

      document.getElementById('markdown-content').innerHTML = tempDiv.innerHTML;
      this.currentPage = path;

      // Highlight code with Prism
      Prism.highlightAllUnder(document.getElementById('markdown-content'));

      // Build the right-hand page-level TOC
      this.generatePageToc();

      // Update the left-hand TOC (active link)
      document.querySelectorAll('.table-of-contents a').forEach((link) => link.classList.remove('active'));
      const activeLink = document.querySelector(`.table-of-contents a[data-path="${path}"]`);
      if (activeLink) {
        activeLink.classList.add('active');

        // If there's no second # in the hash, update the hash to match this page
        const hashParts = window.location.hash.split('#');
        if (hashParts.length <= 2) {
          const newHash = path.replace('.md', '');
          if (window.location.hash !== `#${newHash}`) {
            history.pushState(null, '', `#${newHash}`);
          }
        }
      }
    } catch (error) {
      console.error('Error loading page:', error);
      document.getElementById('markdown-content').innerHTML = '<p>Error loading content.</p>';
    }
  }
}

// Initialize MarkdownBook on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
  console.log('[DOMContentLoaded] Initializing MarkdownBook');
  new MarkdownBook(MarkdownBookConfig);
});
