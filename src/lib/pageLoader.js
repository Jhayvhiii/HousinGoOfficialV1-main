/**
 * HousinGo Modular Page & Component Loader
 * Fetches all focused HTML partials from /pages and /components in parallel,
 * mounts them into index.html, and then boots index.js so all DOM elements exist.
 */

const PAGE_PARTIALS = [
  'pages/home.html',
  'pages/about.html',
  'pages/login.html',
  'pages/register.html',
  'pages/contact.html',
  'pages/admin-dashboard.html',
  'pages/landlord-dashboard.html',
  'pages/tenant-dashboard.html',
  'pages/post-property.html',
  'pages/user-settings.html',
  'pages/browse.html',
  'pages/help.html',
];

const COMPONENT_PARTIALS = [
  'components/modals.html',
];

async function fetchPartial(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) {
    throw new Error(`Failed to load ${url} (HTTP ${res.status})`);
  }
  return res.text();
}

async function bootstrapHousinGo() {
  const pagesRoot = document.getElementById('app-pages');
  const modalsRoot = document.getElementById('app-modals');

  if (!pagesRoot || !modalsRoot) {
    console.error('❌ Required mount containers #app-pages or #app-modals not found in index.html.');
    return;
  }

  try {
    const [pagesHtml, componentsHtml] = await Promise.all([
      Promise.all(PAGE_PARTIALS.map(fetchPartial)),
      Promise.all(COMPONENT_PARTIALS.map(fetchPartial)),
    ]);

    pagesRoot.innerHTML = pagesHtml.join('\n');
    modalsRoot.innerHTML = componentsHtml.join('\n');

    // Load main application logic only AFTER all focused page partials are mounted
    const appScript = document.createElement('script');
    appScript.src = 'index.js';
    appScript.onerror = () => console.error('❌ Failed to load index.js');
    document.body.appendChild(appScript);
  } catch (error) {
    console.error('❌ Error mounting HousinGo pages:', error);
    pagesRoot.innerHTML = `
      <div style="max-width: 600px; margin: 80px auto; background: #FFF5F5; border: 2px solid #FF6B6B; color: #9B1C1C; padding: 30px; border-radius: 12px; text-align: center;">
        <h2 style="margin-bottom: 10px;">⚠️ Failed to Load Page Modules</h2>
        <p>${error.message}</p>
        <p style="margin-top: 12px; font-size: 14px;">Make sure you are running the app via <code>npm run dev</code> (HTTP server), not opening <code>index.html</code> directly via <code>file://</code>.</p>
      </div>
    `;
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrapHousinGo);
} else {
  bootstrapHousinGo();
}
