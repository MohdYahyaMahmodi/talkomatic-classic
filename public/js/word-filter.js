const fs = require("fs");

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
    for (let char of word) {
      if (!node.children[char]) {
        node.children[char] = new TrieNode();
      }
      node = node.children[char];
    }
    node.isEndOfWord = true;
  }

  search(word) {
    let node = this.root;
    for (let char of word) {
      if (!node.children[char]) {
        return false;
      }
      node = node.children[char];
    }
    return node.isEndOfWord;
  }
}

class WordFilter {
  constructor(wordsFilePath, substitutionsFilePath) {
    try {
      // Load offensive and whitelisted words
      const data = JSON.parse(fs.readFileSync(wordsFilePath, "utf8"));
      if (
        !Array.isArray(data.offensive_words) ||
        !Array.isArray(data.whitelisted_words)
      ) {
        throw new Error(
          "Invalid JSON structure: offensive_words and whitelisted_words must be arrays"
        );
      }

      this.offensiveTrie = new Trie();
      data.offensive_words.forEach((word) =>
        this.offensiveTrie.insert(word.toLowerCase())
      );

      this.whitelistTrie = new Trie();
      data.whitelisted_words.forEach((word) =>
        this.whitelistTrie.insert(word.toLowerCase())
      );

      console.log(
        `Loaded ${data.offensive_words.length} offensive words and ${data.whitelisted_words.length} whitelisted words`
      );

      // Initialize cache
      this.cache = new Map();
      this.cacheSize = 1000;
      this.cacheHits = 0;
      this.cacheMisses = 0;

      // Build comprehensive obfuscation mapping
      this.obfuscationMap = this.buildComprehensiveObfuscationMap(
        substitutionsFilePath
      );

      console.log(
        `WordFilter initialized successfully with ${
          Object.keys(this.obfuscationMap).length
        } character mappings`
      );
    } catch (error) {
      console.error("Error initializing WordFilter:", error);
      throw error;
    }
  }

  /**
   * Builds a comprehensive obfuscation map by combining the existing substitutions file
   * with additional Unicode mappings for bypass prevention
   */
  buildComprehensiveObfuscationMap(substitutionsFilePath) {
    let mappings = {};

    // First, load existing substitutions from file
    try {
      const fileSubstitutions = JSON.parse(
        fs.readFileSync(substitutionsFilePath, "utf8")
      );
      mappings = { ...fileSubstitutions };
      console.log(
        `Loaded ${
          Object.keys(fileSubstitutions).length
        } substitutions from file`
      );
    } catch (error) {
      console.warn(
        "Could not load substitutions file, using built-in mappings only:",
        error.message
      );
    }

    // Add comprehensive built-in mappings as fallbacks
    const builtInMappings = this.createBuiltInUnicodeMappings();

    // Merge mappings (file mappings take precedence over built-in ones)
    const combinedMappings = { ...builtInMappings, ...mappings };

    console.log(
      `Total character mappings: ${Object.keys(combinedMappings).length}`
    );
    return combinedMappings;
  }

  /**
   * Creates comprehensive built-in Unicode mappings as fallbacks
   */
  createBuiltInUnicodeMappings() {
    const mappings = {};

    // Mathematical Alphanumeric Symbols - comprehensive coverage
    this.addMathematicalAlphanumericMappings(mappings);

    // Cyrillic characters that look like Latin
    this.addCyrillicMappings(mappings);

    // Greek characters that look like Latin
    this.addGreekMappings(mappings);

    // Fullwidth characters (Ａ-Ｚ, ａ-ｚ, ０-９)
    this.addFullwidthMappings(mappings);

    // Common leetspeak and symbol substitutions
    this.addCommonSubstitutions(mappings);

    // Additional Unicode confusables
    this.addUnicodeConfusables(mappings);

    // Superscript and subscript characters
    this.addSuperSubscriptMappings(mappings);

    // Zero-width and invisible characters
    this.addInvisibleCharacterMappings(mappings);

    return mappings;
  }

