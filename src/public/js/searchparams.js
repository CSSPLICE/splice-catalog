document.getElementById('filterForm').addEventListener('submit', function (e) {
  e.preventDefault();

  const form = e.target;
  const query = form.query.value;
  const selectedFeatures = Array.from(form.querySelectorAll('.exerciseTypeInput:checked'))
    .map((cb) => cb.value)
    .join(',');
  const selectedTools = Array.from(form.querySelectorAll('.toolInput:checked'))
    .map((cb) => cb.value)
    .join(',');

  const url = new URL(window.location.href);
  url.searchParams.set('query', query);
  url.searchParams.set('features', selectedFeatures);
  url.searchParams.set('tool', selectedTools);
  url.searchParams.set('page', '1');

  window.location.href = url.toString(); // Trigger page reload with updated query params
});
