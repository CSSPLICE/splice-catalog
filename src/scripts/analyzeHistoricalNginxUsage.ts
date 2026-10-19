import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const PRODUCTION_API_URL = 'https://splice.cs.vt.edu/api/items';
const DEFAULT_REPORT_PATH = 'historical-usage-analysis.json';
const DEFAULT_IMPORT_PATH = 'historical-usage-import.json';
const HISTORICAL_SOURCE = 'nginx_historical';
const TOP_USER_AGENT_LIMIT = 20;
const TOP_CLIENT_LIMIT = 20;
const TOP_ITEM_LIMIT = 20;
const SAMPLE_ID_LIMIT = 10;

interface ProductionItem {
  id: number;
  persistentID: string;
  title: string;
  platform_name: string;
}

interface CatalogRequest {
  timestamp: string;
  date: string;
  client: string;
  path: string;
  status: number;
  referrer: string;
  userAgent: string;
  catalogId: number;
  botFamily: string | null;
}

interface ParsedLog {
  totalLogLines: number;
  parsedLogLines: number;
  malformedLogLines: number;
  catalogItemRequests: number;
  successfulCatalogRequests: CatalogRequest[];
}

const botIndicators: Array<{ family: string; indicators: string[] }> = [
  { family: 'Googlebot', indicators: ['googlebot'] },
  { family: 'GoogleOther', indicators: ['googleother'] },
  { family: 'Bingbot', indicators: ['bingbot'] },
  { family: 'Bytespider', indicators: ['bytespider'] },
  { family: 'Sogou', indicators: ['sogou'] },
  { family: 'YouBot', indicators: ['youbot'] },
  { family: 'Censys', indicators: ['censys'] },
  { family: 'zgrab', indicators: ['zgrab'] },
  { family: 'Other bot/crawler/spider', indicators: ['bot', 'crawler', 'spider'] },
];

function detectBotFamily(userAgent: string): string | null {
  const normalized = userAgent.toLowerCase();
  return botIndicators.find(({ indicators }) => indicators.some((indicator) => normalized.includes(indicator)))?.family ?? null;
}

function parseLogEntry(line: string): { parsed: boolean; request?: Omit<CatalogRequest, 'date' | 'catalogId' | 'botFamily'> } {
  let nginxLine = line;
  try {
    const envelope: unknown = JSON.parse(line);
    if (typeof envelope === 'object' && envelope !== null && 'log' in envelope) {
      const logValue = (envelope as { log?: unknown }).log;
      if (typeof logValue !== 'string') return { parsed: false };
      nginxLine = logValue.trimEnd();
    }
  } catch {
    // Plain Nginx access-log lines are also accepted.
  }

  const match = nginxLine.match(/^([^\s]+)\s+\S+\s+\S+\s+\[([^\]]+)\]\s+"([^"]*)"\s+(\d{3})\s+\S+\s+"([^"]*)"\s+"([^"]*)"/);
  if (!match) return { parsed: false };

  const [, client, timestamp, requestLine, rawStatus, referrer, userAgent] = match;
  const requestParts = requestLine.split(/\s+/);
  const method = requestParts[0];
  const path = requestParts[1];
  if (!method || !path) return { parsed: false };

  const dateMatch = timestamp.match(/^(\d{2})\/(\w{3})\/(\d{4}):(\d{2}:\d{2}:\d{2})\s+([+-]\d{4})$/);
  if (!dateMatch) return { parsed: false };
  const [, day, monthName, year, time, timezone] = dateMatch;
  const month = new Map([
    ['Jan', '01'], ['Feb', '02'], ['Mar', '03'], ['Apr', '04'], ['May', '05'], ['Jun', '06'],
    ['Jul', '07'], ['Aug', '08'], ['Sep', '09'], ['Oct', '10'], ['Nov', '11'], ['Dec', '12'],
  ]).get(monthName);
  if (!month) return { parsed: false };
  const normalizedTimezone = `${timezone.slice(0, 3)}:${timezone.slice(3)}`;
  const isoTimestamp = `${year}-${month}-${day}T${time}${normalizedTimezone}`;
  if (Number.isNaN(Date.parse(isoTimestamp))) return { parsed: false };

  return {
    parsed: true,
    request: {
      timestamp: new Date(isoTimestamp).toISOString(),
      client,
      path,
      status: Number(rawStatus),
      referrer,
      userAgent,
    },
  };
}

