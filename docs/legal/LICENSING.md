# Posecode licensing

Posecode is an open-source project with separate licenses for its open standard and product-facing layers.

## License matrix

| Component | License |
| --- | --- |
| `spec/**`, `posecode-parser`, `posecode-share`, `posecode-language`, `posecode-lsp`, and `editors/vscode` | Apache-2.0 |
| `posecode-render`, `posecode-embed`, `posecode-mcp`, `posecode-eval`, and `playground` | AGPL-3.0-only |
| Posecode names, logos, and brand assets | See `TRADEMARK.md` |
| Third-party character and motion assets | See `THIRD_PARTY_NOTICES.md` |

The root `LICENSE` contains Apache-2.0 and applies to repository files that do not have a more specific license. Product-layer directories contain their own AGPL-3.0 license files, which override the root default for those directories.

## Package boundary and dependency direction

- `posecode-parser` defines validation and the intermediate representation. It stays Apache-2.0 so independent implementations can adopt the format.
- `posecode-share` only encodes and decodes documents. It stays Apache-2.0 as a format transport primitive.
- `posecode-language`, `posecode-lsp`, and the VS Code extension build on the parser and stay Apache-2.0 as standard-facing developer tooling.
- `posecode-render` turns the intermediate representation into the visual product experience. It is AGPL-3.0-only.
- `posecode-embed` bundles the parser, share codec, and renderer into a distributable product surface. It is AGPL-3.0-only.
- `posecode-mcp` exposes Posecode as an agent-facing service. It depends only on Apache components today, but is intentionally offered as part of the AGPL product layer.
- `posecode-eval` and `playground` exercise or deliver the product experience and are AGPL-3.0-only.

The dependency direction is from AGPL product packages to Apache standard packages. Apache packages do not import or depend on AGPL packages. Current direct software dependencies use permissive licenses compatible with this direction; third-party binary assets are handled separately in `THIRD_PARTY_NOTICES.md`.

## Commercial licensing

The AGPL product layer is also available under a separate commercial agreement for organizations that need closed-source embedding, white-label distribution, commercial support, or service-level commitments. See `COMMERCIAL-LICENSE.md`.

Apache-licensed components may be used in closed-source products under Apache-2.0 without a Posecode commercial license. A commercial license is relevant only when an organization wants alternative terms for an AGPL component.

## Earlier releases

This licensing change is prospective and does not revoke earlier grants:

- Repository revisions and packages distributed under MIT remain available under MIT.
- Posecode 0.2.2 npm packages remain available under Apache-2.0.
- Rights already received under MIT or Apache-2.0 are not withdrawn.
- New AGPL terms apply only to product-layer versions released with those terms.

This document is an overview. The applicable license text controls.
Open questions requiring legal review are recorded in `LEGAL_REVIEW.md`.
