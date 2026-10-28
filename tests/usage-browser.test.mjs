import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import express from 'express';
import puppeteer from 'puppeteer';
import { AppDataSource } from '../src/db/data-source.ts';
import { UsageEvent } from '../src/db/entities/UsageEvent.ts';
import { SearchEvent } from '../src/db/entities/SearchEvent.ts';
import { slc_item_catalog } from '../src/db/entities/SLCItemCatalog.ts';
import { slc_tools_catalog } from '../src/db/entities/SLCToolsCatalog.ts';
import { dataset_catalog } from '../src/db/entities/DatasetCatalog.ts';
import { SearchController } from '../src/controllers/SearchController.ts';
import { CatalogController } from '../src/controllers/CatalogController.ts';
import { meilisearchService } from '../src/services/MeilisearchService.ts';
import usageRoutes from '../src/routes/usage.ts';
import searchRoutes from '../src/routes/search.ts';
import apiRoutes from '../src/routes/api.ts';

const executablePath = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
async function eventually(predicate) {
  for (let i = 0; i < 60; i++) {
    if (predicate()) return;
    await delay(50);
  }
  assert.ok(predicate(), 'expected event did not arrive');
}

test(
  'trusted browser activations, search intent and failed analytics preserve navigation',
  {
    skip: !existsSync(executablePath) ? 'Set CHROME_BIN to a local Chrome executable for browser tests' : false,
    timeout: 60000,
  },
  async (t) => {
    const events = [],
      searches = [],
      retrievals = [],
      errors = [];
    const item = {
      id: 7,
      persistentID: 'urn:test:7',
      title: 'Tree exercise',
      exercise_name: 'Tree',
      iframe_url: '/resource',
      platform_name: 'Fixture platform',
      description: 'A fixture description',
      keywords: ['trees'],
      features: ['Practice'],
      author: [],
      institution: [],
      natural_language: [],
      programming_language: [],
      protocol: [],
      protocol_url: [],
    };
    const items = Array.from({ length: 30 }, (_, index) => ({
      ...item,
      id: 7 + index,
      persistentID: `urn:test:${7 + index}`,
    }));
    const tool = { id: 8, platform_name: 'Fixture tool', url: '/resource' };
    const dataset = { id: 9, title: 'Fixture dataset', resource_url: '/resource' };
    let failAnalytics = false;
    const originalRepository = AppDataSource.getRepository.bind(AppDataSource),
      originalSearch = meilisearchService.search;
    AppDataSource.getRepository = (entity) => {
      if (entity === UsageEvent || entity === SearchEvent)
        return {
          create: (value) => value,
          save: async (value) => {
            (entity === UsageEvent ? events : searches).push(value);
            return value;
          },
        };
      const records =
        entity === slc_item_catalog
          ? items
          : entity === slc_tools_catalog
            ? [tool]
            : entity === dataset_catalog
              ? [dataset]
              : [];
      return {
        find: async () => records.map((record) => ({ ...record })),
        findOneBy: async (where) =>
          records.find((record) => Object.entries(where).every(([key, value]) => record[key] === value)) ?? null,
      };
    };
    meilisearchService.search = async () => items.map((record) => ({ ...record }));
    const app = express();
    app.use(express.json());
    app.set('views', resolve('src/views'));
    app.set('view engine', 'ejs');
    app.use((req, res, next) => {
      Object.assign(res.locals, { user: null, isAdmin: false, showLoginButton: false });
      next();
    });
    app.use('/usage', (req, res, next) => (failAnalytics ? res.status(503).end() : next()), usageRoutes);
    app.use('/search/results', (req, res, next) => {
      retrievals.push(req.query.terms);
      next();
    });
    app.use('/search', searchRoutes);
    app.use('/api', apiRoutes);
    app.use('/js', express.static(resolve('src/public/js')));
    const searchController = new SearchController(),
      catalogController = new CatalogController();
    app.get('/catalog', (req, res) => searchController.searchCatalog(req, res));
    app.get('/catalog/item/:id', (req, res) => catalogController.getCatalogItemByID(req, res));
    app.get('/toolcatalog', (req, res) => res.render('pages/toolcatalog', { toolsCatalog: [tool], title: 'Tools' }));
    app.get('/datasetcatalog', (req, res) =>
      res.render('pages/datasetcatalog', { datasets: [dataset], title: 'Datasets' }),
    );
    app.get('/toolcatalog/item/8', (req, res) => res.render('pages/tool-item', { tool, title: 'Tool' }));
    app.get('/datasetcatalog/item/9', (req, res) =>
      res.render('pages/dataset-item', { dataset, datasetTitle: dataset.title, title: 'Dataset' }),
    );
    app.get('/ontology/tree', (req, res) => res.json({ tree: [] }));
    app.get('/resource', (req, res) => res.send('Fixture resource'));
    app.get('/css/:file', (req, res) => res.type('css').send(''));
    const server = await new Promise((resolveServer) => {
      const listener = app.listen(0, '127.0.0.1', () => resolveServer(listener));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    let browser;
    try {
      browser = await puppeteer.launch({ executablePath, headless: true });
      const page = await browser.newPage();
      await page.setRequestInterception(true);
      page.on('request', (request) => (request.url().startsWith(base) ? request.continue() : request.abort()));
      page.on('pageerror', (error) => errors.push(error.message));
      async function open(path) {
        await page.goto(`${base}${path}`, { waitUntil: 'networkidle0' });
      }
      async function closePopups() {
        for (const other of await browser.pages()) if (other !== page) await other.close();
      }

      await t.test('direct detail access, refresh and iframe loads record no clicks', async () => {
        await open('/catalog/item/7');
        await page.reload({ waitUntil: 'networkidle0' });
        assert.equal(events.length, 0);
        assert.equal(searches.length, 0);
      });
      await t.test('server and dynamic links record once despite duplicate script loading', async () => {
        await open('/catalog');
        await page.addScriptTag({ path: resolve('src/public/js/usageTracking.js') });
        const before = events.length;
        await Promise.all([page.waitForNavigation(), page.locator('a[data-usage-entry-click]').click()]);
        await eventually(() => events.length === before + 1);
        assert.equal(events.at(-1).eventType, 'ENTRY_CLICK');
        await page.reload();
        assert.equal(events.length, before + 1);
        await open('/catalog');
        const requests = retrievals.length;
        await page.type('#query', 'trees');
        await eventually(() => retrievals.length > requests);
        await page.waitForFunction(() => new URL(location.href).searchParams.get('query') === 'trees');
        assert.equal(searches.length, 0);
        await Promise.all([page.waitForNavigation(), page.locator('a[data-usage-entry-click]').click()]);
        await eventually(() => events.length === before + 2);
      });
      await t.test('keyboard, modifier and middle activations each record one event', async () => {
        for (const method of ['keyboard', 'modifier', 'middle']) {
          await open('/catalog');
          const before = events.length;
          if (method === 'keyboard') {
            await page.focus('a[data-usage-entry-click]');
            await page.keyboard.press('Enter');
          } else if (method === 'modifier') {
            await page.keyboard.down('Meta');
            await page.locator('a[data-usage-entry-click]').click();
            await page.keyboard.up('Meta');
          } else await page.click('a[data-usage-entry-click]', { button: 'middle' });
          await eventually(() => events.length === before + 1);
          await delay(100);
          assert.equal(events.length, before + 1);
          await closePopups();
        }
      });
      await t.test('tool and dataset entry links retain canonical identity', async () => {
        for (const [path, type] of [
          ['/toolcatalog', 'TOOL'],
          ['/datasetcatalog', 'DATASET'],
        ]) {
          await open(path);
          const before = events.length;
          await Promise.all([page.waitForNavigation(), page.locator('a[data-usage-entry-click]').click()]);
          await eventually(() => events.length === before + 1);
          assert.equal(events.at(-1).catalogType, type);
        }
      });
      await t.test('all resource links work and record external clicks without entry events', async () => {
        for (const [path, linkType] of [
          ['/catalog', 'iframe_url'],
          ['/catalog/item/7', 'iframe_url'],
          ['/toolcatalog', 'tool_url'],
          ['/toolcatalog/item/8', 'tool_url'],
          ['/datasetcatalog', 'resource_url'],
          ['/datasetcatalog/item/9', 'resource_url'],
        ]) {
          await open(path);
          const before = events.length;
          const popup = new Promise((resolvePopup) => page.once('popup', resolvePopup));
          await page.click('a[data-usage-external-click]');
          const resource = await popup;
          await resource.waitForNetworkIdle();
          assert.equal(resource.url(), `${base}/resource`);
          await eventually(() => events.length === before + 1);
          assert.equal(events.at(-1).eventType, 'EXTERNAL_CLICK');
          assert.equal(events.at(-1).linkType, linkType);
          await closePopups();
        }
      });
      await t.test('header and in-page submits count once; background UI activity never counts as API', async () => {
        await open('/toolcatalog');
        await page.type('#query', 'binary   tree');
        assert.equal(searches.length, 0);
        await Promise.all([page.waitForNavigation(), page.keyboard.press('Enter')]);
        await eventually(() => searches.length === 1);
        assert.equal(searches[0].source, 'WEB');
        assert.equal(searches[0].query, 'binary tree');
        await page.focus('#query');
        await page.keyboard.press('Enter');
        await eventually(() => searches.length === 2);
        await page.keyboard.press('Enter');
        await eventually(() => searches.length === 3);
        await page.reload({ waitUntil: 'networkidle0' });
        assert.equal(searches.length, 3);
        const retrievalCount = retrievals.length;
        await page.type('#query', 's');
        await eventually(() => retrievals.length > retrievalCount);
        await page.waitForFunction(
          () => new URL(location.href).searchParams.get('query')?.trim().replace(/\s+/g, ' ') === 'binary trees',
        );
        await page.select('#itemsPerPage', '10');
        await page.click('.pagination-btn');
        assert.equal(await page.$eval('.pagination .active', (anchor) => anchor.textContent), '2');
        await page.click('[data-filter-toggle="features"]');
        await page.click('[data-filter-option="features"]');
        assert.equal(searches.length, 3);
        assert.ok(searches.every((event) => event.source === 'WEB'));
        await page.$eval('#query', (input) => {
          input.value = '   ';
        });
        await page.focus('#query');
        await page.keyboard.press('Enter');
        await delay(400);
        assert.equal(searches.length, 3);
      });
      await t.test('failed analytics never prevent detail or resource navigation', async () => {
        failAnalytics = true;
        await open('/catalog');
        await Promise.all([page.waitForNavigation(), page.locator('a[data-usage-entry-click]').click()]);
        assert.ok(page.url().endsWith('/catalog/item/7'));
        const popup = new Promise((resolvePopup) => page.once('popup', resolvePopup));
        await page.click('a[data-usage-external-click]');
        const resource = await popup;
        await resource.waitForNetworkIdle();
        assert.equal(resource.url(), `${base}/resource`);
        await closePopups();
        for (const synchronous of [false, true]) {
          await open('/catalog');
          await page.evaluate((sync) => {
            window.fetch = () => {
              if (sync) throw new Error('simulated unavailable fetch');
              return Promise.reject(new Error('simulated rejected fetch'));
            };
          }, synchronous);
          await Promise.all([page.waitForNavigation(), page.locator('a[data-usage-entry-click]').click()]);
          assert.ok(page.url().endsWith('/catalog/item/7'));
        }
        assert.deepEqual(errors, []);
      });
    } finally {
      await browser?.close();
      // Chrome helpers can retain inherited pipes after the browser process exits.
      for (const stream of browser?.process()?.stdio ?? []) stream?.destroy();
      await new Promise((done) => server.close(done));
      AppDataSource.getRepository = originalRepository;
      meilisearchService.search = originalSearch;
    }
  },
);