  /**
   * Adds mathematical alphanumeric symbol mappings (𝐀-𝚥)
   */
  addMathematicalAlphanumericMappings(mappings) {
    // Define Unicode ranges for mathematical alphanumeric symbols
    const ranges = [
      { start: 0x1d400, end: 0x1d433, name: "Mathematical Bold" }, // 𝐀-𝐳
      { start: 0x1d434, end: 0x1d467, name: "Mathematical Italic" }, // 𝐴-𝑧
      { start: 0x1d468, end: 0x1d49b, name: "Mathematical Bold Italic" }, // 𝑨-𝒛
      { start: 0x1d49c, end: 0x1d4cf, name: "Mathematical Script" }, // 𝒜-𝓏
      { start: 0x1d4d0, end: 0x1d503, name: "Mathematical Bold Script" }, // 𝓐-𝔃
      { start: 0x1d504, end: 0x1d537, name: "Mathematical Fraktur" }, // 𝔄-𝔷
      { start: 0x1d538, end: 0x1d56b, name: "Mathematical Double-Struck" }, // 𝔸-𝕫
      { start: 0x1d56c, end: 0x1d59f, name: "Mathematical Bold Fraktur" }, // 𝕬-𝖟
      { start: 0x1d5a0, end: 0x1d5d3, name: "Mathematical Sans-Serif" }, // 𝖠-𝗓
      { start: 0x1d5d4, end: 0x1d607, name: "Mathematical Bold Sans-Serif" }, // 𝗔-𝘇
      { start: 0x1d608, end: 0x1d63b, name: "Mathematical Italic Sans-Serif" }, // 𝘈-𝘻
      {
        start: 0x1d63c,
        end: 0x1d66f,
        name: "Mathematical Bold Italic Sans-Serif",
      }, // 𝘼-𝙯
      { start: 0x1d670, end: 0x1d6a3, name: "Mathematical Monospace" }, // 𝚀-𝚥
    ];

    ranges.forEach((range) => {
      // Handle uppercase letters A-Z (first 26 characters)
      for (let i = 0; i < 26; i++) {
        const codePoint = range.start + i;
        if (codePoint <= range.end) {
          const mathChar = String.fromCodePoint(codePoint);
          const normalChar = String.fromCharCode(65 + i).toLowerCase(); // A-Z -> a-z
          mappings[mathChar] = normalChar;
        }
      }

      // Handle lowercase letters a-z (next 26 characters)
      for (let i = 0; i < 26; i++) {
        const codePoint = range.start + 26 + i;
        if (codePoint <= range.end) {
          const mathChar = String.fromCodePoint(codePoint);
          const normalChar = String.fromCharCode(97 + i); // a-z
          mappings[mathChar] = normalChar;
        }
      }
    });

    // Mathematical digit ranges
    const numberRanges = [
      { start: 0x1d7ce, name: "Mathematical Bold Digits" }, // 𝟎-𝟗
      { start: 0x1d7d8, name: "Mathematical Double-Struck Digits" }, // 𝟘-𝟡
      { start: 0x1d7e2, name: "Mathematical Sans-Serif Digits" }, // 𝟢-𝟫
      { start: 0x1d7ec, name: "Mathematical Bold Sans-Serif Digits" }, // 𝟬-𝟵
      { start: 0x1d7f6, name: "Mathematical Monospace Digits" }, // 𝟶-𝟿
    ];

    numberRanges.forEach((range) => {
      for (let i = 0; i < 10; i++) {
        const mathChar = String.fromCodePoint(range.start + i);
        const normalChar = String.fromCharCode(48 + i); // 0-9
        mappings[mathChar] = normalChar;
      }
    });
  }

