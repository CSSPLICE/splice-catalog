import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync } from 'node:fs';
import { cp, mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { finished } from 'node:stream/promises';
import express from 'express';
import formidable from 'express-formidable';
import puppeteer from 'puppeteer';

const root = resolve('.');
const executablePath = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const resourceId = 'slc_item_catalog';
const listPath = `/admin/resources/${resourceId}`;
const buttonSelector = '[data-testid="slc-delete-selected"]';
const slotSelector = '[data-testid="slc-delete-selected-slot"]';
const fixturePid = (id) => `https://example.test/exercise/${id}/a%2Fb?x=1&y=2#section`;

test(
  'selected deletion uses the stock AdminJS list, confirmation and backend with production JSX assets',
  { timeout: 180000 },
  async (t) => {
    assert.ok(existsSync(executablePath), 'Set CHROME_BIN to a local Chrome executable');
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'splice-admin-selection-')));
    // Keep all generated bundles outside the checkout, including its pre-existing .adminjs directory.
    process.env.ADMIN_JS_TMP_DIR = directory;
    process.env.NODE_ENV = 'production';
    let server, browser;
    try {
      const { default: AdminJS, ActionDecorator, ApiController, Router } = await import('adminjs');
      const { default: AdminJSExpress, buildAssets, buildRoutes } = await import('@adminjs/express');
      const { componentsBundler, generateUserComponentEntry } = await import('adminjs/bundler');
      const { AppDataSource } = await import('../src/db/data-source.ts');
      const { slc_item_catalog } = await import('../src/db/entities/SLCItemCatalog.ts');
      const { slc_tools_catalog } = await import('../src/db/entities/SLCToolsCatalog.ts');
      const { dataset_catalog } = await import('../src/db/entities/DatasetCatalog.ts');
      const { ItemClassification } = await import('../src/db/entities/ItemClassification.ts');

      await AppDataSource.buildMetadatas();
      AppDataSource.createQueryRunner = () => {
        throw new Error('Real database access is forbidden in these tests');
      };
      const removed = [],
        bulkPosts = [],
        bulkGets = [],
        storage = new Map();
      function matches(row, where = {}) {
        return Object.entries(where).every(([key, value]) => {
          if (value?.type === 'in') return value.value.some((entry) => String(entry) === String(row[key]));
          if (value?.type === 'like') return String(row[key]).includes(value.value.slice(1, -1));
          return String(row[key]) === String(value);
        });
      }
      function instance(model, row, relations) {
        if (!row) return null;
        const result = Object.assign(new model(), row);
        if (model === ItemClassification) {
          delete result.item;
          if (relations?.item)
            result.item = [...storage.get(slc_item_catalog).values()].find(
              (item) => item.persistentID === row.item.persistentID,
            );
        }
        return result;
      }
      for (const model of [slc_item_catalog, slc_tools_catalog, dataset_catalog, ItemClassification]) {
        storage.set(model, new Map());
        model.findOneBy = async (where) =>
          instance(
            model,
            [...storage.get(model).values()].find((row) => matches(row, where)),
          );
        model.findBy = async (where) =>
          [...storage.get(model).values()].filter((row) => matches(row, where)).map((row) => instance(model, row));
        model.find = async (options = {}) => {
          const rows = [...storage.get(model).values()].filter((row) => matches(row, options.where));
          const [field, direction] = Object.entries(options.order || { id: 'ASC' })[0];
          rows.sort(
            (a, b) =>
              String(a[field]).localeCompare(String(b[field]), undefined, { numeric: true }) *
              (direction === 'DESC' ? -1 : 1),
          );
          return rows
            .slice(options.skip || 0, (options.skip || 0) + (options.take ?? rows.length))
            .map((row) => instance(model, row, options.relations));
        };
        model.count = async (options) =>
          [...storage.get(model).values()].filter((row) => matches(row, options.where)).length;
      }
      slc_item_catalog.prototype.remove = async function () {
        assert.equal(storage.get(slc_item_catalog).get(this.id)?.persistentID, this.persistentID);
        removed.push(this.id);
        storage.get(slc_item_catalog).delete(this.id);
        return this;
      };
      function reset() {
        removed.length = 0;
        bulkPosts.length = 0;
        bulkGets.length = 0;
        storage.get(slc_item_catalog).clear();
        for (let id = 1; id <= 105; id++)
          storage.get(slc_item_catalog).set(id, {
            id,
            persistentID: fixturePid(id),
            title: `Exercise ${String(id).padStart(3, '0')}`,
            catalog_type: 'SLCItemCatalog',
            platform_name: id <= 100 ? 'Alpha' : 'Beta',
            iframe_url: 'https://example.test/resource',
            description: 'Synthetic exercise',
            license: 'Test',
            author: [],
            institution: [],
            keywords: [],
            features: [],
            programming_language: [],
            natural_language: [],
            protocol: [],
            protocol_url: [],
          });
        storage.get(slc_tools_catalog).set(1, { id: 1, platform_name: 'Test tool', catalog_type: 'SLCToolsCatalog' });
        storage.get(dataset_catalog).set(1, { id: 1, title: 'Test dataset' });
        storage.get(ItemClassification).set(1, { id: 1, item: { persistentID: fixturePid(42) } });
      }
      reset();

      // Capture the actual application configuration without starting a watcher or writing cached assets.
      let admin,
        watches = 0;
      const originalBuildRouter = AdminJSExpress.buildRouter;
      const originalWatch = AdminJS.prototype.watch;
      AdminJSExpress.buildRouter = (configured) => {
        admin = configured;
        return express.Router();
      };
      AdminJS.prototype.watch = async () => {
        watches++;
      };
      const { setup } = await import('../src/admin-panel/adminjs-setup.ts');
      try {
        process.env.NODE_ENV = 'development';
        setup();
        assert.equal(watches, 1, 'development must rebuild custom components');
        process.env.NODE_ENV = 'production';
        setup();
        assert.equal(watches, 1, 'production uses the existing Express initialization');
      } finally {
        AdminJSExpress.buildRouter = originalBuildRouter;
        AdminJS.prototype.watch = originalWatch;
      }

      const api = new ApiController({ admin }, { email: 'synthetic-admin@example.test' });
      await t.test(
        'unsafe action is absent on all catalogs and existing bulk handlers/adapters are preserved',
        async () => {
          for (const id of [resourceId, 'slc_tools_catalog', 'dataset_catalog']) {
            const resource = admin.findResource(id);
            assert.equal(resource.decorate().actions.deleteAll, undefined);
            assert.equal(resource.decorate().actions.bulkDelete.action.handler, AdminJS.ACTIONS.bulkDelete.handler);
            for (const method of ['get', 'post']) {
              await assert.rejects(
                api.resourceAction({ params: { resourceId: id, action: 'deleteAll' }, query: {}, method }, {}),
              );
            }
            const listed = await api.resourceAction(
              { params: { resourceId: id, action: 'list' }, query: {}, method: 'get' },
              {},
            );
            assert.equal(listed.meta.perPage, 100);
          }
          assert.equal(admin.findResource(resourceId).idName(), 'id');
          assert.deepEqual(
            AppDataSource.getMetadata(slc_item_catalog).primaryColumns.map((column) => column.propertyName),
            ['persistentID'],
          );
          const classification = await api.recordAction(
            { params: { resourceId: 'ItemClassification', recordId: '1', action: 'show' }, method: 'get' },
            {},
          );
          assert.equal(classification.record.params['item.persistentID'], '42');
          assert.equal(classification.record.populated['item.persistentID'].params.persistentID, fixturePid(42));
          assert.deepEqual(removed, []);
          assert.equal(AppDataSource.isInitialized, false);
        },
      );

      // A synthetic extra action verifies that removing the old button preserves other toolbar controls.
      const itemResource = admin.findResource(resourceId);
      itemResource.decorate().actions.keepSelection = new ActionDecorator({
        action: {
          name: 'keepSelection',
          label: 'Keep selection action',
          actionType: 'bulk',
          component: false,
          handler: async () => ({ records: [] }),
        },
        admin,
        resource: itemResource,
      });

      await t.test(
        'the actual Gulp task copies JSX assets and AdminJS bundles the copied production files',
        async () => {
          const { adminComponents } = await import('../gulpfile.mjs');
          const project = join(directory, 'packaging');
          const source = join(project, 'src/admin-panel/components');
          const destination = join(project, 'dist/admin-panel/components');
          await mkdir(source, { recursive: true });
          await cp(join(root, 'src/admin-panel/components'), source, { recursive: true });
          try {
            process.chdir(project);
            const stream = adminComponents();
            stream.resume();
            await finished(stream);
          } finally {
            process.chdir(root);
          }
          const names = await readdir(source);
          assert.equal(names.length, 4);
          for (const name of names)
            assert.equal(await readFile(join(source, name), 'utf8'), await readFile(join(destination, name), 'utf8'));
          const { ComponentLoader } = await import('adminjs');
          const copiedLoader = new ComponentLoader();
          for (const [name, path] of Object.entries(admin.componentLoader.getComponents())) {
            copiedLoader.override(name, join(destination, `${path.split('/').at(-1)}.jsx`));
          }
          const bundleDirectory = join(project, '.adminjs');
          await mkdir(bundleDirectory);
          const entry = join(bundleDirectory, 'production-entry.js');
          await writeFile(
            entry,
            generateUserComponentEntry({ options: {}, componentLoader: copiedLoader }, bundleDirectory),
          );
          // Copied files live in a temporary project; resolve their external imports through AdminJS globals.
          componentsBundler
            .setInputOption('input', entry)
            .setOutputOption('file', join(directory, 'production-bundle.js'));
          await componentsBundler.build();
          assert.match(await readFile(join(directory, 'production-bundle.js'), 'utf8'), /Delete selected/);
        },
      );

      // Exercise the source component bundle too, using exactly the application's component registration.
      const entry = join(directory, 'entry.js');
      await writeFile(entry, generateUserComponentEntry(admin, directory));
      const bundlePath = join(directory, 'bundle.js');
      componentsBundler.setInputOption('input', entry).setOutputOption('file', bundlePath);
      await componentsBundler.build();
      const app = express();
      const router = express.Router();
      router.use((req, res, next) => {
        req.session = { adminUser: { email: 'synthetic-admin@example.test' } };
        if (req.path.includes('/bulk/bulkDelete')) {
          (req.method === 'POST' ? bulkPosts : bulkGets).push(String(req.query.recordIds).split(',').map(Number));
        }
        next();
      });
      router.use(formidable());
      buildAssets({ admin, router, assets: Router.assets, routes: Router.routes });
      buildRoutes({ admin, router, routes: Router.routes });
      app.use('/admin', router);
      app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
      server = await new Promise((done) => {
        const listener = app.listen(0, '127.0.0.1', () => done(listener));
      });
      const base = `http://127.0.0.1:${server.address().port}`;
      browser = await puppeteer.launch({ executablePath, headless: true });
      const page = await browser.newPage();
      await page.setViewport({ width: 1440, height: 1000 });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.setRequestInterception(true);
      page.on('request', (request) => (request.url().startsWith(base) ? request.continue() : request.abort()));
      async function open(path = listPath) {
        await page.goto(`${base}${path}`, { waitUntil: 'networkidle0' });
        if (path.startsWith(listPath) && !/\/records\//.test(path)) await page.waitForSelector(buttonSelector);
      }
      async function countIs(count) {
        await page.waitForFunction(
          (selector, n) => {
            const button = document.querySelector(selector);
            return button?.textContent.trim() === `Delete selected (${n})` && button.disabled === (n === 0);
          },
          {},
          buttonSelector,
          count,
        );
        assert.equal(await page.$$eval(buttonSelector, (buttons) => buttons.length), 1);
      }
      async function select(id) {
        await page.click(`[data-id="${id}"] input[type="checkbox"]`);
      }
      async function confirmView(count) {
        await page.click(buttonSelector);
        await page.waitForSelector('#drawerPortal table tbody tr');
        await page.waitForFunction(
          (n) => document.querySelectorAll('#drawerPortal table tbody tr').length === n,
          {},
          count,
        );
        assert.equal(bulkPosts.length, 0);
        assert.equal(removed.length, 0);
        assert.equal(new URL(page.url()).pathname, `${listPath}/bulk/bulkDelete`);
        assert.equal(bulkGets.at(-1).length, count);
        assert.equal(await page.$$eval(buttonSelector, (buttons) => buttons.length), 1);
      }
      async function cancel() {
        await page.click('#drawerPortal a');
        await page.waitForFunction(() => !location.pathname.includes('/bulk/'));
        assert.equal(removed.length, 0);
        assert.equal(bulkPosts.length, 0);
      }

      await t.test(
        'zero selection is disabled and only one primary delete button occupies the top-right header',
        async () => {
          reset();
          await open();
          await countIs(0);
          assert.equal(await page.$$eval('[data-testid="action-deleteAll"]', (nodes) => nodes.length), 0);
          const geometry = await page.$eval(slotSelector, (slot) => {
            const header = slot.closest('[data-css="slc_item_catalog-list-action-header"]');
            const a = slot.getBoundingClientRect(),
              b = header.getBoundingClientRect();
            return { rightDifference: b.right - a.right, topDifference: a.top - b.top, inHeader: Boolean(header) };
          });
          assert.equal(geometry.inHeader, true);
          assert.ok(Math.abs(geometry.rightDifference) < 30);
          assert.ok(Math.abs(geometry.topDifference) < 30);
          assert.equal(await page.$$eval('tbody [data-id] input[type="checkbox"]', (nodes) => nodes.length), 100);
          assert.deepEqual(bulkPosts, []);
        },
      );

      for (const count of [1, 3, 100]) {
        await t.test(`${count} selected records retain the counter, stock confirmation and cancellation`, async () => {
          reset();
          await open();
          if (count === 100) await page.click('thead input[type="checkbox"]');
          else for (let id = 1; id <= count; id++) await select(id);
          await countIs(count);
          assert.equal(await page.$$eval('caption [data-testid="action-bulkDelete"]', (nodes) => nodes.length), 0);
          assert.equal(await page.$$eval('caption [data-testid="action-keepSelection"]', (nodes) => nodes.length), 1);
          assert.match(await page.$eval('caption', (node) => node.textContent), new RegExp(String(count)));
          await confirmView(count);
          assert.match(
            await page.$eval('#drawerPortal', (node) => node.textContent),
            count === 1 ? /record/i : new RegExp(String(count)),
          );
          await cancel();
          assert.equal(storage.get(slc_item_catalog).size, 105);
          await countIs(count);
        });
      }

      for (const count of [1, 3, 100]) {
        await t.test(
          `final confirmation delegates exactly ${count} selected numeric IDs to the unchanged handler`,
          async () => {
            reset();
            await open();
            if (count === 100) await page.click('thead input[type="checkbox"]');
            else for (let id = 1; id <= count; id++) await select(id);
            await countIs(count);
            await confirmView(count);
            await page.click('#drawerPortal [data-css="slc_item_catalog-bulkDelete-drawer-footer"] button');
            await page.waitForFunction(() => !location.pathname.includes('/bulk/'));
            await countIs(0);
            const ids = Array.from({ length: count }, (_, index) => index + 1);
            assert.deepEqual(bulkPosts, [ids]);
            assert.deepEqual(removed, ids);
            assert.equal(storage.get(slc_item_catalog).size, 105 - count);
            assert.equal(storage.get(slc_item_catalog).get(105).persistentID, fixturePid(105));
          },
        );
      }

      await t.test(
        'filtering alone never deletes and only explicit filtered selections reach confirmation',
        async () => {
          reset();
          await open(`${listPath}?filters.platform_name=Beta`);
          await countIs(0);
          assert.equal(await page.$$eval('tbody [data-id]', (nodes) => nodes.length), 5);
          assert.deepEqual(removed, []);
          await select(102);
          await select(104);
          await countIs(2);
          await confirmView(2);
          assert.deepEqual(bulkGets.at(-1), [102, 104]);
          await page.click('#drawerPortal [data-css="slc_item_catalog-bulkDelete-drawer-footer"] button');
          await page.waitForFunction(() => !location.pathname.includes('/bulk/'));
          await countIs(0);
          assert.deepEqual(removed, [102, 104]);
          assert.equal(storage.get(slc_item_catalog).has(101), true);
          assert.equal(storage.get(slc_item_catalog).has(1), true);
        },
      );

      await t.test(
        'List, Show and Edit navigation preserves numeric routing and never duplicates the portal',
        async () => {
          reset();
          await open();
          await page.hover('[data-id="42"] [data-testid="actions-dropdown"]');
          await page.waitForSelector('[data-id="42"] [data-testid="action-show"]', { visible: true });
          await page.click('[data-id="42"] [data-testid="action-show"]');
          await page.waitForFunction(() => location.pathname.endsWith('/records/42/show'));
          await page.waitForSelector('[data-testid="property-show-title"]');
          assert.match(await page.content(), /Exercise 042/);
          assert.equal(await page.$$eval(buttonSelector, (nodes) => nodes.length), 0);
          await page.click('[data-testid="action-edit"]');
          await page.waitForFunction(() => location.pathname.endsWith('/records/42/edit'));
          await page.waitForSelector('input[name="title"]');
          assert.equal(await page.$eval('input[name="title"]', (node) => node.value), 'Exercise 042');
          assert.equal(await page.$$eval(buttonSelector, (nodes) => nodes.length), 0);
          await page.locator('[data-css="slc_item_catalog-edit-breadcrumbs"] a:nth-child(2)').click();
          await countIs(0);
          assert.equal(storage.get(slc_item_catalog).get(42).persistentID, fixturePid(42));
        },
      );

      await t.test('mobile placement and keyboard activation use the same confirmation flow', async () => {
        reset();
        try {
          await page.setViewport({ width: 375, height: 900 });
          await open();
          await countIs(0);
          const position = await page.$eval(buttonSelector, (button) => {
            const rect = button.getBoundingClientRect();
            return { left: rect.left, right: rect.right };
          });
          assert.ok(position.left >= 0 && position.right <= 375);
          await select(1);
          await countIs(1);
          await page.focus(buttonSelector);
          await page.keyboard.press('Enter');
          await page.waitForSelector('#drawerPortal table tbody tr');
          assert.deepEqual(bulkGets.at(-1), [1]);
          await cancel();
        } finally {
          await page.setViewport({ width: 1440, height: 1000 });
        }
      });

      await t.test(
        'empty results and pagination keep a single disabled control; other catalogs retain their toolbar',
        async () => {
          reset();
          await open(`${listPath}?filters.platform_name=Missing`);
          await countIs(0);
          assert.equal(await page.$$eval('tbody [data-id]', (nodes) => nodes.length), 0);
          await open(`${listPath}?page=2`);
          await countIs(0);
          assert.equal(await page.$$eval('tbody [data-id]', (nodes) => nodes.length), 5);
          for (const id of ['slc_tools_catalog', 'dataset_catalog']) {
            await open(`/admin/resources/${id}`);
            await page.waitForSelector('[data-id="1"] input[type="checkbox"]');
            await select(1);
            await page.waitForSelector('caption [data-testid="action-bulkDelete"]');
            assert.equal(await page.$$eval(buttonSelector, (nodes) => nodes.length), 0);
            assert.equal(await page.$$eval(slotSelector, (nodes) => nodes.length), 0);
          }
        },
      );

      await t.test('removed global action is inaccessible over HTTP, including POST', async () => {
        for (const id of [resourceId, 'slc_tools_catalog', 'dataset_catalog']) {
          for (const method of ['GET', 'POST']) {
            const response = await fetch(`${base}/admin/api/resources/${id}/actions/deleteAll`, { method });
            assert.ok(response.status >= 400);
          }
        }
        assert.deepEqual(removed, []);
      });
      assert.deepEqual(errors, [], 'AdminJS navigation should produce no browser exceptions');
    } finally {
      process.chdir(root);
      if (browser) await browser.close();
      if (server) await new Promise((done) => server.close(done));
      await rm(directory, { recursive: true, force: true });
    }
  },
);
