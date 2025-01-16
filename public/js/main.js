/* main.js */
// MarkdownBook Main JavaScript (Enhanced Search Functionality with Modal)

/* Ensure that Prism.js and other dependencies are loaded before this script */

class MarkdownBook {
  constructor(config) {
    this.config = config;
    this.currentPage = null;
    this.pages = new Map(); // Cache for loaded pages
    // this.searchIndex = []; // Array to hold searchable content
    // this.fuse = null; // Fuse.js instance
    this.init();
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

  init() {
    console.log('[MarkdownBook] Initializing...');
    this.initializeBranding();
    this.initializeTheme();
    this.initializeMobileMenu();
    this.loadTableOfContents();

    window.addEventListener('hashchange', () => this.handleHashChange());
    this.handleHashChange();

    // if (this.config.search.enabled) {
    //   this.initializeSearch();
    // }
    // Search functionality is in development. The search initialization is currently commented out and will be enabled once the feature is ready.
  }

  handleHashChange() {
    const hash = window.location.hash.slice(1) || 'welcome';
    const pagePath = `${hash}.md`;
    this.loadPage(pagePath);
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

    const savedTheme = localStorage.getItem('theme') || this.config.theme.default;
    if (savedTheme === 'dark') {
      document.documentElement.classList.add('dark-theme'); // Changed from body to html
      themeIcon.className = 'fa-solid fa-moon';
    }

    themeToggle.addEventListener('click', () => {
      document.documentElement.classList.toggle('dark-theme'); // Changed from body to html
      const isDark = document.documentElement.classList.contains('dark-theme');
      themeIcon.className = isDark ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
      localStorage.setItem('theme', isDark ? 'dark' : 'light');

      // Update modal theme if active
      const searchModalContent = document.querySelector('.search-modal-content');
      if (searchModalContent) {
        if (isDark) {
          searchModalContent.classList.add('dark-theme');
        } else {
          searchModalContent.classList.remove('dark-theme');
        }
      }
    });
  }

  // initializeSearch() {
  //   // Fetch all pages and build the search index
  //   this.fetchAllPages().then(() => {
  //     // Initialize Fuse.js after fetching pages
  //     this.fuse = new Fuse(this.searchIndex, {
  //       keys: ['title', 'content'], // Specify fields to search in
  //       threshold: 0.4, // Adjust sensitivity (0 = exact match, 1 = loose match)
  //       includeScore: true, // Include score for sorting
  //       minMatchCharLength: 2,
  //     });

  //     this.setupSearchModal();
  //   }).catch(error => {
  //     console.error('Error initializing search:', error);
  //   });
  // }
  // 
  // // Search functionality is in development. The initializeSearch method is currently commented out and will be enabled once the feature is ready.

  // async fetchAllPages() {
  //   // Assuming tocPath contains the list of pages
  //   try {
  //     const response = await fetch(this.config.content.tocPath);
  //     const tocMarkdown = await response.text();
  //     const tocData = this.parseTocMarkdown(tocMarkdown);

  //     // Extract all page paths
  //     const pagePaths = [];
  //     tocData.forEach(item => {
  //       if (item.items && Array.isArray(item.items)) {
  //         item.items.forEach(subItem => {
  //           pagePaths.push(subItem.path);
  //         });
  //       } else if (item.path) {
  //         pagePaths.push(item.path);
  //       }
  //     });

  //     // Fetch content for each page
  //     const fetchPromises = pagePaths.map(async (path) => {
  //       const response = await fetch(`${this.config.content.basePath}/${path}`);
  //       const markdown = await response.text();
  //       const htmlContent = marked.parse(markdown);
  //       const plainText = this.stripHtml(htmlContent);
  //       const title = this.extractTitle(markdown) || path.replace('.md', '');

  //       this.searchIndex.push({
  //         title: title,
  //         path: path,
  //         content: plainText,
  //       });
  //     });

  //     await Promise.all(fetchPromises);
  //     console.log('[Search] All pages fetched and indexed.');
  //   } catch (error) {
  //     console.error('Error fetching pages for search:', error);
  //   }
  // }
  // 
  // // Search functionality is in development. The fetchAllPages method is currently commented out and will be enabled once the feature is ready.

  stripHtml(html) {
    // Create a temporary element to strip HTML tags
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    return tempDiv.textContent || tempDiv.innerText || '';
  }

  extractTitle(markdown) {
    // Extract the first heading as the title
    const lines = markdown.split('\n');
    for (let line of lines) {
      if (line.startsWith('# ')) {
        return line.replace('# ', '').trim();
      }
    }
    return null;
  }

  // setupSearchModal() {
  //   const searchModal = document.getElementById('search-modal');
  //   const openSearchModalButtons = [
  //     document.getElementById('open-search-modal'),
  //     document.getElementById('trigger-search-modal'),
  //     document.getElementById('open-search-modal-mobile'),
  //     document.getElementById('trigger-search-modal-mobile'),
  //   ];
  //   const closeSearchModalButton = searchModal.querySelector('.search-modal-close');
  //   const modalSearchInput = document.getElementById('modal-search-input');
  //   const modalSearchResults = document.getElementById('modal-search-results');
  //   const contentWrapper = document.getElementById('content-wrapper');

  //   // Function to open the search modal
  //   const openModal = () => {
  //     searchModal.classList.add('active');
  //     document.body.classList.add('no-scroll');
  //     contentWrapper.classList.add('blurred');
  //     modalSearchInput.focus();
  //   };

  //   // Function to close the search modal
  //   const closeModal = () => {
  //     searchModal.classList.remove('active');
  //     document.body.classList.remove('no-scroll');
  //     contentWrapper.classList.remove('blurred');
  //     modalSearchInput.value = '';
  //     modalSearchResults.innerHTML = '';
  //   };

  //   // Attach event listeners to open modal buttons
  //   openSearchModalButtons.forEach(button => {
  //     if (button) {
  //       button.addEventListener('click', (e) => {
  //         e.preventDefault();
  //         openModal();
  //       });
  //     }
  //   });

  //   // Attach event listener to close modal button
  //   closeSearchModalButton.addEventListener('click', (e) => {
  //     e.preventDefault();
  //     closeModal();
  //   });

  //   // Close modal when clicking outside the modal content
  //   searchModal.addEventListener('click', (e) => {
  //     if (e.target === searchModal) {
  //       closeModal();
  //     }
  //   });

  //   // Handle Esc key to close modal
  //   document.addEventListener('keydown', (e) => {
  //     if (e.key === 'Escape' && searchModal.classList.contains('active')) {
  //       closeModal();
  //     }
  //   });

  //   // Handle search input
  //   modalSearchInput.addEventListener('input', (e) => {
  //     const query = e.target.value.trim();
  //     if (query.length < 2) {
  //       modalSearchResults.innerHTML = '<p>Type at least 2 characters to search.</p>';
  //       return;
  //     }

  //     const results = this.fuse.search(query, { limit: 10 });
  //     this.displayModalSearchResults(results, modalSearchResults, closeModal);
  //   });
  // }
  // 
  // // Search functionality is in development. The setupSearchModal method is currently commented out and will be enabled once the feature is ready.

  // displayModalSearchResults(results, container, closeModal) {
  //   container.innerHTML = ''; // Clear previous results

  //   if (results.length === 0) {
  //     container.innerHTML = '<p>No results found.</p>';
  //     return;
  //   }

  //   results.forEach(result => {
  //     const item = result.item;
  //     const div = document.createElement('div');
  //     div.classList.add('search-result-item');

  //     // Title
  //     const title = document.createElement('h4');
  //     title.textContent = item.title;
  //     div.appendChild(title);

  //     // Snippet (optional: you can implement snippet extraction)
  //     // For simplicity, we'll skip snippets here

  //     // Click event to navigate
  //     div.addEventListener('click', () => {
  //       const targetPath = item.path.replace('.md', '');
  //       window.location.hash = `#${targetPath}`;
  //       closeModal();
  //     });

  //     container.appendChild(div);
  //   });
  // }
  // 
  // // Search functionality is in development. The displayModalSearchResults method is currently commented out and will be enabled once the feature is ready.

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

    lines.forEach(line => {
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
          icon: iconInfo
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
          icon: iconInfo || { type: 'fa', value: 'fa-solid fa-hashtag' }
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

    tocData.forEach(item => {
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

        item.items.forEach(subItem => {
          this.createTocItem(subItem, ul);
        });
      } else {
        this.createTocItem(item, ul);
      }
    });

    toc.appendChild(ul);
  }

  generatePageToc() {
    const pageToc = document.getElementById('page-toc');
    const headers = document.querySelectorAll('#markdown-content h2');

    if (!headers.length) {
      pageToc.innerHTML = '<p class="no-headers">No sections found</p>';
      return;
    }

    const ul = document.createElement('ul');
    headers.forEach(header => {
      const headerId = header.id;
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

          document.querySelectorAll('.page-table-of-contents a').forEach(link =>
            link.classList.remove('active')
          );
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
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const id = entry.target.id;
          const currentPageBase = this.currentPage.replace('.md', '');
          document.querySelectorAll('.page-table-of-contents a').forEach(link => {
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
      threshold: [0, 0.5, 1]
    });
    headers.forEach(header => observer.observe(header));
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

  async loadPage(path) {
    try {
      if (!this.pages.has(path)) {
        const response = await fetch(`${this.config.content.basePath}/${path}`);
        const markdown = await response.text();
        this.pages.set(path, markdown);
      }

      const content = this.pages.get(path);
      const htmlContent = marked.parse(content);

      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = htmlContent;

      // Convert .md links
      tempDiv.querySelectorAll('a').forEach(link => {
        if (link.href.endsWith('.md')) {
          const pageName = link.href.split('/').pop().replace('.md', '');
          link.href = `#${pageName}`;
        }
      });

      // Ensure a language is set for code blocks
      tempDiv.querySelectorAll('pre code').forEach(block => {
        const hasLang = Array.from(block.classList).some(c => c.startsWith('language-'));
        if (!hasLang) {
          block.classList.add('language-plaintext');
        }
      });

      document.getElementById('markdown-content').innerHTML = tempDiv.innerHTML;
      this.currentPage = path;

      // Prism highlight
      Prism.highlightAllUnder(document.getElementById('markdown-content'));

      // Build page TOC
      const headers = document.querySelectorAll('#markdown-content h2');
      headers.forEach((header) => {
        const headerId = header.textContent
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '');
        header.id = headerId;
      });
      this.generatePageToc();

      // Update left TOC
      document.querySelectorAll('.table-of-contents a').forEach(link => link.classList.remove('active'));
      const activeLink = document.querySelector(`.table-of-contents a[data-path="${path}"]`);
      if (activeLink) {
        activeLink.classList.add('active');

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

  // handleSearch(searchTerm) {
  //   if (!searchTerm) return;
  //   const searchText = searchTerm.toLowerCase();

  //   this.pages.forEach(async (content, path) => {
  //     if (content.toLowerCase().includes(searchText)) {
  //       console.log(`Found match for "${searchTerm}" in ${path}`);
  //     }
  //   });
  // }
  // 
  // // Search functionality is in development. The handleSearch method is currently commented out and will be enabled once the feature is ready.
}

document.addEventListener('DOMContentLoaded', () => {
  console.log('[DOMContentLoaded] Initializing MarkdownBook');
  new MarkdownBook(MarkdownBookConfig);
});