  /**
   * Adds Cyrillic character mappings that visually resemble Latin letters
   */
  addCyrillicMappings(mappings) {
    const cyrillicMappings = {
      // Lowercase Cyrillic that looks like Latin
      а: "a",
      е: "e",
      о: "o",
      р: "p",
      с: "c",
      у: "y",
      х: "x",
      ѕ: "s",
      і: "i",
      ј: "j",
      ӏ: "l",
      ԁ: "d",
      ԍ: "g",
      ԛ: "q",
      ѵ: "v",
      ԝ: "w",
      ҁ: "c",
      ԏ: "o",
      ռ: "n",
      ճ: "u",
      հ: "h",

      // Uppercase Cyrillic that looks like Latin
      А: "a",
      В: "b",
      Е: "e",
      К: "k",
      М: "m",
      Н: "h",
      О: "o",
      Р: "p",
      С: "c",
      Т: "t",
      У: "y",
      Х: "x",
      Ѕ: "s",
      І: "i",
      Ј: "j",
      Ӏ: "l",
      Ԁ: "d",
      Ԍ: "g",
      Ԛ: "q",
      Ѵ: "v",
      Ԝ: "w",
      Ҁ: "c",
      Ԏ: "o",
      Ռ: "n",
      Ճ: "u",
      Հ: "h",
    };

    Object.assign(mappings, cyrillicMappings);
  }

  /**
   * Adds Greek character mappings that visually resemble Latin letters
   */
  addGreekMappings(mappings) {
    const greekMappings = {
      // Lowercase Greek
      α: "a",
      β: "b",
      γ: "y",
      δ: "d",
      ε: "e",
      ζ: "z",
      η: "h",
      θ: "o",
      ι: "i",
      κ: "k",
      λ: "l",
      μ: "m",
      ν: "n",
      ξ: "x",
      ο: "o",
      π: "p",
      ρ: "p",
      σ: "s",
      τ: "t",
      υ: "y",
      φ: "f",
      χ: "x",
      ψ: "y",
      ω: "w",
      ς: "s",
      ϱ: "p",
      ϲ: "c",
      ϳ: "j",

      // Uppercase Greek
      Α: "a",
      Β: "b",
      Γ: "y",
      Δ: "d",
      Ε: "e",
      Ζ: "z",
      Η: "h",
      Θ: "o",
      Ι: "i",
      Κ: "k",
      Λ: "l",
      Μ: "m",
      Ν: "n",
      Ξ: "x",
      Ο: "o",
      Π: "p",
      Ρ: "p",
      Σ: "s",
      Τ: "t",
      Υ: "y",
      Φ: "f",
      Χ: "x",
      Ψ: "y",
      Ω: "w",
      Ϲ: "c",
      Ϳ: "j",
    };

    Object.assign(mappings, greekMappings);
  }

  /**
   * Adds fullwidth character mappings (commonly used in CJK text)
   */
  addFullwidthMappings(mappings) {
    // Fullwidth uppercase letters A-Z (U+FF21 to U+FF3A)
    for (let i = 0; i < 26; i++) {
      const fullwidthChar = String.fromCharCode(0xff21 + i); // Ａ-Ｚ
      const normalChar = String.fromCharCode(97 + i); // a-z
      mappings[fullwidthChar] = normalChar;
    }

    // Fullwidth lowercase letters a-z (U+FF41 to U+FF5A)
    for (let i = 0; i < 26; i++) {
      const fullwidthChar = String.fromCharCode(0xff41 + i); // ａ-ｚ
      const normalChar = String.fromCharCode(97 + i); // a-z
      mappings[fullwidthChar] = normalChar;
    }

    // Fullwidth digits 0-9 (U+FF10 to U+FF19)
    for (let i = 0; i < 10; i++) {
      const fullwidthChar = String.fromCharCode(0xff10 + i); // ０-９
      const normalChar = String.fromCharCode(48 + i); // 0-9
      mappings[fullwidthChar] = normalChar;
    }
  }

