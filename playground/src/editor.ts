/**
 * The Posecode code editor: a CodeMirror 6 setup that turns the plain textarea
 * into a real editor: syntax highlighting, inline ROM/error squiggles,
 * context-aware autocomplete, and hover docs. All language smarts come from
 * `posecode-language` (shared with the LSP), so the editor never reimplements them.
 */

import {
  EditorState,
  StateEffect,
  StateField,
  Transaction,
} from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  hoverTooltip,
  placeholder,
  Decoration,
  WidgetType,
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
import {
  ACTION_NAMES,
  EFFECTOR_NAMES,
  GROUND_LOCK_EFFECTOR_NAMES,
  JOINT_NAMES,
  MODES,
  MOVEMENT_KINDS,
  PROP_TYPES,
  RIG_NAMES,
  START_POSE_NAMES,
  expandJoint,
} from "posecode-parser";
import {
  angleRangeFor,
  angleTargetAt,
  findAngleTargets,
  normalizeAngle,
  type AngleTarget,
} from "./direct-manipulation.js";

// --- Syntax highlighting ----------------------------------------------------

const KEYWORDS = new Set([
  "posecode",
  "rig",
  "prop",
  "pose",
  "start",
  "clip",
  "step",
  "repeat",
  "ground-lock",
  "reach",
  "pin",
  "grip",
  "turn",
  "travel",
  "cue",
  "hold",
]);
const KINDS = new Set<string>(MOVEMENT_KINDS);
const ACTIONS = new Set<string>(ACTION_NAMES);
const ATOMS = new Set([
  ...MODES,
  "ease-in",
  "ease-out",
  "ease-in-out",
  ...START_POSE_NAMES,
  ...PROP_TYPES,
  ...EFFECTOR_NAMES,
  ...GROUND_LOCK_EFFECTOR_NAMES,
  ...RIG_NAMES,
]);
const JOINTS = new Set<string>(JOINT_NAMES);

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
  rig: "constant",
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
    ".cm-joint-link": {
      cursor: "pointer",
      borderBottom: "1px dotted rgba(192, 167, 255, 0.72)",
      borderRadius: "2px",
      transition: "color 120ms ease, background-color 120ms ease",
    },
    ".cm-joint-link:hover": {
      color: "#dfd2ff",
      backgroundColor: "rgba(192, 167, 255, 0.12)",
    },
    ".cm-joint-selected": {
      color: "var(--accent)",
      backgroundColor: "rgba(212, 255, 63, 0.11)",
      borderBottomColor: "var(--accent)",
    },
    ".cm-angle-control": {
      cursor: "pointer",
      color: "#ffb184",
      borderBottom: "1px dotted rgba(255, 157, 107, 0.78)",
      borderRadius: "2px",
    },
    ".cm-angle-control:hover": {
      color: "#ffd1b7",
      backgroundColor: "rgba(255, 157, 107, 0.12)",
    },
    ".cm-angle-spinner": {
      display: "inline-flex",
      alignItems: "center",
      verticalAlign: "middle",
      margin: "0 2px",
      height: "25px",
      color: "var(--text)",
      backgroundColor: "var(--panel-3)",
      border: "1px solid var(--accent)",
      borderRadius: "3px",
      boxShadow: "0 0 0 2px rgba(212, 255, 63, 0.08)",
      overflow: "hidden",
    },
    ".cm-angle-input": {
      width: "5.2ch",
      height: "100%",
      padding: "0 2px 0 5px",
      border: "0",
      outline: "0",
      color: "var(--text)",
      backgroundColor: "transparent",
      fontFamily: "var(--mono)",
      fontSize: "12.5px",
      textAlign: "right",
    },
    ".cm-angle-degree": {
      paddingRight: "3px",
      color: "var(--text-2)",
      fontSize: "11px",
    },
    ".cm-angle-step": {
      width: "22px",
      height: "100%",
      padding: "0",
      border: "0",
      borderRadius: "0",
      color: "var(--text-2)",
      backgroundColor: "transparent",
      fontFamily: "var(--mono)",
      fontSize: "14px",
      cursor: "pointer",
    },
    ".cm-angle-step:hover": {
      color: "var(--bg)",
      backgroundColor: "var(--accent)",
    },
    ".cm-angle-step:focus-visible, .cm-angle-input:focus-visible": {
      outline: "1px solid var(--text)",
      outlineOffset: "-2px",
    },
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

// --- Direct manipulation ---------------------------------------------------
// Joint names and authored degree values are live controls rather than inert
// syntax. Clicking a joint selects its concrete bones in the viewer; clicking
// the angle replaces only that number with a compact, ROM-aware spinner.

const setSelectedJoint = StateEffect.define<string | null>();
const setActiveAngle = StateEffect.define<AngleTarget | null>();

