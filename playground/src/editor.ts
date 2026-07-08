/**
 * The Posecode code editor: a CodeMirror 6 setup that turns the plain textarea
 * into a real editor: syntax highlighting, inline ROM/error squiggles,
 * context-aware autocomplete, and hover docs. All language smarts come from
 * `posecode-language` (shared with the LSP), so the editor never reimplements them.
 */

import { EditorState, StateEffect, StateField } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  hoverTooltip,
  Decoration,
  type DecorationSet,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  StreamLanguage,
  LanguageSupport,
  syntaxHighlighting,
  HighlightStyle,
  bracketMatching,
} from "@codemirror/language";
import {
  autocompletion,
  completionKeymap,
  closeBrackets,
  closeBracketsKeymap,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { linter, lintGutter, type Diagnostic as CmDiagnostic } from "@codemirror/lint";
import { tags as t } from "@lezer/highlight";
import {
  getDiagnostics,
  getCompletions,
  getHover,
  type CompletionKind,
} from "posecode-language";

// --- Syntax highlighting ----------------------------------------------------

const KEYWORDS = new Set([
  "posecode",
  "rig",
  "pose",
  "start",
  "step",
  "repeat",
  "ground-lock",
  "cue",
  "hold",
]);
const KINDS = new Set(["exercise", "stretch", "posture"]);
const ACTIONS = new Set([
  "flex",
  "extend",
  "abduct",
  "adduct",
  "rotate-in",
  "rotate-out",
  "supinate",
  "pronate",
  "dorsiflex",
  "plantarflex",
]);
const ATOMS = new Set([
  "linear",
  "ease-in",
  "ease-out",
  "ease-in-out",
  "neutral",
  "standing",
  "plank",
  "hands",
  "feet",
  "humanoid",
]);
const JOINTS = new Set([
  "shoulders",
  "elbows",
  "wrists",
  "hips",
  "knees",
  "ankles",
  "pelvis",
  "spine",
  "chest",
  "neck",
  "head",
]);

const posecodeStream = StreamLanguage.define<{ inStep: boolean }>({
  name: "posecode",
  startState: () => ({ inStep: false }),
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match(/^(#|\/\/).*$/)) return "comment";
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return "string";
    if (stream.match(/^[0-9]*\.?[0-9]+s\b/)) return "number"; // duration (2s)
    if (stream.match(/^-?[0-9]*\.?[0-9]+/)) return "number";
    if (stream.match(/^[:,=]/)) return "punct";
    const m = stream.match(/^[A-Za-z][\w-]*/) as RegExpMatchArray | null;
    if (m) {
      const w = m[0];
      if (KEYWORDS.has(w)) return "kw";
      if (KINDS.has(w)) return "kind";
      if (ACTIONS.has(w)) return "action";
      if (JOINTS.has(w) || /_(left|right)$/.test(w)) return "joint";
      if (ATOMS.has(w)) return "atom";
      return null;
    }
    stream.next();
    return null;
  },
  tokenTable: {
    kw: t.keyword,
    kind: t.typeName,
    action: t.operatorKeyword,
    joint: t.variableName,
    atom: t.atom,
    number: t.number,
    string: t.string,
    comment: t.lineComment,
    punct: t.punctuation,
  },
  languageData: { commentTokens: { line: "#" } },
});

const posecodeHighlight = HighlightStyle.define([
  { tag: t.keyword, color: "var(--accent)", fontWeight: "600" },
  { tag: t.typeName, color: "#79c0ff" },
  { tag: t.operatorKeyword, color: "#ffcc66" },
  { tag: t.variableName, color: "#c0a7ff" },
  { tag: t.atom, color: "#5cd0c0" },
  { tag: t.number, color: "#ff9d6b" },
  { tag: t.string, color: "#d8b48a" },
  { tag: t.lineComment, color: "#5b6675", fontStyle: "italic" },
  { tag: t.punctuation, color: "#6b7785" },
]);

// --- Language service bridges ----------------------------------------------

const posecodeLinter = linter(
  (view) => {
    const doc = view.state.doc;
    return getDiagnostics(doc.toString()).map((d): CmDiagnostic => {
      const lineNo = Math.min(Math.max(d.line, 1), doc.lines);
      const line = doc.line(lineNo);
      return { from: line.from, to: line.to, severity: d.severity, message: d.message };
    });
  },
  { delay: 300 },
);

const CM_TYPE: Record<CompletionKind, string> = {
  keyword: "keyword",
  kind: "type",
  pose: "constant",
  easing: "constant",
  joint: "variable",
  action: "function",
  effector: "constant",
};

function posecodeCompletions(context: CompletionContext): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos);
  const items = getCompletions(
    context.state.doc.toString(),
    line.number - 1,
    context.pos - line.from,
  );
  if (items.length === 0) return null;
  const token = context.matchBefore(/[\w-]*/);
  if (!context.explicit && token && token.from === token.to) return null;
  return {
    from: token ? token.from : context.pos,
    options: items.map((i) => ({
      label: i.label,
      type: CM_TYPE[i.kind],
      ...(i.detail ? { detail: i.detail } : {}),
    })),
    validFor: /^[\w-]*$/,
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;",
  );
}

