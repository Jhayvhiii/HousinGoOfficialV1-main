/**
 * HousinGo Modular Bootstrap & Page Loader
 * 1. Imports Supabase client and all services so they are GUARANTEED ready on window
 * 2. Fetches all focused HTML partials from /pages and /components in parallel
 * 3. Mounts them into index.html and boots index.js
 */

import { getSupabaseClient } from './supabaseClient.js';
import { authService } from '../services/authService.js';
import { propertyService } from '../services/propertyService.js';
import { applicationService } from '../services/applicationService.js';
import { inquiryService } from '../services/inquiryService.js';
import { reviewService } from '../services/reviewService.js';
import { complaintService } from '../services/complaintService.js';
import { adminService } from '../services/adminService.js';

// Explicitly bind all services onto window BEFORE index.js ever runs
if (typeof window !== 'undefined') {
  try {
    window.supabaseClient = getSupabaseClient();
  } catch (err) {
    console.error('❌ Supabase client init failed during bootstrap:', err);
  }
  window.getSupabaseClient = getSupabaseClient;
  window.authService = authService;
  window.propertyService = propertyService;
  window.applicationService = applicationService;
  window.inquiryService = inquiryService;
  window.reviewService = reviewService;
  window.complaintService = complaintService;
  window.adminService = adminService;
}

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

    // Load main application logic only AFTER all services & HTML partials are ready
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