  /**
   * Adds common character substitutions used in leetspeak and obfuscation
   */
  addCommonSubstitutions(mappings) {
    const substitutions = {
      // Numbers that look like letters
      0: "o",
      1: "i",
      3: "e",
      4: "a",
      5: "s",
      6: "g",
      7: "t",
      8: "b",
      9: "g",

      // Symbols that look like letters
      "@": "a",
      $: "s",
      "!": "i",
      "|": "i",
      "+": "t",
      "&": "a",
      "§": "s",
      "¢": "c",
      "€": "e",
      "£": "l",
      "¥": "y",
      "₹": "r",
      "₽": "p",
      "₩": "w",

      // Mathematical symbols
      "∀": "a",
      "∃": "e",
      "∩": "n",
      "∪": "u",
      "∑": "s",
      "∏": "p",
      "∆": "d",
      "∇": "v",
      "∈": "e",
      "∋": "n",
      "∞": "o",
      "∫": "f",

      // Arrows and directional symbols
      "↑": "i",
      "↓": "i",
      "←": "l",
      "→": "r",
      "↔": "x",
      "⇑": "i",
      "⇓": "i",
      "⇐": "l",
      "⇒": "r",
      "⇔": "x",

      // Fractions
      "½": "12",
      "⅓": "13",
      "⅔": "23",
      "¼": "14",
      "¾": "34",
      "⅛": "18",
      "⅜": "38",
      "⅝": "58",
      "⅞": "78",

      // Roman numerals
      Ⅰ: "i",
      Ⅱ: "ii",
      Ⅲ: "iii",
      Ⅳ: "iv",
      Ⅴ: "v",
      Ⅵ: "vi",
      Ⅶ: "vii",
      Ⅷ: "viii",
      Ⅸ: "ix",
      Ⅹ: "x",
      ⅰ: "i",
      ⅱ: "ii",
      ⅲ: "iii",
      ⅳ: "iv",
      ⅴ: "v",
      ⅵ: "vi",
      ⅶ: "vii",
      ⅷ: "viii",
      ⅸ: "ix",
      ⅹ: "x",

      // Circled letters
      "Ⓐ": "a",
      "Ⓑ": "b",
      "Ⓒ": "c",
      "Ⓓ": "d",
      "Ⓔ": "e",
      "Ⓕ": "f",
      "Ⓖ": "g",
      "Ⓗ": "h",
      "Ⓘ": "i",
      "Ⓙ": "j",
      "Ⓚ": "k",
      "Ⓛ": "l",
      "Ⓜ": "m",
      "Ⓝ": "n",
      "Ⓞ": "o",
      "Ⓟ": "p",
      "Ⓠ": "q",
      "Ⓡ": "r",
      "Ⓢ": "s",
      "Ⓣ": "t",
      "Ⓤ": "u",
      "Ⓥ": "v",
      "Ⓦ": "w",
      "Ⓧ": "x",
      "Ⓨ": "y",
      "Ⓩ": "z",
      "ⓐ": "a",
      "ⓑ": "b",
      "ⓒ": "c",
      "ⓓ": "d",
      "ⓔ": "e",
      "ⓕ": "f",
      "ⓖ": "g",
      "ⓗ": "h",
      "ⓘ": "i",
      "ⓙ": "j",
      "ⓚ": "k",
      "ⓛ": "l",
      "ⓜ": "m",
      "ⓝ": "n",
      "ⓞ": "o",
      "ⓟ": "p",
      "ⓠ": "q",
      "ⓡ": "r",
      "ⓢ": "s",
      "ⓣ": "t",
      "ⓤ": "u",
      "ⓥ": "v",
      "ⓦ": "w",
      "ⓧ": "x",
      "ⓨ": "y",
      "ⓩ": "z",

      // Parenthesized letters
      "⒜": "a",
      "⒝": "b",
      "⒞": "c",
      "⒟": "d",
      "⒠": "e",
      "⒡": "f",
      "⒢": "g",
      "⒣": "h",
      "⒤": "i",
      "⒥": "j",
      "⒦": "k",
      "⒧": "l",
      "⒨": "m",
      "⒩": "n",
      "⒪": "o",
      "⒫": "p",
      "⒬": "q",
      "⒭": "r",
      "⒮": "s",
      "⒯": "t",
      "⒰": "u",
      "⒱": "v",
      "⒲": "w",
      "⒳": "x",
      "⒴": "y",
      "⒵": "z",
    };

    Object.assign(mappings, substitutions);
  }

