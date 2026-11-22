const fs = require('node:fs');

// Format: written|reading|meaning|part of speech
// Blank lines and lines starting with # are skipped.
function parseWords(text) {
  const words = [];
  const seen = new Set();
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);

  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const lineNo = i + 1;
    const parts = line.split('|').map((p) => p.trim());
    if (parts.length !== 4 || parts.some((p) => !p)) {
      throw new Error(
        `words: line ${lineNo} must be written|reading|meaning|part of speech: ${line}`
      );
    }
    const [written, reading, meaning, pos] = parts;
    if (seen.has(written)) {
      throw new Error(`words: duplicate word on line ${lineNo}: ${written}`);
    }
    seen.add(written);
    words.push({ written, reading, meaning, pos });
  });

  return words;
}

function loadWords(filePath) {
  return parseWords(fs.readFileSync(filePath, 'utf8'));
}

module.exports = { parseWords, loadWords };
