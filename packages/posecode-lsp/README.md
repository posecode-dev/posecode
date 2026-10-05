# posecode-lsp

Language Server Protocol (LSP) implementation for the **Posecode** (`.posecode`) kinematic motion DSL.

Provides real-time editor services powered by `posecode-language` and `posecode-parser`:
- **Diagnostics**: syntax errors and biomechanical range-of-motion (ROM) clamping warnings.
- **Completions**: movement kinds, joints, actions, timing modes, and contact effectors.
- **Hover documentation**: ROM ranges and keyword specifications.

## Specification and Documentation

- **[Normative Protocol Specification](../../spec/SPEC.md)** (or [posecode.org/spec.html](https://posecode.org/spec.html)): The authoritative language grammar and contact semantics.
- **[LLM Authoring Guide](../../spec/llm-authoring.md)** (or [posecode.org/llm-guide.html](https://posecode.org/llm-guide.html)): Task-oriented authoring prompt and reference.

## License

Apache-2.0