  /**
   * Adds additional Unicode confusable characters
   */
  addUnicodeConfusables(mappings) {
    const confusables = {
      // Double-struck letters
      ℂ: "c",
      ℍ: "h",
      ℕ: "n",
      ℚ: "q",
      ℝ: "r",
      ℤ: "z",
      ℎ: "h",
      ℓ: "l",
      "℘": "p",
      ℬ: "b",
      ℰ: "e",
      ℱ: "f",
      ℋ: "h",
      ℐ: "i",
      ℒ: "l",
      ℳ: "m",
      ℛ: "r",
      ℯ: "e",

      // Set theory symbols
      "∩": "n",
      "∪": "u",
      "⊂": "c",
      "⊃": "c",
      "⊆": "c",
      "⊇": "c",
      "⊕": "o",
      "⊗": "x",
      "⊙": "o",
      "⊚": "o",
      "⊛": "o",

      // Box drawing characters
      "│": "i",
      "║": "i",
      "┃": "i",
      "┊": "i",
      "┋": "i",
      "─": "l",
      "═": "l",
      "━": "l",
      "┄": "l",
      "┅": "l",

      // Currency and symbols
      "¤": "o",
      "¦": "i",
      "©": "c",
      "®": "r",
      "°": "o",
      "±": "t",
      "²": "2",
      "³": "3",
      "¹": "1",
      "¼": "14",
      "½": "12",
      "¾": "34",
      "×": "x",
      "÷": "d",
      "‰": "o",

      // Punctuation lookalikes (using Unicode escape sequences)
      "\u2018": "'", // Left single quotation mark
      "\u2019": "'", // Right single quotation mark
      "\u201C": '"', // Left double quotation mark
      "\u201D": '"', // Right double quotation mark
      "\u2026": "...", // Horizontal ellipsis
      "\u2013": "-", // En dash
      "\u2014": "-", // Em dash
      "\u2015": "-", // Horizontal bar
      "\u2022": "o", // Bullet
      "\u201A": ",", // Single low-9 quotation mark
      "\u201E": '"', // Double low-9 quotation mark
      "\u2039": "<", // Single left-pointing angle quotation mark
      "\u203A": ">", // Single right-pointing angle quotation mark
      "\u00AB": "<", // Left-pointing double angle quotation mark
      "\u00BB": ">", // Right-pointing double angle quotation mark

      // Miscellaneous symbols
      "☆": "o",
      "★": "o",
      "♠": "s",
      "♣": "c",
      "♥": "h",
      "♦": "d",
      "♀": "f",
      "♂": "m",
      "☀": "o",
      "☁": "o",
      "☂": "i",
      "☃": "o",
      "♩": "i",
      "♪": "i",
      "♫": "i",
      "♬": "i",
      "♭": "b",
      "♮": "h",
      "♯": "#",
    };

    Object.assign(mappings, confusables);
  }

  /**
   * Adds superscript and subscript character mappings
   */
  addSuperSubscriptMappings(mappings) {
    const superSubscriptMappings = {
      // Superscript numbers
      "⁰": "0",
      "¹": "1",
      "²": "2",
      "³": "3",
      "⁴": "4",
      "⁵": "5",
      "⁶": "6",
      "⁷": "7",
      "⁸": "8",
      "⁹": "9",

      // Subscript numbers
      "₀": "0",
      "₁": "1",
      "₂": "2",
      "₃": "3",
      "₄": "4",
      "₅": "5",
      "₆": "6",
      "₇": "7",
      "₈": "8",
      "₉": "9",

      // Superscript letters
      ᵃ: "a",
      ᵇ: "b",
      ᶜ: "c",
      ᵈ: "d",
      ᵉ: "e",
      ᶠ: "f",
      ᵍ: "g",
      ʰ: "h",
      ⁱ: "i",
      ʲ: "j",
      ᵏ: "k",
      ˡ: "l",
      ᵐ: "m",
      ⁿ: "n",
      ᵒ: "o",
      ᵖ: "p",
      ʳ: "r",
      ˢ: "s",
      ᵗ: "t",
      ᵘ: "u",
      ᵛ: "v",
      ʷ: "w",
      ˣ: "x",
      ʸ: "y",
      ᶻ: "z",

      // Subscript letters
      ₐ: "a",
      ₑ: "e",
      ₕ: "h",
      ᵢ: "i",
      ⱼ: "j",
      ₖ: "k",
      ₗ: "l",
      ₘ: "m",
      ₙ: "n",
      ₒ: "o",
      ₚ: "p",
      ᵣ: "r",
      ₛ: "s",
      ₜ: "t",
      ᵤ: "u",
      ᵥ: "v",
      ₓ: "x",

      // Superscript symbols
      "⁺": "+",
      "⁻": "-",
      "⁼": "=",
      "⁽": "(",
      "⁾": ")",
      ⁿ: "n",

      // Subscript symbols
      "₊": "+",
      "₋": "-",
      "₌": "=",
      "₍": "(",
      "₎": ")",
    };

    Object.assign(mappings, superSubscriptMappings);
  }

