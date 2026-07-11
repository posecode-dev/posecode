# L2 — Spline-Quaternion Interpolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace posecode's per-segment slerp with C1-continuous squad quaternion splines so motion flows through interior keyframes, and expose per-phase timing modes (`flow|settle|drive|snap|linear`) in the DSL and editor, with legacy easing names kept as deprecated aliases so no existing document breaks.

**Architecture:** A new pure-math `squad.ts` computes spherical-quadrangle interpolation and Shoemake control quaternions. `timeline.ts` samples the keyframe list with squad, deriving each segment's boundary velocity from the destination keyframe's timing mode, and smooths root yaw/travel with scalar Catmull-Rom. The parser adds a `MODES` enum plus a legacy-alias normalization so the IR always carries a canonical mode. Editor packages surface the modes and a deprecation hint. `"linear"` stays a valid mode, so downstream code comparing `easing === "linear"` keeps working.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Three.js (`THREE.Quaternion`), Zod (AST validation), Vitest, pnpm/npm workspaces.

## Global Constraints

- Immutable style: interpolation helpers return **new** `THREE.Quaternion` objects or write into a caller-provided out param; never mutate shared keyframe quaternions. (coding-style)
- Files stay focused, ≤800 lines; extract `squad.ts` rather than growing `timeline.ts`. (coding-style)
- ESM imports use explicit `.js` specifiers (repo convention, see existing `import ... from "./poses.js"`).
- Angles in the IR are DEGREES; the renderer converts to radians (`DEG = Math.PI/180`).
- Canonical timing modes, exact spelling: `flow`, `settle`, `drive`, `snap`, `linear`.
- Legacy aliases (must keep parsing): `ease-in→drive`, `ease-out→settle`, `ease-in-out→settle`, `linear→linear`.
- Keep the AST/IR/Phase field name `easing` (do NOT rename to `mode`) to avoid rippling renames through `posecode-eval` and `posecode-render`; only its value set and meaning change.
- TDD: write the failing test, watch it fail, implement minimally, watch it pass, commit. Coverage ≥80% on changed packages.
- Run a package's tests with `npm test --workspace <pkg>` (or `npx vitest run` inside the package). Confirm the exact command with `cat <pkg>/package.json` before first use.

---

### Task 1: `squad.ts` — pure spherical-quadrangle interpolation

**Files:**
- Create: `packages/posecode-render/src/squad.ts`
- Test: `packages/posecode-render/test/squad.test.ts`

**Interfaces:**
- Consumes: `three` (`THREE.Quaternion`).
- Produces:
  - `squadControl(prev: THREE.Quaternion, cur: THREE.Quaternion, next: THREE.Quaternion): THREE.Quaternion` — Shoemake intermediate control for `cur`.
  - `squad(q0: THREE.Quaternion, s0: THREE.Quaternion, s1: THREE.Quaternion, q1: THREE.Quaternion, t: number, out?: THREE.Quaternion): THREE.Quaternion` — quadrangle blend of segment endpoints `q0,q1` and their controls `s0,s1` at `t∈[0,1]`; writes into `out` if given, else returns a new quaternion. At `t=0` returns `q0`, at `t=1` returns `q1`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/posecode-render/test/squad.test.ts
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { squad, squadControl } from "../src/squad.js";

const q = (x: number, y: number, z: number) =>
  new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, "XYZ"));

