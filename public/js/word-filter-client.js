// ============================================================================
// word-filter-client.js - Browser-side word filter with retry logic
// ============================================================================
// Mirrors server/word-filter.js but runs in the browser.
// Loads offensive_words.json and character_substitutions.json via fetch,
// with retry + exponential backoff to survive 429 rate limits.
// ============================================================================

class TrieNode {
  constructor() {
    this.children = {};
    this.isEndOfWord = false;
  }
}

class Trie {
  constructor() {
    this.root = new TrieNode();
  }
  insert(word) {
    let node = this.root;
    for (const char of word) {
      if (!node.children[char]) node.children[char] = new TrieNode();
      node = node.children[char];
    }
    node.isEndOfWord = true;
  }
}

class ClientWordFilter {
  constructor() {
    this.offensiveTrie = new Trie();
    this.whitelistTrie = new Trie();
    this.obfuscationMap = {};
    this.ready = false;
    this._cache = new Map();
    this._cacheMax = 500;
  }

  // ── Initialization ──────────────────────────────────────────────────────

  async init() {
    try {
      const [wordsData, subsData] = await Promise.all([
        this._fetchJSON("/js/offensive_words.json"),
        this._fetchJSON("/js/character_substitutions.json"),
      ]);

      if (
        !Array.isArray(wordsData.offensive_words) ||
        !Array.isArray(wordsData.whitelisted_words)
      ) {
        throw new Error("Invalid word list structure");
      }

      wordsData.offensive_words.forEach((w) =>
        this.offensiveTrie.insert(w.toLowerCase()),
      );
      wordsData.whitelisted_words.forEach((w) =>
        this.whitelistTrie.insert(w.toLowerCase()),
      );

      this.obfuscationMap = {
        ...this._buildBuiltInMappings(),
        ...subsData,
      };

      this.ready = true;
      console.log(
        `[WordFilter] Ready: ${wordsData.offensive_words.length} offensive, ` +
          `${wordsData.whitelisted_words.length} whitelisted, ` +
          `${Object.keys(this.obfuscationMap).length} char mappings`,
      );
    } catch (err) {
      console.error("[WordFilter] Init failed:", err.message);
      this.ready = false;
    }
  }

