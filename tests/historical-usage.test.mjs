import assert from 'node:assert/strict';
import { test } from 'node:test';
import { filterHighVolumeClients } from '../src/scripts/analyzeHistoricalNginxUsage.ts';

const requests = (client, userAgent, count) => Array.from({ length: count }, (_, index) => ({ client, userAgent, catalogId: index + 1 }));

test('63 distinct entries excludes the entire identity while 62 entries remain', () => {
  const kept = requests('fixture-a', 'fixture-agent', 62);
  const removed = [...requests('fixture-b', 'fixture-agent', 63), ...requests('fixture-b', 'fixture-agent', 10)];
  const result = filterHighVolumeClients([...kept, ...removed]);
  assert.deepEqual(result.includedRequests, kept);
  assert.equal(result.summary.excludedClientIdentities, 1);
  assert.equal(result.summary.requestsRemoved, 73);
  assert.equal(result.summary.retainedClientsWith62UniqueEntries, 1);
  assert.doesNotMatch(JSON.stringify(result.summary), /fixture/);
});

test('the cutoff counts distinct entries rather than repeated requests', () => {
  const repeated = Array.from({ length: 1000 }, () => ({ client: 'fixture-a', userAgent: 'fixture-agent', catalogId: 1 }));
  assert.equal(filterHighVolumeClients(repeated).includedRequests.length, 1000);
});

test('both IP and User-Agent participate in identity without combining clients', () => {
  const first = requests('fixture-a', 'agent-a', 62);
  const second = [{ client: 'fixture-a', userAgent: 'agent-b', catalogId: 63 }];
  const third = [{ client: 'fixture-b', userAgent: 'agent-a', catalogId: 63 }];
  const result = filterHighVolumeClients([...first, ...second, ...third]);
  assert.equal(result.includedRequests.length, 64);
  assert.equal(result.summary.excludedClientIdentities, 0);
});