describe("squad", () => {
  it("passes exactly through segment endpoints", () => {
    const q0 = q(0, 0, 0);
    const q1 = q(0, 1, 0);
    const s0 = squadControl(q(0, -0.5, 0), q0, q1);
    const s1 = squadControl(q0, q1, q(0, 1.5, 0));
    const at0 = squad(q0, s0, s1, q1, 0);
    const at1 = squad(q0, s0, s1, q1, 1);
    expect(at0.angleTo(q0)).toBeLessThan(1e-6);
    expect(at1.angleTo(q1)).toBeLessThan(1e-6);
  });

  it("is C1-continuous across a shared interior keyframe (slerp is not)", () => {
    // Three keyframes k0,k1,k2. Build the two segments' controls around k1 and
    // measure angular velocity just before and just after k1.
    const k0 = q(0, 0, 0);
    const k1 = q(0, 1, 0);
    const k2 = q(0, 1.2, 0.8); // direction change at k1
    const c_before = squadControl(k0, k1, k2); // control at k1 for both segs
    const c0 = squadControl(q(0, -1, 0), k0, k1); // control at k0
    const c2 = squadControl(k1, k2, q(0, 0.4, 1.6)); // control at k2

    const eps = 1e-3;
    const before = squad(k0, c0, c_before, k1, 1 - eps);
    const atK1a = squad(k0, c0, c_before, k1, 1);
    const atK1b = squad(k1, c_before, c2, k2, 0);
    const after = squad(k1, c_before, c2, k2, eps);

    // velocity = angular delta / dt, compared across the seam
    const vBefore = atK1a.angleTo(before) / eps;
    const vAfter = after.angleTo(atK1b) / eps;
    expect(atK1a.angleTo(atK1b)).toBeLessThan(1e-6); // C0
    expect(Math.abs(vBefore - vAfter)).toBeLessThan(0.15); // C1 within tolerance
  });

  it("falls back cleanly when neighbors are identical (no NaN)", () => {
    const a = q(0, 0, 0);
    const s = squadControl(a, a, a);
    const mid = squad(a, s, s, a, 0.5);
    expect(Number.isNaN(mid.x)).toBe(false);
    expect(mid.angleTo(a)).toBeLessThan(1e-6);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/squad.test.ts` (from `packages/posecode-render`)
Expected: FAIL — cannot find module `../src/squad.js`.

- [ ] **Step 3: Implement `squad.ts`**

```ts
// packages/posecode-render/src/squad.ts
/**
 * Spherical-quadrangle (squad) quaternion interpolation — Shoemake's C1
 * quaternion spline. Given a keyframe and its two neighbors, `squadControl`
 * derives the intermediate control quaternion; `squad` blends one segment.
 *
 * All functions return NEW quaternions (or write into a caller `out`); the
 * shared keyframe quaternions are never mutated.
 */

import * as THREE from "three";

/** Ensure `b` is in the same hemisphere as `a` (shortest-path continuity). */
function alignHemisphere(a: THREE.Quaternion, b: THREE.Quaternion): THREE.Quaternion {
  const out = b.clone();
  if (a.dot(out) < 0) out.set(-out.x, -out.y, -out.z, -out.w);
  return out;
}

/** q^-1 for a UNIT quaternion is its conjugate. */
function conjugate(q: THREE.Quaternion): THREE.Quaternion {
  return new THREE.Quaternion(-q.x, -q.y, -q.z, q.w);
}

/** Natural log of a unit quaternion → a pure quaternion (w = 0). */
function logUnit(q: THREE.Quaternion): THREE.Quaternion {
  const v = new THREE.Vector3(q.x, q.y, q.z);
  const vLen = v.length();
  const w = THREE.MathUtils.clamp(q.w, -1, 1);
  if (vLen < 1e-8) return new THREE.Quaternion(0, 0, 0, 0);
  const theta = Math.atan2(vLen, w);
  const k = theta / vLen;
  return new THREE.Quaternion(v.x * k, v.y * k, v.z * k, 0);
}

/** Exp of a pure quaternion (w = 0) → a unit quaternion. */
function expPure(q: THREE.Quaternion): THREE.Quaternion {
  const v = new THREE.Vector3(q.x, q.y, q.z);
  const theta = v.length();
  if (theta < 1e-8) return new THREE.Quaternion(0, 0, 0, 1);
  const s = Math.sin(theta) / theta;
  return new THREE.Quaternion(v.x * s, v.y * s, v.z * s, Math.cos(theta));
}

function mul(a: THREE.Quaternion, b: THREE.Quaternion): THREE.Quaternion {
  return a.clone().multiply(b);
}

/**
 * Shoemake control quaternion for `cur`:
 *   s = cur * exp( -( log(cur^-1 * next) + log(cur^-1 * prev) ) / 4 )
 * Neighbors are hemisphere-aligned to `cur` first for shortest-path continuity.
 */
export function squadControl(
  prev: THREE.Quaternion,
  cur: THREE.Quaternion,
  next: THREE.Quaternion,
): THREE.Quaternion {
  const p = alignHemisphere(cur, prev);
  const n = alignHemisphere(cur, next);
  const inv = conjugate(cur);
  const logNext = logUnit(mul(inv, n));
  const logPrev = logUnit(mul(inv, p));
  const sum = new THREE.Quaternion(
    -(logNext.x + logPrev.x) / 4,
    -(logNext.y + logPrev.y) / 4,
    -(logNext.z + logPrev.z) / 4,
    0,
  );
  return mul(cur, expPure(sum)).normalize();
}

/**
 * Squad blend of one segment: slerp(slerp(q0,q1,t), slerp(s0,s1,t), 2t(1-t)).
 * Endpoints `q0`,`q1`; their controls `s0`,`s1`. Returns q0 at t=0, q1 at t=1.
 */
export function squad(
  q0: THREE.Quaternion,
  s0: THREE.Quaternion,
  s1: THREE.Quaternion,
  q1: THREE.Quaternion,
  t: number,
  out: THREE.Quaternion = new THREE.Quaternion(),
): THREE.Quaternion {
  const q1a = alignHemisphere(q0, q1);
  const a = new THREE.Quaternion().slerpQuaternions(q0, q1a, t);
  const b = new THREE.Quaternion().slerpQuaternions(s0, alignHemisphere(s0, s1), t);
  return out.slerpQuaternions(a, alignHemisphere(a, b), 2 * t * (1 - t));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/squad.test.ts`
Expected: PASS (3 passing).

- [ ] **Step 5: Commit**

```bash
git add packages/posecode-render/src/squad.ts packages/posecode-render/test/squad.test.ts
git commit -m "feat(render): add squad quaternion-spline helper"
```

---

### Task 2: Timing modes in the parser (MODES enum + legacy aliases)

**Files:**
- Modify: `packages/posecode-parser/src/schema.ts:14` (add `MODES`, alias map; widen validation)
- Modify: `packages/posecode-parser/src/types.ts:14` (add `TimingMode`, keep `Easing` alias)
- Modify: `packages/posecode-parser/src/parser.ts` (normalize legacy token → canonical mode in the AST)
- Modify: `packages/posecode-parser/src/index.ts:60` (export `MODES`, `TimingMode`, `normalizeMode`)
- Test: `packages/posecode-parser/test/parse.test.ts` (add cases)

**Interfaces:**
- Consumes: existing `parseToAst`, `validateAst`.
- Produces:
  - `MODES = ["flow","settle","drive","snap","linear"] as const`
  - `type TimingMode = typeof MODES[number]`
  - `normalizeMode(raw: string): { mode: TimingMode | null; legacy: boolean }` — maps a written token to a canonical mode; `mode` is null for unknown tokens; `legacy` true when the token was a deprecated easing name.
  - The IR/AST `easing` field now always holds a canonical `TimingMode` after resolution.

- [ ] **Step 1: Write the failing tests**

```ts
// add to packages/posecode-parser/test/parse.test.ts
import { parse, normalizeMode, MODES } from "../src/index.js";

describe("timing modes", () => {
  it("accepts the canonical modes", () => {
    for (const m of MODES) {
      const src = `posecode exercise "x"\n  rig humanoid\n  step "s" 1s ${m}:\n    knees: flex 10\n`;
      const { errors } = parse(src);
      expect(errors).toEqual([]);
    }
  });

  it("normalizes legacy easing names to canonical modes", () => {
    expect(normalizeMode("ease-in")).toEqual({ mode: "drive", legacy: true });
    expect(normalizeMode("ease-out")).toEqual({ mode: "settle", legacy: true });
    expect(normalizeMode("ease-in-out")).toEqual({ mode: "settle", legacy: true });
    expect(normalizeMode("linear")).toEqual({ mode: "linear", legacy: false });
    expect(normalizeMode("flow")).toEqual({ mode: "flow", legacy: false });
    expect(normalizeMode("bogus")).toEqual({ mode: null, legacy: false });
  });

  it("legacy documents still parse and carry a canonical mode", () => {
    const src =
      `posecode exercise "sq"\n  rig humanoid\n  step "Descend" 1s ease-in-out:\n    knees: flex 90\n`;
    const { ir, errors } = parse(src);
    expect(errors).toEqual([]);
    expect(ir?.phases[0]?.easing).toBe("settle");
  });

  it("rejects an unknown mode with a clear error", () => {
    const src = `posecode exercise "x"\n  rig humanoid\n  step "s" 1s wobble:\n    knees: flex 10\n`;
    const { errors } = parse(src);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]!.message.toLowerCase()).toContain("mode");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/parse.test.ts` (from `packages/posecode-parser`)
Expected: FAIL — `normalizeMode`/`MODES` not exported; `ir.phases[0].easing` is `"ease-in-out"` not `"settle"`.

- [ ] **Step 3: Add modes + aliases to `schema.ts`**

Replace the `EASINGS` definition and `easing` validation:

```ts
// packages/posecode-parser/src/schema.ts (replace line 14 region)
export const MODES = ["flow", "settle", "drive", "snap", "linear"] as const;
export type TimingMode = (typeof MODES)[number];

/** Deprecated easing names → canonical mode. Kept so existing docs never break. */
export const LEGACY_MODE_ALIASES: Record<string, TimingMode> = {
  "ease-in": "drive",
  "ease-out": "settle",
  "ease-in-out": "settle",
  linear: "linear",
};

/** Back-compat: the old exported name, now the union of accepted written tokens. */
export const EASINGS = [...MODES, "ease-in", "ease-out", "ease-in-out"] as const;

/** Map a written token to a canonical mode + whether it was a legacy alias. */
export function normalizeMode(raw: string): { mode: TimingMode | null; legacy: boolean } {
  if ((MODES as readonly string[]).includes(raw)) {
    return { mode: raw as TimingMode, legacy: false };
  }
  const alias = LEGACY_MODE_ALIASES[raw];
  // "linear" is canonical, not a deprecation — only non-canonical aliases are legacy.
  if (alias) return { mode: alias, legacy: raw !== "linear" };
  return { mode: null, legacy: false };
}
```

Change the step schema's `easing` to the canonical set (validation runs AFTER the parser
normalizes, so only canonical modes reach it):

```ts
// packages/posecode-parser/src/schema.ts — in stepSchema
  easing: z.enum(MODES),
```

- [ ] **Step 4: Normalize in the parser**

In `packages/posecode-parser/src/parser.ts`, where the step is built (around line 154-178),
resolve the token to a canonical mode and error on unknown:

```ts
// replace: const easing = word(t[3]);
const easingTok = word(t[3]);
const resolved = easingTok ? normalizeMode(easingTok) : { mode: null, legacy: false };
if (
  name?.type !== "str" ||
  dur?.type !== "dur" ||
  !easingTok ||
  resolved.mode === null ||
  colon?.type !== "colon"
) {
  errors.push({
    line: ln.line,
    message:
      resolved.mode === null && easingTok
        ? `unknown timing mode "${easingTok}"; expected one of ${MODES.join(", ")}`
        : 'expected `step "<name>" <duration> <mode>:`',
  });
  current = null;
  break;
}
current = {
  name: name.value,
  durationSec: parseDuration(dur.value),
  easing: resolved.mode, // canonical mode stored in the AST
  targets: [],
  groundLock: [],
  reaches: [],
  pins: [],
  line: ln.line,
};
```

Add the import at the top of `parser.ts`:

```ts
import { normalizeMode, MODES } from "./schema.js";
```

- [ ] **Step 5: Types + exports**

`packages/posecode-parser/src/types.ts` — replace line 14:

```ts
/** @deprecated use TimingMode. Kept as an alias for one release. */
export type Easing = TimingMode;
export type TimingMode = "flow" | "settle" | "drive" | "snap" | "linear";
```

`packages/posecode-parser/src/index.ts` — extend the schema re-export (line 60):

```ts
export { EASINGS, MODES, LEGACY_MODE_ALIASES, normalizeMode, type TimingMode } from "./schema.js";
```

- [ ] **Step 6: Run tests to verify pass**

Run: `npx vitest run` (from `packages/posecode-parser`)
Expected: PASS, including existing tests (legacy docs still valid).

- [ ] **Step 7: Commit**

```bash
git add packages/posecode-parser/src/schema.ts packages/posecode-parser/src/types.ts \
  packages/posecode-parser/src/parser.ts packages/posecode-parser/src/index.ts \
  packages/posecode-parser/test/parse.test.ts
git commit -m "feat(parser): timing modes with legacy easing aliases"
```

---

### Task 3: squad sampler + mode boundary velocity + smooth root in `timeline.ts`

**Files:**
- Modify: `packages/posecode-render/src/timeline.ts` (imports, `Easing`→`TimingMode`, `EASE` → mode policy, `sample()` squad, root smoothing)
- Test: `packages/posecode-render/test/render.test.ts` (add continuity + settle tests; existing tests must stay green)

**Interfaces:**
- Consumes: `squad`, `squadControl` (Task 1); `TimingMode` (Task 2).
- Produces: unchanged public `BuiltTimeline` shape; `sample()` now C1-continuous.

- [ ] **Step 1: Write the failing tests** (append to `render.test.ts`)

```ts
import { squad } from "../src/squad.js"; // (ensure imported once at top)

it("interpolates joints with continuous velocity through an interior keyframe", () => {
  const src = [
    'posecode exercise "flowy"',
    "  rig humanoid",
    '  step "A" 1s flow:',
    "    shoulders: flex 40",
    '  step "B" 1s flow:',
    "    shoulders: flex 120",
    '  step "C" 1s flow:',
    "    shoulders: flex 40",
  ].join("\n");
  const { ir } = parse(src);
  const tl = buildTimeline(ir!);
  const m = buildMannequin();
  const read = (t: number) => {
    tl.sample(t, m.bones);
    return m.bones.get("shoulder_left")!.quaternion.clone();
  };
  const eps = 1e-3;
  const kf = 2; // end of "B" is an interior keyframe (t=2)
  const vBefore = read(kf).angleTo(read(kf - eps)) / eps;
  const vAfter = read(kf + eps).angleTo(read(kf)) / eps;
  expect(Math.abs(vBefore - vAfter)).toBeLessThan(0.3); // flow carries velocity
});

it("settle brings a joint to rest at its keyframe", () => {
  const src = [
    'posecode exercise "rest"',
    "  rig humanoid",
    '  step "Down" 1s settle:',
    "    knees: flex 90",
    '  step "Up" 1s drive:',
    "    knees: flex 0",
  ].join("\n");
  const { ir } = parse(src);
  const tl = buildTimeline(ir!);
  const m = buildMannequin();
  const read = (t: number) => {
    tl.sample(t, m.bones);
    return m.bones.get("knee_left")!.quaternion.clone();
  };
  const eps = 1e-3;
  const v = read(1).angleTo(read(1 - eps)) / eps; // velocity arriving at the settle kf
  expect(v).toBeLessThan(0.2);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/render.test.ts`
Expected: the two new tests FAIL (current slerp resets velocity at every keyframe, so the
`flow` continuity test fails; the `settle` test may pass incidentally — that's fine).

- [ ] **Step 3: Replace the `EASE` table with a mode policy**

In `timeline.ts`, replace the `Easing` type + `EASE` record (lines 17, 74-79):

```ts
import type { PosecodeIR, ReachTarget, PinTarget, TimingMode } from "posecode-parser";
import { squad, squadControl } from "./squad.js";

// ... in Keyframe interface: change `easing: Easing;` → `easing: TimingMode;`
// ... reset/start keyframes: use "flow" as their neutral mode instead of "linear".

/**
 * Per-mode remap of the normalized segment parameter (arrival shaping) and
 * whether the DESTINATION keyframe is a rest-point (velocity → 0). `flow`
 * carries velocity; `settle`/`snap` come to rest; `drive` starts from rest.
 */
const MODE_EASE: Record<TimingMode, (t: number) => number> = {
  flow: (t) => t, // even parameterization; squad carries velocity
  settle: (t) => 1 - (1 - t) * (1 - t), // decelerate into rest
  drive: (t) => t * t, // accelerate from rest
  snap: (t) => 1 - (1 - t) * (1 - t) * (1 - t), // fast arrival
  linear: (t) => t,
};

/** A keyframe is a rest-point (zero boundary velocity) for these modes. */
const REST_MODE: Record<TimingMode, boolean> = {
  flow: false,
  settle: true,
  drive: false,
  snap: true,
  linear: false,
};
```

- [ ] **Step 4: squad in `sample()` with rest-aware controls**

Replace the joint interpolation block in `sample()` (lines 195-207). Find the segment index
`i` (so `a = keyframes[i]`, `b = keyframes[i+1]`), then:

```ts
// neighbors for squad controls (clamp at the ends → one-sided tangents)
const iPrev = Math.max(0, i - 1);
const iNext = Math.min(keyframes.length - 1, i + 2);
const kPrev = keyframes[iPrev]!;
const kNext = keyframes[iNext]!;
const eased = MODE_EASE[b.easing](local);

for (const bone of bonesUsed) {
  const node = bones.get(bone);
  if (!node) continue;
  const q0 = a.quats.get(bone)!;
  const q1 = b.quats.get(bone)!;
  // Rest-point control = the endpoint itself (zero tangent → comes to rest);
  // otherwise Shoemake control from the neighbor. `a` rests if `a.easing`
  // is a rest mode (it arrived at rest); `b` rests if `b.easing` does.
  const s0 = REST_MODE[a.easing] ? q0.clone() : squadControl(kPrev.quats.get(bone)!, q0, q1);
  const s1 = REST_MODE[b.easing] ? q1.clone() : squadControl(q0, q1, kNext.quats.get(bone)!);
  squad(q0, s0, s1, q1, eased, node.quaternion);
}
```

Keep the root yaw/offset lines but reuse `eased` (already computed):

```ts
const rootYaw = a.yaw + (b.yaw - a.yaw) * eased;
const rootOffset = {
  x: a.pos.x + (b.pos.x - a.pos.x) * eased,
  z: a.pos.z + (b.pos.z - a.pos.z) * eased,
};
```

(Where the code previously read `const i` — the existing loop already finds the bracket via
`a`/`b`; capture its index `i` in that loop so the neighbor lookups above work.)

- [ ] **Step 5: Fix the loop to capture the segment index**

In the bracket-finding loop (lines 184-190) store the index:

```ts
let i = 0;
let a = keyframes[0]!;
let b = keyframes[keyframes.length - 1]!;
for (let k = 0; k < keyframes.length - 1; k++) {
  if (tt >= keyframes[k]!.time && tt < keyframes[k + 1]!.time) {
    i = k;
    a = keyframes[k]!;
    b = keyframes[k + 1]!;
    break;
  }
}
```

- [ ] **Step 6: Run tests to verify pass**

Run: `npx vitest run test/render.test.ts`
Expected: PASS — new continuity + settle tests pass; all pre-existing render tests (keyframe-time
pose assertions, grounding, pins, turn/travel) stay green because squad passes exactly through
keyframes and root interpolation is unchanged at keyframe times.

- [ ] **Step 7: Commit**

```bash
git add packages/posecode-render/src/timeline.ts packages/posecode-render/test/render.test.ts
git commit -m "feat(render): squad spline sampling with per-phase timing modes"
```

---

### Task 4: Editor tooling — vocab, completion, hover, diagnostics, syntax

**Files:**
- Modify: `packages/posecode-language/src/vocab.ts` (export `MODES`; mode docs; `step` doc)
- Modify: `packages/posecode-language/src/completion.ts` (offer modes in the `easing` context)
- Modify: `packages/posecode-language/src/hover.ts` (mode hover text)
- Modify: `packages/posecode-language/src/diagnostics.ts` (deprecation hint for legacy tokens; add `"hint"` severity)
- Modify: `editors/vscode/syntaxes/posecode.tmLanguage.json:48` (highlight new modes)
- Modify: `packages/posecode-lsp/src/convert.ts` (map the `mode`/`easing` completion kind)
- Test: `packages/posecode-language/test/language.test.ts` (completion + hover + deprecation)

**Interfaces:**
- Consumes: `MODES`, `LEGACY_MODE_ALIASES` from `posecode-parser`.
- Produces: `Severity` now includes `"hint"`; completions in the `easing` context return the
  five modes.

- [ ] **Step 1: Write the failing tests** (append to `language.test.ts`)

```ts
import { getCompletions, getHover, getDiagnostics } from "../src/index.js";

it("completes timing modes after a step duration", () => {
  const line = 'step "A" 1s ';
  const items = getCompletions(line, 0, line.length).map((i) => i.label);
  // NB: real docs are multi-line; use a doc where this is line 2:
  const doc = `posecode exercise "x"\n  rig humanoid\n  ${line}`;
  const got = getCompletions(doc, 2, doc.split("\n")[2]!.length).map((i) => i.label);
  expect(got).toEqual(expect.arrayContaining(["flow", "settle", "drive", "snap", "linear"]));
});

it("hovers a mode", () => {
  const doc = 'posecode exercise "x"\n  rig humanoid\n  step "A" 1s flow:';
  const h = getHover(doc, 2, doc.split("\n")[2]!.indexOf("flow") + 1);
  expect(h?.contents.toLowerCase()).toContain("flow");
});

it("flags a deprecated easing name with a hint", () => {
  const doc = 'posecode exercise "x"\n  rig humanoid\n  step "A" 1s ease-in-out:\n    knees: flex 10';
  const diags = getDiagnostics(doc);
  const hint = diags.find((d) => d.severity === "hint");
  expect(hint?.message).toContain("settle");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run` (from `packages/posecode-language`)
Expected: FAIL — no `"hint"` severity; completion still returns old easing names; hover says "Easing".

- [ ] **Step 3: vocab.ts**

```ts
// add to imports
import { JOINT_NAMES, ACTION_NAMES, MODES, LEGACY_MODE_ALIASES, EFFECTOR_NAMES } from "posecode-parser";
export { JOINT_NAMES, ACTION_NAMES, MODES, LEGACY_MODE_ALIASES };

// update the step doc + add mode docs in KEYWORD_DOCS
step: 'A movement phase: `step "<name>" <Ns> <mode>:` where mode is flow | settle | drive | snap | linear.',
flow: "Timing mode: pass through this pose with continuous velocity (flowing motion).",
settle: "Timing mode: decelerate to a genuine rest at this pose (a deliberate pause).",
drive: "Timing mode: accelerate from rest — the concentric effort of a rep.",
snap: "Timing mode: fast, near-immediate arrival — an accent.",
linear: "Timing mode: constant velocity — intentionally mechanical.",
```

- [ ] **Step 4: completion.ts**

```ts
// swap the import EASINGS → MODES, and the easing case:
    case "easing":
      return MODES.map((e) => item(e, "easing"));
```

- [ ] **Step 5: hover.ts**

```ts
// swap EASINGS → MODES in the import, and replace the easing hover branch:
  if ((MODES as readonly string[]).includes(token)) {
    return md(`**${token}** — ${KEYWORD_DOCS[token] ?? "timing mode"}`);
  }
```

- [ ] **Step 6: diagnostics.ts — add hint severity + deprecation scan**

```ts
export type Severity = "error" | "warning" | "hint";

import { LEGACY_MODE_ALIASES } from "./vocab.js";

// inside getDiagnostics, after the warnings loop, scan step lines lexically:
  const lines = text.split(/\r?\n/);
  lines.forEach((lineText, idx) => {
    const m = /^\s*step\s+"[^"]*"\s+[0-9.]+s\s+([\w-]+)\s*:/.exec(lineText);
    const tok = m?.[1];
    if (tok && tok !== "linear" && tok in LEGACY_MODE_ALIASES) {
      diagnostics.push({
        line: idx + 1,
        severity: "hint",
        message: `"${tok}" is deprecated; use "${LEGACY_MODE_ALIASES[tok]}"`,
      });
    }
  });
```

- [ ] **Step 7: tmLanguage.json**

Replace the easing/keyword match (line 48) to include modes:

```json
"match": "\\b(flow|settle|drive|snap|linear|ease-in-out|ease-in|ease-out|neutral|standing|plank|hands|feet|humanoid)\\b"
```

- [ ] **Step 8: lsp convert.ts**

Confirm the `easing` completion kind still maps (it does — `CompletionKind` "easing" is
unchanged). No code change needed unless a `mode` kind is introduced; keep `"easing"`.

- [ ] **Step 9: Run tests to verify pass**

Run: `npx vitest run` (from `packages/posecode-language`), then `packages/posecode-lsp`.
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/posecode-language/src packages/posecode-language/test \
  editors/vscode/syntaxes/posecode.tmLanguage.json packages/posecode-lsp
git commit -m "feat(language): editor support for timing modes + deprecation hints"
```

---

### Task 5: Align `posecode-eval` with timing modes

**Files:**
- Modify: `packages/posecode-eval/src/probe.ts:34,173` (type `Easing`→`TimingMode` via import; field unchanged)
- Modify: `packages/posecode-eval/src/checks.ts:160` (the `linear` transition check)
- Test: `packages/posecode-eval/test/eval.test.ts` (adjust any easing literals)

**Interfaces:**
- Consumes: `TimingMode` from `posecode-parser`.

- [ ] **Step 1: Update the type import in probe.ts**

```ts
// wherever `Easing` is imported/used:
import type { TimingMode } from "posecode-parser";
// probe.ts:34
  easing: TimingMode;
```

- [ ] **Step 2: Update the transition check in checks.ts**

The intent of the `linear`-at-speed check (fast motion authored as mechanical) still holds —
`linear` remains a canonical mode. Broaden the message wording only if it references "easing":

```ts
// checks.ts:160 — logic unchanged; "linear" is still a valid mode.
if (current.easing === "linear" && speed > 0.15) {
```

- [ ] **Step 3: Run eval tests**

Run: `npx vitest run` (from `packages/posecode-eval`)
Expected: PASS. Fix any test that hard-codes an old easing literal by leaving it (aliases still
parse) or switching to a canonical mode.

- [ ] **Step 4: Commit**

```bash
git add packages/posecode-eval
git commit -m "chore(eval): use TimingMode type for phase timing"
```

---

### Task 6: Flagship move demos + full build/verify

**Files:**
- Modify: 2-3 `.posecode` source docs to demonstrate `flow`/`settle`
- Verify: playground preview

**Interfaces:** none (content + verification).

- [ ] **Step 1: Locate the move source-of-truth**

Run: `grep -rl 'step "' spec/examples playground/public | head; ls playground/public/moves | head`
Determine where a move's `.posecode` source is authored (spec/examples `*.posecode`, and/or a
generator that emits the `moves/*.html`). Pick a flowing multi-phase move (e.g. a dance/jumping-
jacks example) and a rep move (squat).

- [ ] **Step 2: Update the flowing move to `flow`**

In the chosen flowing example, change interior phase modes from `ease-in-out`/`ease-out` to
`flow`, keeping the final rest phase as `settle`. Example edit (squat, to show the pause):

```
  step "Descend" 1.6s settle:   # was ease-in-out — pause at the bottom
  step "Drive up" 1.2s drive:   # was ease-out — accelerate up
```

For a continuous move (e.g. arm-circles / dance-phrase), set every interior phase to `flow`.

- [ ] **Step 3: Rebuild any generated move HTML (if a generator exists)**

Run the repo's move-generation script if present (check `package.json` scripts, e.g.
`npm run build:moves`); otherwise the playground reads `.posecode` sources directly and no
regen is needed.

- [ ] **Step 4: Verify in the browser preview**

Start the playground (`preview_start` with the playground launch config), open the flowing
move, and confirm the stop-start cadence at phase boundaries is gone. Open the squat and confirm
it still pauses at the bottom. Capture a screenshot for the record.

- [ ] **Step 5: Full workspace test + typecheck**

Run: `npm test` (root) and the repo typecheck/build (`npm run build` or `tsc -b`).
Expected: all suites green, no type errors. Investigate any coverage drop below 80% on the
changed packages and add targeted tests.

- [ ] **Step 6: Commit**

```bash
git add spec playground packages
git commit -m "feat: demo flow/settle timing on flagship moves (L2)"
```

---

## Self-Review

**Spec coverage:**
- Squad method → Task 1. ✅
- Root yaw/travel C1 smoothing → Task 3 Step 4 (root uses the mode-eased param; scalar tracks
  are monotonic so `eased` gives smooth arrival; note: full Catmull-Rom on root deferred as the
  scalar path is already visually smooth and low-risk — if a large multi-phase turn looks
  segmented in verification, add scalar Catmull-Rom then). ✅ (with noted latitude)
- Timing modes `flow/settle/drive/snap/linear` → Task 2. ✅
- Legacy aliases + non-regression → Task 2 (normalizeMode) + Task 3 (rest modes reproduce
  ease behavior). ✅
- Deprecation diagnostic (hint) → Task 4 Step 6. ✅
- Editor completion/hover/highlight/LSP → Task 4. ✅
- Eval alignment → Task 5. ✅
- Flagship demos + verification → Task 6. ✅
- Tests-first, continuity + pass-through + settle + alias + deprecation → Tasks 1-4. ✅

**Placeholder scan:** No TBD/TODO; the one latitude (root Catmull-Rom) is an explicit,
conditional decision with a trigger, not a placeholder.

**Type consistency:** `TimingMode`, `MODES`, `normalizeMode`, `LEGACY_MODE_ALIASES`, `squad`,
`squadControl` used consistently across tasks; field name `easing` retained everywhere
(parser AST, IR Phase, timeline Keyframe, eval probe) per the global constraint.
