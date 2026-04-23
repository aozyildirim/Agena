#!/usr/bin/env node
// Thin entrypoint — the real logic lives in dist/ (after `npm run build`)
// so this file stays small and doesn't need transpilation.
require('../dist/index.js');
