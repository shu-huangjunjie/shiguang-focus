'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');
const assets = ['index.html', 'styles.css', 'app.js', 'desktop-bridge.js', 'timer-engine.js', 'favicon.svg'];
fs.mkdirSync(output, { recursive: true });
for (const asset of assets) fs.copyFileSync(path.join(root, asset), path.join(output, asset));
console.log(`Prepared ${assets.length} local assets in dist/.`);
