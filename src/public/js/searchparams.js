window.currentItems = [];

document.addEventListener('DOMContentLoaded', function () {
  let activeKeyword = null;

  function parseKeywords(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.map(String).map(s => s.trim()).filter(Boolean);

    const s = String(raw).trim();
    if (!s) return [];

    // handle JSON-string array: '["A","B"]'
    if (s.startsWith('[') && s.endsWith(']')) {
      try {
        const arr = JSON.parse(s);
        if (Array.isArray(arr)) {
          return arr.map(String).map(x => x.trim()).filter(Boolean);
        }
      } catch {}
    }

    // comma-separated
    return s
      .split(/[;,]/)
      .map(x => x.trim())
      .filter(Boolean);
  }

  let currentItems = [...allItems];
  window.currentItems = [...currentItems];

  const form = document.getElementById('filterForm');
  const checkboxes = form.querySelectorAll('input[type="checkbox"]');
  const tableBody = document.querySelector('.table-group-divider');
  const paginationContainer = document.querySelector('.pagination');

  tableBody.addEventListener('click', function (e) {
    console.log('Clicked element:', e.target);
    if (e.target.classList.contains('keyword-link')) {
      handleKeywordSearch.call(e.target, e);
    }
    if (e.target.classList.contains('feature-link')) {
      e.preventDefault();
      const feature = e.target.dataset.feature;
      const featureCheckbox = form.querySelector(`.exerciseTypeInput[value="${feature}"]`);
      if (featureCheckbox) {
        featureCheckbox.checked = true;
        updateResults();
      }
    }
  });

  const ITEMS_PER_PAGE = 25;
  let currentPage = 1;

  function filterItems() {
    const selectedFeatures = Array.from(document.querySelectorAll('.exerciseTypeInput:checked')).map((cb) => cb.value);
    const selectedTools = Array.from(document.querySelectorAll('.toolInput:checked')).map((cb) => cb.value);
    const queryValue = document.querySelector('input[name="query"]').value.trim();

    // Base set: text search uses currentItems; otherwise start from allItems
    let filteredItems = queryValue ? currentItems : allItems;

    if (selectedFeatures.length > 0) {
      filteredItems = filteredItems.filter((item) => {
        const itemFeatures = Array.isArray(item.features)
          ? item.features
          : (item.features || '').split(',').map((s) => s.trim());
        return selectedFeatures.some((sf) => itemFeatures.includes(sf));
      });
    }

    if (selectedTools.length > 0) {
      filteredItems = filteredItems.filter((item) => selectedTools.includes(item.platform_name));
    }

    if (activeKeyword) {
      const target = activeKeyword.trim().toLowerCase();
      filteredItems = filteredItems.filter((item) => {
        const kws = parseKeywords(item.keywords).map(k => k.trim().toLowerCase());
        return kws.includes(target); // exact keyword match
      });
    }

    return filteredItems;
  }

  function renderTable(items, page) {
    const tableBody = document.querySelector('.table-group-divider');
    const recordCountEl = document.getElementById("recordCount");

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
        .map((kw) => `<a href="#" class="keyword-link" data-keyword="${kw}" style="text-decoration: underline; color: #0000EE">${kw}</a>`)
        .join(', ');

      const features = Array.isArray(item.features)
        ? item.features
        : (item.features || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);

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
      recordCountEl.textContent = `Showing ${startNum}–${endNum} of ${items.length} results`;
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
      a.innerText = '❮ Previous';
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
      a.innerText = 'Next ❯';
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
    const selectedFeatures = Array.from(document.querySelectorAll('.exerciseTypeInput:checked')).map((cb) => cb.value);
    const selectedTools = Array.from(document.querySelectorAll('.toolInput:checked')).map((cb) => cb.value);

    const params = new URLSearchParams();
    if (query) params.set('query', query);
    selectedFeatures.forEach((f) => params.append('features', f));
    selectedTools.forEach((t) => params.append('tools', t));
    if (activeKeyword) params.set('keyword', activeKeyword);

    const newUrl = `${window.location.pathname}?${params.toString()}`;
    history.pushState({ path: newUrl }, '', newUrl);
  }

  function updateResults() {
    currentPage = 1;
    const filtered = filterItems();
    renderTable(filtered, currentPage);
    renderPagination(filtered.length);
    updateURL();
  }

  checkboxes.forEach((checkbox) => {
    checkbox.addEventListener('change', function () {
      updateResults();
    });
  });

  async function handleKeywordSearch(e) {
    e.preventDefault();
    const keyword = this.dataset.keyword;

    activeKeyword = keyword;

    // Clear text query so we aren't restricting to text-search subset
    document.querySelector('input[name="query"]').value = '';

    // Reset currentItems so filtering starts from all items
    currentItems = [...allItems];
    window.currentItems = [...currentItems];

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
      currentItems = allItems;
      updateResults();
      return;
    }

    try {
      const response = await fetch(`/api/items?terms=${encodeURIComponent(query)}`);
      if (!response.ok) throw new Error('Network response was not ok');
      const data = await response.json();
      currentItems = data.results;
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
    const features = params.getAll('features');
    const tools = params.getAll('tools');
    const kw = params.get('keyword');
    if (kw) activeKeyword = kw;

    if (query) searchInput.value = query;

    document.querySelectorAll('.exerciseTypeInput').forEach((cb) => {
      if (features.includes(cb.value)) cb.checked = true;
    });

    document.querySelectorAll('.toolInput').forEach((cb) => {
      if (tools.includes(cb.value)) cb.checked = true;
    });
  }

  applyFiltersFromURL();

  const initialQuery = new URLSearchParams(window.location.search).get('query');
  if (initialQuery) {
    debouncedSearch(initialQuery);
  } else {
    updateResults();
  }
});
