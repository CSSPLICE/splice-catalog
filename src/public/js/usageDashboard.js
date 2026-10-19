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

  panels.forEach((panel) => {
    const name = panel.dataset.statisticsTable;
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
      pagination.replaceChildren();
      const addButton = (label, page, disabled = false) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.disabled = disabled;
        if (page === state.page && /^\d+$/.test(label)) button.setAttribute('aria-current', 'page');
        button.setAttribute('aria-label', /^\d+$/.test(label) ? `Page ${label}` : `${label} page`);
        button.addEventListener('click', () => {
          state.page = page;
          render();
          pagination.querySelector('[aria-current="page"]')?.focus({ preventScroll: true });
        });
        pagination.appendChild(button);
      };
      addButton('Previous', state.page - 1, state.page === 1);
      const pageNumbers = [
        ...new Set(
          [1, state.page - 1, state.page, state.page + 1, pageCount].filter((page) => page >= 1 && page <= pageCount),
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
      addButton('Next', state.page + 1, state.page === pageCount);
    }
    input.addEventListener('input', () => {
      state.page = 1;
      render();
    });
    render();
  });
  selectTab(dashboard.querySelector('[data-initial-tab]').dataset.initialTab);
})();
