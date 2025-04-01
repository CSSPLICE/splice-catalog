// catalog.js

function openModal() {
  let description = 'This is a detailed description for all items. It contains more information about the exercise.';
  document.getElementById('fullDescription').innerText = description;
  document.getElementById('descriptionModal').style.display = 'block';
}

function closeModal() {
  document.getElementById('descriptionModal').style.display = 'none';
}

// Close modal if user clicks outside of it
window.onclick = function (event) {
  let modal = document.getElementById('descriptionModal');
  if (event.target === modal) {
    modal.style.display = 'none';
  }
};
