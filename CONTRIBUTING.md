# Contributing to Posecode

Thank you for your interest in contributing to Posecode! We welcome contributions from developers, biomechanists, and creators.

To maintain a high-quality codebase, please review the contribution guidelines below.

---

## Workspace Architecture

Posecode is structured as an npm-based monorepo using **npm workspaces**:

- `packages/posecode-parser`: Text parser converting `.posecode` to validated, ROM-clamped IR (pure TypeScript).
- `packages/posecode-render`: 3D Forward Kinematics and CCD IK WebGL renderer (Three.js).
- `packages/posecode-embed`: Light `<posecode-player>` web component for embedding 3D figures in blogs/docs.
- `packages/posecode-share`: Permalink codec/compressor for creating short, shareable links.
- `packages/posecode-lsp`: Language Server Protocol implementation for editor autocompletion and diagnostic warnings.
- `packages/posecode-mcp`: Model Context Protocol server exposing parser, authoring guide, and renderer to LLM agents.
- `packages/posecode-eval`: Biomechanical scoring evaluations and headless regression testing.
- `playground`: The main interactive web sandbox (Vite + TypeScript).

---

## Local Development & Setup

### 1. Prerequisites
Ensure you have **Node.js 20+** installed.

### 2. Install Dependencies
Run the following command at the monorepo root to link all workspace packages:
```bash
npm install
```

### 3. Run the Playground
Start the local Vite dev server:
```bash
npm run dev
```
Open your browser to `http://localhost:5173`.

### 4. Build the Project
To compile the production build:
```bash
npm run build
```

---

## Testing & Quality Control

We run a strict set of checks on all PRs to ensure regressions are not introduced.

### Unit Tests
Run the unit test suite across all packages using Vitest:
```bash
npm test
```

### Biomechanical Invariant Evals
The fidelity scorecard headlessly solves FK and IK constraints for all example movements to verify biomechanical invariants (e.g., verifying that a deadlift maintains a flat back and matches vertical shins):
```bash
npm run eval
```

### Type Checking
Run compiler typechecks on all workspaces:
```bash
npm run typecheck
```

---

## How to Add a New Example Movement

To add a new movement preset to the catalog:

1. **Write the `.posecode` script**: Create a file named `spec/examples/<your-movement-id>.posecode` and write your movement steps.
2. **Import the script**: Open `playground/src/presets.ts` and add an import at the top of the file using the `?raw` loader:
   ```typescript
   import yourMovement from "../../spec/examples/your-movement-id.posecode?raw";
   ```
3. **Register the Preset**: Append a new preset object to the `PRESETS` array with standard taxonomy metadata:
   ```typescript
   {
     id: "your-movement-id",
     label: "Friendly Movement Name",
     domain: "Fitness", // e.g. Fitness, Dance, Physiotherapy, Yoga, Mobility, etc.
     bodyPart: "Upper legs", // Target body region
     target: "Quadriceps", // Main target muscle group
     equipment: "Body weight", // e.g. Body weight, Chair, Wall, Bar, Box
     difficulty: "Beginner", // Beginner, Intermediate, Advanced
     source: yourMovement
   }
   ```
4. **Regenerate Static Pages**: Statically generated pages must be updated before committing:
   ```bash
   node scripts/generate-content-pages.mjs
   ```
5. **Verify Fidelity**: Run the eval suite to make sure the movement compiles warning-free and conforms to safety limits:
   ```bash
   npm run eval
   ```

---

## Coding Conventions

- **TypeScript First**: All core library files must be written in strongly-typed TypeScript.
- **Framework-Agnostic Core**: Keep packages under `packages/` dependency-light and decoupled from frontend frameworks (like React or Vue) to maximize embeddability.
- **Range of Motion Clamping**: Never bypass the `posecode-parser` ROM bounds. All custom rigs or movements must adhere to healthy physical thresholds.

---

## Licensing and sign-off

Every commit must include a Developer Certificate of Origin sign-off:

```bash
git commit -s
```

The sign-off certifies the statements in [DCO](DCO). It does not transfer copyright.

Contributions to Apache-2.0 components are accepted under Apache-2.0. Product-layer components are AGPL-3.0-only and are also intended for separate commercial licensing. External contributions to the product layer require a separately executed, lawyer-reviewed contributor license agreement before merge. Until that agreement is available, maintainers must not merge external product-layer code.

Do not submit code, assets, model output, or employer-owned work unless you have the right to contribute it under the applicable terms. Identify material AI assistance in the pull request when it produced a substantial part of the contribution.