const selectedJointField = StateField.define<string | null>({
  create: () => null,
  update(selected, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setSelectedJoint)) selected = effect.value;
    }
    if (
      selected &&
      tr.docChanged &&
      !findAngleTargets(tr.state.doc.toString()).some(
        (target) => target.joint === selected,
      )
    ) {
      return null;
    }
    return selected;
  },
});

const activeAngleField = StateField.define<AngleTarget | null>({
  create: () => null,
  update(active, tr) {
    if (active && tr.docChanged) {
      const mapped = tr.changes.mapPos(active.angleFrom, 1);
      active = angleTargetAt(tr.state.doc.toString(), mapped, "angle");
    }
    for (const effect of tr.effects) {
      if (effect.is(setActiveAngle)) active = effect.value;
    }
    return active;
  },
});

function replaceActiveAngle(view: EditorView, requested: number): void {
  const active = view.state.field(activeAngleField);
  if (!active || !Number.isFinite(requested)) return;
  const range = angleRangeFor(active.joint, active.action);
  if (!range) return;
  const insert = normalizeAngle(requested, range);
  const current = view.state.doc.sliceString(active.angleFrom, active.angleTo);
  if (insert === current) return;
  view.dispatch({
    changes: {
      from: active.angleFrom,
      to: active.angleTo,
      insert,
    },
    effects: setActiveAngle.of({
      ...active,
      degrees: Number(insert),
      angleTo: active.angleFrom + insert.length,
    }),
    annotations: Transaction.userEvent.of("input"),
  });
}

class AngleSpinnerWidget extends WidgetType {
  constructor(
    readonly target: AngleTarget,
    readonly min: number,
    readonly max: number,
  ) {
    super();
  }

