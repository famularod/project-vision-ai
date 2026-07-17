const fs = require('fs');
const path = require('path');

const appPath = path.join(__dirname, '..', 'App.tsx');
const source = fs.readFileSync(appPath, 'utf8');
const lineCount = source.split('\n').length - (source.endsWith('\n') ? 1 : 0);
const maximumLines = 23511;
const failures = [];

if (lineCount > maximumLines) {
  failures.push(
    `App.tsx grew to ${lineCount} lines; the current architecture budget is ${maximumLines}.`,
  );
}

if (/useState\s*<\s*(?:AppScreen|Screen)\s*>/.test(source)) {
  failures.push('App.tsx owns screen navigation with useState instead of useAppNavigation.');
}

if (!source.includes("useAppNavigation('Home')")) {
  failures.push('App.tsx does not use the typed application navigation controller.');
}

if (failures.length > 0) {
  failures.forEach(failure => console.error(`FAIL ${failure}`));
  process.exit(1);
}

console.log(
  `PASS App shell architecture: ${lineCount}/${maximumLines} lines; navigation state is externalized.`,
);
