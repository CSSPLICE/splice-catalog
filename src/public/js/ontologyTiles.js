$(document).ready(function () {
  const initialParentId = getParentIdFromURL();
  loadCategories(initialParentId);

  // Method to load categories (top-level or child categories)
  function loadCategories(parentId) {
    const url = parentId ? `/ontology/tiles-data/${parentId}` : '/ontology/tiles-data';
    $.ajax({
      url: url,
      method: 'GET',
      success: function (response) {
        renderTiles(response.categories);
        renderBreadcrumb(response.breadcrumb);
      },
      error: function (xhr, status, error) {
        console.error('Error fetching ontology data:', error);
      }
    });
  }

  // Method to render tiles
  function renderTiles(categories) {
    const container = $('#ontology-container');
    container.empty();
    categories.forEach(function (category) {
      const label = category.label.replace(/_/g, ' ');
      const tile = $(`
        <div class="tile" data-category-id="${category.id}">
          <h3>${label}</h3>
        </div>
      `);
      container.append(tile);
    });
  }

  // Method to render breadcrumb
  function renderBreadcrumb(breadcrumb) {
    const container = $('.breadcrumb-container');
    container.empty();
    breadcrumb.forEach(function (crumb, index) {
      const label = crumb.label;
      if (index > 0) container.append(' / ');

      if (index < breadcrumb.length - 1) {
        container.append(`<a href="#" data-category-id="${crumb.id}">${label}</a>`);
      } else {
        container.append(`<span>${label}</span>`);
      }
    });
  }

  // Method for tile clicks
  $('#ontology-container').on('click', '.tile', function () {
    const categoryId = $(this).data('category-id');
    history.pushState({ parentId: categoryId }, '', `?parentId=${categoryId}`);
    loadCategories(categoryId); 
  });

  // Method for breadcrumb clicks
  $(document).on('click', '.breadcrumb a', function (e) {
    e.preventDefault();
    const categoryId = $(this).data('category-id');
    history.pushState({ parentId: categoryId }, '', `?parentId=${categoryId}`);
    loadCategories(categoryId); // Fetch categories for clicked breadcrumb level
  });

  // back/forward navigation
  window.onpopstate = function (event) {
    const parentId = event.state ? event.state.parentId : null;
    loadCategories(parentId);
  };

  function getParentIdFromURL() {
    const params = new URLSearchParams(window.location.search);
    const parentId = params.get('parentId');
    return parentId ? Number(parentId) : null;
  }
});
