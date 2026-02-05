/**
 * SURVIVOR Oracle — Token Metadata Sanitizer
 * Built by SURVIVOR Agent #598
 */

const OFFENSIVE_PATTERNS = [
  /\bnigg(a|er|ers|as|az)\b/gi,
  /\bfag(s|got|gots)?\b/gi,
  /\bcunt(s)?\b/gi,
  /\bslut(s)?\b/gi,
  /\bretard(s|ed)?\b/gi,
  /\btrann(y|ies)\b/gi,
  /\bkike(s)?\b/gi,
  /\bspic(s)?\b/gi,
  /\bwetback(s)?\b/gi,
  /\bchink(s)?\b/gi,
];

function sanitizeText(s) {
  if (!s || typeof s !== 'string') return s;
  let out = s;
  for (const re of OFFENSIVE_PATTERNS) {
    out = out.replace(re, '[redacted]');
  }
  return out;
}

function sanitizeTokenData(token) {
  if (!token) return token;
  return {
    ...token,
    name: sanitizeText(token.name),
    symbol: sanitizeText(token.symbol),
    description: sanitizeText(token.description),
  };
}

module.exports = { sanitizeText, sanitizeTokenData };
