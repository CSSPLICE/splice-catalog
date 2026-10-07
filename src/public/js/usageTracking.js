document.addEventListener('click', (event) => {
  if (!event.isTrusted || !(event.target instanceof Element)) return;

  const anchor = event.target.closest('a[data-usage-external-click]');
  if (!anchor) return;

  const encodedIdentifier = anchor.dataset.itemIdentifier || anchor.dataset.itemPersistentId;
  const catalogType = anchor.dataset.catalogType || 'SLC_ITEM';
  const linkType = anchor.dataset.linkType;
  if (!encodedIdentifier) return;

  let itemIdentifier;
  try {
    itemIdentifier = decodeURIComponent(encodedIdentifier);
  } catch {
    return;
  }

  fetch('/usage/external-click', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ catalogType, itemIdentifier, linkType }),
    keepalive: true,
  }).catch(() => {});
});
