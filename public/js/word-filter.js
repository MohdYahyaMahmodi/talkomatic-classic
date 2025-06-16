const fs = require('fs');

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
            const data = JSON.parse(fs.readFileSync(wordsFilePath, 'utf8'));

            if (!Array.isArray(data.offensive_words) || !Array.isArray(data.whitelisted_words)) {
                throw new Error('Invalid JSON structure: offensive_words and whitelisted_words must be arrays');
            }

            this.offensiveTrie = new Trie();
            data.offensive_words.forEach(word => this.offensiveTrie.insert(word.toLowerCase()));

            this.whitelistTrie = new Trie();
            data.whitelisted_words.forEach(word => this.whitelistTrie.insert(word.toLowerCase()));

            console.log(`Loaded ${data.offensive_words.length} offensive words and ${data.whitelisted_words.length} whitelisted words`);

            this.cache = new Map();
            this.cacheSize = 1000;
            this.cacheHits = 0;
            this.cacheMisses = 0;

            // Add obfuscation mapping
            this.obfuscationMap = JSON.parse(fs.readFileSync(substitutionsFilePath, 'utf8'));

            console.log('WordFilter initialized successfully');
        } catch (error) {
            console.error('Error initializing WordFilter:', error);
            throw error;
        }
    }

    /**
     * Converts a given string to its alphanumeric representation, mapping obfuscated characters
     * to their standard counterparts.
     * @param {string} text - The input text to normalize.
     * @returns {string} The normalized alphanumeric string.
     */
    stringToAlphanumeric(text) {
        let result = '';
        for (let char of text) {
            let lowerChar = char.toLowerCase();
            lowerChar = lowerChar.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // Remove diacritics
            let mappedChar = this.obfuscationMap[lowerChar] || lowerChar;
            if (/[a-z0-9]/.test(mappedChar)) {
                result += mappedChar;
            } else {
                // Ignore non-alphanumeric characters
            }
        }
        return result;
    }

    checkText(text) {
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

                if (maxOffensiveMatchLength > 0 && maxOffensiveMatchLength >= maxWhitelistMatchLength) {
                    // Offensive word found and not whitelisted
                    result.hasOffensiveWord = true;
                    const startIndex = this.findOriginalIndex(line, i) + overallIndex;
                    const endIndex = this.findOriginalIndex(line, i + maxOffensiveMatchLength) + overallIndex;
                    result.offensiveRanges.push([startIndex, endIndex]);
                    i += maxOffensiveMatchLength;
                } else {
                    i++;
                }
            }
            overallIndex += line.length + 1; // +1 for the newline character
        }

        this.cache.set(cacheKey, result);
        if (this.cache.size > this.cacheSize) {
            const oldestKey = this.cache.keys().next().value;
            this.cache.delete(oldestKey);
        }

        return result;
    }

    findOriginalIndex(originalText, normalizedIndex) {
        let normalizedText = '';
        let indexMapping = [];
        let currentIndex = 0;

        // Build normalized text and keep track of the original indices
        for (let i = 0; i < originalText.length; i++) {
            let char = originalText[i];
            let lowerChar = char.toLowerCase();
            lowerChar = lowerChar.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            let mappedChar = this.obfuscationMap[lowerChar] || lowerChar;

            if (/[a-z0-9]/.test(mappedChar)) {
                normalizedText += mappedChar;
                indexMapping.push(i); // Map from normalized index to original index
                currentIndex++;
            } else {
                // Non-alphanumeric character, skip but keep going
            }
        }

        // Handle out-of-bounds indices
        if (normalizedIndex >= indexMapping.length) {
            return originalText.length;
        }

        return indexMapping[normalizedIndex];
    }

    filterText(text) {
        const { offensiveRanges } = this.checkText(text);
        if (offensiveRanges.length === 0) return text;

        let filteredText = '';
        let lastIndex = 0;

        for (const [start, end] of offensiveRanges) {
            filteredText += text.slice(lastIndex, start);
            filteredText += '*'.repeat(end - start);
            lastIndex = end;
        }

        filteredText += text.slice(lastIndex);
        return filteredText;
    }

    getCacheStats() {
        return {
            size: this.cache.size,
            hits: this.cacheHits,
            misses: this.cacheMisses,
            hitRate: this.cacheHits / (this.cacheHits + this.cacheMisses) || 0
        };
    }

    clearCache() {
        this.cache.clear();
        this.cacheHits = 0;
        this.cacheMisses = 0;
    }
}

module.exports = WordFilter;