  /**
   * Adds mappings for zero-width and invisible characters
   */
  addInvisibleCharacterMappings(mappings) {
    const invisibleMappings = {
      // Zero-width characters
      "\u200B": "", // Zero width space
      "\u200C": "", // Zero width non-joiner
      "\u200D": "", // Zero width joiner
      "\u2060": "", // Word joiner
      "\uFEFF": "", // Zero width no-break space (BOM)
      "\u180E": "", // Mongolian vowel separator
      "\u061C": "", // Arabic letter mark

      // Bidirectional text control characters
      "\u200E": "", // Left-to-right mark
      "\u200F": "", // Right-to-left mark
      "\u202A": "", // Left-to-right embedding
      "\u202B": "", // Right-to-left embedding
      "\u202C": "", // Pop directional formatting
      "\u202D": "", // Left-to-right override
      "\u202E": "", // Right-to-left override
      "\u2066": "", // Left-to-right isolate
      "\u2067": "", // Right-to-left isolate
      "\u2068": "", // First strong isolate
      "\u2069": "", // Pop directional isolate

      // Other invisible characters
      "\u034F": "", // Combining grapheme joiner
      "\u17B4": "", // Khmer vowel inherent AQ
      "\u17B5": "", // Khmer vowel inherent AA
      "\u2028": "", // Line separator
      "\u2029": "", // Paragraph separator
      "\u00AD": "", // Soft hyphen
      "\u115F": "", // Hangul choseong filler
      "\u1160": "", // Hangul jungseong filler
      "\u3164": "", // Hangul filler
      "\uFFA0": "", // Halfwidth hangul filler
    };

    Object.assign(mappings, invisibleMappings);
  }

  /**
   * Enhanced string normalization with comprehensive Unicode handling
   * Optimized for Talkomatic's real-time chat scenarios
   */
  stringToAlphanumeric(text) {
    if (!text || typeof text !== "string") {
      return "";
    }

    let result = "";

    // Process each character individually for maximum compatibility
    for (let char of text) {
      // Handle both original case and lowercase
      let lowerChar = char.toLowerCase();

      // Remove diacritics and combining marks
      lowerChar = lowerChar.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

      // Apply obfuscation mapping (check original char first, then lowercase)
      let mappedChar =
        this.obfuscationMap[char] ||
        this.obfuscationMap[lowerChar] ||
        lowerChar;

      // Only keep alphanumeric characters
      if (/[a-z0-9]/.test(mappedChar)) {
        result += mappedChar;
      }
      // All other characters (spaces, punctuation, symbols) are ignored
    }

    // Handle excessive repeated characters that might be used to break detection
    // (e.g., "baaaadword" -> "badword") while preserving legitimate doubles
    result = this.normalizeRepeatedCharacters(result);

    return result;
  }

  /**
   * Normalizes repeated characters while preserving legitimate patterns
   */
  normalizeRepeatedCharacters(text) {
    // Replace runs of 3+ identical characters with just 2
    // This preserves legitimate double letters while reducing padding attempts
    return text.replace(/(.)\1{2,}/g, "$1$1");
  }