  /**
   * Fetch JSON with retry + exponential backoff (handles 429s).
   */
  async _fetchJSON(url, retries = 5, baseDelay = 800) {
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const resp = await fetch(url);
        if (resp.ok) return resp.json();
        if (resp.status === 429) {
          const delay = baseDelay * Math.pow(2, attempt);
          console.warn(`[WordFilter] 429 on ${url}, retry in ${delay}ms`);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw new Error(`HTTP ${resp.status} for ${url}`);
      } catch (err) {
        if (attempt === retries - 1) throw err;
        const delay = baseDelay * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw new Error(`Failed to fetch ${url} after ${retries} retries`);
  }

  // ── Public API ──────────────────────────────────────────────────────────

  checkText(text) {
    if (!this.ready || !text || typeof text !== "string") {
      return { hasOffensiveWord: false, offensiveRanges: [] };
    }
    if (this._cache.has(text)) return this._cache.get(text);

    const result = { hasOffensiveWord: false, offensiveRanges: [] };
    const lines = text.split(/\r?\n/);
    let offset = 0;

    for (const line of lines) {
      const norm = this._normalize(line);
      if (norm.length > 0) {
        let i = 0;
        while (i < norm.length) {
          let maxOff = 0,
            maxWl = 0;

          let node = this.offensiveTrie.root,
            j = i;
          while (j < norm.length && node.children[norm[j]]) {
            node = node.children[norm[j++]];
            if (node.isEndOfWord) maxOff = j - i;
          }

          node = this.whitelistTrie.root;
          j = i;
          while (j < norm.length && node.children[norm[j]]) {
            node = node.children[norm[j++]];
            if (node.isEndOfWord) maxWl = j - i;
          }

          if (
            maxOff > 0 &&
            maxOff >= maxWl &&
            this._validMatch(norm, i, i + maxOff)
          ) {
            result.hasOffensiveWord = true;
            const s = this._origIndex(line, i) + offset;
            const e = this._origIndex(line, i + maxOff) + offset;
            result.offensiveRanges.push([s, e]);
            i += maxOff;
          } else {
            i++;
          }
        }
      }
      offset += line.length + 1;
    }

    this._cache.set(text, result);
    if (this._cache.size > this._cacheMax) {
      this._cache.delete(this._cache.keys().next().value);
    }
    return result;
  }

  filterText(text) {
    const { offensiveRanges } = this.checkText(text);
    if (offensiveRanges.length === 0) return text;
    let out = "",
      last = 0;
    for (const [s, e] of offensiveRanges) {
      out += text.slice(last, s) + "*".repeat(Math.max(1, e - s));
      last = e;
    }
    return out + text.slice(last);
  }

  // ── Normalization ───────────────────────────────────────────────────────

  _normalize(text) {
    if (!text) return "";
    let r = "";
    for (const char of text) {
      let lc = char
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
      let mapped = this.obfuscationMap[char] || this.obfuscationMap[lc] || lc;
      if (/[a-z0-9]/.test(mapped)) r += mapped;
    }
    return r.replace(/(.)\1{2,}/g, "$1$1");
  }

  _validMatch(norm, start, end) {
    const len = end - start;
    if (len <= 2) return false;
    if (len <= 4) {
      const before = start > 0 ? norm[start - 1] : "";
      const after = end < norm.length ? norm[end] : "";
      if (/[a-z0-9]/.test(before) && /[a-z0-9]/.test(after)) return false;
    }
    return true;
  }

  _origIndex(original, normIdx) {
    const map = [];
    for (let i = 0; i < original.length; i++) {
      let c = original[i];
      let lc = c
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
      let mapped = this.obfuscationMap[c] || this.obfuscationMap[lc] || lc;
      if (/[a-z0-9]/.test(mapped)) map.push(i);
    }
    if (normIdx >= map.length) return original.length;
    return normIdx < 0 ? 0 : map[normIdx];
  }

  // ── Built-in Unicode mappings ───────────────────────────────────────────

  _buildBuiltInMappings() {
    const m = {};

    // Fullwidth A-Z, a-z, 0-9
    for (let i = 0; i < 26; i++) {
      m[String.fromCharCode(0xff21 + i)] = String.fromCharCode(97 + i);
      m[String.fromCharCode(0xff41 + i)] = String.fromCharCode(97 + i);
    }
    for (let i = 0; i < 10; i++) {
      m[String.fromCharCode(0xff10 + i)] = String.fromCharCode(48 + i);
    }

    // Mathematical alphanumeric symbol ranges
    [
      0x1d400, 0x1d434, 0x1d468, 0x1d49c, 0x1d4d0, 0x1d504, 0x1d538, 0x1d56c,
      0x1d5a0, 0x1d5d4, 0x1d608, 0x1d63c, 0x1d670,
    ].forEach((base) => {
      for (let i = 0; i < 26; i++) {
        try {
          m[String.fromCodePoint(base + i)] = String.fromCharCode(97 + i);
        } catch (_) {}
        try {
          m[String.fromCodePoint(base + 26 + i)] = String.fromCharCode(97 + i);
        } catch (_) {}
      }
    });

    // Leetspeak & symbols
    Object.assign(m, {
      0: "o",
      1: "i",
      3: "e",
      4: "a",
      5: "s",
      6: "g",
      7: "t",
      8: "b",
      9: "g",
      "@": "a",
      $: "s",
      "!": "i",
      "|": "i",
      "+": "t",
      "&": "a",
    });

    // Cyrillic confusables
    Object.assign(m, {
      "\u0430": "a",
      "\u0435": "e",
      "\u043e": "o",
      "\u0440": "p",
      "\u0441": "c",
      "\u0443": "y",
      "\u0445": "x",
      "\u0455": "s",
      "\u0456": "i",
      "\u0458": "j",
      "\u0410": "a",
      "\u0412": "b",
      "\u0415": "e",
      "\u041a": "k",
      "\u041c": "m",
      "\u041d": "h",
      "\u041e": "o",
      "\u0420": "p",
      "\u0421": "c",
      "\u0422": "t",
      "\u0423": "y",
      "\u0425": "x",
      "\u0405": "s",
      "\u0406": "i",
      "\u0408": "j",
    });

    // Greek confusables
    Object.assign(m, {
      "\u03b1": "a",
      "\u03b2": "b",
      "\u03b5": "e",
      "\u03b9": "i",
      "\u03ba": "k",
      "\u03bf": "o",
      "\u03c1": "p",
      "\u03c3": "s",
      "\u03c4": "t",
      "\u03c5": "y",
      "\u03c7": "x",
      "\u03c9": "w",
    });

    // Zero-width / invisible characters
    [
      "\u200B",
      "\u200C",
      "\u200D",
      "\u2060",
      "\uFEFF",
      "\u180E",
      "\u200E",
      "\u200F",
      "\u202A",
      "\u202B",
      "\u202C",
      "\u202D",
      "\u202E",
      "\u034F",
      "\u00AD",
    ].forEach((c) => (m[c] = ""));

    return m;
  }
}

window.ClientWordFilter = ClientWordFilter;
