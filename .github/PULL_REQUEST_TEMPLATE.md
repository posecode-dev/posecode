## Description

Please include a summary of the changes and the reasoning behind them. If this PR resolves an open issue, link to it here:
Fixes # (issue number)

## Type of Change

- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Movement/Preset addition (adding a new `.posecode` script and registering it)
- [ ] Documentation update

## Checklist

- [ ] My code follows the code style guidelines of this project
- [ ] I have performed a self-review of my own code
- My changes generate no new TypeScript/compiler warnings or errors:
  - [ ] Running `npm run typecheck` passes successfully
  - [ ] Running `npm run build` compiles without errors
- [ ] I have run the unit test suite (`npm test`) and all tests pass
- [ ] If applicable, I have run the fidelity evals (`npm run eval`) and all checks pass
- [ ] If I added a new movement, I ran `node scripts/generate-content-pages.mjs` to regenerate the static pages
