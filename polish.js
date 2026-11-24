/* Presentation only: keep the quiz engine unchanged. */
(function () {
  'use strict';
  var app = document.getElementById('app');
  function refresh() {
    var upload = document.getElementById('dropzone');
    if (upload) upload.closest('.card').classList.add('upload-card');
    app.querySelectorAll('.url-box:not(details), .sheet-box:not(details)').forEach(function (box) {
      var details = document.createElement('details');
      details.className = box.className + ' import-option';
      var heading = box.querySelector('h3');
      var summary = document.createElement('summary');
      summary.textContent = heading.textContent;
      heading.remove();
      details.appendChild(summary);
      while (box.firstChild) details.appendChild(box.firstChild);
      box.replaceWith(details);
    });
    app.querySelectorAll('.step.current').forEach(function (step) {
      step.setAttribute('aria-current', 'step');
    });
  }
  new MutationObserver(refresh).observe(app, {childList: true, subtree: true});
  refresh();
}());
