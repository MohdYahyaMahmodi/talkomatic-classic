// MarkdownBook Configuration
const MarkdownBookConfig = {
  // Branding
  logo: {
    path: 'images/icons/favicon.png',
    altText: 'Documentation Logo',
    useFavicon: true
  },
  title: {
    website: 'Talkomatic - Documentation', // Title that appears in browser tab
    navbar: 'Talkomatic Classic Docs' // Title that appears in the navbar
  },
  
  /*
  // Search
  search: {
    placeholder: 'Search docs...',
    enabled: true
  },
  // Search feature is in development. The search configuration is currently commented out and will be enabled once the feature is ready.
  */

  // Theme Settings
  theme: {
    default: 'light',
    toggleEnabled: true
  },

  // Content Settings
  content: {
    basePath: 'book',
    tocPath: 'book/toc.md',
    defaultPage: 'welcome-to-talkomatic.md'
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = MarkdownBookConfig;
}
