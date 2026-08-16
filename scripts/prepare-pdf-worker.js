const fs = require('node:fs');
const path = require('node:path');

const source = require.resolve('pdfjs-dist/legacy/build/pdf.worker.min.mjs');
const publicDirectory = path.resolve(process.cwd(), 'public');
const destination = path.join(publicDirectory, 'pdf.worker.min.mjs');

fs.mkdirSync(publicDirectory, { recursive: true });

const sourceBytes = fs.readFileSync(source);
const destinationBytes = fs.existsSync(destination)
  ? fs.readFileSync(destination)
  : null;

if (!destinationBytes || !sourceBytes.equals(destinationBytes)) {
  fs.writeFileSync(destination, sourceBytes);
  console.log('Prepared the matching PDF.js web worker.');
} else {
  console.log('PDF.js web worker already prepared.');
}
