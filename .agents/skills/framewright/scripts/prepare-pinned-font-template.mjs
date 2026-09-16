#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const src = path.resolve(process.argv[2] || 'examples/book-ad-v0/index.html');
const dst = path.resolve(process.argv[3] || 'examples/book-ad-v0/index-e08.html');
const original = fs.readFileSync(src, 'utf8');
let html = original.replaceAll('Arial, "DejaVu Sans", sans-serif', '"DejaVu Sans"');
html = html.replaceAll('Arial,sans-serif', '"DejaVu Sans"');
if (html === original) throw new Error('Expected font stack not found');
fs.writeFileSync(dst, html);
console.log(`prepared pinned-font template ${dst}`);
