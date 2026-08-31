# Third-party notices

Posecode npm packages use dependencies under permissive licenses including MIT, ISC, BSD-2-Clause, BSD-3-Clause, and 0BSD. Their license notices remain available in their respective distributions.

## Character and motion assets

The following committed files originate from Adobe Mixamo character or animation exports and are governed by the applicable Adobe terms, not Apache-2.0 or AGPL-3.0:

- `playground/public/models/xbot.glb`
- `playground/public/models/avatar2.glb` (Mixamo "Beta" character)
- `playground/public/models/avatar3.glb` (Mixamo "Remy" character)
- `playground/public/clips/jumping-jacks.fbx`

Provenance for the two avatar characters is established by their glTF contents:
both carry the `mixamorig:` skeleton, a `mixamo.com` animation track, and Mixamo
mesh and texture names (`Beta_Joints`/`Beta_Surface` and `Remy_Body_*`).

The software licenses in this repository do not grant independent rights to extract, redistribute, or relicense these assets. Review the current Adobe Mixamo terms before redistribution. Posecode also provides a code-generated procedural figure that does not require these assets.

`playground/public/models/character.glb`, an older unused Mixamo-derived character, was removed before the 0.3.0 release. The hosted embed default now uses the same active XBot asset as the playground.