function parseLog(contents: string): ParsedLog {
  let totalLogLines = 0;
  let parsedLogLines = 0;
  let malformedLogLines = 0;
  let catalogItemRequests = 0;
  const successfulCatalogRequests: CatalogRequest[] = [];

  for (const rawLine of contents.split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    totalLogLines += 1;
    const parsed = parseLogEntry(rawLine);
    if (!parsed.parsed || !parsed.request) {
      malformedLogLines += 1;
      continue;
    }
    parsedLogLines += 1;

    const { request } = parsed;
    const requestParts = request.path.match(/^\/catalog\/item\/(\d+)(?:\?.*)?$/);
    const requestLineMethod = rawLine.match(/"([A-Z]+)\s/);
    const isGet = requestLineMethod?.[1] === 'GET';
    if (!requestParts || !isGet) continue;

    catalogItemRequests += 1;
    if (request.status !== 200) continue;

    const requestDate = request.timestamp.slice(0, 10);
    successfulCatalogRequests.push({
      ...request,
      date: requestDate,
      catalogId: Number(requestParts[1]),
      botFamily: detectBotFamily(request.userAgent),
    });
  }

  return { totalLogLines, parsedLogLines, malformedLogLines, catalogItemRequests, successfulCatalogRequests };
}

function percentage(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Number(((numerator / denominator) * 100).toFixed(2));
}

const clientVolumeThresholds = [100, 250, 500, 750, 1000];
const clientRequestThresholds = [50, 100, 250, 500, 1000];

function analyzeClientVolume(requests: CatalogRequest[]) {
  const clients = new Map<string, { requests: number; catalogIds: Set<number> }>();
  for (const request of requests) {
    const clientKey = JSON.stringify([request.client, request.userAgent]);
    const client = clients.get(clientKey) ?? { requests: 0, catalogIds: new Set<number>() };
    client.requests += 1;
    client.catalogIds.add(request.catalogId);
    clients.set(clientKey, client);
  }

  const clientRows = [...clients.values()].map((client) => ({
    requests: client.requests,
    uniqueCatalogEntries: client.catalogIds.size,
    catalogIds: client.catalogIds,
  }));
  const sortedUniqueCounts = clientRows.map(({ uniqueCatalogEntries }) => uniqueCatalogEntries).sort((a, b) => a - b);
  const nearestRank = (percentile: number): number => sortedUniqueCounts.length === 0
    ? 0
    : sortedUniqueCounts[Math.ceil(percentile * sortedUniqueCounts.length) - 1];
  const median = sortedUniqueCounts.length === 0
    ? 0
    : sortedUniqueCounts.length % 2 === 0
      ? (sortedUniqueCounts[sortedUniqueCounts.length / 2 - 1] + sortedUniqueCounts[sortedUniqueCounts.length / 2]) / 2
      : sortedUniqueCounts[Math.floor(sortedUniqueCounts.length / 2)];

  const thresholdSummaries = clientVolumeThresholds.map((minimumUniqueCatalogEntries) => {
    const thresholdClients = clientRows.filter(({ uniqueCatalogEntries }) => uniqueCatalogEntries >= minimumUniqueCatalogEntries);
    const touchedCatalogIds = new Set<number>();
    let requestsByClients = 0;
    for (const client of thresholdClients) {
      requestsByClients += client.requests;
      for (const id of client.catalogIds) touchedCatalogIds.add(id);
    }
    return {
      minimumUniqueCatalogEntries,
      clients: thresholdClients.length,
      requests: requestsByClients,
      uniqueCatalogIdsTouched: touchedCatalogIds.size,
      percentageOfPostBotFilterRequests: percentage(requestsByClients, requests.length),
      requestsRemainingIfExcluded: requests.length - requestsByClients,
    };
  });

  const topClients = [...clientRows]
    .sort((left, right) => right.uniqueCatalogEntries - left.uniqueCatalogEntries || right.requests - left.requests)
    .slice(0, TOP_CLIENT_LIMIT)
    .map((client, index) => ({
      clientLabel: `Client ${index + 1}`,
      uniqueCatalogEntries: client.uniqueCatalogEntries,
      requests: client.requests,
    }));

  const sortedRequestCounts = clientRows.map(({ requests: requestCount }) => requestCount).sort((a, b) => a - b);
  const nearestRequestRank = (percentile: number): number => sortedRequestCounts.length === 0
    ? 0
    : sortedRequestCounts[Math.ceil(percentile * sortedRequestCounts.length) - 1];
  const medianRequests = sortedRequestCounts.length === 0
    ? 0
    : sortedRequestCounts.length % 2 === 0
      ? (sortedRequestCounts[sortedRequestCounts.length / 2 - 1] + sortedRequestCounts[sortedRequestCounts.length / 2]) / 2
      : sortedRequestCounts[Math.floor(sortedRequestCounts.length / 2)];

  const requestThresholdSummaries = clientRequestThresholds.map((minimumRequests) => {
    const thresholdClients = clientRows.filter(({ requests: requestCount }) => requestCount >= minimumRequests);
    const touchedCatalogIds = new Set<number>();
    const requestsByClients = thresholdClients.reduce((sum, client) => sum + client.requests, 0);
    for (const client of thresholdClients) {
      for (const id of client.catalogIds) touchedCatalogIds.add(id);
    }
    return {
      minimumRequests,
      clients: thresholdClients.length,
      requests: requestsByClients,
      percentageOfPostBotFilterRequests: percentage(requestsByClients, requests.length),
      requestsRemainingIfExcluded: requests.length - requestsByClients,
      uniqueCatalogIdsTouched: touchedCatalogIds.size,
    };
  });

  const topClientsByRequests = [...clientRows]
    .sort((left, right) => right.requests - left.requests || right.uniqueCatalogEntries - left.uniqueCatalogEntries)
    .slice(0, TOP_CLIENT_LIMIT)
    .map((client, index) => ({
      clientLabel: `Client ${index + 1}`,
      requests: client.requests,
      uniqueCatalogEntries: client.uniqueCatalogEntries,
    }));

  return {
    postBotFilterRequests: requests.length,
    clientDefinition: 'IP address + User-Agent; the combination is used only in memory and raw values are omitted from this section.',
    totalClients: clientRows.length,
    uniqueCatalogEntriesPerClient: {
      percentileMethod: 'Median is the midpoint of the two central values when client count is even; P90/P95/P99 use nearest rank (ceil(p*n), 1-indexed).',
      median,
      p90: nearestRank(0.90),
      p95: nearestRank(0.95),
      p99: nearestRank(0.99),
      maximum: sortedUniqueCounts.length ? sortedUniqueCounts[sortedUniqueCounts.length - 1] : 0,
    },
    thresholds: thresholdSummaries,
    top20Clients: topClients,
    totalRequestCountAnalysis: {
      percentileMethod: 'Median is the midpoint of the two central values when client count is even; P90/P95/P99 use nearest rank (ceil(p*n), 1-indexed).',
      median: medianRequests,
      p90: nearestRequestRank(0.90),
      p95: nearestRequestRank(0.95),
      p99: nearestRequestRank(0.99),
      maximum: sortedRequestCounts.length ? sortedRequestCounts[sortedRequestCounts.length - 1] : 0,
      thresholds: requestThresholdSummaries,
      top20Clients: topClientsByRequests,
    },
  };
}

function analyzePopulation(requests: CatalogRequest[], productionItems: Map<number, ProductionItem>) {
  const ids = new Set(requests.map(({ catalogId }) => catalogId));
  const matchedRequests = requests.filter(({ catalogId }) => productionItems.has(catalogId));
  const matchedIds = [...ids].filter((id) => productionItems.has(id));
  const unmatchedIds = [...ids].filter((id) => !productionItems.has(id));
  const clientSet = new Set(requests.map(({ client }) => client));

  return {
    requestCount: requests.length,
    uniqueCatalogIdsRequested: ids.size,
    uniqueClients: clientSet.size,
    matchedProductionIds: matchedIds.length,
    unmatchedIds: unmatchedIds.length,
    matchedRequests: matchedRequests.length,
    unmatchedRequests: requests.length - matchedRequests.length,
    idMatchPercentage: percentage(matchedIds.length, ids.size),
    requestMatchPercentage: percentage(matchedRequests.length, requests.length),
    sampleMatchedIds: matchedIds.slice(0, SAMPLE_ID_LIMIT).map((id) => productionItems.get(id)!),
    sampleUnmatchedIds: unmatchedIds.slice(0, SAMPLE_ID_LIMIT),
    matchedIds,
  };
}

function countBy<T>(values: T[]): Array<{ value: T; count: number }> {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value)));
}

