/**
 * Tag analytics (views/tag-analytics.ejs): the visits chart of the last 30 days, from /api/tags/:id/analytics.
 * Colors come from the theme (CSS variables) and the tag's own color.
 */
(function () {
  'use strict';

  const page = document.getElementById('tagAnalytics');
  const canvas = document.getElementById('visitsChart');
  if (!page || !canvas || typeof Chart === 'undefined') return;

  async function draw() {
    const response = await fetch(`/api/tags/${page.dataset.tagId}/analytics`);
    const data = await response.json();
    const counts = new Map((data.visitsByDate || []).map(item => [item.date, item.count]));

    const labels = [];
    const visits = [];
    const today = new Date();
    for (let i = 29; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      labels.push(date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }));
      visits.push(counts.get(date.toISOString().split('T')[0]) || 0);
    }

    const styles = getComputedStyle(document.documentElement);
    const muted = styles.getPropertyValue('--chart-muted-text').trim();
    const grid = styles.getPropertyValue('--border').trim();
    const color = page.dataset.tagColor || styles.getPropertyValue('--primary').trim();

    new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels,
        datasets: [{ label: 'Visits', data: visits, borderColor: color, backgroundColor: `${color}22`, tension: 0.3, fill: true }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0, color: muted }, grid: { color: grid } },
          x: { ticks: { color: muted, maxRotation: 45, minRotation: 45 }, grid: { color: grid } }
        }
      }
    });
  }

  draw().catch(error => console.error('Failed to load tag analytics:', error));
})();
