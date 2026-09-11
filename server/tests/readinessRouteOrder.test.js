const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('admin readiness route is registered before the API 404 middleware', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const readiness = source.indexOf('app.get("/api/admin/readiness"');
  const api404 = source.indexOf('if(req.path.startsWith("/api/"))return res.status(404)');

  assert.notEqual(readiness, -1, 'readiness route must exist');
  assert.notEqual(api404, -1, 'API 404 middleware must exist');
  assert.ok(readiness < api404, 'readiness route must be registered before the API 404 middleware');
});
