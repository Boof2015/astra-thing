// SPDX-License-Identifier: GPL-3.0-only
const {spawn} = require('node:child_process');
const readline = require('node:readline');
function runWorker(binary, request, onEvent = () => {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, [], {stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true});
    let result, error, stderr = '', finished = false;
    child.on('error', reject);
    child.stderr.on('data', data => {stderr = (stderr + data.toString()).slice(-4096);});
    readline.createInterface({input: child.stdout}).on('line', line => {
      try {
        if (line.length > 4 * 1024 * 1024) throw Error('Oversized worker response');
        const event = JSON.parse(line);
        if (event.event === 'complete') {result = event.data; finished = true;}
        else if (event.event === 'error') error = Error(event.message);
        else onEvent(event);
      } catch (err) {error = err;}
    });
    child.on('close', code => {
      if (error || code !== 0 || !finished) reject(error || Error(code === null ? 'Device operation was interrupted' : 'USB worker could not finish. Check USB permissions and reconnect.'));
      else resolve(result);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(request));
  });
}
module.exports = {runWorker};