  /**
   * Enhanced text checking with improved pattern detection
   */
  checkText(text) {
    if (!text || typeof text !== "string") {
      return { hasOffensiveWord: false, offensiveRanges: [] };
    }

    const cacheKey = text;
    if (this.cache.has(cacheKey)) {
      this.cacheHits++;
      return this.cache.get(cacheKey);
    }

    this.cacheMisses++;
    let result = { hasOffensiveWord: false, offensiveRanges: [] };

    const lines = text.split(/\r?\n/);
    let overallIndex = 0;

    for (const line of lines) {
      const normalizedLine = this.stringToAlphanumeric(line);

      // Skip empty lines
      if (normalizedLine.length === 0) {
        overallIndex += line.length + 1;
        continue;
      }

      let i = 0;
      while (i < normalizedLine.length) {
        let maxOffensiveMatchLength = 0;
        let maxWhitelistMatchLength = 0;

        // Check for offensive word starting at position i
        let node = this.offensiveTrie.root;
        let j = i;
        while (j < normalizedLine.length && node.children[normalizedLine[j]]) {
          node = node.children[normalizedLine[j]];
          j++;
          if (node.isEndOfWord) {
            maxOffensiveMatchLength = j - i;
          }
        }

        // Check for whitelisted word starting at position i
        node = this.whitelistTrie.root;
        j = i;
        while (j < normalizedLine.length && node.children[normalizedLine[j]]) {
          node = node.children[normalizedLine[j]];
          j++;
          if (node.isEndOfWord) {
            maxWhitelistMatchLength = j - i;
          }
        }

        // Flag offensive content if found and not whitelisted
        if (
          maxOffensiveMatchLength > 0 &&
          maxOffensiveMatchLength >= maxWhitelistMatchLength
        ) {
          // Additional validation for context and word boundaries
          if (
            this.isValidOffensiveMatch(
              normalizedLine,
              i,
              i + maxOffensiveMatchLength
            )
          ) {
            result.hasOffensiveWord = true;
            const startIndex = this.findOriginalIndex(line, i) + overallIndex;
            const endIndex =
              this.findOriginalIndex(line, i + maxOffensiveMatchLength) +
              overallIndex;
            result.offensiveRanges.push([startIndex, endIndex]);
          }
          i += maxOffensiveMatchLength;
        } else {
          i++;
        }
      }
      overallIndex += line.length + 1; // +1 for newline character
    }

    // Cache the result
    this.cache.set(cacheKey, result);
    if (this.cache.size > this.cacheSize) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }

