document.addEventListener('DOMContentLoaded', function () {
  let currentItems = [...allItems];
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
    const selectedFeatures = Array.from(
      document.querySelectorAll('.exerciseTypeInput:checked')
    ).map((cb) => cb.value);

    const selectedTools = Array.from(
      document.querySelectorAll('.toolInput:checked')
    ).map((cb) => cb.value);

    const queryValue = document.querySelector('input[name="query"]').value.trim();

    let filteredItems = queryValue ? currentItems : allItems;

    if (selectedFeatures.length > 0) {
      filteredItems = filteredItems.filter((item) => {
        const itemFeatures = Array.isArray(item.features)
          ? item.features
          : (item.features || '')
              .split(',')
              .map((s) => s.trim());

        return selectedFeatures.some((sf) => itemFeatures.includes(sf));
      });
    }

    if (selectedTools.length > 0) {
      filteredItems = filteredItems.filter((item) => {
        return selectedTools.includes(item.platform_name);
      });
    }

    currentItems = filteredItems;
    return filteredItems;
  }


  function renderTable(items, page) {
    tableBody.innerHTML = '';
    const start = (page - 1) * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    const paginatedItems = items.slice(start, end);

    if (paginatedItems.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="6" style="text-align: center;">No results found.</td></tr>';
      return;
    }

    let tableHTML = '';
    paginatedItems.forEach((item, index) => {
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
          <td>
            ${(item.keywords || [])
              .map(
                (keyword) => `
              <a href="#" class="keyword-link" data-keyword="${keyword}" style="text-decoration: underline; color: #0000EE">${keyword}</a>
            `,
              )
              .join(', ')}
          </td>
        </tr>
      `;
      tableHTML += row;
    });
    tableBody.innerHTML = tableHTML;
    const recordCountEl = document.getElementById("recordCount");

    const startNum = Math.min((page - 1) * ITEMS_PER_PAGE + 1, items.length);
    const endNum = Math.min(page * ITEMS_PER_PAGE, items.length);

    recordCountEl.textContent =
      `Showing ${startNum}–${endNum} of ${items.length} results`;

  }

  function renderPagination(totalItems) {
    paginationContainer.innerHTML = '';
    const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
    if (totalPages <= 1) return;

    const ul = document.createElement('ul');
    ul.className = 'pagination-list';

    // Previous button
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

    // Page numbers
    let startPage = Math.max(1, currentPage - 2);
    let endPage = Math.min(totalPages, currentPage + 2);

    if (startPage > 1) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = '#';
      a.innerText = '1';
      a.addEventListener('click', (e) => {
        e.preventDefault();
        currentPage = 1;
        const filtered = filterItems();
        renderTable(filtered, currentPage);
        renderPagination(filtered.length);
      });
      li.appendChild(a);
      ul.appendChild(li);
      if (startPage > 2) {
        const ellipsis = document.createElement('li');
        ellipsis.className = 'ellipsis';
        ellipsis.innerText = '...';
        ul.appendChild(ellipsis);
      }
    }

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

    if (endPage < totalPages) {
      if (endPage < totalPages - 1) {
        const ellipsis = document.createElement('li');
        ellipsis.className = 'ellipsis';
        ellipsis.innerText = '...';
        ul.appendChild(ellipsis);
      }
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = '#';
      a.innerText = totalPages;
      a.addEventListener('click', (e) => {
        e.preventDefault();
        currentPage = totalPages;
        const filtered = filterItems();
        renderTable(filtered, currentPage);
        renderPagination(filtered.length);
      });
      li.appendChild(a);
      ul.appendChild(li);
    }

    // Next button
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
    if (query) {
      params.set('query', query);
    }
    selectedFeatures.forEach((f) => params.append('features', f));
    selectedTools.forEach((t) => params.append('tools', t));

    const newUrl = `${window.location.pathname}?${params.toString()}`;
    history.pushState({ path: newUrl }, '', newUrl);
  }

  function updateResults() {
    currentPage = 1;

    const anyFeatureChecked = document.querySelectorAll('.exerciseTypeInput:checked').length > 0;
    const anyToolChecked = document.querySelectorAll('.toolInput:checked').length > 0;
    const queryValue = document.querySelector('input[name="query"]').value.trim();

    if (!anyFeatureChecked && !anyToolChecked && !queryValue) {
      currentItems = [...allItems];
    }

    currentPage = 1;

    const filtered = filterItems();
    renderTable(filtered, currentPage);
    renderPagination(filtered.length);
    updateURL();
  }


  checkboxes.forEach((checkbox) => {
    checkbox.addEventListener('change', function (e) {
      console.log('Checkbox changed!', e.target.value, e.target.checked);
      updateResults();
    });
  });

  async function handleKeywordSearch(e) {
    e.preventDefault();
    console.log('handleKeywordSearch called');
    const keyword = this.dataset.keyword;
    document.querySelector('input[name="query"]').value = keyword;
    debouncedSearch(keyword);
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
      if (!response.ok) {
        throw new Error('Network response was not ok');
      }
      const data = await response.json();
      console.log('API Response:', data);
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

    if (query) {
      searchInput.value = query;
    }

    document.querySelectorAll('.exerciseTypeInput').forEach((cb) => {
      if (features.includes(cb.value)) {
        cb.checked = true;
      }
    });

    document.querySelectorAll('.toolInput').forEach((cb) => {
      if (tools.includes(cb.value)) {
        cb.checked = true;
      }
    });
  }

  // Initial render
  applyFiltersFromURL();
  const initialQuery = new URLSearchParams(window.location.search).get('query');
  if (initialQuery) {
    debouncedSearch(initialQuery);
  } else {
    updateResults();
  }
});
