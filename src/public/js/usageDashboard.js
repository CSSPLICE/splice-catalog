(() => {
  const searchInput = document.getElementById('catalogEntrySearch');
  const table = document.querySelector('.usage-table');
  if (!searchInput || !table) return;

  const rows = Array.from(table.querySelectorAll('[data-searchable-row]'));
  const emptyState = table.querySelector('[data-search-empty]');

  searchInput.addEventListener('input', () => {
    const query = searchInput.value.trim().toLocaleLowerCase();
    let visibleCount = 0;

    rows.forEach((row) => {
      const matches = row.dataset.searchText.toLocaleLowerCase().includes(query);
      row.hidden = !matches;
      if (matches) visibleCount += 1;
    });

    if (emptyState) emptyState.hidden = query.length === 0 || visibleCount > 0;
  });
})();
