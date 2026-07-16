# posecode-parser

Parses **`.posecode`**, a small text language for describing human movement, into
a validated, range-of-motion-clamped intermediate representation (IR).

Part of [Posecode](https://posecode.org): a kinematic-motion protocol LLMs can
write, rendered as an animated 3D figure in the browser. See the
[language spec](https://posecode.org/spec.html) for the full grammar.

## Install

```bash
npm install posecode-parser
```

## Usage

```ts
import { parse } from "posecode-parser";

const { ir, warnings, errors } = parse(`
  posecode exercise "Body-weight squat"
    rig humanoid
    pose start = standing

    step "Descend" 1.6s settle:
      hips: flex 80
      knees: flex 95
      ground-lock: feet

    repeat 8
`);

if (errors.length === 0 && ir) {
  // Pass `ir` to posecode-render to animate it, or inspect it directly.
}
```

## Validate a movement library

Version 0.2 includes a zero-config validator for local files and directories:

```bash
npx posecode-parser@0.2.0 validate ./movements
npx posecode-parser@0.2.0 validate --strict ./movements
```

The command recurses through directories, prints file-and-line diagnostics, and
exits non-zero for parse errors. `--strict` also fails on ROM-clamp warnings;
`--json` emits machine-readable results for CI.

## Timing modes

Canonical modes are `flow`, `settle`, `drive`, `snap`, and `linear`. The v0.1
aliases `ease-in`, `ease-out`, and `ease-in-out` remain accepted so existing
movement files keep working.

`parse()` never throws: malformed or out-of-range documents come back as
structured `errors`/`warnings` instead. Every joint angle in `ir` is hard-clamped
to a healthy range of motion, so a hallucinated `knee: flex 200` renders at its
safe ceiling with a warning, never an anatomically impossible joint.

## License

Apache-2.0
