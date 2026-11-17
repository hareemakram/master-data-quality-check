// Builds the engine for Node (tests, precompute) and the browser (web dashboard).
const fs = require('fs'), path = require('path'), esbuild = require('esbuild');
const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'src/engine.ts'), 'utf8');
const names = ['runQualityChecks','dqToCsv','dqOwnerPackets','dqOwnerEmailHtml','dqDice','dqNormalizeName',
  'dqMatchesPattern','dqValidEmail','dqPhoneProblem','dqValidIban','dqDate','dqNumber','DQ_REPORT_COLUMNS','dqSummaryEmailHtml','dqReportHtml'];
fs.mkdirSync(path.join(root, 'build'), { recursive: true });
fs.writeFileSync(path.join(root, 'build/engine.module.ts'), src + '\nexport { ' + names.join(', ') + ' };\n');
esbuild.buildSync({ entryPoints: [path.join(root, 'build/engine.module.ts')], outfile: path.join(root, 'build/engine.cjs'),
  format: 'cjs', platform: 'node', target: 'es2017' });
esbuild.buildSync({ entryPoints: [path.join(root, 'build/engine.module.ts')], outfile: path.join(root, 'build/engine.browser.js'),
  format: 'iife', globalName: 'DQ', target: 'es2017', minify: true });
console.log('engine built');
