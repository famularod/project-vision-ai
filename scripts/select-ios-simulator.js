#!/usr/bin/env node

// Picks the iPhone simulator the end-to-end job boots. Reads the JSON that
// `xcrun simctl list devices available -j` prints on standard input and writes
// one simulator's UDID. It lives in a file, not inline in the workflow, so the
// Maestro contract test can run it (independent review R13: the inline version
// could not even be parsed, and the contract only read the workflow's text).

/** The first available iPhone simulator's UDID in simctl's device list, or null. */
function selectIosSimulator(simctlJson) {
  const runtimes = simctlJson?.devices;
  if (runtimes === null || typeof runtimes !== 'object') return null;
  const devices = Object.values(runtimes).flatMap(list => (Array.isArray(list) ? list : []));
  const match = devices.find(device =>
    device?.isAvailable === true &&
    typeof device.name === 'string' && /^iPhone/.test(device.name) &&
    typeof device.udid === 'string' && device.udid.trim() !== '');
  return match ? match.udid.trim() : null;
}

if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => {
    let parsed;
    try {
      parsed = JSON.parse(input);
    } catch {
      console.error('select-ios-simulator: the simulator list was not valid JSON.');
      process.exit(1);
    }
    const udid = selectIosSimulator(parsed);
    if (!udid) {
      console.error('select-ios-simulator: no available iPhone simulator was found.');
      process.exit(1);
    }
    process.stdout.write(udid);
  });
}

module.exports = { selectIosSimulator };
