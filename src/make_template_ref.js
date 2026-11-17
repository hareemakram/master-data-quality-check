// Produces build/pq_template.xlsx from Microsoft's connected-workbooks library; its DataMashup
// supplies the Package.xml / permissions / bindings blocks Excel expects.
const { workbookManager } = require('@microsoft/connected-workbooks');
const fs = require('fs'), path = require('path');
(async () => {
  const blob = await workbookManager.generateSingleQueryWorkbook({ queryMashup: 'let Source = 1 in Source', queryName: 'Q', refreshOnOpen: false });
  fs.writeFileSync(path.join(__dirname, '../build/pq_template.xlsx'), Buffer.from(await blob.arrayBuffer()));
})();
