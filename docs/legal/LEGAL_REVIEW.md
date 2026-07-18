# Legal review checklist

This is an engineering audit checklist, not legal advice. Resolve these points with an intellectual-property lawyer before relying on dual licensing at scale.

## Copyright ownership and relicensing authority

- Repository shortlog review on 2026-07-18 found one apparent human contributor represented by two author-name aliases sharing the same email address, plus Claude, Copilot, Dependabot, and GitHub Actions identities. Confirm that no commits attributed to tools or bots incorporate copyright owned by an undisclosed human or third party.
- Confirm that the project owner personally owns the relevant code or has written assignments from any employer, client, cofounder, contractor, or other party whose agreement could cover the work.
- Review material AI-assisted code under the applicable provider terms and local law. Confirm provenance, training-output risk policy, and whether the desired copyright and commercial relicensing position is supportable.
- Preserve immutable evidence of the versions previously released under MIT and Apache-2.0, including Git tags, npm metadata, and release records.

## Contributor strategy

- DCO sign-off documents contributor provenance but does not itself grant broad relicensing authority.
- Before accepting external contributions to an AGPL component that will also be commercially licensed, adopt a lawyer-reviewed individual and corporate CLA or another explicit copyright/relicensing grant.
- Define how existing contributions will be handled if a contributor cannot or will not sign the future CLA. Keep those contributions out of commercially relicensed builds unless counsel confirms another basis.

## Commercial and brand documents

- Have counsel draft the actual commercial license agreement, warranty and liability terms, support terms, SLA, privacy terms, export controls, and pricing/order documents. `COMMERCIAL-LICENSE.md` is only a contact notice.
- Confirm ownership and registrability of the Posecode name and logos before trademark registration, enforcement, or representations about exclusive rights.
- Review product copy so “open source” always identifies the Apache-2.0 and AGPL-3.0 split and does not imply that third-party assets share those licenses.

## Third-party materials

- Recheck the current Adobe Mixamo terms for redistribution of `xbot.glb` and `jumping-jacks.fbx`, especially for npm, source archives, hosted demos, white-label offerings, and customer redistribution.
- Replace the remaining Mixamo-derived files with owned or clearly redistributable assets if the intended distribution is not covered.
- Run a dependency and source-provenance audit for every release artifact, including bundled JavaScript, model files, fonts, images, and generated content. Preserve all required notices.
