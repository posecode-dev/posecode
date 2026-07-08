# posecode-share

Encodes and decodes `.posecode` documents to URL-safe share tokens: the
distribution primitive behind [Posecode](https://posecode.org) playground
permalinks and embeds. Pure, dependency-free.

## Install

```bash
npm install posecode-share
```

## Usage

```ts
import { buildShareHash, readShareHash } from "posecode-share";

const hash = buildShareHash(myPosecodeSource); // "#doc=…"
const link = `https://posecode.org/play${hash}`;

// On the receiving page:
const source = readShareHash(window.location.hash);
```

## License

MIT
