/**
 * Shared Chart.js settings (load right after /vendor/chart.umd.js). Hovering anywhere over a chart shows the values
 * of the nearest day, not only exactly on a point, and a thin vertical line marks that day.
 */
(function () {
  'use strict';
  if (typeof Chart === 'undefined') return;

  Chart.defaults.interaction.mode = 'index';
  Chart.defaults.interaction.intersect = false;

  Chart.register({
    id: 'hoverLine',
    afterDatasetsDraw(chart) {
      const active = chart.tooltip && chart.tooltip.getActiveElements();
      if (!active || !active.length || chart.config.type !== 'line') return;
      const { ctx, chartArea } = chart;
      const x = active[0].element.x;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.lineWidth = 1;
      ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--muted-foreground').trim() || '#888888';
      ctx.globalAlpha = 0.5;
      ctx.stroke();
      ctx.restore();
    }
  });
})();
