/**
 * LineNumbers — attaches a non-selectable line-number gutter to a <textarea>.
 *
 * Usage:
 *   <textarea data-line-numbers ...></textarea>   → auto-wired on DOMContentLoaded
 *   LineNumbers(document.getElementById('myTextarea'));   → manual
 *
 * The gutter is an absolutely-positioned overlay so the textarea keeps its
 * normal sizing / resize behaviour. The gutter counts newline-delimited lines
 * (matching paste-view.ejs), so the textarea is switched to no-wrap /
 * horizontal-scroll to keep the numbers aligned.
 */
(function () {
  'use strict';

  function LineNumbers(textarea) {
    if (!textarea || textarea.dataset.lnAttached) return;
    textarea.dataset.lnAttached = '1';

    var wrap = document.createElement('div');
    wrap.className = 'ln-wrap';

    var gutter = document.createElement('div');
    gutter.className = 'ln-gutter';
    gutter.setAttribute('aria-hidden', 'true');

    var inner = document.createElement('div');
    inner.className = 'ln-gutter-inner';
    gutter.appendChild(inner);

    textarea.parentNode.insertBefore(wrap, textarea);
    wrap.appendChild(textarea);
    wrap.appendChild(gutter);
    textarea.classList.add('ln-input');

    var lastCount = -1;

    function render() {
      var count = (textarea.value.match(/\n/g) || []).length + 1;
      if (count !== lastCount) {
        lastCount = count;
        var lines = '';
        for (var i = 1; i <= count; i++) lines += i + '\n';
        inner.textContent = lines;
      }
      inner.style.transform = 'translateY(' + (-textarea.scrollTop) + 'px)';
    }

    textarea.addEventListener('input', render);
    textarea.addEventListener('scroll', function () {
      inner.style.transform = 'translateY(' + (-textarea.scrollTop) + 'px)';
    });

    if (window.ResizeObserver) {
      new ResizeObserver(render).observe(textarea);
    }

    render();
    textarea._lineNumbersRender = render;
  }

  window.LineNumbers = LineNumbers;

  document.addEventListener('DOMContentLoaded', function () {
    var nodes = document.querySelectorAll('textarea[data-line-numbers]');
    for (var i = 0; i < nodes.length; i++) LineNumbers(nodes[i]);
  });
}());
