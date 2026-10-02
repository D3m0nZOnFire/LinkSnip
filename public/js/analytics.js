/**
 * Analytics page (views/analytics.ejs, also /stats/:token): the charts from #analyticsData, the QR code and the
 * share links (/api/share-links/:type/:id). Chart.js comes from /vendor/chart.umd.js.
 */
(function () {
  'use strict';

  const page = document.getElementById('analyticsPage');
  const dataEl = document.getElementById('analyticsData');
  if (!page || !dataEl) return;
  const data = JSON.parse(dataEl.textContent);
  const { type, id, slug } = page.dataset;

  // ─── Charts ───────────────────────────────────────────────────────────────
  if (typeof Chart !== 'undefined') {
    // Canvas can't read CSS variables: take the theme's colors once
    const css = getComputedStyle(document.documentElement);
    const token = (name) => css.getPropertyValue(name).trim();
    const primary = token('--primary');
    const muted = token('--muted-foreground');
    const grid = token('--border');
    const tint = (hex, alpha) => {
      const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
      return m ? `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})` : hex;
    };
    Chart.defaults.font.family = token('--font-sans');
    const colors = [primary, '#60a5fa', '#f472b6', '#fbbf24', '#a78bfa', '#fb923c', '#2dd4bf', '#e879f9'];

    const events = document.getElementById('eventsChart');
    if (events) {
      new Chart(events, {
        type: 'line',
        data: {
          labels: data.byDate.map(d => d.date),
          datasets: [{
            label: data.eventLabel,
            data: data.byDate.map(d => d.count),
            borderColor: primary,
            backgroundColor: tint(primary, 0.1),
            fill: true,
            tension: 0.3,
            pointRadius: data.byDate.length > 60 ? 0 : 3
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: { ticks: { color: muted, maxTicksLimit: 8 }, grid: { color: grid } },
            y: { ticks: { color: muted, precision: 0 }, grid: { color: grid }, beginAtZero: true }
          },
          plugins: { legend: { display: false } }
        }
      });
    }

    const doughnut = (canvasId, rows, key) => {
      const canvas = document.getElementById(canvasId);
      if (!canvas) return;
      new Chart(canvas, {
        type: 'doughnut',
        data: {
          labels: rows.map(r => r[key] || 'Unknown'),
          datasets: [{ data: rows.map(r => r.count), backgroundColor: colors.slice(0, rows.length), borderWidth: 0 }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '62%',
          plugins: { legend: { position: 'bottom', labels: { color: muted, padding: 14, boxWidth: 12 } } }
        }
      });
    };
    doughnut('devicesChart', data.devices, 'device');
    doughnut('browsersChart', data.browsers, 'browser');
  }

  // ─── Modals ───────────────────────────────────────────────────────────────
  document.querySelectorAll('[data-close-modal]').forEach(button => {
    button.addEventListener('click', () => closeModal(button.dataset.closeModal));
  });

  const qrButton = page.querySelector('[data-open-qr]');
  if (qrButton) {
    qrButton.addEventListener('click', () => {
      document.getElementById('qrcodeImage').src = `/qrcode/${type}/${encodeURIComponent(slug)}?theme=light`;
      openModal('qrcodeModal');
    });
  }

  // ─── Share links ──────────────────────────────────────────────────────────
  const shareButton = page.querySelector('[data-open-share]');
  if (!shareButton) return;
  const API = `/api/share-links/${type}/${id}`;
  const list = document.getElementById('shareLinksList');
  const date = (value) => value ? new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '';

  function row(link) {
    const item = document.createElement('div');
    item.className = 'share-item';
    const text = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = link.label || 'Untitled link';
    const meta = document.createElement('span');
    meta.className = 'muted';
    meta.textContent = `Created ${date(link.createdAt)} · ${link.expiresAt ? `expires ${date(link.expiresAt)}` : 'never expires'} · ${link.viewCount} view${link.viewCount === 1 ? '' : 's'}`;
    text.append(name, meta);
    const revoke = document.createElement('button');
    revoke.type = 'button';
    revoke.className = 'btn btn-small btn-secondary';
    revoke.textContent = 'Revoke';
    revoke.dataset.revoke = link.id;
    item.append(text, revoke);
    return item;
  }

  async function load() {
    try {
      const response = await fetch(API);
      const result = await response.json();
      if (!result.success) throw new Error(result.error || 'Could not load the share links');
      document.getElementById('shareLinksCount').textContent =
        result.limit === null ? `(${result.links.length})` : `(${result.links.length} of ${result.limit})`;
      list.replaceChildren(...(result.links.length ? result.links.map(row) : [Object.assign(document.createElement('p'), { className: 'field-help', textContent: 'No share links yet.' })]));
    } catch (error) {
      list.replaceChildren(Object.assign(document.createElement('p'), { className: 'field-error', textContent: error.message }));
    }
  }

  shareButton.addEventListener('click', async () => {
    document.getElementById('newShareLink').hidden = true;
    await load();
    openModal('shareLinksModal');
  });

  list.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-revoke]');
    if (!button) return;
    if (!confirm('Revoke this link? Anyone using it loses access.')) return;
    const response = await fetch(`/api/share-links/${button.dataset.revoke}`, { method: 'DELETE' });
    const result = await response.json().catch(() => ({}));
    if (!result.success) showToast(result.error || 'Could not revoke the link', 'error');
    load();
  });

  document.getElementById('createShareLinkForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const response = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: document.getElementById('shareLinkLabel').value,
        expiresInDays: document.getElementById('shareLinkExpiry').value || null
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!result.success) return showToast(result.error || result.message || 'Could not create the link', 'error');
    document.getElementById('shareLinkLabel').value = '';
    document.getElementById('newShareLinkUrl').value = result.shareUrl;
    document.getElementById('newShareLink').hidden = false;
    load();
  });

  document.getElementById('copyShareLinkBtn').addEventListener('click', async () => {
    const button = document.getElementById('copyShareLinkBtn');
    try {
      await navigator.clipboard.writeText(document.getElementById('newShareLinkUrl').value);
      button.textContent = 'Copied';
    } catch (_) {
      document.getElementById('newShareLinkUrl').select();
      button.textContent = 'Select and copy';
    }
    setTimeout(() => { button.textContent = 'Copy'; }, 1500);
  });
})();
