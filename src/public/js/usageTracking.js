(() => {
  if (window.spliceUsageTrackingInitialized) return;
  window.spliceUsageTrackingInitialized = true;

  const meta = document.querySelector('meta[name="splice-usage-token"]');
  let credential = meta ? { csrf: meta.content, expiresAt: Number(meta.dataset.expiresAt) } : null;
  let renewal;
  let renewalTimer;
  function scheduleRenewal() {
    clearTimeout(renewalTimer);
    if (credential)
      renewalTimer = setTimeout(
        () => {
          try {
            renew().catch(() => {});
          } catch {
            /* Tracking must survive unavailable fetch. */
          }
        },
        Math.max(100, credential.expiresAt - Date.now() + 20),
      );
  }
  function renew() {
    if (renewal) return renewal;
    renewal = fetch('/usage/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      credentials: 'same-origin',
      keepalive: true,
    })
      .then((response) => {
        if (!response.ok) throw new Error('Tracking session unavailable');
        return response.json();
      })
      .then((value) => {
        credential = value;
        scheduleRenewal();
        return value;
      })
      .finally(() => {
        renewal = null;
      });
    return renewal;
  }
  scheduleRenewal();
  for (const name of ['pageshow', 'focus'])
    window.addEventListener(name, () => {
      if (credential && credential.expiresAt <= Date.now()) {
        try {
          renew().catch(() => {});
        } catch {
          /* Browsing remains available. */
        }
      }
    });

  function send(path, data) {
    try {
      // A new identifier per deliberate activation; retries retain that identifier.
      const eventId = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join('');
      function post(retry) {
        return fetch(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(credential ? { 'X-Usage-Token': credential.csrf } : {}) },
          credentials: 'same-origin',
          body: JSON.stringify({ ...data, eventId }),
          keepalive: true,
        }).then((response) => {
          if (response.status === 401 && retry) return renew().then(() => post(false));
          // The provisional ledger reconciles a retry of an ambiguously stored ID.
          if (response.status === 503 && retry) return post(false);
        });
      }
      // HTML normally supplies credentials synchronously. Off mode needs none.
      post(true).catch(() => {});
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
