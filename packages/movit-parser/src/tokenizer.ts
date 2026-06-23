/**
 * Line-oriented lexer for the `.movit` DSL.
 *
 * The grammar is indentation-aware but simple, so we tokenize per line and let
 * the parser dispatch on the first token. Blank lines and comments (`#` or `//`)
 * are dropped. Leading spaces become the `indent` count.
 */

export type TokenType = "str" | "num" | "dur" | "word" | "colon" | "comma" | "eq";

export interface Token {
  type: TokenType;
  value: string;
}

export interface Line {
  /** 1-based source line number, for error reporting. */
  line: number;
  /** Number of leading spaces (tabs count as one). */
  indent: number;
  tokens: Token[];
}

/** Ordered lexer rules; first match wins. Capture group 1 (if present) is the value. */
const RULES: Array<{ type: TokenType | "skip"; re: RegExp }> = [
  { type: "skip", re: /^\s+/ },
  { type: "str", re: /^"([^"]*)"/ },
  { type: "dur", re: /^(\d+(?:\.\d+)?s)\b/ },
  { type: "num", re: /^(-?\d+(?:\.\d+)?)/ },
  { type: "word", re: /^([A-Za-z_][A-Za-z0-9_-]*)/ },
  { type: "colon", re: /^(:)/ },
  { type: "comma", re: /^(,)/ },
  { type: "eq", re: /^(=)/ },
];

function stripComment(text: string): string {
  // Remove `#...` or `//...` that are not inside a quoted string.
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') inString = !inString;
    if (inString) continue;
    if (ch === "#") return text.slice(0, i);
    if (ch === "/" && text[i + 1] === "/") return text.slice(0, i);
  }
  return text;
}

function lex(content: string, lineNo: number): Token[] {
  const tokens: Token[] = [];
  let rest = content;
  while (rest.length > 0) {
    let matched = false;
    for (const rule of RULES) {
      const m = rule.re.exec(rest);
      if (!m) continue;
      matched = true;
      rest = rest.slice(m[0].length);
      if (rule.type === "skip") break;
      tokens.push({ type: rule.type, value: m[1] ?? m[0] });
      break;
    }
    if (!matched) {
      throw new TokenizeError(lineNo, `unexpected character: "${rest[0]}"`);
    }
  }
  return tokens;
}

export class TokenizeError extends Error {
  constructor(
    public readonly line: number,
    message: string,
  ) {
    super(message);
    this.name = "TokenizeError";
  }
}

/** Tokenize source into non-empty lines. Throws `TokenizeError` on bad characters. */
export function tokenize(source: string): Line[] {
  const out: Line[] = [];
  const rawLines = source.split(/\r?\n/);
  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i]!;
    const withoutComment = stripComment(raw);
    if (withoutComment.trim().length === 0) continue;
    const indent = withoutComment.length - withoutComment.trimStart().length;
    const tokens = lex(withoutComment.trimStart(), i + 1);
    if (tokens.length > 0) out.push({ line: i + 1, indent, tokens });
  }
  return out;
}
