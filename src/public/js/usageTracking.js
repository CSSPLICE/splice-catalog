(() => {
  if (window.spliceUsageTrackingInitialized) return;
  window.spliceUsageTrackingInitialized = true;

  function send(path, data) {
    try {
      fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        keepalive: true,
      }).catch(() => {});
    } catch {
      // Navigation must also survive synchronous failures (for example, unavailable fetch).
    }
  }

  function trackActivation(event) {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    if (event.type === 'auxclick' ? event.button !== 1 : event.button !== 0) return;
    const anchor = event.target.closest('a[data-usage-entry-click], a[data-usage-external-click]');
    if (!anchor) return;
    const encodedIdentifier = anchor.dataset.itemIdentifier || anchor.dataset.itemPersistentId;
    if (!encodedIdentifier) return;
    let itemIdentifier;
    try {
      itemIdentifier = decodeURIComponent(encodedIdentifier);
    } catch {
      return;
    }
    const external = anchor.hasAttribute('data-usage-external-click');
    send(external ? '/usage/external-click' : '/usage/entry-click', {
      catalogType: anchor.dataset.catalogType || 'SLC_ITEM',
      itemIdentifier,
      ...(external ? { linkType: anchor.dataset.linkType } : {}),
    });
  }

  document.addEventListener('click', trackActivation);
  document.addEventListener('auxclick', trackActivation);
  // Capture once, including submits whose local search handler prevents native navigation.
  document.addEventListener(
    'submit',
    (event) => {
      if (!event.isTrusted || !(event.target instanceof HTMLFormElement) || event.target.id !== 'searchForm') return;
      const input = event.target.querySelector('input[name="query"]');
      const query = input?.value.trim().replace(/\s+/g, ' ');
      if (query && query.length <= 500) send('/usage/web-search', { query });
    },
    true,
  );
})();