const posecodeHoverTip = hoverTooltip((view, pos) => {
  const line = view.state.doc.lineAt(pos);
  const info = getHover(view.state.doc.toString(), line.number - 1, pos - line.from);
  if (!info) return null;
  return {
    pos,
    create() {
      const dom = document.createElement("div");
      dom.className = "cm-posecode-hover";
      // Contents are markdown from our own vocab (no user free-text): render bold.
      dom.innerHTML = escapeHtml(info.contents).replace(
        /\*\*(.+?)\*\*/g,
        "<strong>$1</strong>",
      );
      return { dom };
    },
  };
});

// --- Theme (Kinetic Lab dark) ----------------------------------------------

const posecodeTheme = EditorView.theme(
  {
    "&": { height: "100%", color: "var(--text)", backgroundColor: "transparent" },
    ".cm-scroller": {
      fontFamily: "var(--mono)",
      fontSize: "13.5px",
      lineHeight: "1.65",
    },
    ".cm-content": { padding: "16px 0", caretColor: "var(--accent)" },
    ".cm-gutters": {
      backgroundColor: "transparent",
      color: "var(--muted)",
      border: "none",
      paddingLeft: "6px",
    },
    ".cm-activeLine": { backgroundColor: "rgba(255,255,255,0.025)" },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--text-2)" },
    "&.cm-focused .cm-cursor": { borderLeftColor: "var(--accent)" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
      backgroundColor: "var(--accent-veil)",
    },
    ".cm-tooltip": {
      backgroundColor: "var(--panel-2)",
      border: "1px solid var(--border-2)",
      borderRadius: "8px",
      boxShadow: "var(--shadow-2)",
    },
    ".cm-posecode-hover": {
      padding: "8px 11px",
      fontFamily: "var(--sans)",
      fontSize: "12.5px",
      maxWidth: "320px",
      color: "var(--text-2)",
    },
    ".cm-posecode-hover strong": { color: "var(--text)" },
    ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
      backgroundColor: "var(--accent-veil)",
      color: "var(--text)",
    },
    ".cm-tooltip-autocomplete > ul > li": { fontFamily: "var(--mono)" },
    ".cm-completionDetail": { color: "var(--muted)", fontStyle: "normal" },
  },
  { dark: true },
);

// --- Active-phase highlight -------------------------------------------------
// As the figure animates, the playground highlights the step block driving the
// current moment, making the text↔motion mapping visible. Lines are 1-based.

const setPhaseHighlight = StateEffect.define<{ from: number; to: number } | null>();
const phaseLineDeco = Decoration.line({ class: "cm-phase-active" });

const phaseHighlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(setPhaseHighlight)) continue;
      const range = effect.value;
      if (!range) {
        deco = Decoration.none;
        continue;
      }
      const lastLine = tr.state.doc.lines;
      const marks = [];
      for (let n = Math.max(1, range.from); n <= Math.min(range.to, lastLine); n++) {
        marks.push(phaseLineDeco.range(tr.state.doc.line(n).from));
      }
      deco = Decoration.set(marks, true);
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// --- Public API -------------------------------------------------------------

export interface PosecodeEditor {
  getValue(): string;
  setValue(doc: string): void;
  focus(): void;
  /** Highlight an inclusive 1-based line range as the active phase; null clears. */
  highlightPhase(from: number | null, to?: number): void;
}

export interface PosecodeEditorOptions {
  doc: string;
  onChange: (value: string) => void;
}

export function createPosecodeEditor(
  parent: HTMLElement,
  opts: PosecodeEditorOptions,
): PosecodeEditor {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: opts.doc,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        drawSelection(),
        history(),
        bracketMatching(),
        closeBrackets(),
        new LanguageSupport(posecodeStream),
        syntaxHighlighting(posecodeHighlight),
        phaseHighlightField,
        autocompletion({ override: [posecodeCompletions], icons: false }),
        posecodeLinter,
        lintGutter(),
        posecodeHoverTip,
        posecodeTheme,
        EditorView.lineWrapping,
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...completionKeymap,
          indentWithTab,
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) opts.onChange(u.state.doc.toString());
        }),
      ],
    }),
  });

  // Dev-only handle for preview/E2E testing; stripped from production builds.
  if (import.meta.env.DEV) {
    (globalThis as unknown as { posecodeView?: EditorView }).posecodeView = view;
  }

  return {
    getValue: () => view.state.doc.toString(),
    setValue: (doc: string) => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: doc },
      });
    },
    focus: () => view.focus(),
    highlightPhase: (from: number | null, to?: number) => {
      view.dispatch({
        effects: setPhaseHighlight.of(
          from === null ? null : { from, to: to ?? from },
        ),
      });
    },
  };
}
