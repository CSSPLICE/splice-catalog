window.currentItems = [];

document.addEventListener('DOMContentLoaded', function () {
  let activeKeyword = null;
  const ontologyDescendantsByLabel = new Map();

  function parseKeywords(raw) {
    if (!raw) return [];
    if (Array.isArray(raw))
      return raw
        .map(String)
        .map((s) => s.trim())
        .filter(Boolean);

    const s = String(raw).trim();
    if (!s) return [];

    if (s.startsWith('[') && s.endsWith(']')) {
      try {
        const arr = JSON.parse(s);
        if (Array.isArray(arr)) {
          return arr
            .map(String)
            .map((x) => x.trim())
            .filter(Boolean);
        }
      } catch {}
    }

    return s
      .split(/[;,]/)
      .map((x) => x.trim())
      .filter(Boolean);
  }

  function parseFieldValues(raw) {
    if (!raw) return [];
    if (Array.isArray(raw))
      return raw
        .map(String)
        .map((s) => s.trim())
        .filter(Boolean);

    return String(raw)
      .split(/[;,]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function getSelectedFilterValues() {
    return (window.filterSections || []).reduce((acc, section) => {
      acc[section.key] = Array.from(document.querySelectorAll(`[data-filter-option="${section.key}"]:checked`)).map(
        (cb) => cb.value,
      );
      return acc;
    }, {});
  }

  function setFilterSectionExpanded(key, isExpanded) {
    const toggle = document.querySelector(`[data-filter-toggle="${key}"]`);
    const optionsContainer = document.querySelector(`[data-filter-options="${key}"]`);
    const caret = toggle?.querySelector('.filter-section-caret');

    if (toggle) {
      toggle.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
    }
    if (caret) {
      caret.textContent = isExpanded ? 'v' : '>';
    }
    if (optionsContainer) {
      optionsContainer.style.display = isExpanded ? '' : 'none';
    }
  }

  function collectOntologyLabels(node) {
    const labels = [node.label];
    (node.children || []).forEach((child) => {
      labels.push(...collectOntologyLabels(child));
    });
    return labels;
  }

  function indexOntologyNode(node) {
    ontologyDescendantsByLabel.set(node.label, collectOntologyLabels(node));
    (node.children || []).forEach(indexOntologyNode);
  }

  function getFilterMatchValues(section, selectedValues) {
    if (section.key !== 'keywords') return selectedValues;

    return [
      ...new Set(
        selectedValues.flatMap((selectedValue) => ontologyDescendantsByLabel.get(selectedValue) || [selectedValue]),
      ),
    ];
  }

  function renderOntologyNodes(nodes, selectedValues) {
    const list = document.createElement('ul');
    list.className = 'ontology-filter-list';

    nodes.forEach((node) => {
      const item = document.createElement('li');
      item.className = 'ontology-filter-node';

      const row = document.createElement('div');
      row.className = 'ontology-filter-row';

      const children = node.children || [];
      const expandButton = document.createElement('button');
      expandButton.type = 'button';
      expandButton.className = 'ontology-filter-expand';
      expandButton.textContent = children.length > 0 ? '>' : '';
      expandButton.setAttribute('aria-label', children.length > 0 ? `Expand ${node.label}` : '');
      expandButton.disabled = children.length === 0;
      if (children.length === 0) {
        expandButton.setAttribute('aria-hidden', 'true');
      }

      const label = document.createElement('label');
      label.className = 'ontology-filter-label';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'filter-option-input ontology-filter-checkbox';
      checkbox.dataset.filterOption = 'keywords';
      checkbox.name = 'keywords';
      checkbox.value = node.label;
      checkbox.checked = selectedValues.has(node.label);
      checkbox.addEventListener('change', function () {
        if (this.checked) setFilterSectionExpanded('keywords', true);
        updateResults();
      });

      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(node.label));
      row.appendChild(expandButton);
      row.appendChild(label);
      item.appendChild(row);

      if (children.length > 0) {
        const childWrapper = document.createElement('div');
        childWrapper.className = 'ontology-filter-children';
        childWrapper.hidden = true;
        childWrapper.appendChild(renderOntologyNodes(children, selectedValues));
        item.appendChild(childWrapper);

        expandButton.addEventListener('click', function () {
          const isExpanded = !childWrapper.hidden;
          childWrapper.hidden = isExpanded;
          expandButton.textContent = isExpanded ? '>' : 'v';
          expandButton.setAttribute('aria-label', `${isExpanded ? 'Expand' : 'Collapse'} ${node.label}`);
        });
      }

      list.appendChild(item);
    });

    return list;
  }

  async function initOntologyFilters() {
    const treeContainers = Array.from(document.querySelectorAll('[data-ontology-tree="keywords"]'));
    if (treeContainers.length === 0) return;

    try {
      const response = await fetch('/ontology/tree');
      if (!response.ok) throw new Error('Unable to load ontology tree');

      const data = await response.json();
      const tree = data.tree || [];
      tree.forEach(indexOntologyNode);

      treeContainers.forEach((container) => {
        const selectedValues = new Set(
          (container.dataset.selectedValues || '')
            .split('|')
            .map((value) => value.trim())
            .filter(Boolean),
        );

        container.innerHTML = '';
        container.appendChild(renderOntologyNodes(tree, selectedValues));
      });

      updateResults();
    } catch (error) {
      console.error('Error loading ontology tree:', error);
      treeContainers.forEach((container) => {
        container.innerHTML = '<div class="ontology-filter-loading">Unable to load keywords.</div>';
      });
    }
  }

  let currentItems = [...allItems];
  window.currentItems = [...currentItems];
  let searchResults = [...allItems];

  const form = document.getElementById('filterForm');
  const checkboxes = form.querySelectorAll('input[type="checkbox"]');
  const tableBody = document.querySelector('.table-group-divider');
  const paginationContainer = document.querySelector('.pagination');

  tableBody.addEventListener('click', function (e) {
    if (e.target.classList.contains('keyword-link')) {
      handleKeywordSearch.call(e.target, e);
    }
    if (e.target.classList.contains('feature-link')) {
      e.preventDefault();
      const feature = e.target.dataset.feature;
      const featureCheckbox = form.querySelector(`[data-filter-option="features"][value="${feature}"]`);
      if (featureCheckbox) {
        featureCheckbox.checked = true;
        setFilterSectionExpanded('features', true);
        updateResults();
      }
    }
  });

  const itemsPerPageSelect = document.getElementById('itemsPerPage');
  let ITEMS_PER_PAGE = parseInt(itemsPerPageSelect?.value || '25', 10);
  let currentPage = 1;

  if (itemsPerPageSelect) {
    itemsPerPageSelect.addEventListener('change', () => {
      ITEMS_PER_PAGE = parseInt(itemsPerPageSelect.value, 10) || 25;
      currentPage = 1;

      const filtered = filterItems();
      renderTable(filtered, currentPage);
      renderPagination(filtered.length);
    });
  }

  function filterItems() {
    const selectedFilters = getSelectedFilterValues();

    let filteredItems = searchResults;

    (window.filterSections || []).forEach((section) => {
      const selectedValues = getFilterMatchValues(section, selectedFilters[section.key] || []);
      if (selectedValues.length === 0) return;

      const itemField = section.key === 'tools' ? 'platform_name' : section.key;
      filteredItems = filteredItems.filter((item) => {
        const itemValues = parseFieldValues(item[itemField]);
        return selectedValues.some((selectedValue) => itemValues.includes(selectedValue));
      });
    });

    if (activeKeyword) {
      const target = activeKeyword.trim().toLowerCase();
      filteredItems = filteredItems.filter((item) => {
        const kws = parseKeywords(item.keywords).map((k) => k.trim().toLowerCase());
        return kws.includes(target);
      });
    }

    return filteredItems;
  }

  function renderTable(items, page) {
    const tableBody = document.querySelector('.table-group-divider');
    const recordCountEl = document.getElementById('recordCount');

    tableBody.innerHTML = '';

    if (!items || items.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="6" style="text-align: center;">No results found.</td></tr>';
      if (recordCountEl) {
        recordCountEl.textContent = 'Showing 0 results';
      }
      return;
    }

    const start = (page - 1) * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    const paginatedItems = items.slice(start, end);

    let tableHTML = '';
    paginatedItems.forEach((item, index) => {
      const keywords = parseKeywords(item.keywords);
      const keywordLinks = keywords
        .map(
          (kw) =>
            `<a href="#" class="keyword-link" data-keyword="${kw}" style="text-decoration: underline; color: #0000EE">${kw}</a>`,
        )
        .join(', ');

      const features = parseFieldValues(item.features);
      const featureLinks = features
        .map((f) => `<a href="#" class="feature-link" data-feature="${f}">${f}</a>`)
        .join(', ');

      const rowNumber = (page - 1) * ITEMS_PER_PAGE + index + 1;

      const row = `
        <tr>
          <td>${rowNumber}</td>
          <td scope="row">
            <a href="/catalog/item/${encodeURIComponent(item.id)}" style="text-decoration: underline; color: #0000EE;">
              ${item.title}
            </a>
          </td>
          <td>${featureLinks}</td>
          <td>
            <span class="short-description" data-description="${item.description || ''}" style="cursor: pointer;">
              ${(item.description || '').split(' ').slice(0, 20).join(' ')}...
            </span>
          </td>
          <td><a href="${item.iframe_url}" target="_blank">${item.platform_name}</a></td>
          <td>${keywordLinks}</td>
        </tr>
      `;
      tableHTML += row;
    });

    tableBody.innerHTML = tableHTML;

    const startNum = (page - 1) * ITEMS_PER_PAGE + 1;
    const endNum = Math.min(page * ITEMS_PER_PAGE, items.length);

    if (recordCountEl) {
      recordCountEl.textContent = `Showing ${startNum}-${endNum} of ${items.length} results`;
    }
  }

  function renderPagination(totalItems) {
    paginationContainer.innerHTML = '';
    const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
    if (totalPages <= 1) return;

    const ul = document.createElement('ul');
    ul.className = 'pagination-list';

    if (currentPage > 1) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = '#';
      a.innerText = '< Previous';
      a.className = 'pagination-btn';
      a.addEventListener('click', (e) => {
        e.preventDefault();
        currentPage--;
        const filtered = filterItems();
        renderTable(filtered, currentPage);
        renderPagination(filtered.length);
      });
      li.appendChild(a);
      ul.appendChild(li);
    }

    let startPage = Math.max(1, currentPage - 2);
    let endPage = Math.min(totalPages, currentPage + 2);

    for (let i = startPage; i <= endPage; i++) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = '#';
      a.innerText = i;
      a.className = currentPage === i ? 'active' : '';
      a.addEventListener('click', (e) => {
        e.preventDefault();
        currentPage = i;
        const filtered = filterItems();
        renderTable(filtered, currentPage);
        renderPagination(filtered.length);
      });
      li.appendChild(a);
      ul.appendChild(li);
    }

    if (currentPage < totalPages) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = '#';
      a.innerText = 'Next >';
      a.className = 'pagination-btn';
      a.addEventListener('click', (e) => {
        e.preventDefault();
        currentPage++;
        const filtered = filterItems();
        renderTable(filtered, currentPage);
        renderPagination(filtered.length);
      });
      li.appendChild(a);
      ul.appendChild(li);
    }

    paginationContainer.appendChild(ul);
  }

  function updateURL() {
    const searchInput = searchForm.querySelector('input[name="query"]');
    const query = searchInput.value;
    const selectedFilters = getSelectedFilterValues();

    const params = new URLSearchParams();
    if (query) params.set('query', query);
    Object.entries(selectedFilters).forEach(([key, values]) => {
      values.forEach((value) => params.append(key, value));
    });
    if (activeKeyword) params.set('keyword', activeKeyword);

    const newUrl = `${window.location.pathname}?${params.toString()}`;
    history.pushState({ path: newUrl }, '', newUrl);
  }

  function updateResults() {
    currentPage = 1;
    const filtered = filterItems();
    currentItems = [...filtered];
    window.currentItems = [...filtered];
    renderTable(filtered, currentPage);
    renderPagination(filtered.length);
    updateURL();
  }

  document.querySelectorAll('[data-filter-toggle]').forEach((toggle) => {
    toggle.addEventListener('click', function () {
      const key = this.dataset.filterToggle;
      const isExpanded = this.getAttribute('aria-expanded') === 'true';
      setFilterSectionExpanded(key, !isExpanded);
    });
  });

  checkboxes.forEach((checkbox) => {
    if (checkbox.dataset.filterOption) {
      checkbox.addEventListener('change', function () {
        const key = this.dataset.filterOption;
        const selectedCount = document.querySelectorAll(`[data-filter-option="${key}"]:checked`).length;
        if (selectedCount > 0) {
          setFilterSectionExpanded(key, true);
        }
        updateResults();
      });
      return;
    }

    checkbox.addEventListener('change', function () {
      updateResults();
    });
  });

  async function handleKeywordSearch(e) {
    e.preventDefault();
    const keyword = this.dataset.keyword;
    activeKeyword = keyword;
    currentPage = 1;
    updateResults();
  }

  const searchForm = document.getElementById('searchForm');
  const searchInput = searchForm.querySelector('input[name="query"]');

  function debounce(func, delay) {
    let timeout;
    return function (...args) {
      const context = this;
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(context, args), delay);
    };
  }

  const debouncedSearch = debounce(async (query) => {
    if (!query) {
      searchResults = [...allItems];
      updateResults();
      return;
    }

    try {
      const response = await fetch(`/api/items?terms=${encodeURIComponent(query)}`);
      if (!response.ok) throw new Error('Network response was not ok');
      const data = await response.json();
      searchResults = data.results || [];
      updateResults();
    } catch (error) {
      console.error('There has been a problem with your fetch operation:', error);
    }
  }, 300);

  searchInput.addEventListener('input', (e) => {
    debouncedSearch(e.target.value);
  });

  searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    debouncedSearch(searchInput.value);
  });

  function applyFiltersFromURL() {
    const params = new URLSearchParams(window.location.search);
    const query = params.get('query');
    const kw = params.get('keyword');
    if (kw) activeKeyword = kw;

    if (query) searchInput.value = query;

    (window.filterSections || []).forEach((section) => {
      const values = params.getAll(section.key);
      document.querySelectorAll(`[data-filter-option="${section.key}"]`).forEach((cb) => {
        if (values.includes(cb.value)) cb.checked = true;
      });

      if (values.length > 0) {
        setFilterSectionExpanded(section.key, true);
      }
    });
  }

  applyFiltersFromURL();
  initOntologyFilters();

  const initialQuery = new URLSearchParams(window.location.search).get('query');
  if (initialQuery) {
    debouncedSearch(initialQuery);
  } else {
    updateResults();
  }
});
