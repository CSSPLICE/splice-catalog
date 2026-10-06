document.addEventListener('click', (event) => {
  if (!event.isTrusted || !(event.target instanceof Element)) return;

  const anchor = event.target.closest('a[data-usage-external-click]');
  if (!anchor) return;

  const encodedPersistentID = anchor.dataset.itemPersistentId;
  const linkType = anchor.dataset.linkType;
  if (!encodedPersistentID || linkType !== 'iframe_url') return;

  let itemPersistentID;
  try {
    itemPersistentID = decodeURIComponent(encodedPersistentID);
  } catch {
    return;
  }

  fetch('/usage/external-click', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemPersistentID, linkType }),
    keepalive: true,
  }).catch(() => {});
});
