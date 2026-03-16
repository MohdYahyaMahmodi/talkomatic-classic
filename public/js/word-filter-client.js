// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  word-filter-client.js — Full browser port of server/word-filter.js     ║
// ║  Identical algorithm, identical mappings. Loads JSON via fetch.          ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

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
      if (!node.children[char]) node.children[char] = new TrieNode();
      node = node.children[char];
    }
    node.isEndOfWord = true;
  }
  search(word) {
    let node = this.root;
    for (let char of word) {
      if (!node.children[char]) return false;
      node = node.children[char];
    }
    return node.isEndOfWord;
  }
}

class ClientWordFilter {
  constructor() {
    this.offensiveTrie = new Trie();
    this.whitelistTrie = new Trie();
    this.obfuscationMap = {};
    this.ready = false;
    this.cache = new Map();
    this.cacheSize = 1000;
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  // ── Initialization (replaces fs.readFileSync with fetch + retry) ────────

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
        throw new Error("Invalid JSON structure");
      }
      wordsData.offensive_words.forEach((w) =>
        this.offensiveTrie.insert(w.toLowerCase()),
      );
      wordsData.whitelisted_words.forEach((w) =>
        this.whitelistTrie.insert(w.toLowerCase()),
      );
      console.log(
        `Loaded ${wordsData.offensive_words.length} offensive words and ${wordsData.whitelisted_words.length} whitelisted words`,
      );
      this.obfuscationMap = this.buildComprehensiveObfuscationMap(subsData);
      console.log(
        `WordFilter initialized successfully with ${Object.keys(this.obfuscationMap).length} character mappings`,
      );
      this.ready = true;
    } catch (err) {
      console.error("[WordFilter] Init failed:", err.message);
      this.ready = false;
    }
  }

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
        await new Promise((r) =>
          setTimeout(r, baseDelay * Math.pow(2, attempt)),
        );
      }
    }
    throw new Error(`Failed to fetch ${url} after ${retries} retries`);
  }

  // ── Obfuscation map (identical to server) ───────────────────────────────

  buildComprehensiveObfuscationMap(fileSubstitutions) {
    let mappings = {};
    if (fileSubstitutions && typeof fileSubstitutions === "object") {
      mappings = { ...fileSubstitutions };
    }
    const builtInMappings = this.createBuiltInUnicodeMappings();
    const combinedMappings = { ...builtInMappings, ...mappings };
    return combinedMappings;
  }

  createBuiltInUnicodeMappings() {
    const mappings = {};
    this.addMathematicalAlphanumericMappings(mappings);
    this.addCyrillicMappings(mappings);
    this.addGreekMappings(mappings);
    this.addFullwidthMappings(mappings);
    this.addCommonSubstitutions(mappings);
    this.addUnicodeConfusables(mappings);
    this.addSuperSubscriptMappings(mappings);
    this.addInvisibleCharacterMappings(mappings);
    return mappings;
  }

  addMathematicalAlphanumericMappings(mappings) {
    const ranges = [
      { start: 0x1d400, end: 0x1d433 },
      { start: 0x1d434, end: 0x1d467 },
      { start: 0x1d468, end: 0x1d49b },
      { start: 0x1d49c, end: 0x1d4cf },
      { start: 0x1d4d0, end: 0x1d503 },
      { start: 0x1d504, end: 0x1d537 },
      { start: 0x1d538, end: 0x1d56b },
      { start: 0x1d56c, end: 0x1d59f },
      { start: 0x1d5a0, end: 0x1d5d3 },
      { start: 0x1d5d4, end: 0x1d607 },
      { start: 0x1d608, end: 0x1d63b },
      { start: 0x1d63c, end: 0x1d66f },
      { start: 0x1d670, end: 0x1d6a3 },
    ];
    ranges.forEach((range) => {
      for (let i = 0; i < 26; i++) {
        const cp = range.start + i;
        if (cp <= range.end) {
          try {
            mappings[String.fromCodePoint(cp)] = String.fromCharCode(
              65 + i,
            ).toLowerCase();
          } catch (_) {}
        }
      }
      for (let i = 0; i < 26; i++) {
        const cp = range.start + 26 + i;
        if (cp <= range.end) {
          try {
            mappings[String.fromCodePoint(cp)] = String.fromCharCode(97 + i);
          } catch (_) {}
        }
      }
    });
    const numberRanges = [0x1d7ce, 0x1d7d8, 0x1d7e2, 0x1d7ec, 0x1d7f6];
    numberRanges.forEach((start) => {
      for (let i = 0; i < 10; i++) {
        try {
          mappings[String.fromCodePoint(start + i)] = String.fromCharCode(
            48 + i,
          );
        } catch (_) {}
      }
    });
  }

  addCyrillicMappings(mappings) {
    Object.assign(mappings, {
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
      "\u04CF": "l",
      "\u0501": "d",
      "\u050D": "g",
      "\u051B": "q",
      "\u0475": "v",
      "\u051D": "w",
      "\u0481": "c",
      "\u050F": "o",
      "\u057C": "n",
      "\u0573": "u",
      "\u0570": "h",
      "\u0410": "a",
      "\u0412": "b",
      "\u0415": "e",
      "\u041A": "k",
      "\u041C": "m",
      "\u041D": "h",
      "\u041E": "o",
      "\u0420": "p",
      "\u0421": "c",
      "\u0422": "t",
      "\u0423": "y",
      "\u0425": "x",
      "\u0405": "s",
      "\u0406": "i",
      "\u0408": "j",
      "\u04C0": "l",
      "\u0500": "d",
      "\u050C": "g",
      "\u051A": "q",
      "\u0474": "v",
      "\u051C": "w",
      "\u0480": "c",
      "\u050E": "o",
      "\u054C": "n",
      "\u0543": "u",
      "\u0540": "h",
    });
  }

  addGreekMappings(mappings) {
    Object.assign(mappings, {
      "\u03B1": "a",
      "\u03B2": "b",
      "\u03B3": "y",
      "\u03B4": "d",
      "\u03B5": "e",
      "\u03B6": "z",
      "\u03B7": "h",
      "\u03B8": "o",
      "\u03B9": "i",
      "\u03BA": "k",
      "\u03BB": "l",
      "\u03BC": "m",
      "\u03BD": "n",
      "\u03BE": "x",
      "\u03BF": "o",
      "\u03C0": "p",
      "\u03C1": "p",
      "\u03C3": "s",
      "\u03C4": "t",
      "\u03C5": "y",
      "\u03C6": "f",
      "\u03C7": "x",
      "\u03C8": "y",
      "\u03C9": "w",
      "\u03C2": "s",
      "\u03F1": "p",
      "\u03F2": "c",
      "\u03F3": "j",
      "\u0391": "a",
      "\u0392": "b",
      "\u0393": "y",
      "\u0394": "d",
      "\u0395": "e",
      "\u0396": "z",
      "\u0397": "h",
      "\u0398": "o",
      "\u0399": "i",
      "\u039A": "k",
      "\u039B": "l",
      "\u039C": "m",
      "\u039D": "n",
      "\u039E": "x",
      "\u039F": "o",
      "\u03A0": "p",
      "\u03A1": "p",
      "\u03A3": "s",
      "\u03A4": "t",
      "\u03A5": "y",
      "\u03A6": "f",
      "\u03A7": "x",
      "\u03A8": "y",
      "\u03A9": "w",
      "\u03F9": "c",
      "\u037F": "j",
    });
  }

  addFullwidthMappings(mappings) {
    for (let i = 0; i < 26; i++) {
      mappings[String.fromCharCode(0xff21 + i)] = String.fromCharCode(97 + i);
      mappings[String.fromCharCode(0xff41 + i)] = String.fromCharCode(97 + i);
    }
    for (let i = 0; i < 10; i++) {
      mappings[String.fromCharCode(0xff10 + i)] = String.fromCharCode(48 + i);
    }
  }

  addCommonSubstitutions(mappings) {
    Object.assign(mappings, {
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
      "\u00A7": "s",
      "\u00A2": "c",
      "\u20AC": "e",
      "\u00A3": "l",
      "\u00A5": "y",
      "\u20B9": "r",
      "\u20BD": "p",
      "\u20A9": "w",
      "\u2200": "a",
      "\u2203": "e",
      "\u2229": "n",
      "\u222A": "u",
      "\u2211": "s",
      "\u220F": "p",
      "\u2206": "d",
      "\u2207": "v",
      "\u2208": "e",
      "\u220B": "n",
      "\u221E": "o",
      "\u222B": "f",
      "\u2191": "i",
      "\u2193": "i",
      "\u2190": "l",
      "\u2192": "r",
      "\u2194": "x",
      "\u21D1": "i",
      "\u21D3": "i",
      "\u21D0": "l",
      "\u21D2": "r",
      "\u21D4": "x",
      "\u00BD": "12",
      "\u2153": "13",
      "\u2154": "23",
      "\u00BC": "14",
      "\u00BE": "34",
      "\u215B": "18",
      "\u215C": "38",
      "\u215D": "58",
      "\u215E": "78",
      "\u2160": "i",
      "\u2161": "ii",
      "\u2162": "iii",
      "\u2163": "iv",
      "\u2164": "v",
      "\u2165": "vi",
      "\u2166": "vii",
      "\u2167": "viii",
      "\u2168": "ix",
      "\u2169": "x",
      "\u2170": "i",
      "\u2171": "ii",
      "\u2172": "iii",
      "\u2173": "iv",
      "\u2174": "v",
      "\u2175": "vi",
      "\u2176": "vii",
      "\u2177": "viii",
      "\u2178": "ix",
      "\u2179": "x",
      "\u24B6": "a",
      "\u24B7": "b",
      "\u24B8": "c",
      "\u24B9": "d",
      "\u24BA": "e",
      "\u24BB": "f",
      "\u24BC": "g",
      "\u24BD": "h",
      "\u24BE": "i",
      "\u24BF": "j",
      "\u24C0": "k",
      "\u24C1": "l",
      "\u24C2": "m",
      "\u24C3": "n",
      "\u24C4": "o",
      "\u24C5": "p",
      "\u24C6": "q",
      "\u24C7": "r",
      "\u24C8": "s",
      "\u24C9": "t",
      "\u24CA": "u",
      "\u24CB": "v",
      "\u24CC": "w",
      "\u24CD": "x",
      "\u24CE": "y",
      "\u24CF": "z",
      "\u24D0": "a",
      "\u24D1": "b",
      "\u24D2": "c",
      "\u24D3": "d",
      "\u24D4": "e",
      "\u24D5": "f",
      "\u24D6": "g",
      "\u24D7": "h",
      "\u24D8": "i",
      "\u24D9": "j",
      "\u24DA": "k",
      "\u24DB": "l",
      "\u24DC": "m",
      "\u24DD": "n",
      "\u24DE": "o",
      "\u24DF": "p",
      "\u24E0": "q",
      "\u24E1": "r",
      "\u24E2": "s",
      "\u24E3": "t",
      "\u24E4": "u",
      "\u24E5": "v",
      "\u24E6": "w",
      "\u24E7": "x",
      "\u24E8": "y",
      "\u24E9": "z",
      "\u249C": "a",
      "\u249D": "b",
      "\u249E": "c",
      "\u249F": "d",
      "\u24A0": "e",
      "\u24A1": "f",
      "\u24A2": "g",
      "\u24A3": "h",
      "\u24A4": "i",
      "\u24A5": "j",
      "\u24A6": "k",
      "\u24A7": "l",
      "\u24A8": "m",
      "\u24A9": "n",
      "\u24AA": "o",
      "\u24AB": "p",
      "\u24AC": "q",
      "\u24AD": "r",
      "\u24AE": "s",
      "\u24AF": "t",
      "\u24B0": "u",
      "\u24B1": "v",
      "\u24B2": "w",
      "\u24B3": "x",
      "\u24B4": "y",
      "\u24B5": "z",
    });
  }

  addUnicodeConfusables(mappings) {
    Object.assign(mappings, {
      "\u2102": "c",
      "\u210D": "h",
      "\u2115": "n",
      "\u211A": "q",
      "\u211D": "r",
      "\u2124": "z",
      "\u210E": "h",
      "\u2113": "l",
      "\u2118": "p",
      "\u212C": "b",
      "\u2130": "e",
      "\u2131": "f",
      "\u210B": "h",
      "\u2110": "i",
      "\u2112": "l",
      "\u2133": "m",
      "\u211B": "r",
      "\u212F": "e",
      "\u2229": "n",
      "\u222A": "u",
      "\u2282": "c",
      "\u2283": "c",
      "\u2286": "c",
      "\u2287": "c",
      "\u2295": "o",
      "\u2297": "x",
      "\u2299": "o",
      "\u229A": "o",
      "\u229B": "o",
      "\u2502": "i",
      "\u2551": "i",
      "\u2503": "i",
      "\u250A": "i",
      "\u250B": "i",
      "\u2500": "l",
      "\u2550": "l",
      "\u2501": "l",
      "\u2504": "l",
      "\u2505": "l",
      "\u00A4": "o",
      "\u00A6": "i",
      "\u00A9": "c",
      "\u00AE": "r",
      "\u00B0": "o",
      "\u00B1": "t",
      "\u00B2": "2",
      "\u00B3": "3",
      "\u00B9": "1",
      "\u00BC": "14",
      "\u00BD": "12",
      "\u00BE": "34",
      "\u00D7": "x",
      "\u00F7": "d",
      "\u2030": "o",
      "\u2018": "'",
      "\u2019": "'",
      "\u201C": '"',
      "\u201D": '"',
      "\u2026": "...",
      "\u2013": "-",
      "\u2014": "-",
      "\u2015": "-",
      "\u2022": "o",
      "\u201A": ",",
      "\u201E": '"',
      "\u2039": "<",
      "\u203A": ">",
      "\u00AB": "<",
      "\u00BB": ">",
      "\u2606": "o",
      "\u2605": "o",
      "\u2660": "s",
      "\u2663": "c",
      "\u2665": "h",
      "\u2666": "d",
      "\u2640": "f",
      "\u2642": "m",
      "\u2600": "o",
      "\u2601": "o",
      "\u2602": "i",
      "\u2603": "o",
      "\u2669": "i",
      "\u266A": "i",
      "\u266B": "i",
      "\u266C": "i",
      "\u266D": "b",
      "\u266E": "h",
      "\u266F": "#",
    });
  }

  addSuperSubscriptMappings(mappings) {
    Object.assign(mappings, {
      "\u2070": "0",
      "\u00B9": "1",
      "\u00B2": "2",
      "\u00B3": "3",
      "\u2074": "4",
      "\u2075": "5",
      "\u2076": "6",
      "\u2077": "7",
      "\u2078": "8",
      "\u2079": "9",
      "\u2080": "0",
      "\u2081": "1",
      "\u2082": "2",
      "\u2083": "3",
      "\u2084": "4",
      "\u2085": "5",
      "\u2086": "6",
      "\u2087": "7",
      "\u2088": "8",
      "\u2089": "9",
      "\u1D43": "a",
      "\u1D47": "b",
      "\u1D9C": "c",
      "\u1D48": "d",
      "\u1D49": "e",
      "\u1DA0": "f",
      "\u1D4D": "g",
      "\u02B0": "h",
      "\u2071": "i",
      "\u02B2": "j",
      "\u1D4F": "k",
      "\u02E1": "l",
      "\u1D50": "m",
      "\u207F": "n",
      "\u1D52": "o",
      "\u1D56": "p",
      "\u02B3": "r",
      "\u02E2": "s",
      "\u1D57": "t",
      "\u1D58": "u",
      "\u1D5B": "v",
      "\u02B7": "w",
      "\u02E3": "x",
      "\u02B8": "y",
      "\u1DBB": "z",
      "\u2090": "a",
      "\u2091": "e",
      "\u2095": "h",
      "\u1D62": "i",
      "\u2C7C": "j",
      "\u2096": "k",
      "\u2097": "l",
      "\u2098": "m",
      "\u2099": "n",
      "\u2092": "o",
      "\u209A": "p",
      "\u1D63": "r",
      "\u209B": "s",
      "\u209C": "t",
      "\u1D64": "u",
      "\u1D65": "v",
      "\u2093": "x",
      "\u207A": "+",
      "\u207B": "-",
      "\u207C": "=",
      "\u207D": "(",
      "\u207E": ")",
      "\u208A": "+",
      "\u208B": "-",
      "\u208C": "=",
      "\u208D": "(",
      "\u208E": ")",
    });
  }

  addInvisibleCharacterMappings(mappings) {
    Object.assign(mappings, {
      "\u200B": "",
      "\u200C": "",
      "\u200D": "",
      "\u2060": "",
      "\uFEFF": "",
      "\u180E": "",
      "\u061C": "",
      "\u200E": "",
      "\u200F": "",
      "\u202A": "",
      "\u202B": "",
      "\u202C": "",
      "\u202D": "",
      "\u202E": "",
      "\u2066": "",
      "\u2067": "",
      "\u2068": "",
      "\u2069": "",
      "\u034F": "",
      "\u17B4": "",
      "\u17B5": "",
      "\u2028": "",
      "\u2029": "",
      "\u00AD": "",
      "\u115F": "",
      "\u1160": "",
      "\u3164": "",
      "\uFFA0": "",
    });
  }

  // ── Normalization (identical to server) ─────────────────────────────────

  stringToAlphanumeric(text) {
    if (!text || typeof text !== "string") return "";
    let result = "";
    for (let char of text) {
      let lowerChar = char.toLowerCase();
      lowerChar = lowerChar.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      let mappedChar =
        this.obfuscationMap[char] ||
        this.obfuscationMap[lowerChar] ||
        lowerChar;
      if (/[a-z0-9]/.test(mappedChar)) {
        result += mappedChar;
      }
    }
    result = this.normalizeRepeatedCharacters(result);
    return result;
  }

  normalizeRepeatedCharacters(text) {
    return text.replace(/(.)\1{2,}/g, "$1$1");
  }

  // ── Text checking (identical to server) ─────────────────────────────────

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
      if (normalizedLine.length === 0) {
        overallIndex += line.length + 1;
        continue;
      }
      let i = 0;
      while (i < normalizedLine.length) {
        let maxOffensiveMatchLength = 0;
        let maxWhitelistMatchLength = 0;

        let node = this.offensiveTrie.root;
        let j = i;
        while (j < normalizedLine.length && node.children[normalizedLine[j]]) {
          node = node.children[normalizedLine[j]];
          j++;
          if (node.isEndOfWord) maxOffensiveMatchLength = j - i;
        }

        node = this.whitelistTrie.root;
        j = i;
        while (j < normalizedLine.length && node.children[normalizedLine[j]]) {
          node = node.children[normalizedLine[j]];
          j++;
          if (node.isEndOfWord) maxWhitelistMatchLength = j - i;
        }

        if (
          maxOffensiveMatchLength > 0 &&
          maxOffensiveMatchLength >= maxWhitelistMatchLength
        ) {
          if (
            this.isValidOffensiveMatch(
              normalizedLine,
              i,
              i + maxOffensiveMatchLength,
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
      overallIndex += line.length + 1;
    }

    this.cache.set(cacheKey, result);
    if (this.cache.size > this.cacheSize) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }
    return result;
  }

  isValidOffensiveMatch(normalizedText, startPos, endPos) {
    const matchLength = endPos - startPos;
    if (matchLength <= 2) return false;
    if (matchLength <= 4) {
      const beforeChar = startPos > 0 ? normalizedText[startPos - 1] : "";
      const afterChar =
        endPos < normalizedText.length ? normalizedText[endPos] : "";
      const isEmbedded =
        /[a-z0-9]/.test(beforeChar) && /[a-z0-9]/.test(afterChar);
      if (isEmbedded) return false;
    }
    return true;
  }

  findOriginalIndex(originalText, normalizedIndex) {
    let indexMapping = [];
    for (let i = 0; i < originalText.length; i++) {
      let char = originalText[i];
      let lowerChar = char.toLowerCase();
      lowerChar = lowerChar.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      let mappedChar =
        this.obfuscationMap[char] ||
        this.obfuscationMap[lowerChar] ||
        lowerChar;
      if (/[a-z0-9]/.test(mappedChar)) {
        indexMapping.push(i);
      }
    }
    if (normalizedIndex >= indexMapping.length) return originalText.length;
    if (normalizedIndex < 0) return 0;
    return indexMapping[normalizedIndex];
  }

  // ── Text filtering (identical to server) ────────────────────────────────

  filterText(text) {
    const { offensiveRanges } = this.checkText(text);
    if (offensiveRanges.length === 0) return text;
    let filteredText = "";
    let lastIndex = 0;
    for (const [start, end] of offensiveRanges) {
      filteredText += text.slice(lastIndex, start);
      const offensiveLength = end - start;
      filteredText += "*".repeat(Math.max(1, offensiveLength));
      lastIndex = end;
    }
    filteredText += text.slice(lastIndex);
    return filteredText;
  }

  clearCache() {
    this.cache.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }
}

window.ClientWordFilter = ClientWordFilter;
