/**
 * Pure adapters from the shared `movit-language` service to LSP wire types.
 * Kept separate from the server wiring so they can be unit-tested without a
 * running connection.
 */

import {
  DiagnosticSeverity,
  CompletionItemKind,
  MarkupKind,
  type Diagnostic,
  type CompletionItem,
  type Hover,
} from "vscode-languageserver";
import {
  getDiagnostics,
  getCompletions,
  getHover,
  type CompletionKind,
} from "movit-language";

export function toDiagnostics(text: string): Diagnostic[] {
  const lines = text.split(/\r?\n/);
  return getDiagnostics(text).map((d): Diagnostic => {
    const lineText = lines[d.line - 1] ?? "";
    return {
      range: {
        start: { line: d.line - 1, character: 0 },
        end: { line: d.line - 1, character: lineText.length },
      },
      severity:
        d.severity === "error"
          ? DiagnosticSeverity.Error
          : DiagnosticSeverity.Warning,
      source: "movit",
      message: d.message,
    };
  });
}

const KIND_MAP: Record<CompletionKind, CompletionItemKind> = {
  keyword: CompletionItemKind.Keyword,
  kind: CompletionItemKind.TypeParameter,
  pose: CompletionItemKind.Constant,
  easing: CompletionItemKind.Constant,
  joint: CompletionItemKind.Variable,
  action: CompletionItemKind.Function,
  effector: CompletionItemKind.Constant,
};

export function toCompletions(
  text: string,
  line: number,
  character: number,
): CompletionItem[] {
  return getCompletions(text, line, character).map((c): CompletionItem => ({
    label: c.label,
    kind: KIND_MAP[c.kind],
    ...(c.detail ? { detail: c.detail } : {}),
  }));
}

export function toHover(
  text: string,
  line: number,
  character: number,
): Hover | null {
  const info = getHover(text, line, character);
  if (!info) return null;
  return { contents: { kind: MarkupKind.Markdown, value: info.contents } };
}