    return result;
  }

  /**
   * Validates whether an offensive word match is legitimate
   */
  isValidOffensiveMatch(normalizedText, startPos, endPos) {
    const matchLength = endPos - startPos;

    // Reject very short matches (1-2 characters) as they're prone to false positives
    if (matchLength <= 2) {
      return false;
    }

    // For medium-length matches (3-4 characters), check word boundaries
    if (matchLength <= 4) {
      const beforeChar = startPos > 0 ? normalizedText[startPos - 1] : "";
      const afterChar =
        endPos < normalizedText.length ? normalizedText[endPos] : "";

      // If surrounded by letters/numbers, it might be part of a larger legitimate word
      const isEmbedded =
        /[a-z0-9]/.test(beforeChar) && /[a-z0-9]/.test(afterChar);
      if (isEmbedded) {
        return false;
      }
    }

    // For longer matches (5+ characters), generally accept them
    return true;
  }

  /**
   * Enhanced original index finding with better Unicode support
   */
  findOriginalIndex(originalText, normalizedIndex) {
    let normalizedText = "";
    let indexMapping = [];

    // Build mapping between normalized and original indices
    for (let i = 0; i < originalText.length; i++) {
      let char = originalText[i];
      let lowerChar = char.toLowerCase();
      lowerChar = lowerChar.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

      // Apply the same mapping as in stringToAlphanumeric
      let mappedChar =
        this.obfuscationMap[char] ||
        this.obfuscationMap[lowerChar] ||
        lowerChar;

      if (/[a-z0-9]/.test(mappedChar)) {
        normalizedText += mappedChar;
        indexMapping.push(i);
      }
    }

    // Handle boundary cases
    if (normalizedIndex >= indexMapping.length) {
      return originalText.length;
    }
    if (normalizedIndex < 0) {
      return 0;
    }

    return indexMapping[normalizedIndex];
  }

  /**
   * Enhanced text filtering with better preservation of text structure
   */
  filterText(text) {
    const { offensiveRanges } = this.checkText(text);
    if (offensiveRanges.length === 0) return text;

    let filteredText = "";
    let lastIndex = 0;

    for (const [start, end] of offensiveRanges) {
      // Add text before the offensive content
      filteredText += text.slice(lastIndex, start);

      // Replace offensive content with asterisks
      const offensiveLength = end - start;
      filteredText += "*".repeat(Math.max(1, offensiveLength));

      lastIndex = end;
    }

    // Add remaining text
    filteredText += text.slice(lastIndex);

    return filteredText;
  }

  /**
   * Get detailed cache statistics for performance monitoring
   */
  getCacheStats() {
    const hitRate =
      this.cacheHits + this.cacheMisses > 0
        ? this.cacheHits / (this.cacheHits + this.cacheMisses)
        : 0;

    return {
      size: this.cache.size,
      maxSize: this.cacheSize,
      hits: this.cacheHits,
      misses: this.cacheMisses,
      hitRate: Math.round(hitRate * 100) / 100,
      memoryUsage: this.cache.size > 0 ? "active" : "empty",
    };
  }

  /**
   * Clear cache and reset statistics
   */
  clearCache() {
    this.cache.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  /**
   * Test method for debugging normalization behavior
   */
  testNormalization(text) {
    const normalized = this.stringToAlphanumeric(text);
    const characterDetails = [...text].map((char) => {
      const code = char.codePointAt(0);
      const lowerChar = char
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
      const mapped =
        this.obfuscationMap[char] ||
        this.obfuscationMap[lowerChar] ||
        lowerChar;
      const kept = /[a-z0-9]/.test(mapped);

      return {
        original: char,
        code: `U+${code.toString(16).toUpperCase().padStart(4, "0")}`,
        mapped: mapped,
        kept: kept,
        source: this.obfuscationMap[char]
          ? "direct"
          : this.obfuscationMap[lowerChar]
          ? "lowercase"
          : "unchanged",
      };
    });

    return {
      original: text,
      normalized: normalized,
      reduction: `${text.length} → ${normalized.length} chars`,
      efficiency:
        normalized.length > 0
          ? Math.round((normalized.length / text.length) * 100) + "%"
          : "0%",
      characterDetails: characterDetails,
    };
  }

  /**
   * Get comprehensive filter statistics and configuration info
   */
  getFilterStats() {
    return {
      version: "2.0.0-enhanced",
      cache: this.getCacheStats(),
      mappings: {
        totalMappings: Object.keys(this.obfuscationMap).length,
        categories: [
          "File-based substitutions",
          "Mathematical Alphanumeric Symbols",
          "Cyrillic Confusables",
          "Greek Confusables",
          "Fullwidth Characters",
          "Common Substitutions",
          "Unicode Confusables",
          "Superscript/Subscript",
          "Zero-width Characters",
        ],
      },
      wordLists: {
        offensive: this.offensiveTrie ? "loaded" : "not loaded",
        whitelist: this.whitelistTrie ? "loaded" : "not loaded",
      },
      performance: {
        cacheEnabled: true,
        unicodeNormalization: true,
        boundaryDetection: true,
        realtimeOptimized: true,
      },
    };
  }

  /**
   * Validate filter configuration and report any issues
   */
  validateConfiguration() {
    const issues = [];
    const warnings = [];

    // Check word lists
    if (!this.offensiveTrie) {
      issues.push("Offensive words trie not initialized");
    }
    if (!this.whitelistTrie) {
      warnings.push("Whitelist trie not initialized");
    }

    // Check mappings
    if (Object.keys(this.obfuscationMap).length === 0) {
      issues.push("No character mappings loaded");
    }
    if (Object.keys(this.obfuscationMap).length < 1000) {
      warnings.push("Character mapping count seems low");
    }

    // Check cache configuration
    if (this.cacheSize <= 0) {
      warnings.push("Cache disabled - may impact performance");
    }

    return {
      status: issues.length === 0 ? "valid" : "invalid",
      issues: issues,
      warnings: warnings,
      summary: `${issues.length} issues, ${warnings.length} warnings`,
    };
  }
}

module.exports = WordFilter;