  eq(other: AngleSpinnerWidget): boolean {
    return (
      other.target.joint === this.target.joint &&
      other.target.action === this.target.action &&
      other.target.degrees === this.target.degrees &&
      other.min === this.min &&
      other.max === this.max
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const control = document.createElement("span");
    control.className = "cm-angle-spinner";
    control.title = `Safe range: ${this.min}–${this.max}°`;

    const minus = document.createElement("button");
    minus.type = "button";
    minus.className = "cm-angle-step";
    minus.textContent = "−";
    minus.setAttribute("aria-label", `Decrease ${this.target.joint} angle`);

    const input = document.createElement("input");
    input.type = "number";
    input.className = "cm-angle-input";
    input.min = String(this.min);
    input.max = String(this.max);
    input.step = "1";
    input.value = String(this.target.degrees);
    input.setAttribute(
      "aria-label",
      `${this.target.joint} ${this.target.action} angle in degrees; safe range ${this.min} to ${this.max}`,
    );

    const degree = document.createElement("span");
    degree.className = "cm-angle-degree";
    degree.textContent = "°";
    degree.setAttribute("aria-hidden", "true");

    const plus = document.createElement("button");
    plus.type = "button";
    plus.className = "cm-angle-step";
    plus.textContent = "+";
    plus.setAttribute("aria-label", `Increase ${this.target.joint} angle`);

    const step = (delta: number): void => {
      const current = Number(input.value);
      replaceActiveAngle(
        view,
        (Number.isFinite(current) ? current : this.target.degrees) + delta,
      );
    };
    minus.addEventListener("click", () => step(-1));
    plus.addEventListener("click", () => step(1));
    input.addEventListener("input", () => {
      if (input.value !== "") replaceActiveAngle(view, Number(input.value));
    });
    input.addEventListener("change", () => {
      if (input.value === "") input.value = String(this.target.degrees);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      view.dispatch({ effects: setActiveAngle.of(null) });
      view.focus();
    });

    control.append(minus, input, degree, plus);
    window.setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
    return control;
  }

  updateDOM(dom: HTMLElement): boolean {
    const input = dom.querySelector<HTMLInputElement>(".cm-angle-input");
    if (!input) return false;
    input.min = String(this.min);
    input.max = String(this.max);
    if (document.activeElement !== input) {
      input.value = String(this.target.degrees);
    }
    dom.title = `Safe range: ${this.min}–${this.max}°`;
    return true;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

const directManipulationDecorations = EditorView.decorations.compute(
  ["doc", selectedJointField, activeAngleField],
  (state) => {
    const selected = state.field(selectedJointField);
    const active = state.field(activeAngleField);
    const marks = [];
    for (const target of findAngleTargets(state.doc.toString())) {
      marks.push(
        Decoration.mark({
          class: `cm-joint-link${
            selected === target.joint ? " cm-joint-selected" : ""
          }`,
          attributes: {
            "data-posecode-joint": target.joint,
            title: `Select ${target.joint} in the 3D viewer`,
          },
        }).range(target.jointFrom, target.jointTo),
      );
      if (
        !active ||
        active.angleFrom !== target.angleFrom ||
        active.angleTo !== target.angleTo
      ) {
        marks.push(
          Decoration.mark({
            class: "cm-angle-control",
            attributes: {
              "data-posecode-angle": "true",
              title: `Adjust ${target.joint} ${target.action}`,
            },
          }).range(target.angleFrom, target.angleTo),
        );
      }
    }
    return Decoration.set(marks, true);
  },
);

const angleSpinnerDecoration = EditorView.decorations.compute(
  [activeAngleField],
  (state) => {
    const active = state.field(activeAngleField);
    if (!active) return Decoration.none;
    const range = angleRangeFor(active.joint, active.action);
    if (!range) return Decoration.none;
    return Decoration.set([
      Decoration.replace({
        widget: new AngleSpinnerWidget(active, range.min, range.max),
      }).range(active.angleFrom, active.angleTo),
    ]);
  },
);

// --- Public API -------------------------------------------------------------

export interface PosecodeEditor {
  getValue(): string;
  setValue(doc: string): void;
  focus(): void;
  /** Reveal and focus a direct angle spinner for the requested joint action. */
  focusAngleControl(joint: string, action: string): boolean;
  /** Highlight an inclusive 1-based line range as the active phase; null clears. */
  highlightPhase(from: number | null, to?: number): void;
}

export interface PosecodeEditorOptions {
  doc: string;
  onChange: (
    value: string,
    userInitiated: boolean,
    context?: { previewLine: number },
  ) => void;
  onJointSelect?: (joint: string | null, boneIds: readonly string[]) => void;
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
        selectedJointField,
        activeAngleField,
        directManipulationDecorations,
        angleSpinnerDecoration,
        autocompletion({ override: [posecodeCompletions], icons: false }),
        posecodeLinter,
        lintGutter(),
        posecodeHoverTip,
        posecodeTheme,
        // Shown only while the document is empty: guides the paste-from-LLM flow.
        placeholder(
          'Paste a movement from your AI chat here, or start typing:\nposecode exercise "My movement"',
        ),
        EditorView.lineWrapping,
        EditorView.domEventHandlers({
          click(event, targetView) {
            const element = (event.target as Element | null)?.closest<HTMLElement>(
              "[data-posecode-joint], [data-posecode-angle]",
            );
            if (!element || !targetView.dom.contains(element)) {
              targetView.dispatch({
                effects: [
                  setSelectedJoint.of(null),
                  setActiveAngle.of(null),
                ],
              });
              opts.onJointSelect?.(null, []);
              return false;
            }

            const part = element.dataset.posecodeAngle ? "angle" : "joint";
            const position = targetView.posAtDOM(element, 0);
            const target = angleTargetAt(
              targetView.state.doc.toString(),
              position,
              part,
            );
            if (!target) return false;

            const selectionFrom =
              part === "angle" ? target.angleFrom : target.jointFrom;
            const selectionTo =
              part === "angle" ? target.angleTo : target.jointTo;
            targetView.dispatch({
              selection: { anchor: selectionFrom, head: selectionTo },
              effects: [
                setSelectedJoint.of(target.joint),
                setActiveAngle.of(part === "angle" ? target : null),
              ],
            });
            opts.onJointSelect?.(target.joint, expandJoint(target.joint));
            return true;
          },
        }),
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...completionKeymap,
          indentWithTab,
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) {
            const userInitiated = u.transactions.some(
              (transaction) =>
                transaction.annotation(Transaction.userEvent) !== undefined,
            );
            // Spinner edits are different from ordinary source typing: the
            // author is manipulating one key pose and expects to see that pose
            // immediately. Pass its resulting source line to the playground;
            // main.ts will seek there after rebuilding the timeline.
            const directAngleEdit = u.transactions.some((transaction) =>
              transaction.effects.some(
                (effect) => effect.is(setActiveAngle) && effect.value !== null,
              ),
            );
            const activeAngle = directAngleEdit
              ? u.state.field(activeAngleField)
              : null;
            opts.onChange(
              u.state.doc.toString(),
              userInitiated,
              activeAngle
                ? { previewLine: u.state.doc.lineAt(activeAngle.angleFrom).number }
                : undefined,
            );
          }
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
        effects: [
          setSelectedJoint.of(null),
          setActiveAngle.of(null),
        ],
      });
      opts.onJointSelect?.(null, []);
    },
    focus: () => view.focus(),
    focusAngleControl: (joint: string, action: string) => {
      const target = findAngleTargets(view.state.doc.toString()).find(
        (candidate) =>
          candidate.joint === joint && candidate.action === action,
      );
      if (!target) return false;
      view.dispatch({
        selection: { anchor: target.angleFrom, head: target.angleTo },
        effects: [
          setSelectedJoint.of(target.joint),
          setActiveAngle.of(target),
          EditorView.scrollIntoView(target.angleFrom, { y: "center" }),
        ],
      });
      opts.onJointSelect?.(target.joint, expandJoint(target.joint));
      return true;
    },
    highlightPhase: (from: number | null, to?: number) => {
      view.dispatch({
        effects: setPhaseHighlight.of(
          from === null ? null : { from, to: to ?? from },
        ),
      });
    },
  };
}
