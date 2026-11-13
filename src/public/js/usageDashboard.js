(() => {
  const dashboard = document.querySelector('[data-usage-dashboard]');
  if (!dashboard || dashboard.dataset.initialized) return;
  dashboard.dataset.initialized = 'true';

  const filterForm = dashboard.querySelector('[data-filter-form]');
  const period = filterForm.querySelector('[name="period"]');
  const from = filterForm.querySelector('[name="from"]');
  const to = filterForm.querySelector('[name="to"]');
  const dateKey = (date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const constrainDates = () => {
    from.max = to.value;
    to.min = from.value;
  };
  period.addEventListener('change', () => {
    if (period.value === 'all') {
      from.value = '';
      to.value = '';
    }
    if (period.value === '7d' || period.value === '30d') {
      const [year, month, day] = filterForm.dataset.today.split('-').map(Number);
      const today = new Date(year, month - 1, day);
      const start = new Date(today);
      start.setDate(start.getDate() - (period.value === '7d' ? 6 : 29));
      from.value = dateKey(start);
      to.value = dateKey(today);
    }
    constrainDates();
  });
  [from, to].forEach((input) =>
    input.addEventListener('input', () => {
      period.value = 'custom';
      constrainDates();
    }),
  );
  constrainDates();

  const chart = dashboard.querySelector('.usage-line-chart');
  if (chart) {
    // Reflow the same recorded points into the available width, keeping labels legible on mobile.
    const reflowChart = () => {
      const width = Math.max(260, chart.clientWidth);
      const points = [...chart.querySelectorAll('.usage-point--entry')];
      const first = Number(points[0].dataset.day);
      const last = Number(points[points.length - 1].dataset.day);
      const xFor = (node) =>
        last === first ? width / 2 : 44 + ((Number(node.dataset.day) - first) * (width - 66)) / (last - first);
      chart.setAttribute('viewBox', `0 0 ${width} 235`);
      chart.querySelectorAll('.usage-gridline').forEach((line) => line.setAttribute('x2', width - 22));
      chart.querySelectorAll('circle[data-day]').forEach((point) => point.setAttribute('cx', xFor(point)));
      chart.querySelectorAll('text[data-day]').forEach((label) => label.setAttribute('x', xFor(label)));
      for (const [series, selector] of [
        ['entry', '.usage-point--entry'],
        ['external', '.usage-point--external'],
        ['api', '.usage-point--api'],
      ]) {
        const nodes = [...chart.querySelectorAll(selector)];
        const path = nodes
          .map((node, index) => `${index ? 'L' : 'M'}${xFor(node)},${node.getAttribute('cy')}`)
          .join(' ');
        chart.querySelector(`.usage-series--${series}`).setAttribute('d', path);
      }
    };
    reflowChart();
    if ('ResizeObserver' in window) new ResizeObserver(reflowChart).observe(chart);
    else window.addEventListener('resize', reflowChart);
  }

  const panels = [...dashboard.querySelectorAll('[data-statistics-table]')];
  const tabs = [...dashboard.querySelectorAll('[data-tab]')];
  let loadHistorical = () => {};
  let loadAudit = () => {};
  function selectTab(name, focus = false) {
    tabs.forEach((tab) => {
      const active = tab.dataset.tab === name;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      if (active && focus) tab.focus();
    });
    panels.forEach((panel) => {
      panel.hidden = panel.dataset.statisticsTable !== name;
    });
    if (name === 'historical') loadHistorical();
    if (name === 'audit') loadAudit();
    filterForm.querySelector('[data-active-tab-input]').value = name;
    const url = new URL(location.href);
    url.searchParams.set('tab', name);
    history.replaceState(null, '', url);
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectTab(tab.dataset.tab));
    tab.addEventListener('keydown', (event) => {
      const offsets = { ArrowRight: 1, ArrowLeft: -1, Home: -index, End: tabs.length - 1 - index };
      if (!(event.key in offsets)) return;
      event.preventDefault();
      selectTab(tabs[(index + offsets[event.key] + tabs.length) % tabs.length].dataset.tab, true);
    });
  });

  function renderPagination(pagination, currentPage, pageCount, onPage) {
    pagination.replaceChildren();
    const addButton = (label, page, disabled = false) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.disabled = disabled;
      if (page === currentPage && /^\d+$/.test(label)) button.setAttribute('aria-current', 'page');
      button.setAttribute('aria-label', /^\d+$/.test(label) ? `Page ${label}` : `${label} page`);
      button.addEventListener('click', () => {
        onPage(page);
      });
      pagination.appendChild(button);
    };
    addButton('Previous', currentPage - 1, currentPage === 1);
    const pageNumbers = [
      ...new Set(
        [1, currentPage - 1, currentPage, currentPage + 1, pageCount].filter((page) => page >= 1 && page <= pageCount),
      ),
    ].sort((a, b) => a - b);
    pageNumbers.forEach((page, index) => {
      if (index && page - pageNumbers[index - 1] > 1) {
        const gap = document.createElement('span');
        gap.textContent = '…';
        gap.setAttribute('aria-hidden', 'true');
        pagination.appendChild(gap);
      }
      addButton(String(page), page);
    });
    addButton('Next', currentPage + 1, currentPage === pageCount);
  }

  function setupHistorical(panel) {
    const input = panel.querySelector('[data-table-search]');
    const body = panel.querySelector('[data-historical-rows]');
    const empty = panel.querySelector('[data-table-empty]');
    const summary = panel.querySelector('[data-table-summary]');
    const totals = panel.querySelector('[data-historical-totals]');
    const pagination = panel.querySelector('[data-table-pagination]');
    let loaded = false, controller, timer, version = 0;
    async function load(page = 1, focus = false) {
      const request = ++version;
      controller?.abort();
      controller = new AbortController();
      panel.setAttribute('aria-busy', 'true');
      body.replaceChildren(empty);
      empty.hidden = false;
      empty.firstElementChild.textContent = 'Loading historical entries…';
      summary.textContent = 'Loading historical entries…';
      pagination.replaceChildren();
      try {
        const params = new URLSearchParams({ page: String(page), q: input.value.trim() });
        const response = await fetch(`/admin/usage-statistics/historical?${params}`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!response.ok) throw new Error('Historical data request failed');
        const data = await response.json();
        if (request !== version) return;
        loaded = true;
        totals.textContent = `${data.totalRequests.toLocaleString()} page requests across ${data.rowCount.toLocaleString()} imported entries`;
        dashboard.querySelector('[data-tab-count="historical"]').textContent = data.matchingCount.toLocaleString();
        body.replaceChildren();
        for (const item of data.rows) {
          const row = document.createElement('tr');
          row.dataset.tableRow = '';
          const type = row.insertCell();
          const badge = document.createElement('span');
          const classes = { SLC_ITEM: 'slc-item', TOOL: 'tool', DATASET: 'dataset' };
          badge.className = `catalog-type-badge catalog-type-badge--${classes[item.catalogType] || 'unknown'}`;
          badge.textContent = { SLC_ITEM: 'SLC Item', TOOL: 'Tool', DATASET: 'Dataset' }[item.catalogType] || 'Unknown';
          type.appendChild(badge);
          const title = row.insertCell();
          const linked = typeof item.catalogPath === 'string' && /^\/catalog\/item\/[1-9]\d*$/.test(item.catalogPath);
          const label = document.createElement(linked ? 'a' : 'span');
          label.textContent = item.itemTitle;
          if (linked) {
            label.className = 'usage-item-link';
            label.href = item.catalogPath;
          }
          title.appendChild(label);
          const count = row.insertCell();
          count.className = 'usage-number';
          count.textContent = item.historicalPageRequests.toLocaleString();
          body.appendChild(row);
        }
        empty.hidden = data.rows.length > 0;
        empty.firstElementChild.textContent = input.value.trim()
          ? 'No historical entries match your search.'
          : 'No historical data has been imported.';
        body.appendChild(empty);
        const start = (data.page - 1) * data.pageSize;
        summary.textContent = `Showing ${data.matchingCount ? start + 1 : 0}–${Math.min(start + data.rows.length, data.matchingCount)} of ${data.matchingCount.toLocaleString()} historical entries`;
        renderPagination(pagination, data.page, data.totalPages, (next) => load(next, true));
        if (focus) pagination.querySelector('[aria-current="page"]')?.focus({ preventScroll: true });
      } catch (error) {
        if (request !== version || error.name === 'AbortError') return;
        loaded = false;
        body.replaceChildren(empty);
        empty.hidden = false;
        totals.textContent = 'Historical totals unavailable.';
        dashboard.querySelector('[data-tab-count="historical"]').textContent = '—';
        empty.firstElementChild.textContent = 'Unable to load historical data. Select this tab to retry.';
        summary.textContent = 'Historical data unavailable.';
      } finally {
        if (request === version) panel.setAttribute('aria-busy', 'false');
      }
    }
    input.addEventListener('input', () => {
      clearTimeout(timer);
      ++version;
      controller?.abort();
      timer = setTimeout(() => load(), 200);
    });
    loadHistorical = () => { if (!loaded) load(); };
  }

  function setupAudit(panel) {
    const form = panel.querySelector('[data-audit-filters]');
    const endpoint = form.getAttribute('action');
    const range = form.elements.namedItem('period');
    const body = panel.querySelector('[data-audit-rows]');
    const empty = panel.querySelector('[data-table-empty]');
    const summary = panel.querySelector('[data-table-summary]');
    const pagination = panel.querySelector('[data-table-pagination]');
    const badge = dashboard.querySelector('[data-tab-count="audit"]');
    const downloads = [...panel.querySelectorAll('[data-audit-download]')];
    const exportMessage = panel.querySelector('[data-audit-export-message]');
    const kinds = { ENTRY_CLICK: 'Entry click', EXTERNAL_CLICK: 'External click', WEB_SEARCH: 'Web search' };
    const catalogs = { SLC_ITEM: 'SLC Item', TOOL: 'Tool', DATASET: 'Dataset' };
    const statuses = { ACCEPTED: 'accepted', REVIEW: 'review', REJECTED: 'rejected', EXPIRED: 'expired' };
    let applied = new URLSearchParams();
    let loaded = false, inFlight, exporting = false;

    const syncDates = () => {
      const custom = range.value === 'custom';
      form.querySelectorAll('[data-audit-date]').forEach((label) => {
        label.hidden = !custom;
        const input = label.querySelector('input');
        input.disabled = !custom;
        input.required = custom;
      });
    };
    const updateDownloads = () => {
      for (const button of downloads) button.disabled = !loaded || !!inFlight || exporting;
    };
    const showMessage = (message) => {
      empty.firstElementChild.textContent = message;
      body.replaceChildren(empty);
    };

    function renderRows(data) {
      const dates = new Intl.DateTimeFormat('en-US', {
        timeZone: data.timeZone, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
        timeZoneName: 'short',
      });
      const fragment = document.createDocumentFragment();
      for (const record of data.rows) {
        const row = document.createElement('tr');
        row.dataset.tableRow = '';
        const time = document.createElement('time');
        time.dateTime = record.finalizedAt;
        time.textContent = dates.format(new Date(record.finalizedAt));
        row.insertCell().appendChild(time);
        row.insertCell().textContent = kinds[record.kind] || record.kind;
        const status = document.createElement('span');
        status.className = `catalog-type-badge usage-audit-status--${statuses[record.status] || 'expired'}`;
        status.textContent = record.status;
        row.insertCell().appendChild(status);
        row.insertCell().textContent = record.reason;
        const item = row.insertCell();
        item.textContent = record.itemTitle || record.itemPersistentID || '—';
        const details = [catalogs[record.catalogType], record.itemTitle && record.itemPersistentID].filter(Boolean);
        if (details.length) {
          const detail = document.createElement('small');
          detail.textContent = details.join(' · ');
          item.appendChild(detail);
        }
        const official = row.insertCell();
        official.className = 'usage-number';
        official.textContent = record.officialEventId ?? '—';
        fragment.appendChild(row);
      }
      if (data.rows.length) body.replaceChildren(fragment);
      else showMessage('No audit records found for the selected filters.');
    }

    async function load(page = 1, focus = false) {
      inFlight?.abort();
      const request = new AbortController();
      inFlight = request;
      updateDownloads();
      panel.setAttribute('aria-busy', 'true');
      if (!loaded) showMessage('Loading audit history…');
      summary.textContent = 'Loading audit history…';
      let failure = 'Unable to load audit history. Please try again.';
      try {
        const params = new URLSearchParams(applied);
        params.set('page', String(page));
        const response = await fetch(`${endpoint}?${params}`, { signal: request.signal, cache: 'no-store' });
        if (response.status === 400) failure = (await response.json()).error;
        if (!response.ok) throw new Error('Audit history request failed');
        const data = await response.json();
        if (request !== inFlight) return;
        renderRows(data);
        loaded = true;
        panel.querySelector('[data-audit-disabled]').hidden = data.collectionEnabled;
        if (applied.size === 0) {
          badge.textContent = data.matchingCount.toLocaleString();
          badge.hidden = false;
        }
        const offset = (data.page - 1) * data.pageSize;
        const start = data.rows.length ? offset + 1 : 0;
        const end = data.rows.length ? offset + data.rows.length : 0;
        summary.textContent = `Showing ${start}–${end} of ${data.matchingCount.toLocaleString()} audit records`;
        if (data.pageLimitReached) summary.textContent += '. Narrow the filters to see older results.';
        renderPagination(pagination, data.page, data.totalPages, (next) => { if (!inFlight) load(next, true); });
        if (focus && !panel.hidden) pagination.querySelector('[aria-current="page"]')?.focus({ preventScroll: true });
      } catch {
        if (request !== inFlight) return;
        loaded = false;
        showMessage(failure);
        summary.textContent = '';
        pagination.replaceChildren();
      } finally {
        if (request === inFlight) {
          inFlight = undefined;
          panel.setAttribute('aria-busy', 'false');
          updateDownloads();
        }
      }
    }

    function applyFilters() {
      applied = new URLSearchParams();
      for (const [key, value] of new FormData(form)) {
        if (value.trim()) applied.set(key, value.trim());
      }
      exportMessage.hidden = true;
      load();
    }
    range.addEventListener('change', syncDates);
    form.addEventListener('submit', (event) => { event.preventDefault(); applyFilters(); });
    form.querySelector('[data-audit-reset]').addEventListener('click', () => {
      form.reset();
      syncDates();
      applyFilters();
    });
    async function download(format) {
      exporting = true;
      updateDownloads();
      exportMessage.hidden = true;
      const filters = applied;
      let failure = 'Unable to export audit history. Please try again.';
      try {
        const response = await fetch(`${endpoint}/export.${format}?${filters}`, { cache: 'no-store' });
        if (response.status === 422 || response.status === 400) failure = (await response.json()).error;
        if (!response.ok) throw new Error('Audit export failed');
        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement('a');
        link.href = url;
        link.download = `splice-audit-history.${format}`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch {
        if (filters === applied) {
          exportMessage.textContent = failure;
          exportMessage.hidden = false;
        }
      } finally {
        exporting = false;
        updateDownloads();
      }
    }
    for (const button of downloads) button.addEventListener('click', () => download(button.dataset.auditDownload));
    syncDates();
    loadAudit = () => { if (!loaded && !inFlight) load(); };
  }

  panels.forEach((panel) => {
    const name = panel.dataset.statisticsTable;
    if (name === 'historical') {
      setupHistorical(panel);
      return;
    }
    if (name === 'audit') {
      setupAudit(panel);
      return;
    }
    const rows = [...panel.querySelectorAll('[data-table-row]')];
    const input = panel.querySelector('[data-table-search]');
    const empty = panel.querySelector('[data-table-empty]');
    const summary = panel.querySelector('[data-table-summary]');
    const pagination = panel.querySelector('[data-table-pagination]');
    const state = { page: 1 };
    const pageSize = 6;
    function render() {
      const query = input.value.trim().toLowerCase();
      const filtered = rows.filter((row) => row.dataset.searchText.toLowerCase().includes(query));
      const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
      state.page = Math.min(state.page, pageCount);
      const start = (state.page - 1) * pageSize;
      rows.forEach((row) => {
        row.hidden = true;
      });
      filtered.forEach((row, index) => {
        row.hidden = index < start || index >= start + pageSize;
      });
      empty.hidden = filtered.length > 0;
      empty.firstElementChild.textContent = query
        ? `No ${name === 'entries' ? 'catalog entries' : 'search terms'} match your search.`
        : name === 'entries'
          ? 'No live click activity recorded for these filters.'
          : 'No submitted search terms recorded for these filters.';
      const noun = name === 'entries' ? 'catalog entries' : 'search terms';
      summary.textContent = `Showing ${filtered.length ? start + 1 : 0}–${Math.min(start + pageSize, filtered.length)} of ${filtered.length.toLocaleString()} ${noun}`;
      dashboard.querySelector(`[data-tab-count="${name}"]`).textContent = filtered.length.toLocaleString();
      renderPagination(pagination, state.page, pageCount, (page) => {
        state.page = page;
        render();
        pagination.querySelector('[aria-current="page"]')?.focus({ preventScroll: true });
      });
    }
    input.addEventListener('input', () => {
      state.page = 1;
      render();
    });
    render();
  });
  selectTab(dashboard.querySelector('[data-initial-tab]').dataset.initialTab);
})();
