# Intentional Browsing Extension

A Manifest V3 extension for Chromium browsers that adds friction to distracting
sites and blocks sites, keywords and page content configured by enterprise
policy. It's built for people who want protections that are hard to undo in
a weak moment, so that is a design goal, not a side effect.

## Layout

- `extension/`: exactly what goes into the Chrome Web Store zip.
- `tests/`: Node test scripts that run the real extension code in a VM with a
  stubbed `chrome` API (`helpers.js`). `fixtures/sample-policy.json` is a
  neutral sample policy.
- `tools/build.js`: builds `dist/intentional-browsing-<version>.zip` from
  `extension/` only. `tools/check-fuzzy-words.js` lists dictionary words that
  fuzzy keywords would catch.
- `config/config.template.reg`: policy template with placeholder values.

## Rules

- Never commit a personal policy file. `*.reg` is ignored except the template;
  don't add exceptions. Tests use `tests/fixtures/sample-policy.json`.
- Keep the add-only design: nothing added from the popup can be removed or
  weakened from the popup. Don't add escape hatches, "undo" buttons or ways
  to turn protections off without administrator action.
- Every new policy key goes into `managed-config.js`, `extension/schema.json`
  (or the browser drops it), `config/config.template.reg` and the README table.
- Run `npm test` before every commit that touches `extension/`. Add tests for
  new behaviour, including ordinary pages that must stay allowed.
- A release bumps the version in `extension/manifest.json` and `package.json`,
  is built with `npm run build`, and is tagged `vX.Y.Z` after it is uploaded.
- Describe features at the level of design in docs and commit messages; don't
  write up which inputs a check does not catch.