function buildDailyStats(requests: CatalogRequest[], productionItems: Map<number, ProductionItem>) {
  const byDay = new Map<string, CatalogRequest[]>();
  for (const request of requests) {
    const dayRequests = byDay.get(request.date) ?? [];
    dayRequests.push(request);
    byDay.set(request.date, dayRequests);
  }

  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, dayRequests]) => {
    const likelyHuman = dayRequests.filter(({ botFamily }) => botFamily === null);
    const matched = dayRequests.filter(({ catalogId }) => productionItems.has(catalogId));
    const filteredMatched = likelyHuman.filter(({ catalogId }) => productionItems.has(catalogId));
    return {
      date,
      successfulCatalogRequests: dayRequests.length,
      knownBotScannerRequests: dayRequests.length - likelyHuman.length,
      likelyHumanRequests: likelyHuman.length,
      matchedProductionRequests: matched.length,
      likelyHumanMatchedProductionRequests: filteredMatched.length,
    };
  });
}

async function fetchProductionCatalog(): Promise<Map<number, ProductionItem>> {
  let response: Response;
  try {
    response = await fetch(PRODUCTION_API_URL, { signal: AbortSignal.timeout(30_000) });
  } catch (error) {
    throw new Error(`Could not fetch production catalog from ${PRODUCTION_API_URL}: ${String(error)}`);
  }
  if (!response.ok) throw new Error(`Production catalog API returned HTTP ${response.status}`);

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error('Production catalog API did not return valid JSON');
  }
  const items = Array.isArray(body)
    ? body
    : typeof body === 'object' && body !== null && 'results' in body
      ? (body as { results: unknown }).results
      : undefined;
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Production catalog API returned an unexpected payload; expected a non-empty array or an object with a results array');
  }

  const catalog = new Map<number, ProductionItem>();
  for (const [index, item] of items.entries()) {
    if (typeof item !== 'object' || item === null) throw new Error(`Production catalog item ${index} is not an object`);
    const record = item as Record<string, unknown>;
    const id = typeof record.id === 'number' ? record.id : Number(record.id);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`Production catalog item ${index} has an invalid numeric id`);
    if (typeof record.persistentID !== 'string' || typeof record.title !== 'string' || typeof record.platform_name !== 'string') {
      throw new Error(`Production catalog item ${index} is missing persistentID, title, or platform_name`);
    }
    if (catalog.has(id)) throw new Error(`Production catalog API returned duplicate numeric id ${id}`);
    catalog.set(id, { id, persistentID: record.persistentID, title: record.title, platform_name: record.platform_name });
  }
  return catalog;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const noOutput = args.includes('--no-output');
  const writeImport = args.includes('--write-import');
  const filePaths = args.filter((argument) => !argument.startsWith('--'));
  if (filePaths.length !== 1) throw new Error('Usage: yarn usage:analyze-nginx <nginx-log-path> [--write-import] [--no-output]');

  const logPath = resolve(filePaths[0]);
  let contents: string;
  try {
    contents = await readFile(logPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`Nginx log file not found: ${logPath}`);
    throw new Error(`Could not read nginx log file ${logPath}: ${String(error)}`);
  }

  const productionItems = await fetchProductionCatalog();
  const log = parseLog(contents);
  const allRequests = log.successfulCatalogRequests;
  const likelyHumanRequests = allRequests.filter(({ botFamily }) => botFamily === null);
  const botRequests = allRequests.filter(({ botFamily }) => botFamily !== null);
  const unfiltered = analyzePopulation(allRequests, productionItems);
  const filtered = analyzePopulation(likelyHumanRequests, productionItems);
  const clientVolume = analyzeClientVolume(likelyHumanRequests);

  const botFamilyCounts = countBy(botRequests.map(({ botFamily }) => botFamily!));
  const userAgentCounts = countBy(allRequests.map(({ userAgent }) => userAgent));
  const userAgentLabels = new Map(userAgentCounts.map(({ value }, index) => [value, `User-Agent ${index + 1}`]));
  const detectedBotUserAgents = countBy(botRequests.map(({ userAgent }) => userAgent));
  const topUserAgents = userAgentCounts.slice(0, TOP_USER_AGENT_LIMIT);
  const matchedViewsById = new Map<number, number>();
  for (const request of likelyHumanRequests) {
    if (productionItems.has(request.catalogId)) {
      matchedViewsById.set(request.catalogId, (matchedViewsById.get(request.catalogId) ?? 0) + 1);
    }
  }
  const topMatchedItemsAfterBotFiltering = [...matchedViewsById.entries()]
    .map(([id, requests]) => ({ ...productionItems.get(id)!, requests }))
    .sort((a, b) => b.requests - a.requests || a.id - b.id)
    .slice(0, TOP_ITEM_LIMIT);
  const dailyCounts = buildDailyStats(allRequests, productionItems);
  const aug28Requests = allRequests.filter(({ date }) => date.endsWith('-08-28'));
  const aug28LikelyHuman = aug28Requests.filter(({ botFamily }) => botFamily === null);
  const aug28 = {
    date: 'August 28 (UTC)',
    successfulCatalogRequests: aug28Requests.length,
    knownBotScannerRequests: aug28Requests.length - aug28LikelyHuman.length,
    likelyHumanRequests: aug28LikelyHuman.length,
    botRequestPercentage: percentage(aug28Requests.length - aug28LikelyHuman.length, aug28Requests.length),
    likelyHumanMatchedProductionRequests: aug28LikelyHuman.filter(({ catalogId }) => productionItems.has(catalogId)).length,
  };

  const productionIds = [...productionItems.keys()];
  const report = {
    generatedAt: new Date().toISOString(),
    sourceLog: logPath,
    productionCatalog: {
      source: PRODUCTION_API_URL,
      itemCount: productionItems.size,
      minId: Math.min(...productionIds),
      maxId: Math.max(...productionIds),
    },
    rawNginx: {
      totalLogLines: log.totalLogLines,
      parsedLogLines: log.parsedLogLines,
      malformedLogLines: log.malformedLogLines,
      catalogItemGetRequestsAllStatuses: log.catalogItemRequests,
      successfulCatalogItemGetRequests: allRequests.length,
      uniqueCatalogIdsInSuccessfulRequests: unfiltered.uniqueCatalogIdsRequested,
      totalCatalogItemRequests: log.catalogItemRequests,
      uniqueClients: unfiltered.uniqueClients,
    },
    botFiltering: {
      knownBotScannerRequestsRemoved: botRequests.length,
      likelyHumanRequestsRemaining: likelyHumanRequests.length,
      percentageRemovedAsBots: percentage(botRequests.length, allRequests.length),
      byDetectedBotFamily: botFamilyCounts.map(({ value, count }) => ({ family: value, requests: count })),
      detectedBotUserAgents: detectedBotUserAgents.map(({ value, count }) => ({ userAgentLabel: userAgentLabels.get(value), requests: count })),
      topUserAgents: topUserAgents.map(({ value, count }) => ({ userAgentLabel: userAgentLabels.get(value), requests: count })),
    },
    clientVolumeAnalysis: clientVolume,
    productionMatching: {
      unfiltered: {
        matchedProductionIds: unfiltered.matchedProductionIds,
        unmatchedIds: unfiltered.unmatchedIds,
        matchedRequests: unfiltered.matchedRequests,
        unmatchedRequests: unfiltered.unmatchedRequests,
        percentageIdsMatched: unfiltered.idMatchPercentage,
        percentageRequestsMatched: unfiltered.requestMatchPercentage,
        sampleMatchedIds: unfiltered.sampleMatchedIds,
        sampleUnmatchedIds: unfiltered.sampleUnmatchedIds,
      },
      filteredLikelyHuman: {
        matchedProductionIds: filtered.matchedProductionIds,
        unmatchedIds: filtered.unmatchedIds,
        matchedRequests: filtered.matchedRequests,
        unmatchedRequests: filtered.unmatchedRequests,
        percentageIdsMatched: filtered.idMatchPercentage,
        percentageRequestsMatched: filtered.requestMatchPercentage,
        sampleMatchedIds: filtered.sampleMatchedIds,
        sampleUnmatchedIds: filtered.sampleUnmatchedIds,
      },
    },
    topMatchedItemsAfterBotFiltering,
    dailyCounts,
    aug28,
    privacy: 'Raw client/IP addresses are not included in this report.',
  };

  console.log('Historical nginx usage analysis');
  console.log(`Production catalog: ${productionItems.size} items (IDs ${report.productionCatalog.minId}–${report.productionCatalog.maxId})`);
  console.log(`Nginx log: ${log.totalLogLines} lines; ${log.parsedLogLines} parsed; ${log.malformedLogLines} malformed`);
  console.log(`Catalog item GET requests (all statuses): ${log.catalogItemRequests}`);
  console.log(`Successful catalog item GET requests (HTTP 200): ${allRequests.length}`);
  console.log(`Unique clients: ${unfiltered.uniqueClients}`);
  console.log(`Known bot/scanner requests removed: ${botRequests.length} (${report.botFiltering.percentageRemovedAsBots}%)`);
  console.log(`Likely-human requests remaining: ${likelyHumanRequests.length}`);
  console.log(`Post-bot-filter clients (IP + User-Agent): ${clientVolume.totalClients}`);
  console.log('Unique catalog entries per client:');
  console.log(`  Median ${clientVolume.uniqueCatalogEntriesPerClient.median}; P90 ${clientVolume.uniqueCatalogEntriesPerClient.p90}; P95 ${clientVolume.uniqueCatalogEntriesPerClient.p95}; P99 ${clientVolume.uniqueCatalogEntriesPerClient.p99}; max ${clientVolume.uniqueCatalogEntriesPerClient.maximum}`);
  console.log('Client-volume thresholds (post-bot-filter population):');
  console.log('Threshold | Clients | Requests | Unique IDs touched | % requests | Requests remaining');
  for (const summary of clientVolume.thresholds) {
    console.log(
      `>= ${String(summary.minimumUniqueCatalogEntries).padEnd(4)} | ${String(summary.clients).padStart(7)} | ${String(summary.requests).padStart(8)} | ${String(summary.uniqueCatalogIdsTouched).padStart(18)} | ${String(summary.percentageOfPostBotFilterRequests).padStart(10)}% | ${String(summary.requestsRemainingIfExcluded).padStart(18)}`,
    );
  }
  console.log('Top 20 clients by unique catalog entries (anonymized):');
  for (const client of clientVolume.top20Clients) {
    console.log(`  ${client.clientLabel}: ${client.uniqueCatalogEntries} unique entries; ${client.requests} requests`);
  }
  console.log('Total requests per client:');
  console.log(`  Median ${clientVolume.totalRequestCountAnalysis.median}; P90 ${clientVolume.totalRequestCountAnalysis.p90}; P95 ${clientVolume.totalRequestCountAnalysis.p95}; P99 ${clientVolume.totalRequestCountAnalysis.p99}; max ${clientVolume.totalRequestCountAnalysis.maximum}`);
  console.log('Client request-count thresholds (post-bot-filter population):');
  console.log('Threshold | Clients | Requests | % requests | Requests remaining | Unique IDs touched');
  for (const summary of clientVolume.totalRequestCountAnalysis.thresholds) {
    console.log(
      `>= ${String(summary.minimumRequests).padEnd(4)} | ${String(summary.clients).padStart(7)} | ${String(summary.requests).padStart(8)} | ${String(summary.percentageOfPostBotFilterRequests).padStart(10)}% | ${String(summary.requestsRemainingIfExcluded).padStart(18)} | ${String(summary.uniqueCatalogIdsTouched).padStart(18)}`,
    );
  }
  console.log('Top 20 clients by total requests (anonymized):');
  for (const client of clientVolume.totalRequestCountAnalysis.top20Clients) {
    console.log(`  ${client.clientLabel}: ${client.requests} requests; ${client.uniqueCatalogEntries} unique entries`);
  }
  console.log(`Bot-family breakdown: ${botFamilyCounts.map(({ value, count }) => `${value}=${count}`).join('; ') || 'none'}`);
  console.log(`Top User-Agents (anonymized): ${topUserAgents.map(({ value, count }) => `${userAgentLabels.get(value)} (${count})`).join('; ') || 'none'}`);
  console.log('Production matching (unfiltered):');
  console.log(`  IDs: ${unfiltered.matchedProductionIds} matched, ${unfiltered.unmatchedIds} unmatched (${unfiltered.idMatchPercentage}% matched)`);
  console.log(`  Requests: ${unfiltered.matchedRequests} matched, ${unfiltered.unmatchedRequests} unmatched (${unfiltered.requestMatchPercentage}% matched)`);
  console.log('Production matching (likely human):');
  console.log(`  IDs: ${filtered.matchedProductionIds} matched, ${filtered.unmatchedIds} unmatched (${filtered.idMatchPercentage}% matched)`);
  console.log(`  Requests: ${filtered.matchedRequests} matched, ${filtered.unmatchedRequests} unmatched (${filtered.requestMatchPercentage}% matched)`);
  console.log(`Sample matched IDs: ${unfiltered.sampleMatchedIds.map(({ id, title, platform_name }) => `${id} — ${title} (${platform_name})`).join('; ') || 'none'}`);
  console.log(`Sample unmatched IDs: ${unfiltered.sampleUnmatchedIds.join(', ') || 'none'}`);
  console.log('Top 20 matched production items after bot filtering:');
  for (const item of topMatchedItemsAfterBotFiltering) console.log(`  ${item.requests} — ${item.id} — ${item.title} (${item.platform_name})`);
  console.log(`Per-day successful catalog requests: ${dailyCounts.map(({ date, successfulCatalogRequests, knownBotScannerRequests, likelyHumanRequests }) => `${date}: ${successfulCatalogRequests} total, ${knownBotScannerRequests} bots, ${likelyHumanRequests} likely human`).join('; ') || 'none'}`);
  console.log(`August 28: ${aug28.successfulCatalogRequests} successful requests, ${aug28.knownBotScannerRequests} known bots (${aug28.botRequestPercentage}%), ${aug28.likelyHumanRequests} likely human, ${aug28.likelyHumanMatchedProductionRequests} likely-human requests matched to production`);

  if (!noOutput) {
    const outputPath = resolve(DEFAULT_REPORT_PATH);
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`JSON report written to ${outputPath}`);
  }

  if (writeImport) {
    const importedViewsById = new Map<number, number>();
    for (const request of likelyHumanRequests) {
      if (productionItems.has(request.catalogId)) {
        importedViewsById.set(request.catalogId, (importedViewsById.get(request.catalogId) ?? 0) + 1);
      }
    }
    const importItems = [...importedViewsById.entries()]
      .sort(([left], [right]) => left - right)
      .map(([legacyId, viewCount]) => {
        const item = productionItems.get(legacyId)!;
        return {
          catalogType: 'SLC_ITEM',
          legacyId,
          persistentID: item.persistentID,
          title: item.title,
          catalogPath: `/catalog/item/${item.id}`,
          viewCount,
        };
      });
    const importViews = importItems.reduce((sum, item) => sum + item.viewCount, 0);
    const importFile = {
      version: 1,
      generatedAt: new Date().toISOString(),
      source: HISTORICAL_SOURCE,
      filterPolicy: {
        description: 'Includes successful HTTP 200 GET requests to numeric SLC item routes after excluding requests whose User-Agent contains an explicitly recognized bot, crawler, or scanner indicator.',
        knownBotIndicators: botIndicators.flatMap(({ indicators }) => indicators),
      },
      summary: {
        successfulCatalogRequests: allRequests.length,
        filteredBotRequests: botRequests.length,
        includedRequests: importViews,
        uniqueIncludedItems: importItems.length,
        totalIncludedViews: importViews,
        productionApiItemCount: productionItems.size,
      },
      items: importItems,
    };
    const importPath = resolve(DEFAULT_IMPORT_PATH);
    await writeFile(importPath, `${JSON.stringify(importFile, null, 2)}\n`, 'utf8');
    console.log(`Filtered historical import file written to ${importPath}`);
    console.log(`Import items: ${importItems.length}; included views: ${importViews}`);
  }
}

main().catch((error: unknown) => {
  console.error(`Historical nginx analysis failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
