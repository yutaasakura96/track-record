import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const state = JSON.parse(readFileSync('.dev-session/storage-state.json', 'utf8'));
const token = state.cookies.find((cookie) => cookie.name === 'better-auth.session_token');
assert.ok(token);
const headers = { cookie: `${token.name}=${token.value}` };
const origin = 'http://localhost:8787';

async function call(path, method = 'GET') {
  const response = await fetch(`${origin}${path}`, { method, headers });
  assert.ok(response.ok, `${method} ${path}: ${response.status}`);
  return response.json();
}

async function facts(importId) {
  return (await call(`/api/facts?importId=${importId}`)).items;
}

const before = await facts('sdv_nm_portfolio');
const restated = before.find((fact) => fact.id === 'fct_nm_restate');
const conflicting = before.find((fact) => fact.id === 'fct_nm_conflict');
const unrelated = before.find((fact) => fact.id === 'fct_nm_unrelated');
assert.equal(restated.likelyMatches.length, 1);
assert.equal(restated.likelyMatches[0].conflict, false);
assert.equal(conflicting.likelyMatches.length, 1);
assert.equal(conflicting.likelyMatches[0].conflict, true);
assert.deepEqual(unrelated.likelyMatches, []);
assert.deepEqual(Object.keys(conflicting.likelyMatches[0]).sort(), ['claim', 'conflict', 'document', 'id']);
console.log('GET /api/facts: restatement links to narrative.md without conflict; different figure is flagged; unrelated claim has no match. Match response has claim, conflict, document and id only.');

const accepted = await call('/api/facts/fct_nm_restate/accept', 'POST');
assert.equal(accepted.status, 'accepted');
assert.deepEqual(accepted.likelyMatches, []);
console.log('POST /api/facts/fct_nm_restate/accept: candidate is accepted and its match clears.');

await call('/api/facts/fct_nm_accepted/undo', 'POST');
await call('/api/facts/fct_nm_accepted/reject', 'POST');
const after = await facts('sdv_nm_portfolio');
assert.deepEqual(after.find((fact) => fact.id === 'fct_nm_conflict').likelyMatches, []);
const narrative = await facts('sdv_nm_narrative');
assert.equal(narrative.find((fact) => fact.id === 'fct_nm_accepted').status, 'rejected');
console.log('Undo then reject narrative fact: conflicting candidate loses its advisory match; rejected fact remains in the record.');
