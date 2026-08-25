#!/usr/bin/env node
/**
 * Correction sprint Section 24: render the permanent Little Chapters app
 * icon (public/pwa/icon.svg) into the maskable PNG variants the PWA
 * manifest ships. Runs once whenever the SVG is edited — the outputs are
 * committed alongside the source.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(process.cwd(), 'public', 'pwa');
const svg = await readFile(path.join(root, 'icon.svg'));

for (const size of [192, 512]) {
  const png = await sharp(svg, { density: 384 })
    .resize(size, size, { fit: 'cover' })
    .png({ compressionLevel: 9 })
    .toBuffer();
  const out = path.join(root, `icon-${size}.png`);
  await writeFile(out, png);
  console.log(`wrote ${out} (${png.length} bytes)`);
}

// A small favicon so browser tabs stop reaching for the child profile image.
const favicon = await sharp(svg, { density: 192 }).resize(64, 64).png().toBuffer();
await writeFile(path.resolve('public', 'favicon.png'), favicon);
console.log('wrote public/favicon.png');
