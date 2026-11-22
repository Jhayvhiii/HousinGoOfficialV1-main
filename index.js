/**
 * HousinGo Main Application Controller
 * Connects modular HTML pages (/pages/*.html, /components/modals.html)
 * to the Supabase service layer (/src/services/*.js).
 * Zero mock data, zero hardcoded credentials.
 */

// ============================================================================
// Global State
// ============================================================================
let currentUser = null;
let authListenerInitialized = false;
let cachedAvailableProperties = [];
let selectedHomeKeyword = '';
let currentModalImages = [];
let modalCurrentImageIndex = 0;
let activeConversations = [];
let selectedConversationUserId = null;
let selectedConversationPropertyId = null;
let selectedNewRecipient = null;
let editingExistingImageUrls = [];
let streamClient = null;
let isStreamConnected = false;
let homeMap = null;
let homeMapMarkers = new Map();
let userGpsMarker = null;
let userGpsCoords = null;
let postPropertyMap = null;
let postPropertyPin = null;

const DEFAULT_EAST_REMBO = { lat: 14.5547, lng: 121.0596 };

// ============================================================================
// Utility Helpers
// ============================================================================
function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeJsAttr(str) {
    return String(str ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/"/g, '&quot;')
        .replace(/\r?\n/g, ' ');
}

function formatPeso(amount) {
    const num = Number(amount || 0);
    return `₱${num.toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function renderStars(rating) {
    const r = Math.round(Number(rating || 0));
    return '★'.repeat(Math.max(0, Math.min(5, r))) + '☆'.repeat(Math.max(0, 5 - Math.min(5, r)));
}

const AMENITY_ICONS = {
    'Wi-Fi': '📶',
    'Aircon': '❄️',
    'Water Included': '💧',
    'Electric Included': '⚡',
    'Kitchen Access': '🍳',
    'Parking': '🚗',
    'Private Bathroom': '🚿',
    'Pet Friendly': '🐾',
};

const META_OPEN = '[HOUSINGO_META]';
const META_CLOSE = '[/HOUSINGO_META]';

function normalizeSafeUrl(rawUrl) {
    const val = String(rawUrl || '').trim();
    if (!val) return '';
    const withProto = /^https?:\/\//i.test(val) ? val : `https://${val}`;
    try {
        const parsed = new URL(withProto);
        return (parsed.protocol === 'http:' || parsed.protocol === 'https:') ? parsed.href : '';
    } catch {
        return '';
    }
}

function encodePropertyDescription(plainText, meta = {}) {
    const cleanText = (plainText || '').trim();
    const cleanedMeta = {
        type: meta.type || '',
        slots: meta.slots ? Number(meta.slots) : null,
        area: (meta.area || '').trim(),
        min_occupants: (meta.min_occupants || '').trim(),
        min_stay: (meta.min_stay || '').trim(),
        advance_payment: (meta.advance_payment || '').trim(),
        move_in_date: (meta.move_in_date || '').trim(),
        landmarks: (meta.landmarks || '').trim(),
        map_link: (meta.map_link || '').trim(),
        rules: (meta.rules || '').trim(),
        amenities: Array.isArray(meta.amenities) ? meta.amenities : [],
        amenity_fees: meta.amenity_fees && typeof meta.amenity_fees === 'object' ? meta.amenity_fees : {},
        contact_name: (meta.contact_name || '').trim(),
        contact_phone: (meta.contact_phone || '').trim(),
        social_link: normalizeSafeUrl(meta.social_link || ''),
        landlord_profile: meta.landlord_profile && typeof meta.landlord_profile === 'object' ? meta.landlord_profile : null,
        payment_info: meta.payment_info && typeof meta.payment_info === 'object' ? meta.payment_info : null,
        approval_status: meta.approval_status || '',
        rejection_reason: (meta.rejection_reason || '').trim(),
        lat: meta.lat !== undefined && meta.lat !== '' && !Number.isNaN(Number(meta.lat)) ? Number(meta.lat) : null,
        lng: meta.lng !== undefined && meta.lng !== '' && !Number.isNaN(Number(meta.lng)) ? Number(meta.lng) : null,
    };
    return `${cleanText}\n\n${META_OPEN}${JSON.stringify(cleanedMeta)}${META_CLOSE}`;
}

function parseComplaintReason(rawReason) {
    const raw = String(rawReason || '').trim();
    const match = raw.match(/^\[([^\]]+)\]\s*(.*)$/s);
    if (match) {
        return { category: match[1].trim(), details: match[2].trim() };
    }
    return { category: 'Other Concerns', details: raw };
}

function getPropertyApprovalState(property, meta = null) {
    const parsedMeta = meta || parsePropertyDescription(property?.description).meta;
    if (parsedMeta.approval_status) return parsedMeta.approval_status;
    return property?.availability_status === 'hidden' ? 'pending_approval' : 'approved';
}

function parsePropertyDescription(rawDescription) {
    const raw = String(rawDescription || '');
    const startIdx = raw.indexOf(META_OPEN);
    const endIdx = raw.indexOf(META_CLOSE);

    if (startIdx !== -1 && endIdx > startIdx) {
        const text = raw.slice(0, startIdx).trim();
        const jsonStr = raw.slice(startIdx + META_OPEN.length, endIdx);
        try {
            const meta = JSON.parse(jsonStr);
            return { text, meta: meta || {} };
        } catch {
            return { text: raw, meta: {} };
        }
    }
    return { text: raw, meta: {} };
}

function statusBadgeHtml(status) {
    const s = String(status || '').toLowerCase();
    const map = {
        available: { bg: '#E8F5E9', color: '#1B5E20' },
        active: { bg: '#E8F5E9', color: '#1B5E20' },
        approved: { bg: '#E8F5E9', color: '#1B5E20' },
        resolved: { bg: '#E8F5E9', color: '#1B5E20' },
        pending: { bg: '#FFF8E1', color: '#B54708' },
        occupied: { bg: '#FFF8E1', color: '#B54708' },
        under_review: { bg: '#E3F2FD', color: '#0D47A1' },
        open: { bg: '#FFF0F0', color: '#B42318' },
        rejected: { bg: '#FFF0F0', color: '#B42318' },
        suspended: { bg: '#FFF0F0', color: '#B42318' },
        removed: { bg: '#FFF0F0', color: '#B42318' },
        hidden: { bg: '#ECEFF1', color: '#455A64' },
        cancelled: { bg: '#ECEFF1', color: '#455A64' },
        dismissed: { bg: '#ECEFF1', color: '#455A64' },
    };
    const style = map[s] || { bg: '#F5F5DC', color: '#8B4513' };
    return `<span style="display:inline-block;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:700;text-transform:capitalize;background:${style.bg};color:${style.color};">${escapeHtml(s.replace(/_/g, ' '))}</span>`;
}

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `hg-toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(20px)';
        setTimeout(() => toast.remove(), 260);
    }, 4000);
}

function showAuthAlert(elementId, message, type = 'error') {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.textContent = message;
    el.className = `auth-alert show ${type}`;
}

function hideAuthAlert(elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.textContent = '';
    el.className = 'auth-alert';
}

function getFriendlyAuthError(error) {
    const msg = (error?.message || String(error || 'Something went wrong')).trim();
    const lower = msg.toLowerCase();
    if (lower.includes('invalid login credentials')) return 'Incorrect email or password. Please try again.';
    if (lower.includes('email not confirmed')) return 'Please confirm your email address first via the link sent to your inbox.';
    if (lower.includes('already registered') || lower.includes('already been registered')) return 'An account with this email already exists. Try logging in instead.';
    if (lower.includes('password should be at least')) return 'Password must be at least 6 characters long.';
    if (lower.includes('rate limit')) return 'Too many attempts. Please wait a moment and try again.';
    return msg;
}

// ============================================================================
// Authentication, Session Persistence & Role Guards
// ============================================================================
function normalizeUserProfile(profile, authUser = null) {
    if (!profile && !authUser) return null;
    const meta = authUser?.user_metadata || {};
    const fullName = (profile?.full_name || meta.full_name || '').trim();
    const parts = fullName ? fullName.split(/\s+/) : ['User'];
    const role = (profile?.role || meta.role || 'tenant').toLowerCase();
    const status = (profile?.status || 'active').toLowerCase();
    const id = profile?.id || authUser?.id;
    const email = profile?.email || authUser?.email || '';
    const phone = profile?.phone || meta.phone || '';

    return {
        id,
        user_id: id,
        full_name: fullName || email.split('@')[0] || 'User',
        first_name: parts[0] || 'User',
        last_name: parts.slice(1).join(' ') || '',
        email,
        phone,
        mobile: phone,
        role,
        status,
        is_verified: Boolean(profile?.is_verified),
        created_at: profile?.created_at || null,
        avatar_url: meta.avatar_url || '',
        bio: meta.bio || '',
        hobbies: meta.hobbies || '',
        house_address: meta.house_address || '',
        payment_methods: Array.isArray(meta.payment_methods) ? meta.payment_methods : [],
        payment_gcash: meta.payment_gcash || '',
        payment_maya: meta.payment_maya || '',
        payment_bank: meta.payment_bank || '',
        payment_card: meta.payment_card || '',
        qrph_url: meta.qrph_url || '',
        wishlist: Array.isArray(meta.wishlist) ? meta.wishlist : [],
        verification_docs: meta.verification_docs && typeof meta.verification_docs === 'object' ? meta.verification_docs : {},
    };
}

function getDashboardForRole(role) {
    const r = (role || 'tenant').toLowerCase();
    if (r === 'admin') return 'admin-dashboard';
    if (r === 'landlord') return 'landlord-dashboard';
    return 'tenant-dashboard';
}

function updateLandlordVerificationUI() {
    const isUnverified = Boolean(currentUser && currentUser.role === 'landlord' && !currentUser.is_verified);
    const dashBanner = document.getElementById('landlord-verification-banner');
    const postBanner = document.getElementById('post-property-verification-banner');
    const addBtn = document.getElementById('landlord-add-property-btn');
    const submitBtn = document.getElementById('post-property-submit-btn');

    if (dashBanner) dashBanner.classList.toggle('show', isUnverified);
    if (postBanner) postBanner.classList.toggle('show', isUnverified);
    if (addBtn) {
        addBtn.disabled = isUnverified;
        addBtn.title = isUnverified ? 'Awaiting admin verification' : '';
    }
    if (submitBtn) {
        submitBtn.disabled = isUnverified;
        submitBtn.title = isUnverified ? 'Awaiting admin verification' : '';
    }
}

async function applyAuthenticatedUser(session, profile) {
    if (!session || !session.user) {
        currentUser = null;
        updateNavForLoggedInUser();
        updateLandlordVerificationUI();
        return null;
    }

    const normalized = normalizeUserProfile(profile, session.user);
    if (normalized.status === 'suspended') {
        await window.authService?.signOut();
        currentUser = null;
        updateNavForLoggedInUser();
        showAuthAlert('login-alert', 'Your account has been suspended by an administrator.', 'error');
        showToast('Your account is suspended. Please contact support.', 'error');
        showPage('login');
        return null;
    }

    currentUser = normalized;
    updateNavForLoggedInUser();
    updateLandlordVerificationUI();
    refreshNotificationBadge();
    if (cachedAvailableProperties.length) renderHomeGrid(cachedAvailableProperties);
    initOptionalStreamClient(session).catch(() => { });
    return currentUser;
}

async function checkAuthState() {
    if (!window.authService) {
        console.error('❌ window.authService is not loaded.');
        return;
    }

    try {
        const session = await window.authService.getSession();
        if (session?.user) {
            const profile = await window.authService.getProfile(session.user.id);
            await applyAuthenticatedUser(session, profile);
        } else {
            currentUser = null;
            updateNavForLoggedInUser();
            updateLandlordVerificationUI();
        }
    } catch (error) {
        console.error('Error restoring session:', error);
        currentUser = null;
        updateNavForLoggedInUser();
    }

    const remembered = localStorage.getItem('housingo_remember_email');
    const loginEmail = document.getElementById('login-email');
    const rememberBox = document.getElementById('remember-me');
    if (remembered && loginEmail && !loginEmail.value) {
        loginEmail.value = remembered;
        if (rememberBox) rememberBox.checked = true;
    }

    if (!authListenerInitialized) {
        authListenerInitialized = true;
        window.authService.onAuthStateChange(async (event, session, profile) => {
            if (event === 'SIGNED_OUT') {
                currentUser = null;
                clearProtectedDashboardContent();
                updateNavForLoggedInUser();
                updateLandlordVerificationUI();
                const protectedPages = ['admin-dashboard', 'landlord-dashboard', 'tenant-dashboard', 'post-property', 'user-settings'];
                if (protectedPages.includes(window.__currentPageName)) {
                    showPage('login');
                }
            } else if (session?.user) {
                await applyAuthenticatedUser(session, profile);
            }
        });
    }
}

function clearProtectedDashboardContent() {
    const idsToClear = [
        'admin-users-list', 'admin-properties-list', 'admin-complaints-list', 'admin-system-records',
        'landlord-properties-list', 'landlord-applications-list', 'landlord-inquiries-list',
        'tenant-saved-properties', 'tenant-reviews', 'tenant-complaints',
        'conversations-container', 'chat-messages', 'notifications-list'
    ];
    idsToClear.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '';
    });
    ['property-modal', 'messages-modal', 'new-message-modal', 'notifications-modal', 'complaint-modal'].forEach(id => {
        document.getElementById(id)?.classList.remove('active');
    });
}

function updateNavForLoggedInUser() {
    const navList = document.querySelector('#nav-menu ul');
    const profileDropdown = document.getElementById('user-profile-dropdown');
    const userNameDisplay = document.getElementById('user-name-display');
    const userEmailDisplay = document.getElementById('user-email-display');
    const userRoleDisplay = document.getElementById('user-role-display');
    const sideNavUserInfo = document.getElementById('side-nav-user-info');
    const sideNavAvatar = document.getElementById('side-nav-avatar');
    const floatingChat = document.getElementById('floating-chat-button');
    const sideNavFooter = document.getElementById('side-nav-footer');
    const hamburger = document.getElementById('hamburger');
    const navMenu = document.getElementById('nav-menu');

    if (!navList) {
        console.error('❌ #nav-menu ul not found.');
        return;
    }

    if (currentUser) {
        const dash = getDashboardForRole(currentUser.role);
        const roleLabel = currentUser.role.charAt(0).toUpperCase() + currentUser.role.slice(1);

        let roleDrawerItems = '';
        if (currentUser.role === 'landlord') {
            roleDrawerItems = `
                <li class="mobile-nav-section-label">Landlord Dashboard</li>
                <li class="mobile-only-nav-item"><a href="#" onclick="openDashboardSection('landlord-dashboard', 'landlord', 'landlord-tab-listings'); return false;">🏠 My Listings</a></li>
                <li class="mobile-only-nav-item"><a href="#" onclick="openDashboardSection('landlord-dashboard', 'landlord', 'landlord-tab-apps'); return false;">📩 Applications</a></li>
                <li class="mobile-only-nav-item"><a href="#" onclick="openDashboardSection('landlord-dashboard', 'landlord', 'landlord-tab-inquiries'); return false;">💬 Inquiries</a></li>
                <li class="mobile-only-nav-item"><a href="#" onclick="openDashboardSection('landlord-dashboard', 'landlord', 'landlord-tab-feedback'); return false;">⭐ Feedback</a></li>
                <li class="mobile-only-nav-item"><a href="#" onclick="openDashboardSection('landlord-dashboard', 'landlord', 'landlord-tab-profile'); return false;">👤 Account Profile</a></li>
                <li class="mobile-only-nav-item"><a href="#" onclick="openCreatePropertyForm(); return false;">＋ Add New Property</a></li>
            `;
        } else if (currentUser.role === 'tenant') {
            roleDrawerItems = `
                <li class="mobile-nav-section-label">Tenant Dashboard</li>
                <li class="mobile-only-nav-item"><a href="#" onclick="openDashboardSection('tenant-dashboard', 'tenant', 'tenant-tab-apps'); return false;">📋 My Applications</a></li>
                <li class="mobile-only-nav-item"><a href="#" onclick="openDashboardSection('tenant-dashboard', 'tenant', 'tenant-tab-wishlist'); return false;">❤️ Wishlist</a></li>
                <li class="mobile-only-nav-item"><a href="#" onclick="openDashboardSection('tenant-dashboard', 'tenant', 'tenant-tab-reviews'); return false;">⭐ My Reviews</a></li>
                <li class="mobile-only-nav-item"><a href="#" onclick="openDashboardSection('tenant-dashboard', 'tenant', 'tenant-tab-complaints'); return false;">🚨 My Complaints</a></li>
                <li class="mobile-only-nav-item"><a href="#" onclick="openDashboardSection('tenant-dashboard', 'tenant', 'tenant-tab-profile'); return false;">👤 Account Profile</a></li>
            `;
        } else if (currentUser.role === 'admin') {
            roleDrawerItems = `
                <li class="mobile-nav-section-label">Admin Dashboard</li>
                <li class="mobile-only-nav-item"><a href="#" onclick="openDashboardSection('admin-dashboard', 'admin', 'admin-tab-users'); return false;">👥 Manage Users</a></li>
                <li class="mobile-only-nav-item"><a href="#" onclick="openDashboardSection('admin-dashboard', 'admin', 'admin-tab-properties'); return false;">🏠 Moderate Properties</a></li>
                <li class="mobile-only-nav-item"><a href="#" onclick="openDashboardSection('admin-dashboard', 'admin', 'admin-tab-complaints'); return false;">🚨 Handle Complaints</a></li>
                <li class="mobile-only-nav-item"><a href="#" onclick="openDashboardSection('admin-dashboard', 'admin', 'admin-tab-audit'); return false;">📜 Audit Log</a></li>
            `;
        }

        navList.innerHTML = `
            <li class="mobile-nav-section-label">Explore</li>
            <li><a href="#" data-nav="home" onclick="showPage('home'); return false;">🏠 Home</a></li>
            <li><a href="#" data-nav="${dash}" onclick="showPage('${dash}'); return false;">📊 Dashboard</a></li>
            ${roleDrawerItems}
            <li class="mobile-nav-section-label">Account &amp; Pages</li>
            <li><a href="#" data-nav="user-settings" onclick="showPage('user-settings'); return false;">⚙️ Account Settings</a></li>
            <li><a href="#" data-nav="about" onclick="showPage('about'); return false;">ℹ️ About Us</a></li>
            <li><a href="#" data-nav="contact" onclick="showPage('contact'); return false;">📞 Contact Us</a></li>
            <li><a href="#" data-nav="help" onclick="showPage('help'); return false;">❓ Help</a></li>
        `;
        if (profileDropdown) profileDropdown.style.display = 'block';
        if (sideNavUserInfo) sideNavUserInfo.style.display = 'flex';
        if (userNameDisplay) userNameDisplay.textContent = currentUser.full_name;
        if (userEmailDisplay) userEmailDisplay.textContent = currentUser.email || '';
        if (userRoleDisplay) userRoleDisplay.textContent = roleLabel;
        if (sideNavAvatar) {
            if (currentUser.avatar_url) {
                sideNavAvatar.innerHTML = `<img src="${escapeHtml(currentUser.avatar_url)}" alt="Avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
            } else {
                const initials = (currentUser.full_name || 'U').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
                sideNavAvatar.textContent = initials || 'U';
            }
        }
        if (floatingChat) floatingChat.style.display = 'block';
        if (sideNavFooter) sideNavFooter.style.display = 'block';
        if (hamburger) {
            hamburger.style.removeProperty('display');
            hamburger.classList.remove('active');
        }
        if (navMenu) navMenu.classList.remove('active');
    } else {
        navList.innerHTML = `
            <li class="mobile-nav-section-label">Explore</li>
            <li><a href="#" data-nav="home" onclick="showPage('home'); return false;">🏠 Home</a></li>
            <li><a href="#" data-nav="about" onclick="showPage('about'); return false;">ℹ️ About Us</a></li>
            <li><a href="#" data-nav="contact" onclick="showPage('contact'); return false;">📞 Contact Us</a></li>
            <li><a href="#" data-nav="help" onclick="showPage('help'); return false;">❓ Help</a></li>
            <li class="mobile-nav-section-label">Account</li>
            <li><a href="#" data-nav="login" onclick="showPage('login'); return false;">🔑 Log In</a></li>
            <li><a href="#" data-nav="register" onclick="showPage('register'); return false;">✨ Register</a></li>
        `;
        if (profileDropdown) profileDropdown.style.display = 'none';
        if (sideNavUserInfo) sideNavUserInfo.style.display = 'none';
        if (floatingChat) floatingChat.style.display = 'none';
        if (sideNavFooter) sideNavFooter.style.display = 'none';
        if (hamburger) hamburger.style.removeProperty('display');
    }
    setActiveNavLink(window.__currentPageName || 'home');
}

function openDashboardSection(dashboardPage, tabGroup, targetTabId) {
    closeNavDrawer();
    showPage(dashboardPage);
    if (tabGroup && targetTabId) {
        switchDashboardTab(tabGroup, targetTabId);
    }
}

function toggleNavDrawer() {
    const hamburger = document.getElementById('hamburger');
    const navMenu = document.getElementById('nav-menu');
    const backdrop = document.getElementById('nav-backdrop');
    if (!navMenu) return;
    const isOpen = navMenu.classList.toggle('active');
    if (hamburger) hamburger.classList.toggle('active', isOpen);
    if (backdrop) backdrop.classList.toggle('active', isOpen);
}

function closeNavDrawer() {
    document.getElementById('hamburger')?.classList.remove('active');
    document.getElementById('nav-menu')?.classList.remove('active');
    document.getElementById('nav-backdrop')?.classList.remove('active');
}

function setActiveNavLink(pageName) {
    window.__currentPageName = pageName;
    document.querySelectorAll('#nav-menu a').forEach(a => {
        a.classList.toggle('nav-link-active', a.getAttribute('data-nav') === pageName);
    });
}

function switchDashboardTab(group, targetPanelId) {
    document.querySelectorAll(`.dash-tabs[data-tab-group="${group}"] .dash-tab-btn`).forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-tab-target') === targetPanelId);
    });
    document.querySelectorAll(`.dash-tab-panel[data-tab-group="${group}"]`).forEach(panel => {
        panel.classList.toggle('active', panel.id === targetPanelId);
    });
}

async function logout() {
    try {
        if (streamClient && isStreamConnected) {
            await streamClient.disconnectUser().catch(() => { });
            isStreamConnected = false;
        }
        await window.authService?.signOut();
    } catch (error) {
        console.error('Logout error:', error);
    } finally {
        currentUser = null;
        clearProtectedDashboardContent();
        updateNavForLoggedInUser();
        updateLandlordVerificationUI();

        const dd = document.getElementById('profile-dropdown-menu');
        if (dd) dd.style.display = 'none';
        showToast('Logged out successfully!', 'info');
        showPage('login');
    }
}

function goToDashboard() {
    if (!currentUser) return showPage('login');
    showPage(getDashboardForRole(currentUser.role));
}

function toggleProfileDropdown() {
    const menu = document.getElementById('profile-dropdown-menu');
    const caret = document.getElementById('profile-caret');
    if (!menu) return console.error('❌ #profile-dropdown-menu not found.');
    const isOpen = menu.style.display === 'block';
    menu.style.display = isOpen ? 'none' : 'block';
    if (caret) caret.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(180deg)';
}

// ============================================================================
// Page Router & Route Guards
// ============================================================================
function showPage(pageName) {
    const protectedPages = ['admin-dashboard', 'landlord-dashboard', 'tenant-dashboard', 'post-property', 'user-settings'];
    if (protectedPages.includes(pageName)) {
        if (!currentUser) {
            showToast('Please log in to access this page.', 'warning');
            pageName = 'login';
        } else if (currentUser.status === 'suspended') {
            showToast('Your account is suspended.', 'error');
            logout();
            return;
        } else if (pageName === 'admin-dashboard' && currentUser.role !== 'admin') {
            showToast('Admin access required.', 'error');
            pageName = getDashboardForRole(currentUser.role);
        } else if ((pageName === 'landlord-dashboard' || pageName === 'post-property') && !['landlord', 'admin'].includes(currentUser.role)) {
            showToast('Landlord access required.', 'error');
            pageName = getDashboardForRole(currentUser.role);
        } else if (pageName === 'tenant-dashboard' && !['tenant', 'admin'].includes(currentUser.role)) {
            showToast('Tenant access required.', 'error');
            pageName = getDashboardForRole(currentUser.role);
        }
    }

    if ((pageName === 'login' || pageName === 'register') && currentUser) {
        pageName = getDashboardForRole(currentUser.role);
    }

    if (pageName === 'browse-properties') pageName = 'home';

    const allPageIds = [
        'home-page', 'home-content', 'about-page', 'login-page', 'register-page',
        'contact-page', 'help-page', 'admin-dashboard-page',
        'landlord-dashboard-page', 'tenant-dashboard-page', 'post-property-page', 'user-settings-page'
    ];
    allPageIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
        else console.error(`❌ Page container #${id} not found.`);
    });

    if (pageName === 'login') hideAuthAlert('login-alert');
    if (pageName === 'register') hideAuthAlert('register-alert');

    if (pageName === 'home') {
        const hp = document.getElementById('home-page');
        const hc = document.getElementById('home-content');
        if (hp) hp.style.display = 'block';
        if (hc) hc.style.display = 'block';
    } else {
        const target = document.getElementById(`${pageName}-page`);
        if (!target) {
            console.error(`❌ Target page #${pageName}-page not found.`);
            return;
        }
        target.style.display = 'block';
    }

    setActiveNavLink(pageName);

    const dd = document.getElementById('profile-dropdown-menu');
    if (dd) dd.style.display = 'none';
    // Close nav drawer
    closeNavDrawer();

    if (pageName === 'home') loadHomeProperties();
    else if (pageName === 'tenant-dashboard') loadTenantDashboard();
    else if (pageName === 'landlord-dashboard') { updateLandlordVerificationUI(); loadLandlordDashboard(); }
    else if (pageName === 'post-property') { updateLandlordVerificationUI(); loadPostPropertyForm(); }
    else if (pageName === 'admin-dashboard') loadAdminDashboard();
    else if (pageName === 'user-settings') loadUserSettings();

    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ============================================================================
// Auth Form Handlers (Login, Register, Settings)
// ============================================================================
async function handleLogin(event) {
    event.preventDefault();
    hideAuthAlert('login-alert');

    const emailEl = document.getElementById('login-email');
    const passwordEl = document.getElementById('login-password');
    const rememberEl = document.getElementById('remember-me');
    const submitBtn = document.getElementById('login-submit-btn');

    if (!emailEl || !passwordEl) return console.error('❌ Login inputs not found.');

    const email = emailEl.value.trim();
    const password = passwordEl.value;

    submitBtn.disabled = true;
    submitBtn.textContent = '⏳ Logging in...';

    try {
        const { session, profile } = await window.authService.signIn({ email, password });
        if (rememberEl?.checked) localStorage.setItem('housingo_remember_email', email);
        else localStorage.removeItem('housingo_remember_email');

        const user = await applyAuthenticatedUser(session, profile);
        if (!user) return;

        showAuthAlert('login-alert', `Welcome back, ${user.full_name}! Redirecting...`, 'success');
        showToast(`Welcome back, ${user.full_name}! 🎉`, 'success');

        setTimeout(() => {
            event.target.reset();
            if (rememberEl?.checked) emailEl.value = email;
            showPage(getDashboardForRole(user.role));
        }, 550);
    } catch (error) {
        console.error('Login error:', error);
        const friendly = getFriendlyAuthError(error);
        showAuthAlert('login-alert', friendly, 'error');
        showToast(friendly, 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = '🔑 Log In';
    }
}

async function handleRegister(event) {
    event.preventDefault();
    hideAuthAlert('register-alert');

    const firstName = document.getElementById('reg-firstname')?.value.trim() || '';
    const lastName = document.getElementById('reg-lastname')?.value.trim() || '';
    const email = document.getElementById('reg-email')?.value.trim() || '';
    const phone = document.getElementById('reg-mobile')?.value.trim() || '';
    const role = (document.getElementById('reg-usertype')?.value || 'tenant').toLowerCase();
    const password = document.getElementById('reg-password')?.value || '';
    const confirmPassword = document.getElementById('reg-confirm-password')?.value || '';
    const submitBtn = document.getElementById('register-submit-btn');

    if (!firstName || !lastName) return showAuthAlert('register-alert', 'Please enter your first and last name.', 'error');
    if (password.length < 6) return showAuthAlert('register-alert', 'Password must be at least 6 characters.', 'error');
    if (password !== confirmPassword) return showAuthAlert('register-alert', 'Passwords do not match.', 'error');
    if (!['tenant', 'landlord'].includes(role)) return showAuthAlert('register-alert', 'Please choose Tenant or Landlord.', 'error');

    submitBtn.disabled = true;
    submitBtn.textContent = '⏳ Creating Account...';

    try {
        const fullName = `${firstName} ${lastName}`.trim();
        const data = await window.authService.signUp({ email, password, fullName, role, phone });

        if (data?.session && data?.user) {
            await new Promise(r => setTimeout(r, 350));
            const profile = await window.authService.getProfile(data.user.id);
            const user = await applyAuthenticatedUser(data.session, profile);
            showToast(`Welcome to HousinGo, ${firstName}!`, 'success');
            document.getElementById('register-form')?.reset();
            showPage(getDashboardForRole(user?.role || role));
        } else {
            showAuthAlert('register-alert', `🎉 Account created! Please check ${email} to verify your email, then log in.`, 'success');
            showToast('Account created! Please check your email to confirm.', 'success');
            document.getElementById('register-form')?.reset();
            setTimeout(() => {
                const loginEmail = document.getElementById('login-email');
                if (loginEmail) loginEmail.value = email;
                showPage('login');
            }, 2200);
        }
    } catch (error) {
        console.error('Register error:', error);
        const friendly = getFriendlyAuthError(error);
        showAuthAlert('register-alert', friendly, 'error');
        showToast(friendly, 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = '🚀 Create Account';
    }
}

function loadUserSettings() {
    if (!currentUser) return;
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
    const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val || ''; };

    setVal('settings-firstname', currentUser.first_name);
    setVal('settings-lastname', currentUser.last_name);
    setVal('settings-email', currentUser.email);
    setVal('settings-mobile', currentUser.phone);
    const roleLabel = `${currentUser.role.toUpperCase()}${currentUser.role === 'landlord' ? (currentUser.is_verified ? ' (Verified)' : ' (Pending Verification)') : ''}`;
    setVal('settings-role', roleLabel);

    const roleEmoji = currentUser.role === 'admin' ? '🛡️' : currentUser.role === 'landlord' ? '🔑' : '🔍';
    setTxt('settings-role-pill', `${roleEmoji} ${roleLabel}`);
    setTxt('settings-display-name', currentUser.full_name || 'Account Settings');
    setTxt('settings-display-email', currentUser.email || 'Manage your personal information and password security.');
    const initials = (currentUser.full_name || 'U').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
    setTxt('settings-avatar', initials || 'U');

    const emailEl = document.getElementById('settings-email');
    if (emailEl) emailEl.readOnly = true;
}

async function handleUpdateProfile(event) {
    event.preventDefault();
    if (!currentUser) return;
    const first = document.getElementById('settings-firstname')?.value.trim() || '';
    const last = document.getElementById('settings-lastname')?.value.trim() || '';
    const phone = document.getElementById('settings-mobile')?.value.trim() || '';
    const btn = event.target.querySelector('button[type="submit"]');

    btn.disabled = true;
    btn.textContent = 'Saving...';
    try {
        const updated = await window.authService.updateProfile(currentUser.id, {
            full_name: `${first} ${last}`.trim(),
            phone,
        });
        currentUser = normalizeUserProfile(updated, { id: currentUser.id, email: currentUser.email });
        updateNavForLoggedInUser();
        showToast('Profile updated successfully!', 'success');
    } catch (error) {
        console.error('Update profile error:', error);
        showToast(`Failed to update profile: ${error.message}`, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Update Profile';
    }
}

async function handleChangePassword(event) {
    event.preventDefault();
    const newPass = document.getElementById('new-password')?.value || '';
    const confirmPass = document.getElementById('confirm-new-password')?.value || '';
    const btn = event.target.querySelector('button[type="submit"]');

    if (newPass.length < 6) return showToast('New password must be at least 6 characters.', 'error');
    if (newPass !== confirmPass) return showToast('New passwords do not match.', 'error');

    btn.disabled = true;
    btn.textContent = 'Updating...';
    try {
        await window.authService.changePassword(newPass);
        showToast('Password updated successfully!', 'success');
        event.target.reset();
    } catch (error) {
        console.error('Change password error:', error);
        showToast(`Failed to change password: ${error.message}`, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Change Password';
    }
}

// ============================================================================
// Home & Browse Properties (available_properties view)
// ============================================================================
function renderPropertyCard(p) {
    const imgUrl = Array.isArray(p.image_urls) && p.image_urls.length > 0 ? p.image_urls[0] : '';
    const imgHtml = imgUrl
        ? `<img src="${escapeHtml(imgUrl)}" alt="${escapeHtml(p.title)}">`
        : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:48px;color:#0F4C81;">🏠</div>`;

    const { text: cleanDesc, meta } = parsePropertyDescription(p.description);
    const ratingHtml = p.review_count > 0
        ? `<span style="font-size:13px;color:#D97706;font-weight:700;">★ ${Number(p.avg_rating).toFixed(1)} <span style="color:#64748B;font-weight:500;">(${p.review_count})</span></span>`
        : `<span style="font-size:12px;color:#94A3B8;">New listing</span>`;

    const typePillHtml = meta.type
        ? `<span style="display:inline-block;background:#EEF6FA;color:#0F4C81;font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;margin-bottom:8px;">🏷️ ${escapeHtml(meta.type)}${meta.slots ? ` · ${meta.slots} slot${meta.slots > 1 ? 's' : ''}` : ''}</span>`
        : '';

    const amenityChips = Array.isArray(meta.amenities) && meta.amenities.length > 0
        ? `<div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:12px;">${meta.amenities.slice(0, 3).map(a => `<span style="background:#FAF8F5;border:1px solid #EAE5DC;color:#475569;font-size:11px;padding:3px 8px;border-radius:999px;">${AMENITY_ICONS[a] || '✓'} ${escapeHtml(a)}</span>`).join('')}${meta.amenities.length > 3 ? `<span style="font-size:11px;color:#64748B;padding:3px 4px;">+${meta.amenities.length - 3} more</span>` : ''}</div>`
        : '';

    const showApplyBtn = !currentUser || currentUser.role === 'tenant';
    const isWishlisted = currentUser?.role === 'tenant' && isInWishlist(p.property_id);

    return `
        <div class="property-card" data-property-id="${p.property_id}" onmouseenter="highlightMapPin('${p.property_id}', true)" onmouseleave="highlightMapPin('${p.property_id}', false)" style="background:#fff;overflow:hidden;display:flex;flex-direction:column;">
            <div class="property-card-media">
                ${imgHtml}
                <div class="property-card-badge">${statusBadgeHtml(p.availability_status || 'available')}</div>
                ${currentUser?.role === 'tenant' ? `<button type="button" onclick="toggleWishlist('${p.property_id}')" title="${isWishlisted ? 'Remove from Wishlist' : 'Save to Wishlist'}" style="position:absolute;top:10px;right:10px;z-index:3;width:36px;height:36px;border-radius:50%;border:none;background:rgba(255,255,255,0.92);cursor:pointer;font-size:17px;box-shadow:0 3px 10px rgba(0,0,0,0.16);display:flex;align-items:center;justify-content:center;">${isWishlisted ? '❤️' : '🤍'}</button>` : ''}
                <div class="property-card-price-pill">${formatPeso(p.price)}<span style="font-weight:400;font-size:11px;"> /mo</span></div>
            </div>
            <div style="padding:18px;flex:1;display:flex;flex-direction:column;">
                <div>${typePillHtml}</div>
                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px;">
                    <h3 style="font-size:17px;font-weight:700;color:#1E293B;margin:0;line-height:1.3;">${escapeHtml(p.title)}</h3>
                </div>
                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;">
                    <span style="font-size:13px;color:#64748B;">📍 ${escapeHtml(p.location)}</span>
                    ${ratingHtml}
                </div>
                ${amenityChips}
                <p style="font-size:13.5px;color:#475569;line-height:1.55;margin-bottom:16px;flex:1;">${escapeHtml(cleanDesc.slice(0, 105))}${cleanDesc.length > 105 ? '…' : ''}</p>
                <div style="display:flex;gap:8px;margin-top:auto;">
                    <button class="btn" onclick="openPropertyDetails('${p.property_id}')" style="flex:1;padding:10px;font-size:14px;">View Details</button>
                    ${showApplyBtn ? `<button class="btn-secondary" onclick="applyForProperty('${p.property_id}')" style="padding:10px 14px;font-size:14px;">Apply</button>` : ''}
                </div>
            </div>
        </div>
    `;
}

async function loadHomeProperties() {
    const loadingEl = document.getElementById('loading');
    const containerEl = document.getElementById('properties-container');
    const emptyEl = document.getElementById('empty-state');
    if (!containerEl) return;

    if (loadingEl) loadingEl.style.display = 'block';
    containerEl.style.display = 'none';
    if (emptyEl) emptyEl.style.display = 'none';

    try {
        cachedAvailableProperties = await window.propertyService.getAvailableProperties({ sortBy: 'newest' });
        renderHomeGrid(cachedAvailableProperties);
    } catch (error) {
        console.error('Error loading properties:', error);
        showToast(`Failed to load properties: ${error.message}`, 'error');
        if (emptyEl) {
            emptyEl.style.display = 'block';
            emptyEl.querySelector('h3').textContent = 'Could not load properties';
            emptyEl.querySelector('p').textContent = error.message;
        }
    } finally {
        if (loadingEl) loadingEl.style.display = 'none';
    }
}

function renderHomeGrid(list) {
    const containerEl = document.getElementById('properties-container');
    const emptyEl = document.getElementById('empty-state');
    if (!containerEl) return;

    if (!list || list.length === 0) {
        containerEl.style.display = 'none';
        if (emptyEl) emptyEl.style.display = 'block';
        updateHomeMapMarkers([]);
        return;
    }

    if (emptyEl) emptyEl.style.display = 'none';
    containerEl.style.display = 'grid';
    containerEl.innerHTML = list.map(renderPropertyCard).join('');
    updateHomeMapMarkers(list);
}

// ============================================================================
// Spotahome-Style Interactive GPS Map (Leaflet + OpenStreetMap)
// ============================================================================
const PH_LOCATION_CENTROIDS = [
    { match: 'east rembo', lat: 14.5547, lng: 121.0596 },
    { match: 'pembo',      lat: 14.5446, lng: 121.0618 },
    { match: 'mckinley',   lat: 14.5345, lng: 121.0496 },
    { match: 'bgc',        lat: 14.5508, lng: 121.0498 },
    { match: 'taguig',     lat: 14.5243, lng: 121.0792 },
    { match: 'poblacion',  lat: 14.5653, lng: 121.0315 },
    { match: 'makati',     lat: 14.5547, lng: 121.0244 },
    { match: 'kapitolyo',  lat: 14.5718, lng: 121.0588 },
    { match: 'ortigas',    lat: 14.5869, lng: 121.0614 },
    { match: 'pasig',      lat: 14.5764, lng: 121.0851 },
    { match: 'katipunan',  lat: 14.6368, lng: 121.0746 },
    { match: 'quezon',     lat: 14.6760, lng: 121.0437 },
    { match: 'marikina',   lat: 14.6507, lng: 121.1029 },
    { match: 'cebu',       lat: 10.3304, lng: 123.9064 },
];

function deterministicOffset(seedStr) {
    let hash = 0;
    const s = String(seedStr || 'hg');
    for (let i = 0; i < s.length; i++) hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
    const latOff = (((hash & 0xff) / 255) - 0.5) * 0.006;
    const lngOff = ((((hash >> 8) & 0xff) / 255) - 0.5) * 0.006;
    return { latOff, lngOff };
}

function resolvePropertyCoords(property, meta = {}) {
    if (typeof meta.lat === 'number' && typeof meta.lng === 'number') {
        return { lat: meta.lat, lng: meta.lng };
    }
    const loc = `${property.location || ''} ${property.title || ''}`.toLowerCase();
    const found = PH_LOCATION_CENTROIDS.find(c => loc.includes(c.match));
    const base = found || DEFAULT_EAST_REMBO;
    const { latOff, lngOff } = deterministicOffset(property.property_id || property.title);
    return { lat: base.lat + latOff, lng: base.lng + lngOff };
}

function calcDistanceKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function initHomeMap() {
    if (typeof window.L === 'undefined') {
        console.error('❌ Leaflet library (window.L) not loaded.');
        return null;
    }
    const mapEl = document.getElementById('home-gps-map');
    if (!mapEl) return null;

    if (!homeMap) {
        homeMap = window.L.map(mapEl, { zoomControl: true }).setView([DEFAULT_EAST_REMBO.lat, DEFAULT_EAST_REMBO.lng], 14);
        window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; OpenStreetMap contributors',
        }).addTo(homeMap);
    }
    setTimeout(() => homeMap?.invalidateSize(), 120);
    return homeMap;
}

function updateHomeMapMarkers(properties) {
    const countEl = document.getElementById('map-results-count');
    if (countEl) countEl.textContent = `${properties.length} rental${properties.length === 1 ? '' : 's'} on map`;

    const map = initHomeMap();
    if (!map) return;

    homeMapMarkers.forEach(({ marker }) => map.removeLayer(marker));
    homeMapMarkers.clear();

    const bounds = [];
    properties.forEach(p => {
        const { meta } = parsePropertyDescription(p.description);
        const { lat, lng } = resolvePropertyCoords(p, meta);
        bounds.push([lat, lng]);

        const priceShort = `₱${Math.round(Number(p.price || 0)).toLocaleString('en-PH')}`;
        const icon = window.L.divIcon({
            className: '',
            html: `<div class="hg-price-pin" id="map-pin-${p.property_id}">${priceShort}</div>`,
            iconSize: [78, 28],
            iconAnchor: [39, 14],
        });

        const distText = userGpsCoords
            ? `<div style="font-size:11px;color:#2563EB;font-weight:700;margin-bottom:6px;">📍 ${calcDistanceKm(userGpsCoords.lat, userGpsCoords.lng, lat, lng).toFixed(1)} km from you</div>`
            : '';

        const imgUrl = Array.isArray(p.image_urls) && p.image_urls[0] ? p.image_urls[0] : '';
        const popupHtml = `
            <div style="min-width:210px;font-family:'Plus Jakarta Sans',sans-serif;">
                ${imgUrl ? `<img src="${escapeHtml(imgUrl)}" style="width:100%;height:100px;object-fit:cover;border-radius:8px;margin-bottom:8px;">` : ''}
                <div style="font-weight:700;font-size:14px;color:#1E293B;margin-bottom:3px;">${escapeHtml(p.title)}</div>
                <div style="font-size:12px;color:#64748B;margin-bottom:5px;">📍 ${escapeHtml(p.location)}</div>
                ${distText}
                <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;">
                    <strong style="color:#0F4C81;font-size:15px;">${formatPeso(p.price)}/mo</strong>
                    <button onclick="openPropertyDetails('${p.property_id}')" style="background:#0F4C81;color:#fff;border:none;padding:5px 10px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;">View Details</button>
                </div>
            </div>
        `;

        const marker = window.L.marker([lat, lng], { icon }).addTo(map).bindPopup(popupHtml);
        homeMapMarkers.set(p.property_id, { marker, lat, lng });
    });

    if (bounds.length > 0 && !userGpsCoords) {
        map.fitBounds(bounds, { padding: [45, 45], maxZoom: 15 });
    }
}

function highlightMapPin(propertyId, isActive) {
    const pinEl = document.getElementById(`map-pin-${propertyId}`);
    if (pinEl) pinEl.classList.toggle('active', Boolean(isActive));
}

function locateUserOnMap() {
    if (!navigator.geolocation) {
        return showToast('GPS geolocation is not supported by your browser.', 'warning');
    }
    showToast('Locating your GPS position...', 'info');
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            const { latitude: lat, longitude: lng } = pos.coords;
            userGpsCoords = { lat, lng };
            const map = initHomeMap();
            if (!map) return;

            if (userGpsMarker) map.removeLayer(userGpsMarker);
            const gpsIcon = window.L.divIcon({
                className: '',
                html: '<div class="hg-user-gps-dot"></div>',
                iconSize: [18, 18],
                iconAnchor: [9, 9],
            });
            userGpsMarker = window.L.marker([lat, lng], { icon: gpsIcon })
                .addTo(map)
                .bindPopup('<strong>📍 You are here</strong>')
                .openPopup();

            map.flyTo([lat, lng], 14, { duration: 1.0 });
            updateHomeMapMarkers(cachedAvailableProperties);
            showToast('GPS location found! Distances updated on map pins.', 'success');
        },
        (err) => {
            showToast(`Could not access GPS: ${err.message}`, 'error');
        },
        { enableHighAccuracy: true, timeout: 10000 }
    );
}

function resetMapToEastRembo() {
    const map = initHomeMap();
    if (!map) return;
    map.flyTo([DEFAULT_EAST_REMBO.lat, DEFAULT_EAST_REMBO.lng], 15, { duration: 0.9 });
}

function toggleHomeMap() {
    const split = document.getElementById('home-split-layout');
    const btn = document.getElementById('toggle-map-btn');
    if (!split) return;
    const isHidden = split.classList.toggle('map-hidden');
    if (btn) btn.textContent = isHidden ? '🗺️ Show Map' : '🗺️ Hide Map';
    if (!isHidden) setTimeout(() => homeMap?.invalidateSize(), 120);
}

function initPostPropertyMap(initialLat = null, initialLng = null) {
    if (typeof window.L === 'undefined') return;
    const mapEl = document.getElementById('post-property-map');
    if (!mapEl) return;

    const lat = typeof initialLat === 'number' ? initialLat : DEFAULT_EAST_REMBO.lat;
    const lng = typeof initialLng === 'number' ? initialLng : DEFAULT_EAST_REMBO.lng;

    if (!postPropertyMap) {
        postPropertyMap = window.L.map(mapEl).setView([lat, lng], 15);
        window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; OpenStreetMap contributors',
        }).addTo(postPropertyMap);

        postPropertyMap.on('click', (e) => {
            setPostPropertyPin(e.latlng.lat, e.latlng.lng);
        });
    } else {
        postPropertyMap.setView([lat, lng], 15);
    }

    if (typeof initialLat === 'number' && typeof initialLng === 'number') {
        const hasExistingLink = Boolean(document.getElementById('location-link')?.value?.trim());
        setPostPropertyPin(initialLat, initialLng, { updateMapLink: !hasExistingLink });
    } else if (postPropertyPin) {
        postPropertyMap.removeLayer(postPropertyPin);
        postPropertyPin = null;
        const lbl = document.getElementById('post-map-coords-label');
        if (lbl) lbl.textContent = 'Click anywhere on the map to pin the address (auto-fills Google Maps link)';
    }

    setTimeout(() => postPropertyMap?.invalidateSize(), 150);
}

let postPinLookupSeq = 0;

function formatReverseGeocodedAddress(data) {
    if (!data) return '';
    const addr = data.address || {};
    const street = [addr.house_number, addr.road || addr.pedestrian || addr.footway].filter(Boolean).join(' ');
    const area = addr.neighbourhood || addr.quarter || addr.suburb || addr.village || '';
    const city = addr.city || addr.town || addr.municipality || '';
    const parts = [street, area, city].filter(Boolean);
    if (parts.length) return parts.join(', ');
    return (data.display_name || '').split(',').slice(0, 4).join(',').trim();
}

async function setPostPropertyPin(lat, lng, options = {}) {
    const { updateMapLink = true } = options;
    const latEl = document.getElementById('property-lat');
    const lngEl = document.getElementById('property-lng');
    const lbl = document.getElementById('post-map-coords-label');
    const linkEl = document.getElementById('location-link');
    const addrInput = document.getElementById('property-address');

    if (latEl) latEl.value = lat.toFixed(6);
    if (lngEl) lngEl.value = lng.toFixed(6);

    const googleMapsUrl = `https://www.google.com/maps?q=${lat.toFixed(6)},${lng.toFixed(6)}`;
    if (linkEl && updateMapLink) {
        linkEl.value = googleMapsUrl;
    }

    if (postPropertyMap) {
        if (postPropertyPin) {
            postPropertyPin.setLatLng([lat, lng]);
        } else {
            postPropertyPin = window.L.marker([lat, lng], { draggable: true }).addTo(postPropertyMap);
            postPropertyPin.on('dragend', (ev) => {
                const p = ev.target.getLatLng();
                setPostPropertyPin(p.lat, p.lng, { updateMapLink: true });
            });
        }
        postPropertyMap.panTo([lat, lng]);
    }

    if (lbl) lbl.textContent = '📍 Finding pinned location address...';
    const seq = ++postPinLookupSeq;

    try {
        const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&zoom=18&addressdetails=1`,
            { headers: { Accept: 'application/json' } }
        );
        if (seq !== postPinLookupSeq) return;
        if (!res.ok) throw new Error('Reverse geocode failed');
        const data = await res.json();
        if (seq !== postPinLookupSeq) return;

        const addressText = formatReverseGeocodedAddress(data) || 'Barangay East Rembo, Taguig City';
        if (lbl) lbl.textContent = `📍 Pinned Location: ${addressText}`;
        if (addrInput && !addrInput.value.trim()) {
            addrInput.value = addressText;
        }
    } catch {
        if (seq !== postPinLookupSeq) return;
        const fallbackAddr = addrInput?.value.trim() || 'Barangay East Rembo, Taguig City';
        if (lbl) lbl.textContent = `📍 Pinned Location: ${fallbackAddr}`;
    }
}

function useCurrentGpsForProperty() {
    if (!navigator.geolocation) return showToast('Location is not supported by this browser.', 'warning');
    showToast('Getting your current location...', 'info');
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            initPostPropertyMap(pos.coords.latitude, pos.coords.longitude);
            setPostPropertyPin(pos.coords.latitude, pos.coords.longitude, { updateMapLink: true });
            showToast('Location pinned and Google Maps link added!', 'success');
        },
        (err) => showToast(`Location error: ${err.message}`, 'error'),
        { enableHighAccuracy: true, timeout: 10000 }
    );
}

function filterHomeProperties() {
    const searchVal = (document.getElementById('search-input')?.value || '').trim().toLowerCase();
    const typeVal = (document.getElementById('type-search')?.value || selectedHomeKeyword || '').toLowerCase();
    const maxPriceVal = document.getElementById('price-search')?.value || '';

    const filtered = cachedAvailableProperties.filter(p => {
        const hay = `${p.title || ''} ${p.location || ''} ${p.description || ''}`.toLowerCase();
        const matchSearch = !searchVal || hay.includes(searchVal);
        const matchType = !typeVal || hay.includes(typeVal);
        const matchPrice = !maxPriceVal || Number(p.price) <= Number(maxPriceVal);
        return matchSearch && matchType && matchPrice;
    });

    renderHomeGrid(filtered);
}

function performHeroSearch() {
    filterHomeProperties();
    const homeContent = document.getElementById('home-content');
    if (homeContent) {
        homeContent.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

// ============================================================================
// Property Details Modal + Reviews + Apply + Complaint
// ============================================================================
async function openPropertyDetails(propertyId) {
    const modal = document.getElementById('property-modal');
    const titleEl = document.getElementById('modal-title');
    const bodyEl = document.getElementById('modal-body');
    if (!modal || !bodyEl) return console.error('❌ #property-modal or #modal-body not found.');

    modal.classList.add('active');
    if (titleEl) titleEl.textContent = 'Loading property...';
    bodyEl.innerHTML = '<div class="loading"><div class="loading-spinner"></div><p>Loading details &amp; reviews...</p></div>';

    try {
        const [property, reviews] = await Promise.all([
            window.propertyService.getPropertyById(propertyId),
            window.reviewService.getPropertyReviews(propertyId),
        ]);

        currentModalImages = Array.isArray(property.image_urls) ? property.image_urls : [];
        modalCurrentImageIndex = 0;

        if (titleEl) titleEl.textContent = property.title;

        const galleryHtml = currentModalImages.length > 0
            ? `<div style="position:relative;margin-bottom:20px;">
                 <img id="modal-carousel-img" src="${escapeHtml(currentModalImages[0])}" alt="${escapeHtml(property.title)}" style="width:100%;max-height:340px;object-fit:cover;border-radius:10px;">
                 ${currentModalImages.length > 1 ? `
                   <button onclick="prevModalImage()" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);background:rgba(255,255,255,0.9);border:none;border-radius:50%;width:38px;height:38px;font-size:18px;cursor:pointer;">‹</button>
                   <button onclick="nextModalImage()" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:rgba(255,255,255,0.9);border:none;border-radius:50%;width:38px;height:38px;font-size:18px;cursor:pointer;">›</button>
                   <div id="modal-carousel-counter" style="position:absolute;bottom:10px;right:14px;background:rgba(0,0,0,0.6);color:#fff;padding:3px 10px;border-radius:999px;font-size:12px;">1 / ${currentModalImages.length}</div>
                 ` : ''}
               </div>`
            : `<div style="width:100%;height:200px;background:linear-gradient(135deg,#ADD8E6,#E8F6FB);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:60px;margin-bottom:20px;">🏠</div>`;

        const avgRating = reviews.length
            ? (reviews.reduce((s, r) => s + Number(r.rating), 0) / reviews.length).toFixed(1)
            : null;

        const myReview = currentUser ? reviews.find(r => r.tenant_id === currentUser.id) : null;
        const canReview = currentUser && currentUser.role === 'tenant';
        const isOwner = currentUser && currentUser.id === property.landlord_id;

        const reviewFormHtml = canReview ? `
            <form onsubmit="handleSubmitReview(event, '${property.property_id}')" style="background:#F5F5DC;padding:18px;border-radius:10px;margin-bottom:18px;">
                <h4 style="color:#8B4513;margin-bottom:10px;">${myReview ? '✏️ Edit Your Review' : '⭐ Write a Review'}</h4>
                <div style="margin-bottom:10px;">
                    <label style="font-weight:600;color:#8B4513;margin-right:10px;">Rating:</label>
                    <select id="review-rating-input" required style="padding:8px 12px;border:2px solid #ADD8E6;border-radius:8px;">
                        ${[5, 4, 3, 2, 1].map(n => `<option value="${n}" ${myReview && Number(myReview.rating) === n ? 'selected' : ''}>${n} Star${n > 1 ? 's' : ''} (${'★'.repeat(n)})</option>`).join('')}
                    </select>
                </div>
                <textarea id="review-comment-input" rows="3" placeholder="Share your experience with this property..." style="width:100%;padding:10px;border:2px solid #ADD8E6;border-radius:8px;margin-bottom:10px;">${escapeHtml(myReview?.comment || '')}</textarea>
                <div style="display:flex;gap:10px;">
                    <button type="submit" class="btn" style="padding:9px 18px;font-size:14px;">${myReview ? 'Update Review' : 'Post Review'}</button>
                    ${myReview ? `<button type="button" class="btn-secondary" onclick="handleDeleteReview('${myReview.review_id}', '${property.property_id}')" style="padding:9px 14px;font-size:14px;color:#B42318;border-color:#FF6B6B;">Delete</button>` : ''}
                </div>
            </form>
        ` : '';

        const reviewsListHtml = reviews.length === 0
            ? '<p style="color:#654321;">No reviews yet. Be the first tenant to review this listing!</p>'
            : reviews.map(r => `
                <div style="border-bottom:1px solid #EAE6D6;padding:12px 0;">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <strong style="color:#8B4513;">${escapeHtml(r.tenant?.full_name || 'Tenant')}</strong>
                        <span style="color:#B54708;font-weight:700;">${renderStars(r.rating)} (${r.rating}/5)</span>
                    </div>
                    <p style="color:#654321;margin:6px 0 4px;">${escapeHtml(r.comment || '')}</p>
                    <small style="color:#888;">${formatDate(r.created_at)}</small>
                </div>
            `).join('');

        const { text: cleanDesc, meta } = parsePropertyDescription(property.description);
        const canEditThisProperty = Boolean(currentUser && (currentUser.id === property.landlord_id || currentUser.role === 'admin'));

        const specsItems = [
            meta.type ? `<div style="background:#FAF8F5;padding:10px 14px;border-radius:10px;border:1px solid #EAE5DC;"><small style="color:#64748B;display:block;">Property Type</small><strong style="color:#1E293B;">🏷️ ${escapeHtml(meta.type)}</strong></div>` : '',
            meta.area ? `<div style="background:#FAF8F5;padding:10px 14px;border-radius:10px;border:1px solid #EAE5DC;"><small style="color:#64748B;display:block;">Lot / Floor Area</small><strong style="color:#1E293B;">📐 ${escapeHtml(meta.area)}</strong></div>` : '',
            meta.min_occupants ? `<div style="background:#FAF8F5;padding:10px 14px;border-radius:10px;border:1px solid #EAE5DC;"><small style="color:#64748B;display:block;">Occupants (Min/Max)</small><strong style="color:#1E293B;">👥 ${escapeHtml(meta.min_occupants)}</strong></div>` : '',
            meta.slots ? `<div style="background:#FAF8F5;padding:10px 14px;border-radius:10px;border:1px solid #EAE5DC;"><small style="color:#64748B;display:block;">Available Slots</small><strong style="color:#1E293B;">🛏️ ${meta.slots}</strong></div>` : '',
            meta.min_stay ? `<div style="background:#FAF8F5;padding:10px 14px;border-radius:10px;border:1px solid #EAE5DC;"><small style="color:#64748B;display:block;">Minimum Stay</small><strong style="color:#1E293B;">⏳ ${escapeHtml(meta.min_stay)}</strong></div>` : '',
            meta.advance_payment ? `<div style="background:#EFF6FF;padding:10px 14px;border-radius:10px;border:1px solid #BFDBFE;"><small style="color:#1D4ED8;display:block;">Advance / Deposit</small><strong style="color:#1E3A8A;">💵 ${escapeHtml(meta.advance_payment)}</strong></div>` : '',
            meta.move_in_date ? `<div style="background:#FAF8F5;padding:10px 14px;border-radius:10px;border:1px solid #EAE5DC;"><small style="color:#64748B;display:block;">Move-in Date</small><strong style="color:#1E293B;">📅 ${formatDate(meta.move_in_date)}</strong></div>` : '',
        ].filter(Boolean).join('');

        const specsGridHtml = specsItems
            ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:10px;margin-bottom:18px;">${specsItems}</div>`
            : '';

        const landmarksHtml = (meta.landmarks || meta.map_link)
            ? `<div style="margin-bottom:16px;font-size:14px;color:#475569;">
                 ${meta.landmarks ? `<div>🧭 <strong>Nearby Landmarks:</strong> ${escapeHtml(meta.landmarks)}</div>` : ''}
                 ${meta.map_link ? `<div style="margin-top:6px;"><a href="${escapeHtml(meta.map_link)}" target="_blank" rel="noopener noreferrer" style="color:#0F4C81;font-weight:700;text-decoration:underline;">🗺️ View Location on Google Maps ↗</a></div>` : ''}
               </div>`
            : '';

        const amenityFees = meta.amenity_fees && typeof meta.amenity_fees === 'object' ? meta.amenity_fees : {};
        const amenitiesDetailHtml = Array.isArray(meta.amenities) && meta.amenities.length > 0
            ? `<div style="margin-bottom:18px;">
                 <strong style="display:block;color:#2C1E16;margin-bottom:8px;">✨ Amenities, Inclusions &amp; Utility / Advance Payments</strong>
                 <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px;">
                   ${meta.amenities.map(a => {
                       const fee = amenityFees[a];
                       return `<div style="background:#EEF6FA;border:1px solid #C8E2F2;color:#0F4C81;font-size:13px;font-weight:600;padding:8px 12px;border-radius:10px;display:flex;justify-content:space-between;align-items:center;gap:8px;">
                         <span>${AMENITY_ICONS[a] || '✓'} ${escapeHtml(a)}</span>
                         ${fee ? `<span style="background:#FFFFFF;color:#1E293B;font-size:11.5px;font-weight:700;padding:2px 8px;border-radius:999px;">${escapeHtml(fee)}</span>` : ''}
                       </div>`;
                   }).join('')}
                 </div>
               </div>`
            : '';

        const rulesDetailHtml = meta.rules
            ? `<div style="background:#FFF8E1;border:1px solid #FDE68A;padding:14px;border-radius:10px;margin-bottom:18px;">
                 <strong style="display:block;color:#92400E;margin-bottom:4px;">📜 House Rules &amp; Conditions</strong>
                 <p style="color:#78350F;margin:0;font-size:14px;white-space:pre-line;">${escapeHtml(meta.rules)}</p>
               </div>`
            : '';

        const llName = meta.contact_name || property.landlord?.full_name || 'Property Owner';
        const llPhone = meta.contact_phone || property.landlord?.phone || '';
        const llEmail = property.landlord?.email || '';
        const llInitials = llName.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() || 'L';

        const isWishlisted = currentUser?.role === 'tenant' && isInWishlist(property.property_id);

        bodyEl.innerHTML = `
            ${galleryHtml}
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:14px;">
                <span style="font-size:28px;font-weight:800;color:#0F4C81;">${formatPeso(property.price)} <span style="font-size:14px;color:#64748B;font-weight:500;">/ month</span></span>
                ${statusBadgeHtml(property.availability_status)}
            </div>
            <p style="font-size:15px;color:#2C1E16;margin-bottom:14px;">📍 <strong>Location:</strong> ${escapeHtml(property.location)}</p>
            ${specsGridHtml}
            ${landmarksHtml}
            ${amenitiesDetailHtml}
            <div style="margin-bottom:18px;">
                <strong style="display:block;color:#2C1E16;margin-bottom:6px;">📝 Description</strong>
                <p style="color:#475569;line-height:1.7;margin:0;white-space:pre-line;">${escapeHtml(cleanDesc || 'No description provided.')}</p>
            </div>
            ${rulesDetailHtml}
            <div style="background:#FAF8F5;border:1px solid #EAE5DC;padding:18px;border-radius:12px;margin-bottom:20px;">
                <div style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;color:#64748B;margin-bottom:10px;">👤 Property Manager / Landlord Information</div>
                <div style="display:flex;align-items:flex-start;gap:14px;flex-wrap:wrap;">
                    <div style="width:56px;height:56px;border-radius:50%;overflow:hidden;background:linear-gradient(135deg,#0F4C81,#0288D1);color:#fff;font-weight:800;font-size:20px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                        ${escapeHtml(llInitials)}
                    </div>
                    <div style="flex:1;min-width:200px;font-size:14px;color:#334155;line-height:1.65;">
                        <div style="font-size:16px;font-weight:700;color:#1E293B;">
                            ${escapeHtml(llName)}
                            ${property.landlord?.is_verified ? ' <span style="color:#2E7D32;font-size:12.5px;font-weight:700;">✔ Verified Landlord</span>' : ''}
                        </div>
                        ${llPhone ? `<div>📞 <strong>Contact:</strong> ${escapeHtml(llPhone)}</div>` : ''}
                        ${llEmail ? `<div>📧 <strong>Email:</strong> ${escapeHtml(llEmail)}</div>` : ''}
                        ${meta.social_link ? `<div style="margin-top:10px;"><a href="${escapeHtml(normalizeSafeUrl(meta.social_link))}" target="_blank" rel="noopener noreferrer" style="display:inline-flex;align-items:center;gap:6px;background:#1877F2;color:#FFFFFF;padding:8px 14px;border-radius:8px;font-size:13px;font-weight:700;text-decoration:none;">💬 Open Facebook / Messenger ↗</a></div>` : ''}
                    </div>
                </div>
            </div>
            <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:26px;">
                ${canEditThisProperty ? `<button class="btn" onclick="document.getElementById('property-modal').classList.remove('active'); openEditPropertyForm('${property.property_id}')" style="flex:1;min-width:160px;padding:12px;">✏️ Edit Property Details</button>` : ''}
                ${!isOwner && (!currentUser || currentUser.role === 'tenant') ? `<button class="btn" onclick="applyForProperty('${property.property_id}')" style="flex:1;min-width:140px;padding:12px;">📝 Apply Now</button>` : ''}
                ${currentUser?.role === 'tenant' ? `<button class="btn-secondary" onclick="toggleWishlist('${property.property_id}'); openPropertyDetails('${property.property_id}')" style="padding:12px 16px;">${isWishlisted ? '❤️ Wishlisted' : '🤍 Add to Wishlist'}</button>` : ''}
                ${!isOwner && property.landlord_id ? `<button class="btn-secondary" onclick="openMessageToUser('${property.landlord_id}', '${escapeJsAttr(llName)}', '${property.property_id}')" style="flex:1;min-width:140px;padding:12px;">💬 Message Landlord</button>` : ''}
                ${currentUser && !isOwner ? `<button class="btn-secondary" onclick="openComplaintModal('${property.property_id}', '${property.landlord_id}', '${escapeJsAttr(property.title)}')" style="padding:12px 16px;color:#B42318;border-color:#FF6B6B;">🚨 Report</button>` : ''}
            </div>
            <hr style="border:none;border-top:2px solid #EAE5DC;margin:20px 0;">
            <h3 style="color:#2C1E16;margin-bottom:12px;">⭐ Reviews ${avgRating ? `(${avgRating} avg · ${reviews.length})` : '(0)'}</h3>
            ${reviewFormHtml}
            <div>${reviewsListHtml}</div>
        `;
    } catch (error) {
        console.error('Property details error:', error);
        bodyEl.innerHTML = `<div class="auth-alert show error">Failed to load property details: ${escapeHtml(error.message)}</div>`;
    }
}

function nextModalImage() {
    if (!currentModalImages.length) return;
    modalCurrentImageIndex = (modalCurrentImageIndex + 1) % currentModalImages.length;
    const img = document.getElementById('modal-carousel-img');
    const ctr = document.getElementById('modal-carousel-counter');
    if (img) img.src = currentModalImages[modalCurrentImageIndex];
    if (ctr) ctr.textContent = `${modalCurrentImageIndex + 1} / ${currentModalImages.length}`;
}

function prevModalImage() {
    if (!currentModalImages.length) return;
    modalCurrentImageIndex = (modalCurrentImageIndex - 1 + currentModalImages.length) % currentModalImages.length;
    const img = document.getElementById('modal-carousel-img');
    const ctr = document.getElementById('modal-carousel-counter');
    if (img) img.src = currentModalImages[modalCurrentImageIndex];
    if (ctr) ctr.textContent = `${modalCurrentImageIndex + 1} / ${currentModalImages.length}`;
}

async function applyForProperty(propertyId) {
    if (!currentUser) {
        showToast('Please log in as a tenant to apply for this property.', 'warning');
        document.getElementById('property-modal')?.classList.remove('active');
        return showPage('login');
    }
    if (currentUser.role !== 'tenant') {
        return showToast('Only tenant accounts can submit rental applications.', 'warning');
    }

    try {
        await window.applicationService.applyToProperty({
            property_id: propertyId,
            tenant_id: currentUser.id,
        });
        showToast('Application submitted! Check your Tenant Dashboard for status updates.', 'success');
    } catch (error) {
        console.error('Apply error:', error);
        showToast(error.message, 'error');
    }
}

async function handleSubmitReview(event, propertyId) {
    event.preventDefault();
    if (!currentUser) return showToast('Please log in to post a review.', 'warning');

    const rating = document.getElementById('review-rating-input')?.value;
    const comment = document.getElementById('review-comment-input')?.value || '';

    try {
        const res = await window.reviewService.upsertReview({
            property_id: propertyId,
            tenant_id: currentUser.id,
            rating,
            comment,
        });
        showToast(res.updated ? 'Review updated!' : 'Review posted!', 'success');
        openPropertyDetails(propertyId);
    } catch (error) {
        console.error('Review submit error:', error);
        showToast(`Could not save review: ${error.message}`, 'error');
    }
}

async function handleDeleteReview(reviewId, propertyId = null) {
    if (!confirm('Delete your review?')) return;
    try {
        await window.reviewService.deleteReview(reviewId);
        showToast('Review deleted.', 'info');
        if (propertyId) openPropertyDetails(propertyId);
        else loadTenantDashboard();
    } catch (error) {
        showToast(`Failed to delete review: ${error.message}`, 'error');
    }
}

// ============================================================================
// Tenant Dashboard
// ============================================================================
async function loadTenantDashboard() {
    if (!currentUser) return;
    const appsEl = document.getElementById('tenant-saved-properties');
    const reviewsEl = document.getElementById('tenant-reviews');
    const complaintsEl = document.getElementById('tenant-complaints');

    if (appsEl) appsEl.innerHTML = '<p>Loading applications...</p>';
    if (reviewsEl) reviewsEl.innerHTML = '<p>Loading reviews...</p>';
    if (complaintsEl) complaintsEl.innerHTML = '<p>Loading complaints...</p>';

    try {
        const [apps, reviews, complaints] = await Promise.all([
            window.applicationService.getTenantApplications(currentUser.id),
            window.reviewService.getTenantReviews(currentUser.id),
            window.complaintService.getMyComplaints(currentUser.id),
        ]);

        const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = String(v); };
        const wishlistIds = getWishlistIds();
        setTxt('tenant-stat-total', apps.length);
        setTxt('tenant-stat-approved', apps.filter(a => a.status === 'approved').length);
        setTxt('tenant-stat-wishlist', wishlistIds.length);
        setTxt('tenant-stat-reviews', reviews.length);

        // Render Tenant Wishlist tab
        renderTenantWishlistTab(wishlistIds);

        // Populate Tenant Account Profile form + Reviews Activity
        populateRoleProfileForm('tenant');
        const profileReviewsEl = document.getElementById('tenant-profile-reviews');
        if (profileReviewsEl) {
            profileReviewsEl.innerHTML = reviews.length === 0
                ? '<p style="color:#64748B;">No reviews posted yet. Open any property to leave a review.</p>'
                : reviews.map(r => `
                    <div style="border-bottom:1px solid #EAE5DC;padding:12px 0;">
                        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
                            <strong style="color:#1E293B;">${escapeHtml(r.property?.title || 'Property')}</strong>
                            <span style="color:#D97706;font-weight:700;">${renderStars(r.rating)} (${r.rating}/5)</span>
                        </div>
                        <p style="color:#475569;margin:4px 0;font-size:13.5px;">${escapeHtml(r.comment || '')}</p>
                        <small style="color:#94A3B8;">${formatDate(r.created_at)}</small>
                    </div>
                `).join('');
        }

        if (appsEl) {
            appsEl.innerHTML = apps.length === 0
                ? '<p style="color:#654321;">You have not applied to any properties yet. <a href="#" onclick="showPage(\'home\'); return false;" style="color:#0288D1;font-weight:700;">Browse listings →</a></p>'
                : apps.map(a => `
                    <div style="border:2px solid #ADD8E6;border-radius:10px;padding:18px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:14px;">
                        <div>
                            <h3 style="color:#8B4513;margin:0 0 6px;">${escapeHtml(a.property?.title || 'Property')}</h3>
                            <p style="color:#654321;margin:0 0 6px;">📍 ${escapeHtml(a.property?.location || '—')} · <strong>${formatPeso(a.property?.price)}/mo</strong></p>
                            <small style="color:#654321;">Applied: ${formatDate(a.application_date)}</small>
                        </div>
                        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                            ${statusBadgeHtml(a.status)}
                            ${a.property?.property_id ? `<button class="btn-secondary" onclick="openPropertyDetails('${a.property.property_id}')" style="padding:8px 14px;font-size:13px;">View</button>` : ''}
                            ${a.property?.landlord?.id ? `<button class="btn-secondary" onclick="openMessageToUser('${a.property.landlord.id}', '${escapeHtml(a.property.landlord.full_name || 'Landlord')}', '${a.property.property_id}')" style="padding:8px 14px;font-size:13px;">💬 Message</button>` : ''}
                            ${a.status === 'pending' ? `<button class="btn-secondary" onclick="cancelTenantApplication('${a.application_id}')" style="padding:8px 14px;font-size:13px;color:#B42318;border-color:#FF6B6B;">Cancel</button>` : ''}
                        </div>
                    </div>
                `).join('');
        }

        if (reviewsEl) {
            reviewsEl.innerHTML = reviews.length === 0
                ? '<p style="color:#654321;">You haven\'t written any reviews yet. Open any property to leave a review.</p>'
                : reviews.map(r => `
                    <div style="border:1.5px solid #EAE6D6;background:#FAFAF5;border-radius:10px;padding:16px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:start;gap:12px;flex-wrap:wrap;">
                        <div>
                            <strong style="color:#8B4513;">${escapeHtml(r.property?.title || 'Property')}</strong>
                            <span style="margin-left:10px;color:#B54708;font-weight:700;">${renderStars(r.rating)}</span>
                            <p style="color:#654321;margin:6px 0 4px;">${escapeHtml(r.comment || '')}</p>
                            <small style="color:#888;">${formatDate(r.created_at)}</small>
                        </div>
                        <div style="display:flex;gap:8px;">
                            ${r.property?.property_id ? `<button class="btn-secondary" onclick="openPropertyDetails('${r.property.property_id}')" style="padding:7px 12px;font-size:13px;">Edit</button>` : ''}
                            <button class="btn-secondary" onclick="handleDeleteReview('${r.review_id}')" style="padding:7px 12px;font-size:13px;color:#B42318;border-color:#FF6B6B;">Delete</button>
                        </div>
                    </div>
                `).join('');
        }

        if (complaintsEl) {
            complaintsEl.innerHTML = complaints.length === 0
                ? '<p style="color:#654321;">No complaints filed.</p>'
                : complaints.map(c => {
                    const { category, details } = parseComplaintReason(c.reason);
                    return `
                    <div style="border:1.5px solid #EAE6D6;border-radius:10px;padding:16px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
                        <div>
                            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
                                <strong style="color:#1E293B;">${escapeHtml(c.property?.title || 'General Complaint')}</strong>
                                <span style="background:#FEE2E2;color:#991B1B;font-size:11.5px;font-weight:700;padding:2px 9px;border-radius:999px;">🏷️ ${escapeHtml(category)}</span>
                            </div>
                            <p style="color:#475569;margin:4px 0;">${escapeHtml(details)}</p>
                            <small style="color:#94A3B8;">Filed: ${formatDate(c.created_at)}</small>
                        </div>
                        ${statusBadgeHtml(c.status)}
                    </div>
                `;
                }).join('');
        }
    } catch (error) {
        console.error('Tenant dashboard error:', error);
        showToast(`Failed to load dashboard: ${error.message}`, 'error');
    }
}

async function cancelTenantApplication(applicationId) {
    if (!confirm('Cancel this rental application?')) return;
    try {
        await window.applicationService.cancelApplication(applicationId);
        showToast('Application cancelled.', 'info');
        loadTenantDashboard();
    } catch (error) {
        showToast(`Could not cancel application: ${error.message}`, 'error');
    }
}

// ============================================================================
// Landlord Dashboard & Post / Edit Property
// ============================================================================
async function loadLandlordDashboard() {
    if (!currentUser) return;
    const listEl = document.getElementById('landlord-properties-list');
    const appsEl = document.getElementById('landlord-applications-list');
    const inqEl = document.getElementById('landlord-inquiries-list');
    const fbEl = document.getElementById('landlord-feedback-list');

    if (listEl) listEl.innerHTML = '<p>Loading your properties...</p>';
    if (appsEl) appsEl.innerHTML = '<p>Loading applications...</p>';
    if (inqEl) inqEl.innerHTML = '<p>Loading inquiries...</p>';
    if (fbEl) fbEl.innerHTML = '<p>Loading tenant feedback...</p>';

    populateRoleProfileForm('landlord');

    try {
        const [properties, summary, applications, inquiries, feedback] = await Promise.all([
            window.propertyService.getLandlordProperties(currentUser.id),
            window.propertyService.getLandlordSummary(currentUser.id),
            window.applicationService.getLandlordApplications(currentUser.id),
            window.inquiryService.getUserInquiries(currentUser.id),
            window.reviewService.getLandlordReviews(currentUser.id).catch(() => []),
        ]);

        if (fbEl) {
            if (!feedback.length) {
                fbEl.innerHTML = '<div style="text-align:center;padding:36px 20px;background:#FAF8F5;border:1px dashed #D8D2C7;border-radius:14px;color:#64748B;">No tenant feedback or reviews on your properties yet.</div>';
            } else {
                const avg = (feedback.reduce((s, r) => s + Number(r.rating || 0), 0) / feedback.length).toFixed(1);
                fbEl.innerHTML = `
                    <div style="background:#EEF6FA;border:1px solid #C8E2F2;border-radius:12px;padding:14px 18px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
                        <strong style="color:#0F4C81;">⭐ Overall Rating Across Your Listings: ${avg} / 5.0</strong>
                        <span style="font-size:13px;color:#475569;">${feedback.length} review${feedback.length === 1 ? '' : 's'}</span>
                    </div>
                    ${feedback.map(r => `
                        <div class="settings-card" style="padding:16px;margin-bottom:12px;">
                            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:6px;">
                                <div>
                                    <strong style="color:#1E293B;">${escapeHtml(r.tenant?.full_name || 'Tenant')}</strong>
                                    <span style="color:#64748B;font-size:13px;"> reviewed </span>
                                    <strong style="color:#0F4C81;">${escapeHtml(r.property?.title || 'Property')}</strong>
                                </div>
                                <span style="color:#D97706;font-weight:700;">${renderStars(r.rating)} (${r.rating}/5)</span>
                            </div>
                            <p style="color:#475569;margin:6px 0;">${escapeHtml(r.comment || 'No written comment.')}</p>
                            <small style="color:#94A3B8;">${formatDateTime(r.created_at)}</small>
                        </div>
                    `).join('')}
                `;
            }
        }

        const totalProps = summary?.total_properties ?? properties.length;
        const availProps = summary?.available ?? properties.filter(p => p.availability_status === 'available').length;
        const totalVal = summary?.total_value ?? properties.reduce((s, p) => s + Number(p.price || 0), 0);

        const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = String(v); };
        setTxt('landlord-total-properties', totalProps);
        setTxt('landlord-available-properties', availProps);
        setTxt('landlord-occupied-properties', Math.max(0, totalProps - availProps));
        setTxt('landlord-total-value', formatPeso(totalVal));

        if (listEl) {
            listEl.innerHTML = properties.length === 0
                ? '<div style="text-align:center;padding:36px 20px;background:#FAF8F5;border:1px dashed #D8D2C7;border-radius:14px;color:#64748B;">You haven\'t listed any properties yet. Click <strong>＋ Add New Property</strong> above to publish your first listing.</div>'
                : properties.map(p => {
                    const { meta } = parsePropertyDescription(p.description);
                    const thumbUrl = Array.isArray(p.image_urls) && p.image_urls[0] ? p.image_urls[0] : '';
                    const thumbHtml = thumbUrl
                        ? `<img src="${escapeHtml(thumbUrl)}" alt="${escapeHtml(p.title)}">`
                        : '<span>🏠</span>';
                    const chips = [
                        meta.type ? `🏷️ ${escapeHtml(meta.type)}` : '',
                        meta.slots ? `🛏️ ${meta.slots} slot${meta.slots > 1 ? 's' : ''}` : '',
                        meta.area ? `📐 ${escapeHtml(meta.area)}` : '',
                        `📷 ${Array.isArray(p.image_urls) ? p.image_urls.length : 0} photo${(p.image_urls?.length || 0) === 1 ? '' : 's'}`,
                    ].filter(Boolean).map(c => `<span style="background:#FAF8F5;border:1px solid #EAE5DC;color:#475569;font-size:11.5px;font-weight:600;padding:3px 9px;border-radius:999px;">${c}</span>`).join('');

                    const approvalState = getPropertyApprovalState(p, meta);
                    const approvalBadge = approvalState === 'pending_approval'
                        ? '<span style="display:inline-block;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:700;background:#FEF3C7;color:#92400E;">⏳ Pending Admin Approval</span>'
                        : approvalState === 'rejected'
                        ? '<span style="display:inline-block;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:700;background:#FEE2E2;color:#991B1B;">❌ Rejected by Admin</span>'
                        : statusBadgeHtml(p.availability_status);
                    const rejectionNoteHtml = (approvalState === 'rejected' && meta.rejection_reason)
                        ? `<div style="margin-top:6px;padding:8px 10px;background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;font-size:12.5px;color:#991B1B;"><strong>Admin Note:</strong> ${escapeHtml(meta.rejection_reason)} — <em>Edit details to resubmit for approval.</em></div>`
                        : '';
                    const isAwaitingAdmin = approvalState === 'pending_approval' || approvalState === 'rejected';

                    return `
                    <div class="landlord-listing-card">
                        <div class="landlord-listing-left">
                            <div class="landlord-listing-thumb">${thumbHtml}</div>
                            <div style="min-width:0;flex:1;">
                                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
                                    <h3 style="color:#1E293B;font-size:17px;font-weight:700;margin:0;">${escapeHtml(p.title)}</h3>
                                    ${approvalBadge}
                                </div>
                                <div style="font-size:13.5px;color:#64748B;margin-bottom:6px;">📍 ${escapeHtml(p.location)}</div>
                                <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px;">
                                    <span style="font-size:17px;font-weight:800;color:#0F4C81;">${formatPeso(p.price)}<span style="font-size:12px;font-weight:500;color:#64748B;"> /mo</span></span>
                                    <small style="color:#94A3B8;">Updated ${formatDate(p.updated_at || p.created_at)}</small>
                                </div>
                                <div style="display:flex;gap:6px;flex-wrap:wrap;">${chips}</div>
                                ${rejectionNoteHtml}
                            </div>
                        </div>
                        <div class="landlord-listing-actions">
                            <select class="ll-status-select" ${isAwaitingAdmin ? 'disabled title="Awaiting admin approval before listing can go live"' : ''} onchange="handleLandlordStatusChange('${p.property_id}', this.value)" aria-label="Availability status">
                                ${isAwaitingAdmin
                                    ? '<option selected>⏳ Awaiting Approval</option>'
                                    : ['available', 'occupied', 'hidden'].map(st => `<option value="${st}" ${p.availability_status === st ? 'selected' : ''}>${st === 'available' ? '✅ Available' : st === 'occupied' ? '🔒 Occupied' : '🙈 Hidden'}</option>`).join('')
                                }
                            </select>
                            <button type="button" class="ll-btn-preview" onclick="openPropertyDetails('${p.property_id}')">👁️ Preview</button>
                            <button type="button" class="ll-btn-edit" onclick="openEditPropertyForm('${p.property_id}')">✏️ Edit Details</button>
                            <button type="button" class="ll-btn-delete" onclick="handleLandlordDeleteProperty('${p.property_id}')">🗑 Delete</button>
                        </div>
                    </div>
                `;
                }).join('');
        }

        if (appsEl) {
            appsEl.innerHTML = applications.length === 0
                ? '<p style="color:#654321;">No applications received yet.</p>'
                : applications.map(a => `
                    <div style="border:1.5px solid #EAE6D6;background:#FAFAF5;border-radius:10px;padding:16px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
                        <div>
                            <strong style="color:#8B4513;">${escapeHtml(a.tenant?.full_name || 'Tenant')}</strong>
                            <span style="color:#654321;"> applied for </span>
                            <strong style="color:#0288D1;">${escapeHtml(a.property?.title || 'Property')}</strong>
                            <div style="font-size:13px;color:#654321;margin-top:4px;">📧 ${escapeHtml(a.tenant?.email || '—')} ${a.tenant?.phone ? `· 📞 ${escapeHtml(a.tenant.phone)}` : ''} · ${formatDate(a.application_date)}</div>
                        </div>
                        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                            ${statusBadgeHtml(a.status)}
                            ${a.status === 'approved' ? `
                                <button class="btn-secondary" onclick="handleLandlordVacated('${a.application_id}', '${a.property?.property_id || ''}')" style="padding:7px 14px;font-size:13px;background:#DC2626 !important;color:#FFFFFF !important;border-color:#DC2626 !important;">Vacated</button>
                            ` : ''}
                            ${a.status === 'pending' ? `
                                <button class="btn" onclick="handleLandlordAppDecision('${a.application_id}', 'approved')" style="padding:7px 14px;font-size:13px;background:#2E7D32;color:#fff;">✔ Approve</button>
                                <button class="btn-secondary" onclick="handleLandlordAppDecision('${a.application_id}', 'rejected')" style="padding:7px 14px;font-size:13px;color:#B42318;border-color:#FF6B6B;">✖ Reject</button>
                            ` : ''}
                        </div>
                    </div>
                `).join('');
        }

        if (inqEl) {
            const received = inquiries.filter(i => i.receiver_id === currentUser.id);
            inqEl.innerHTML = received.length === 0
                ? '<p style="color:#654321;">No tenant inquiries yet.</p>'
                : received.map(inq => `
                    <div style="border:1.5px solid #ADD8E6;border-radius:10px;padding:16px;margin-bottom:12px;">
                        <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:6px;">
                            <strong style="color:#8B4513;">From: ${escapeHtml(inq.sender?.full_name || 'Tenant')}</strong>
                            <small style="color:#888;">${formatDateTime(inq.date_sent)}</small>
                        </div>
                        ${inq.property?.title ? `<div style="font-size:13px;color:#0288D1;margin-bottom:6px;">🏠 Re: ${escapeHtml(inq.property.title)}</div>` : ''}
                        <p style="color:#654321;margin-bottom:10px;">${escapeHtml(inq.message)}</p>
                        <form onsubmit="handleInlineInquiryReply(event, '${inq.sender_id}', '${inq.property_id || ''}')" style="display:flex;gap:8px;">
                            <input type="text" required placeholder="Write a quick reply..." style="flex:1;padding:9px 12px;border:2px solid #ADD8E6;border-radius:8px;font-size:14px;">
                            <button type="submit" class="btn" style="padding:9px 16px;font-size:14px;">Reply</button>
                        </form>
                    </div>
                `).join('');
        }
    } catch (error) {
        console.error('Landlord dashboard error:', error);
        showToast(`Failed to load landlord dashboard: ${error.message}`, 'error');
    }
}

async function handleLandlordStatusChange(propertyId, newStatus) {
    try {
        await window.propertyService.updateProperty(propertyId, { availability_status: newStatus });
        showToast(`Property marked as ${newStatus}.`, 'success');
        loadLandlordDashboard();
    } catch (error) {
        showToast(`Failed to update status: ${error.message}`, 'error');
    }
}

async function handleLandlordDeleteProperty(propertyId) {
    if (!confirm('Permanently delete this property listing?')) return;
    try {
        await window.propertyService.deleteProperty(propertyId);
        showToast('Property deleted.', 'info');
        loadLandlordDashboard();
    } catch (error) {
        showToast(`Failed to delete property: ${error.message}`, 'error');
    }
}

async function handleLandlordAppDecision(applicationId, status) {
    try {
        await window.applicationService.updateStatus(applicationId, status);
        showToast(`Application ${status}!`, status === 'approved' ? 'success' : 'info');
        loadLandlordDashboard();
    } catch (error) {
        showToast(`Failed to update application: ${error.message}`, 'error');
    }
}

async function handleLandlordVacated(applicationId, propertyId) {
    if (!confirm('Mark this tenant as Vacated? The property will be set back to Available.')) return;
    try {
        await window.applicationService.updateStatus(applicationId, 'cancelled');
        if (propertyId) {
            await window.propertyService.updateProperty(propertyId, { availability_status: 'available' });
        }
        showToast('Tenant marked as Vacated. Property is now Available!', 'info');
        loadLandlordDashboard();
    } catch (error) {
        showToast(`Failed to mark as vacated: ${error.message}`, 'error');
    }
}

async function handleInlineInquiryReply(event, receiverId, propertyId) {
    event.preventDefault();
    const input = event.target.querySelector('input');
    const message = input?.value.trim() || '';
    if (!message) return;
    try {
        await window.inquiryService.sendInquiry({
            receiver_id: receiverId,
            property_id: propertyId || null,
            message,
        });
        input.value = '';
        showToast('Reply sent!', 'success');
    } catch (error) {
        showToast(`Failed to send reply: ${error.message}`, 'error');
    }
}

function openCreatePropertyForm() {
    if (currentUser?.role === 'landlord' && !currentUser.is_verified) {
        return showToast('Your landlord account is pending admin verification.', 'warning');
    }
    editingExistingImageUrls = [];
    const editId = document.getElementById('edit-property-id');
    if (editId) editId.value = '';
    const heading = document.getElementById('post-property-heading');
    if (heading) heading.textContent = 'Post New Property';
    const submitBtn = document.getElementById('post-property-submit-btn');
    if (submitBtn) submitBtn.textContent = 'Publish Property';
    document.getElementById('post-property-form')?.reset();
    const latReset = document.getElementById('property-lat');
    const lngReset = document.getElementById('property-lng');
    const pinLbl = document.getElementById('post-map-coords-label');
    if (latReset) latReset.value = '';
    if (lngReset) lngReset.value = '';
    if (pinLbl) pinLbl.textContent = 'Click anywhere on the map to pin the address (auto-fills Google Maps link)';
    const preview = document.getElementById('image-preview');
    if (preview) preview.innerHTML = '';
    showPage('post-property');
}

async function openEditPropertyForm(propertyId) {
    try {
        const prop = await window.propertyService.getPropertyById(propertyId);
        const { text: cleanDesc, meta } = parsePropertyDescription(prop.description);
        editingExistingImageUrls = Array.isArray(prop.image_urls) ? [...prop.image_urls] : [];
        showPage('post-property');

        const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v ?? ''; };
        setVal('edit-property-id', prop.property_id);
        setVal('property-name', prop.title);
        setVal('property-type', meta.type || 'Studio Type');
        setVal('property-address', prop.location);
        setVal('monthly-rent', prop.price);
        setVal('available-slots', meta.slots || 1);
        setVal('property-area', meta.area || '');
        setVal('min-occupants', meta.min_occupants || '');
        setVal('min-stay', meta.min_stay || '');
        setVal('advance-payment', meta.advance_payment || '');
        setVal('move-in-date', meta.move_in_date || '');
        setVal('nearby-landmarks', meta.landmarks || '');
        setVal('location-link', meta.map_link || '');
        setVal('property-description', cleanDesc);
        setVal('property-rules', meta.rules || '');
        setVal('property-availability-status', prop.availability_status || 'available');
        setVal('contact-name', meta.contact_name || currentUser?.full_name || '');
        setVal('contact-number', meta.contact_phone || currentUser?.phone || '');
        setVal('contact-social-link', meta.social_link || '');
        setVal('property-lat', meta.lat ?? '');
        setVal('property-lng', meta.lng ?? '');

        const savedAmenities = new Set(Array.isArray(meta.amenities) ? meta.amenities : []);
        const savedFees = meta.amenity_fees && typeof meta.amenity_fees === 'object' ? meta.amenity_fees : {};
        document.querySelectorAll('#post-property-form input[name="amenity"]').forEach(cb => {
            cb.checked = savedAmenities.has(cb.value);
        });
        document.querySelectorAll('#post-property-form input[data-amenity-fee]').forEach(inp => {
            const key = inp.getAttribute('data-amenity-fee');
            inp.value = savedFees[key] || '';
        });

        const heading = document.getElementById('post-property-heading');
        if (heading) heading.textContent = 'Edit Property Details';
        const submitBtn = document.getElementById('post-property-submit-btn');
        if (submitBtn) submitBtn.textContent = 'Save Changes';

        renderExistingImagePreview();
        initPostPropertyMap(meta.lat, meta.lng);
    } catch (error) {
        showToast(`Could not load property for editing: ${error.message}`, 'error');
    }
}

function renderExistingImagePreview() {
    const preview = document.getElementById('image-preview');
    if (!preview) return;
    preview.innerHTML = editingExistingImageUrls.map((url, idx) => `
        <div style="position:relative;">
            <img src="${escapeHtml(url)}" style="width:100%;height:95px;object-fit:cover;border-radius:8px;border:2px solid #ADD8E6;">
            <button type="button" onclick="removeEditingImage(${idx})" style="position:absolute;top:4px;right:4px;background:#FF6B6B;color:#fff;border:none;border-radius:50%;width:22px;height:22px;cursor:pointer;font-size:12px;">×</button>
        </div>
    `).join('');
}

function removeEditingImage(index) {
    editingExistingImageUrls.splice(index, 1);
    renderExistingImagePreview();
}

function loadPostPropertyForm() {
    if (!currentUser) return;
    const cn = document.getElementById('contact-name');
    const cnum = document.getElementById('contact-number');
    if (cn && !cn.value) cn.value = currentUser.full_name || '';
    if (cnum && !cnum.value) cnum.value = currentUser.phone || '';
    hideAuthAlert('post-property-alert');
    const latVal = document.getElementById('property-lat')?.value;
    const lngVal = document.getElementById('property-lng')?.value;
    initPostPropertyMap(latVal ? Number(latVal) : null, lngVal ? Number(lngVal) : null);
}

async function handlePostProperty(event) {
    event.preventDefault();
    if (!currentUser) return showToast('Please log in first.', 'warning');
    if (currentUser.role === 'landlord' && !currentUser.is_verified) {
        return showAuthAlert('post-property-alert', 'Only verified landlords can publish properties.', 'error');
    }

    const editId = document.getElementById('edit-property-id')?.value || '';
    const title = document.getElementById('property-name')?.value.trim() || '';
    const location = document.getElementById('property-address')?.value.trim() || '';
    const price = Number(document.getElementById('monthly-rent')?.value || 0);
    const plainDescription = document.getElementById('property-description')?.value.trim() || '';
    const requestedStatus = document.getElementById('property-availability-status')?.value || 'available';

    // New landlord uploads MUST pass Admin verification first (hidden from tenants until approved)
    let finalAvailability = requestedStatus;
    let approvalStatus = 'approved';
    if (currentUser.role !== 'admin') {
        if (!editId) {
            finalAvailability = 'hidden';
            approvalStatus = 'pending_approval';
        } else {
            try {
                const existingProp = await window.propertyService.getPropertyById(editId);
                const prevApproval = getPropertyApprovalState(existingProp);
                if (prevApproval === 'pending_approval' || prevApproval === 'rejected') {
                    finalAvailability = 'hidden';
                    approvalStatus = 'pending_approval';
                }
            } catch {
                // fallback to requested
            }
        }
    }

    const checkedAmenities = Array.from(document.querySelectorAll('#post-property-form input[name="amenity"]:checked')).map(cb => cb.value);
    const amenityFees = {};
    document.querySelectorAll('#post-property-form input[data-amenity-fee]').forEach(inp => {
        const key = inp.getAttribute('data-amenity-fee');
        const val = inp.value.trim();
        if (val) {
            amenityFees[key] = val;
            if (!checkedAmenities.includes(key)) checkedAmenities.push(key);
        }
    });
    const description = encodePropertyDescription(plainDescription, {
        type: document.getElementById('property-type')?.value || '',
        slots: document.getElementById('available-slots')?.value || 1,
        area: document.getElementById('property-area')?.value || '',
        min_occupants: document.getElementById('min-occupants')?.value || '',
        min_stay: document.getElementById('min-stay')?.value || '',
        advance_payment: document.getElementById('advance-payment')?.value || '',
        move_in_date: document.getElementById('move-in-date')?.value || '',
        landmarks: document.getElementById('nearby-landmarks')?.value || '',
        map_link: document.getElementById('location-link')?.value || '',
        rules: document.getElementById('property-rules')?.value || '',
        amenities: checkedAmenities,
        amenity_fees: amenityFees,
        contact_name: document.getElementById('contact-name')?.value.trim() || '',
        contact_phone: document.getElementById('contact-number')?.value.trim() || '',
        social_link: document.getElementById('contact-social-link')?.value.trim() || '',
        approval_status: approvalStatus,
        rejection_reason: '',
        lat: document.getElementById('property-lat')?.value || '',
        lng: document.getElementById('property-lng')?.value || '',
    });
    const fileInput = document.getElementById('property-images');
    const submitBtn = document.getElementById('post-property-submit-btn');

    submitBtn.disabled = true;
    submitBtn.textContent = editId ? '⏳ Saving...' : '⏳ Submitting for Approval...';

    try {
        const uploadedUrls = [...editingExistingImageUrls];
        if (fileInput?.files?.length) {
            for (const file of Array.from(fileInput.files)) {
                const url = await window.propertyService.uploadPropertyImage(currentUser.id, file);
                uploadedUrls.push(url);
            }
        }

        if (editId) {
            await window.propertyService.updateProperty(editId, {
                title, location, price, description, availability_status: finalAvailability, image_urls: uploadedUrls,
            });
            showToast(
                approvalStatus === 'pending_approval'
                    ? 'Property updated and resubmitted for Admin verification!'
                    : 'Property updated successfully!',
                'success'
            );
        } else {
            await window.propertyService.createProperty({
                landlord_id: currentUser.id,
                title, location, price, description, availability_status: finalAvailability, image_urls: uploadedUrls,
            });
            showToast(
                approvalStatus === 'pending_approval'
                    ? 'Property submitted! It will be visible to tenants once approved by Admin. ⏳'
                    : 'Property published successfully! 🎉',
                'success'
            );
        }

        document.getElementById('post-property-form')?.reset();
        editingExistingImageUrls = [];
        showPage('landlord-dashboard');
    } catch (error) {
        console.error('Post property error:', error);
        showAuthAlert('post-property-alert', `Failed to save property: ${error.message}`, 'error');
        showToast(error.message, 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = editId ? 'Save Changes' : 'Publish Property';
    }
}

// ============================================================================
// Wishlist, Role Account Profiles, and Landlord Payment & QR Ph Helpers
// ============================================================================
function getWishlistIds() {
    if (!currentUser) return [];
    const fromMeta = Array.isArray(currentUser.wishlist) ? currentUser.wishlist : [];
    const localKey = `housingo_wishlist_${currentUser.id}`;
    try {
        const local = JSON.parse(localStorage.getItem(localKey) || '[]');
        return Array.from(new Set([...fromMeta, ...(Array.isArray(local) ? local : [])]));
    } catch {
        return fromMeta;
    }
}

function isInWishlist(propertyId) {
    return getWishlistIds().includes(propertyId);
}

async function toggleWishlist(propertyId) {
    if (!currentUser || currentUser.role !== 'tenant') {
        return showToast('Log in as a Tenant to save properties to your Wishlist.', 'warning');
    }
    const current = getWishlistIds();
    const exists = current.includes(propertyId);
    const updated = exists ? current.filter(id => id !== propertyId) : [...current, propertyId];

    currentUser.wishlist = updated;
    localStorage.setItem(`housingo_wishlist_${currentUser.id}`, JSON.stringify(updated));
    showToast(exists ? 'Removed from Wishlist.' : 'Saved to Wishlist ❤️', exists ? 'info' : 'success');

    if (cachedAvailableProperties.length) renderHomeGrid(cachedAvailableProperties);
    const statEl = document.getElementById('tenant-stat-wishlist');
    if (statEl) statEl.textContent = String(updated.length);
    renderTenantWishlistTab(updated);

    try {
        await window.authService.updateUserMetadata({ wishlist: updated });
    } catch (err) {
        console.warn('Could not sync wishlist to Auth metadata:', err);
    }
}

async function renderTenantWishlistTab(wishlistIds) {
    const el = document.getElementById('tenant-wishlist-list');
    if (!el) return;
    if (!wishlistIds || wishlistIds.length === 0) {
        el.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:36px 20px;background:#FAF8F5;border:1px dashed #D8D2C7;border-radius:14px;color:#64748B;">Your wishlist is empty. Tap the 🤍 heart on any rental property to save it here!</div>';
        return;
    }
    if (!cachedAvailableProperties.length) {
        cachedAvailableProperties = await window.propertyService.getAvailableProperties().catch(() => []);
    }
    const items = cachedAvailableProperties.filter(p => wishlistIds.includes(p.property_id));
    if (!items.length) {
        el.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:30px;color:#64748B;">Saved properties are currently unavailable.</div>';
        return;
    }
    el.innerHTML = items.map(renderPropertyCard).join('');
}

function compressImageToDataUrl(file, maxSize = 480) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Failed to read image file.'));
        reader.onload = (ev) => {
            const img = new Image();
            img.onerror = () => reject(new Error('Invalid image file.'));
            img.onload = () => {
                const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(img.width * scale));
                canvas.height = Math.max(1, Math.round(img.height * scale));
                canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', 0.82));
            };
            img.src = ev.target.result;
        };
        reader.readAsDataURL(file);
    });
}

function populateRoleProfileForm(role) {
    if (!currentUser) return;
    const prefix = role === 'landlord' ? 'll' : 'tn';
    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
    setVal(`${prefix}-profile-name`, currentUser.full_name);
    setVal(`${prefix}-profile-email`, currentUser.email);
    setVal(`${prefix}-profile-phone`, currentUser.phone);
    setVal(`${prefix}-profile-bio`, currentUser.bio);
    setVal(`${prefix}-profile-hobbies`, currentUser.hobbies);
    if (role === 'landlord') {
        setVal('ll-profile-address', currentUser.house_address);
        const docs = currentUser.verification_docs || {};
        const docFields = [
            { key: 'title_copy', previewId: 'll-doc-title-preview', label: 'Certified True Copy of Title' },
            { key: 'business_permit', previewId: 'll-doc-business-permit-preview', label: 'Business Permit' },
            { key: 'tax_receipt', previewId: 'll-doc-tax-receipt-preview', label: 'Real Property Tax Receipt' },
            { key: 'valid_ids', previewId: 'll-doc-valid-ids-preview', label: '2 Valid IDs w/ 3 Specimen Signatures' },
        ];
        docFields.forEach(({ key, previewId, label }) => {
            const pEl = document.getElementById(previewId);
            if (!pEl) return;
            if (docs[key]) {
                pEl.innerHTML = `
                    <div style="display:flex;align-items:center;gap:10px;">
                        <a href="${escapeHtml(docs[key])}" target="_blank" rel="noopener noreferrer">
                            <img src="${escapeHtml(docs[key])}" alt="${escapeHtml(label)}" style="width:58px;height:58px;object-fit:cover;border-radius:8px;border:1.5px solid #C8E2F2;">
                        </a>
                        <span style="font-size:12px;font-weight:700;color:#2E7D32;">✅ Uploaded</span>
                    </div>
                `;
            } else {
                pEl.innerHTML = '<small style="color:#94A3B8;">⏳ Not uploaded yet</small>';
            }
        });
    }

    const avEl = document.getElementById(`${prefix}-profile-avatar-preview`);
    if (avEl) {
        if (currentUser.avatar_url) {
            avEl.innerHTML = `<img src="${escapeHtml(currentUser.avatar_url)}" alt="Avatar" style="width:100%;height:100%;object-fit:cover;">`;
        } else {
            const initials = (currentUser.full_name || 'U').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
            avEl.textContent = initials || '👤';
        }
    }
}

async function syncLandlordMetaToProperties() {
    if (!currentUser || currentUser.role !== 'landlord') return;
    try {
        const props = await window.propertyService.getLandlordProperties(currentUser.id);
        for (const p of props) {
            const { text, meta } = parsePropertyDescription(p.description);
            const updatedDesc = encodePropertyDescription(text, {
                ...meta,
                landlord_profile: {
                    avatar_url: currentUser.avatar_url || '',
                    bio: currentUser.bio || '',
                    hobbies: currentUser.hobbies || '',
                    house_address: currentUser.house_address || '',
                    email: currentUser.email || '',
                },
            });
            await window.propertyService.updateProperty(p.property_id, { description: updatedDesc });
        }
    } catch (err) {
        console.warn('Could not sync landlord metadata to existing listings:', err);
    }
}

async function handleSaveRoleProfile(event, role) {
    event.preventDefault();
    if (!currentUser) return;
    const prefix = role === 'landlord' ? 'll' : 'tn';
    const btn = document.getElementById(`${prefix}-save-profile-btn`);
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Saving...'; }

    try {
        const fullName = document.getElementById(`${prefix}-profile-name`)?.value.trim() || currentUser.full_name;
        const phone = document.getElementById(`${prefix}-profile-phone`)?.value.trim() || '';
        const bio = document.getElementById(`${prefix}-profile-bio`)?.value.trim() || '';
        const hobbies = document.getElementById(`${prefix}-profile-hobbies`)?.value.trim() || '';
        const houseAddress = role === 'landlord' ? (document.getElementById('ll-profile-address')?.value.trim() || '') : currentUser.house_address;
        const photoFile = document.getElementById(`${prefix}-profile-photo`)?.files?.[0];

        let avatarUrl = currentUser.avatar_url || '';
        if (photoFile) {
            if (role === 'landlord' && currentUser.is_verified) {
                try {
                    avatarUrl = await window.propertyService.uploadPropertyImage(currentUser.id, photoFile);
                } catch {
                    avatarUrl = await compressImageToDataUrl(photoFile, 240);
                }
            } else {
                avatarUrl = await compressImageToDataUrl(photoFile, 240);
            }
        }

        const verificationDocs = { ...(currentUser.verification_docs || {}) };
        if (role === 'landlord') {
            const docInputs = [
                { id: 'll-doc-title', key: 'title_copy' },
                { id: 'll-doc-business-permit', key: 'business_permit' },
                { id: 'll-doc-tax-receipt', key: 'tax_receipt' },
                { id: 'll-doc-valid-ids', key: 'valid_ids' },
            ];
            for (const item of docInputs) {
                const file = document.getElementById(item.id)?.files?.[0];
                if (file) {
                    if (currentUser.is_verified) {
                        try {
                            verificationDocs[item.key] = await window.propertyService.uploadPropertyImage(currentUser.id, file);
                        } catch {
                            verificationDocs[item.key] = await compressImageToDataUrl(file, 420);
                        }
                    } else {
                        verificationDocs[item.key] = await compressImageToDataUrl(file, 420);
                    }
                }
            }
        }

        const updatedProfile = await window.authService.updateProfile(currentUser.id, { full_name: fullName, phone });
        const updatedAuthUser = await window.authService.updateUserMetadata({
            full_name: fullName,
            phone,
            avatar_url: avatarUrl,
            bio,
            hobbies,
            house_address: houseAddress,
            ...(role === 'landlord' ? { verification_docs: verificationDocs } : {}),
        });

        currentUser = normalizeUserProfile(updatedProfile, updatedAuthUser);
        updateNavForLoggedInUser();
        populateRoleProfileForm(role);

        if (role === 'landlord') {
            await window.inquiryService.syncLandlordProfileForAdmin(currentUser.id, {
                full_name: fullName,
                email: currentUser.email || '',
                phone,
                avatar_url: avatarUrl,
                bio,
                hobbies,
                house_address: houseAddress,
                verification_docs: verificationDocs,
            });
            showToast('Account profile saved and updated for Admin review! 🔒', 'success');
        } else {
            showToast('Account profile saved successfully!', 'success');
        }
    } catch (error) {
        console.error('Save role profile error:', error);
        showToast(`Failed to save profile: ${error.message}`, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = role === 'landlord' ? '💾 Save Landlord Profile' : '💾 Save Tenant Profile'; }
    }
}

// ============================================================================
// Admin Dashboard
// ============================================================================
async function loadAdminDashboard() {
    if (!currentUser || currentUser.role !== 'admin') return;
    try {
        const report = await window.adminService.getAdminReports();
        if (report) {
            const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = String(v ?? 0); };
            setTxt('admin-total-users', report.total_users);
            setTxt('admin-total-properties', report.total_listings);
            setTxt('admin-open-complaints', report.open_complaints);
        }
        await Promise.all([
            loadAdminUsers(),
            loadAdminProperties(),
            loadAdminComplaints(),
            loadAdminSystemRecords(),
        ]);
    } catch (error) {
        console.error('Admin dashboard error:', error);
        showToast(`Admin dashboard error: ${error.message}`, 'error');
    }
}

let adminUsersCache = [];
let activeAdminDetailUserId = null;

async function loadAdminUsers() {
    const el = document.getElementById('admin-users-list');
    if (!el) return;
    el.innerHTML = '<p>Loading users...</p>';

    try {
        const users = await window.adminService.getUsers({
            search: document.getElementById('admin-user-search')?.value || '',
            role: document.getElementById('admin-user-role-filter')?.value || '',
            status: document.getElementById('admin-user-status-filter')?.value || '',
        });
        adminUsersCache = users;

        if (!users.length) {
            el.innerHTML = '<p style="color:#64748B;">No matching users found.</p>';
            return;
        }

        el.innerHTML = users.map(u => {
            const roleBadgeColor = u.role === 'admin' ? '#7C3AED' : u.role === 'landlord' ? '#0F4C81' : '#0288D1';
            const roleBadgeBg = u.role === 'admin' ? '#F3E8FF' : u.role === 'landlord' ? '#EBF5FF' : '#E0F2FE';
            const canViewDetails = u.role === 'tenant' || u.role === 'landlord';
            return `
            <div style="border:1.5px solid #EAE5DC;background:#FFFFFF;border-radius:12px;padding:14px 16px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
                <div>
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:3px;">
                        <strong style="color:#1E293B;font-size:15px;">${escapeHtml(u.full_name)}</strong>
                        <span style="padding:2px 9px;border-radius:999px;font-size:11px;font-weight:700;text-transform:uppercase;color:${roleBadgeColor};background:${roleBadgeBg};">${escapeHtml(u.role)}</span>
                        ${u.role === 'landlord' ? (u.is_verified ? '<span style="color:#166534;background:#DCFCE7;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:700;">✔ Verified</span>' : '<span style="color:#92400E;background:#FEF3C7;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:700;">⏳ Unverified</span>') : ''}
                    </div>
                    <div style="font-size:13px;color:#64748B;">${escapeHtml(u.email)} ${u.phone ? `· ${escapeHtml(u.phone)}` : ''} · Joined ${formatDate(u.created_at)}</div>
                </div>
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                    ${statusBadgeHtml(u.status)}
                    ${canViewDetails ? `<button class="ll-btn-preview" onclick="openAdminUserDetails('${u.id}')" style="padding:7px 12px;font-size:12px;">👁️ View Details</button>` : ''}
                    ${u.role === 'landlord' ? `<button class="btn" onclick="adminVerifyLandlord('${u.id}', ${!u.is_verified})" style="padding:7px 12px;font-size:12px;">${u.is_verified ? 'Revoke Verify' : '✔ Verify Landlord'}</button>` : ''}
                    ${u.id !== currentUser.id ? `<button class="btn-secondary" onclick="adminToggleUserStatus('${u.id}', '${u.status === 'suspended' ? 'active' : 'suspended'}')" style="padding:7px 12px;font-size:12px;${u.status === 'suspended' ? 'color:#1B5E20;border-color:#2E7D32;' : 'color:#B42318;border-color:#FF6B6B;'}">${u.status === 'suspended' ? 'Activate' : 'Suspend'}</button>` : ''}
                </div>
            </div>
        `;
        }).join('');
    } catch (error) {
        el.innerHTML = `<div class="auth-alert show error">${escapeHtml(error.message)}</div>`;
    }
}

function closeAdminUserDetails() {
    activeAdminDetailUserId = null;
    document.getElementById('admin-user-details-modal')?.classList.remove('active');
}

async function openAdminUserDetails(userId) {
    if (!currentUser || currentUser.role !== 'admin') return;
    const modal = document.getElementById('admin-user-details-modal');
    const titleEl = document.getElementById('admin-user-details-title');
    const bodyEl = document.getElementById('admin-user-details-body');
    if (!modal || !bodyEl) return;

    activeAdminDetailUserId = userId;
    modal.classList.add('active');
    if (titleEl) titleEl.textContent = '👤 User Details';
    bodyEl.innerHTML = '<div style="text-align:center;padding:32px;color:#64748B;">Loading user details...</div>';

    try {
        let user = adminUsersCache.find(u => u.id === userId) || null;
        if (!user) {
            user = await window.authService.getProfile(userId);
        }
        if (!user) {
            bodyEl.innerHTML = '<div class="auth-alert show error">User profile not found.</div>';
            return;
        }

        const isLandlord = user.role === 'landlord';
        const isTenant = user.role === 'tenant';
        const initials = (user.full_name || 'U').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() || 'U';
        if (titleEl) titleEl.textContent = isLandlord ? '🔑 Landlord Details' : isTenant ? '🔍 Tenant Details' : '👤 User Details';

        if (isLandlord) {
            const [props, apps, reviews, complaints, syncedProfile] = await Promise.all([
                window.propertyService.getLandlordProperties(userId).catch(() => []),
                window.applicationService.getLandlordApplications(userId).catch(() => []),
                window.reviewService.getLandlordReviews(userId).catch(() => []),
                window.complaintService.getMyComplaints(userId).catch(() => []),
                window.inquiryService.getLatestLandlordProfileSync(userId).catch(() => null),
            ]);

            // Prefer the private Admin-only synced profile; fallback to any legacy listing metadata
            let extProfile = syncedProfile || null;
            if (!extProfile) {
                for (const p of props) {
                    const { meta } = parsePropertyDescription(p.description);
                    if (meta?.landlord_profile) {
                        extProfile = meta.landlord_profile;
                        break;
                    }
                }
            }

            const docs = extProfile?.verification_docs || {};
            const docItems = [
                { key: 'title_copy', label: '📜 Certified True Copy of Title' },
                { key: 'business_permit', label: '🏢 Business Permit' },
                { key: 'tax_receipt', label: '🧾 Real Property Tax Receipt' },
                { key: 'valid_ids', label: '🪪 2 Valid IDs w/ 3 Specimen Signatures' },
            ];
            const uploadedDocCount = docItems.filter(d => Boolean(docs[d.key])).length;

            const avgRating = reviews.length
                ? (reviews.reduce((sum, r) => sum + Number(r.rating || 0), 0) / reviews.length).toFixed(1)
                : '—';

            const displayFullName = extProfile?.full_name || user.full_name;
            const displayPhone = extProfile?.phone || user.phone || 'Not provided';

            const avatarHtml = extProfile?.avatar_url
                ? `<img src="${escapeHtml(extProfile.avatar_url)}" alt="${escapeHtml(displayFullName)}" style="width:64px;height:64px;border-radius:50%;object-fit:cover;border:2.5px solid #0F4C81;flex-shrink:0;">`
                : `<div style="width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,#0F4C81,#0288D1);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:22px;flex-shrink:0;">${escapeHtml(initials)}</div>`;

            bodyEl.innerHTML = `
                <div style="display:flex;align-items:center;gap:16px;padding:16px;background:#FAF8F5;border:1.5px solid #EAE5DC;border-radius:14px;margin-bottom:16px;flex-wrap:wrap;">
                    ${avatarHtml}
                    <div style="flex:1;min-width:200px;">
                        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
                            <h3 style="margin:0;color:#1E293B;font-size:18px;">${escapeHtml(displayFullName)}</h3>
                            <span style="padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;text-transform:uppercase;color:#0F4C81;background:#EBF5FF;">Landlord</span>
                            ${user.is_verified
                                ? '<span style="padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;color:#166534;background:#DCFCE7;">✔ Verified</span>'
                                : '<span style="padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;color:#92400E;background:#FEF3C7;">⏳ Unverified</span>'}
                            ${statusBadgeHtml(user.status)}
                        </div>
                        <div style="font-size:13px;color:#64748B;">
                            Member since ${formatDate(user.created_at)}
                            ${extProfile?.updated_at ? ` · Profile updated ${formatDateTime(extProfile.updated_at)}` : ''}
                        </div>
                    </div>
                </div>

                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:16px;">
                    <div style="background:#FFFFFF;border:1.5px solid #EAE5DC;border-radius:12px;padding:12px;text-align:center;">
                        <div style="font-size:20px;font-weight:800;color:#0F4C81;">${props.length}</div>
                        <div style="font-size:12px;color:#64748B;">Properties</div>
                    </div>
                    <div style="background:#FFFFFF;border:1.5px solid #EAE5DC;border-radius:12px;padding:12px;text-align:center;">
                        <div style="font-size:20px;font-weight:800;color:#0288D1;">${apps.length}</div>
                        <div style="font-size:12px;color:#64748B;">Applications</div>
                    </div>
                    <div style="background:#FFFFFF;border:1.5px solid #EAE5DC;border-radius:12px;padding:12px;text-align:center;">
                        <div style="font-size:20px;font-weight:800;color:#D97706;">★ ${avgRating}</div>
                        <div style="font-size:12px;color:#64748B;">${reviews.length} Review${reviews.length === 1 ? '' : 's'}</div>
                    </div>
                    <div style="background:#FFFFFF;border:1.5px solid #EAE5DC;border-radius:12px;padding:12px;text-align:center;">
                        <div style="font-size:20px;font-weight:800;color:${uploadedDocCount === 4 ? '#166534' : '#B54708'};">${uploadedDocCount}/4</div>
                        <div style="font-size:12px;color:#64748B;">Verification Docs</div>
                    </div>
                </div>

                <div style="background:#FFFFFF;border:1.5px solid #EAE5DC;border-radius:12px;padding:16px;margin-bottom:16px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:10px;">
                        <h4 style="margin:0;color:#1E293B;font-size:14.5px;">📋 Account &amp; Profile Information</h4>
                        <span style="background:#EEF6FA;color:#0F4C81;font-size:11px;font-weight:700;padding:2px 9px;border-radius:999px;">🔒 Visible to Admin Only</span>
                    </div>
                    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;font-size:13.5px;color:#334155;">
                        <div><strong style="color:#64748B;">Email:</strong><br>${escapeHtml(user.email || '—')}</div>
                        <div><strong style="color:#64748B;">Phone:</strong><br>${escapeHtml(displayPhone)}</div>
                        <div><strong style="color:#64748B;">House Address:</strong><br>${escapeHtml(extProfile?.house_address || 'Not provided')}</div>
                        <div><strong style="color:#64748B;">Hobbies / Interests:</strong><br>${escapeHtml(extProfile?.hobbies || 'Not provided')}</div>
                    </div>
                    ${extProfile?.bio ? `<div style="margin-top:10px;padding-top:10px;border-top:1px solid #F1ECE3;font-size:13.5px;color:#334155;"><strong style="color:#64748B;">Personal Info / About Me:</strong><p style="margin:4px 0 0;">${escapeHtml(extProfile.bio)}</p></div>` : ''}
                </div>

                <div style="background:#FAF8F5;border:1.5px solid #EAE5DC;border-radius:12px;padding:16px;margin-bottom:16px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:12px;">
                        <h4 style="margin:0;color:#0F4C81;font-size:14.5px;">📄 Verification Documents (${uploadedDocCount}/4 Uploaded)</h4>
                        <span style="background:#EEF6FA;color:#0F4C81;font-size:11px;font-weight:700;padding:2px 9px;border-radius:999px;">🔒 Admin Verification Only</span>
                    </div>
                    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;">
                        ${docItems.map(doc => {
                            const url = docs[doc.key];
                            return `
                                <div style="background:#FFFFFF;border:1px solid #EAE5DC;border-radius:10px;padding:12px;">
                                    <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:8px;">
                                        <strong style="font-size:13px;color:#1E293B;">${doc.label}</strong>
                                        ${url
                                            ? '<span style="background:#DCFCE7;color:#166534;font-size:10.5px;font-weight:700;padding:2px 7px;border-radius:999px;">✔ Uploaded</span>'
                                            : '<span style="background:#FEF3C7;color:#92400E;font-size:10.5px;font-weight:700;padding:2px 7px;border-radius:999px;">Missing</span>'}
                                    </div>
                                    ${url
                                        ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" style="display:block;">
                                             <img src="${escapeHtml(url)}" alt="${escapeHtml(doc.label)}" style="width:100%;max-height:140px;object-fit:cover;border-radius:8px;border:1.5px solid #C8E2F2;">
                                             <span style="display:inline-block;margin-top:6px;font-size:12px;font-weight:600;color:#0288D1;">🔍 View Full Image ↗</span>
                                           </a>`
                                        : '<div style="font-size:12.5px;color:#94A3B8;padding:14px 8px;text-align:center;border:1px dashed #D8D2C7;border-radius:8px;">No document uploaded yet.</div>'}
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>

                <div style="background:#FFFFFF;border:1.5px solid #EAE5DC;border-radius:12px;padding:16px;margin-bottom:16px;">
                    <h4 style="margin:0 0 10px;color:#1E293B;font-size:14.5px;">🏠 Landlord Properties (${props.length})</h4>
                    ${props.length === 0
                        ? '<p style="margin:0;color:#64748B;font-size:13px;">No properties posted yet.</p>'
                        : props.map(p => {
                            const { meta } = parsePropertyDescription(p.description);
                            const approvalState = getPropertyApprovalState(p, meta);
                            const badge = approvalState === 'pending_approval'
                                ? '<span style="padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;background:#FEF3C7;color:#92400E;">⏳ Pending</span>'
                                : approvalState === 'rejected'
                                ? '<span style="padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;background:#FEE2E2;color:#991B1B;">❌ Rejected</span>'
                                : statusBadgeHtml(p.availability_status);
                            return `
                                <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #F1ECE3;flex-wrap:wrap;">
                                    <div>
                                        <strong style="color:#1E293B;font-size:14px;">${escapeHtml(p.title)}</strong>
                                        <span style="color:#0F4C81;font-weight:700;font-size:13px;margin-left:6px;">${formatPeso(p.price)}/mo</span>
                                        <div style="font-size:12.5px;color:#64748B;">📍 ${escapeHtml(p.location)}</div>
                                    </div>
                                    <div style="display:flex;align-items:center;gap:8px;">
                                        ${badge}
                                        <button class="ll-btn-preview" onclick="closeAdminUserDetails(); openPropertyDetails('${p.property_id}');" style="padding:5px 10px;font-size:12px;">👁️ Inspect</button>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                </div>

                <div style="display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;padding-top:8px;border-top:1px solid #EAE5DC;">
                    <button class="btn-secondary" onclick="closeAdminUserDetails(); openMessageToUser('${user.id}', '${escapeJsAttr(user.full_name)}');" style="padding:9px 14px;font-size:13px;">💬 Message Landlord</button>
                    <button class="btn" onclick="adminVerifyLandlord('${user.id}', ${!user.is_verified})" style="padding:9px 14px;font-size:13px;">${user.is_verified ? 'Revoke Verify' : '✔ Verify Landlord'}</button>
                    ${user.id !== currentUser.id ? `<button class="btn-secondary" onclick="adminToggleUserStatus('${user.id}', '${user.status === 'suspended' ? 'active' : 'suspended'}')" style="padding:9px 14px;font-size:13px;${user.status === 'suspended' ? 'color:#1B5E20;border-color:#2E7D32;' : 'color:#B42318;border-color:#FF6B6B;'}">${user.status === 'suspended' ? 'Activate Account' : 'Suspend Account'}</button>` : ''}
                </div>
            `;
        } else {
            // Tenant view
            const [apps, reviews, complaints] = await Promise.all([
                window.applicationService.getTenantApplications(userId).catch(() => []),
                window.reviewService.getTenantReviews(userId).catch(() => []),
                window.complaintService.getMyComplaints(userId).catch(() => []),
            ]);

            bodyEl.innerHTML = `
                <div style="display:flex;align-items:center;gap:16px;padding:16px;background:#FAF8F5;border:1.5px solid #EAE5DC;border-radius:14px;margin-bottom:16px;flex-wrap:wrap;">
                    <div style="width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,#0288D1,#38BDF8);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:22px;flex-shrink:0;">${escapeHtml(initials)}</div>
                    <div style="flex:1;min-width:200px;">
                        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
                            <h3 style="margin:0;color:#1E293B;font-size:18px;">${escapeHtml(user.full_name)}</h3>
                            <span style="padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;text-transform:uppercase;color:#0288D1;background:#E0F2FE;">Tenant</span>
                            ${statusBadgeHtml(user.status)}
                        </div>
                        <div style="font-size:13px;color:#64748B;">Member since ${formatDate(user.created_at)}</div>
                    </div>
                </div>

                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:16px;">
                    <div style="background:#FFFFFF;border:1.5px solid #EAE5DC;border-radius:12px;padding:12px;text-align:center;">
                        <div style="font-size:20px;font-weight:800;color:#0F4C81;">${apps.length}</div>
                        <div style="font-size:12px;color:#64748B;">Applications</div>
                    </div>
                    <div style="background:#FFFFFF;border:1.5px solid #EAE5DC;border-radius:12px;padding:12px;text-align:center;">
                        <div style="font-size:20px;font-weight:800;color:#D97706;">${reviews.length}</div>
                        <div style="font-size:12px;color:#64748B;">Reviews Written</div>
                    </div>
                    <div style="background:#FFFFFF;border:1.5px solid #EAE5DC;border-radius:12px;padding:12px;text-align:center;">
                        <div style="font-size:20px;font-weight:800;color:#B42318;">${complaints.length}</div>
                        <div style="font-size:12px;color:#64748B;">Complaints Filed</div>
                    </div>
                </div>

                <div style="background:#FFFFFF;border:1.5px solid #EAE5DC;border-radius:12px;padding:16px;margin-bottom:16px;">
                    <h4 style="margin:0 0 10px;color:#1E293B;font-size:14.5px;">📋 Account &amp; Contact Information</h4>
                    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;font-size:13.5px;color:#334155;">
                        <div><strong style="color:#64748B;">Email:</strong><br>${escapeHtml(user.email || '—')}</div>
                        <div><strong style="color:#64748B;">Phone:</strong><br>${escapeHtml(user.phone || 'Not provided')}</div>
                        <div><strong style="color:#64748B;">Account Status:</strong><br>${escapeHtml(user.status || 'active')}</div>
                        <div><strong style="color:#64748B;">Joined:</strong><br>${formatDateTime(user.created_at)}</div>
                    </div>
                </div>

                <div style="background:#FFFFFF;border:1.5px solid #EAE5DC;border-radius:12px;padding:16px;margin-bottom:16px;">
                    <h4 style="margin:0 0 10px;color:#1E293B;font-size:14.5px;">📝 Rental Applications (${apps.length})</h4>
                    ${apps.length === 0
                        ? '<p style="margin:0;color:#64748B;font-size:13px;">No rental applications submitted yet.</p>'
                        : apps.map(a => `
                            <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #F1ECE3;flex-wrap:wrap;">
                                <div>
                                    <strong style="color:#1E293B;font-size:14px;">${escapeHtml(a.property?.title || 'Property')}</strong>
                                    ${a.property?.price ? `<span style="color:#0F4C81;font-weight:700;font-size:13px;margin-left:6px;">${formatPeso(a.property.price)}/mo</span>` : ''}
                                    <div style="font-size:12.5px;color:#64748B;">Applied ${formatDate(a.application_date)} ${a.property?.location ? `· 📍 ${escapeHtml(a.property.location)}` : ''}</div>
                                </div>
                                <div style="display:flex;align-items:center;gap:8px;">
                                    ${statusBadgeHtml(a.status)}
                                    ${a.property?.property_id ? `<button class="ll-btn-preview" onclick="closeAdminUserDetails(); openPropertyDetails('${a.property.property_id}');" style="padding:5px 10px;font-size:12px;">👁️ View</button>` : ''}
                                </div>
                            </div>
                        `).join('')}
                </div>

                <div style="background:#FFFFFF;border:1.5px solid #EAE5DC;border-radius:12px;padding:16px;margin-bottom:16px;">
                    <h4 style="margin:0 0 10px;color:#1E293B;font-size:14.5px;">⭐ Reviews Written (${reviews.length})</h4>
                    ${reviews.length === 0
                        ? '<p style="margin:0;color:#64748B;font-size:13px;">No reviews written yet.</p>'
                        : reviews.map(r => `
                            <div style="padding:8px 0;border-bottom:1px solid #F1ECE3;font-size:13px;">
                                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
                                    <strong style="color:#1E293B;">${escapeHtml(r.property?.title || 'Property')}</strong>
                                    <span style="color:#D97706;font-weight:700;">${'★'.repeat(Number(r.rating || 0))}${'☆'.repeat(5 - Number(r.rating || 0))} (${r.rating}/5)</span>
                                </div>
                                ${r.comment ? `<p style="margin:4px 0 2px;color:#475569;">${escapeHtml(r.comment)}</p>` : ''}
                                <small style="color:#94A3B8;">${formatDate(r.created_at)}</small>
                            </div>
                        `).join('')}
                </div>

                ${complaints.length ? `
                <div style="background:#FFFFFF;border:1.5px solid #EAE5DC;border-radius:12px;padding:16px;margin-bottom:16px;">
                    <h4 style="margin:0 0 10px;color:#1E293B;font-size:14.5px;">🚨 Complaints Filed (${complaints.length})</h4>
                    ${complaints.map(c => {
                        const parsed = parseComplaintReason(c.reason);
                        return `
                            <div style="padding:8px 0;border-bottom:1px solid #F1ECE3;font-size:13px;">
                                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
                                    <span style="background:#FEE2E2;color:#991B1B;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;">${escapeHtml(parsed.category)}</span>
                                    ${statusBadgeHtml(c.status)}
                                </div>
                                <p style="margin:2px 0;color:#475569;">${escapeHtml(parsed.details)}</p>
                                <small style="color:#94A3B8;">${formatDate(c.created_at)}</small>
                            </div>
                        `;
                    }).join('')}
                </div>` : ''}

                <div style="display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;padding-top:8px;border-top:1px solid #EAE5DC;">
                    <button class="btn-secondary" onclick="closeAdminUserDetails(); openMessageToUser('${user.id}', '${escapeJsAttr(user.full_name)}');" style="padding:9px 14px;font-size:13px;">💬 Message Tenant</button>
                    ${user.id !== currentUser.id ? `<button class="btn-secondary" onclick="adminToggleUserStatus('${user.id}', '${user.status === 'suspended' ? 'active' : 'suspended'}')" style="padding:9px 14px;font-size:13px;${user.status === 'suspended' ? 'color:#1B5E20;border-color:#2E7D32;' : 'color:#B42318;border-color:#FF6B6B;'}">${user.status === 'suspended' ? 'Activate Account' : 'Suspend Account'}</button>` : ''}
                </div>
            `;
        }
    } catch (error) {
        console.error('Admin user details error:', error);
        bodyEl.innerHTML = `<div class="auth-alert show error">${escapeHtml(error.message)}</div>`;
    }
}

async function adminVerifyLandlord(userId, isVerified) {
    try {
        await window.adminService.verifyLandlord(currentUser.id, userId, isVerified);
        showToast(isVerified ? 'Landlord verified!' : 'Landlord verification revoked.', 'success');
        await loadAdminDashboard();
        if (activeAdminDetailUserId === userId) openAdminUserDetails(userId);
    } catch (error) {
        showToast(`Failed: ${error.message}`, 'error');
    }
}

async function adminToggleUserStatus(userId, newStatus) {
    try {
        await window.adminService.updateUserStatus(currentUser.id, userId, newStatus);
        showToast(`User status updated to ${newStatus}.`, 'success');
        await loadAdminDashboard();
        if (activeAdminDetailUserId === userId) openAdminUserDetails(userId);
    } catch (error) {
        showToast(`Failed: ${error.message}`, 'error');
    }
}

async function loadAdminProperties() {
    const el = document.getElementById('admin-properties-list');
    if (!el) return;
    el.innerHTML = '<p>Loading properties...</p>';

    try {
        const filterVal = document.getElementById('admin-prop-status-filter')?.value || '';
        const allProps = await window.adminService.getAllProperties({
            search: document.getElementById('admin-prop-search')?.value || '',
            status: filterVal === 'pending_approval' ? '' : filterVal,
        });

        // Count pending properties for Admin KPI card
        const pendingCount = allProps.filter(p => getPropertyApprovalState(p) === 'pending_approval').length;
        const pendingEl = document.getElementById('admin-pending-properties');
        if (pendingEl && !filterVal) pendingEl.textContent = String(pendingCount);

        const props = filterVal === 'pending_approval'
            ? allProps.filter(p => getPropertyApprovalState(p) === 'pending_approval')
            : allProps;

        if (!props.length) {
            el.innerHTML = '<p style="color:#64748B;">No properties found.</p>';
            return;
        }

        el.innerHTML = props.map(p => {
            const { meta } = parsePropertyDescription(p.description);
            const approvalState = getPropertyApprovalState(p, meta);
            const approvalBadge = approvalState === 'pending_approval'
                ? '<span style="display:inline-block;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:700;background:#FEF3C7;color:#92400E;">⏳ Pending Approval</span>'
                : approvalState === 'rejected'
                ? '<span style="display:inline-block;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:700;background:#FEE2E2;color:#991B1B;">❌ Rejected</span>'
                : statusBadgeHtml(p.availability_status);

            return `
            <div style="border:1.5px solid ${approvalState === 'pending_approval' ? '#FCD34D' : '#EAE5DC'};background:${approvalState === 'pending_approval' ? '#FFFDF5' : '#FFFFFF'};border-radius:12px;padding:16px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
                <div>
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
                        <strong style="color:#1E293B;font-size:15.5px;">${escapeHtml(p.title)}</strong>
                        <strong style="color:#0F4C81;">${formatPeso(p.price)}/mo</strong>
                        ${approvalBadge}
                    </div>
                    <div style="font-size:13px;color:#64748B;">📍 ${escapeHtml(p.location)} · Landlord: ${escapeHtml(p.landlord?.full_name || '—')} · Photos: ${Array.isArray(p.image_urls) ? p.image_urls.length : 0}</div>
                </div>
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                    <button class="ll-btn-preview" onclick="openPropertyDetails('${p.property_id}')" style="padding:7px 12px;font-size:12px;">👁️ Inspect</button>
                    ${approvalState !== 'approved' ? `<button class="btn" onclick="adminApproveProperty('${p.property_id}')" style="padding:7px 12px;font-size:12px;background:#2E7D32 !important;">✅ Approve</button>` : ''}
                    ${approvalState !== 'rejected' ? `<button class="btn-secondary" onclick="adminRejectProperty('${p.property_id}')" style="padding:7px 12px;font-size:12px;color:#B42318;border-color:#FCA5A5;">❌ Reject</button>` : ''}
                    <select onchange="adminModerateProperty('${p.property_id}', this.value)" style="padding:7px 10px;border:1.5px solid #D8D2C7;border-radius:8px;font-size:12px;">
                        ${['available', 'occupied', 'hidden', 'removed'].map(st => `<option value="${st}" ${p.availability_status === st ? 'selected' : ''}>${st}</option>`).join('')}
                    </select>
                    <button class="ll-btn-delete" onclick="adminDeleteProperty('${p.property_id}', '${escapeJsAttr(p.title)}')" style="padding:7px 12px;font-size:12px;">Delete</button>
                </div>
            </div>
        `;
        }).join('');
    } catch (error) {
        el.innerHTML = `<div class="auth-alert show error">${escapeHtml(error.message)}</div>`;
    }
}

async function adminApproveProperty(propertyId) {
    try {
        const prop = await window.propertyService.getPropertyById(propertyId);
        const { text, meta } = parsePropertyDescription(prop.description);
        const updatedDesc = encodePropertyDescription(text, {
            ...meta,
            approval_status: 'approved',
            rejection_reason: '',
        });
        await window.propertyService.updateProperty(propertyId, {
            availability_status: 'available',
            description: updatedDesc,
        });
        await window.adminService.logAction(currentUser.id, 'approve_property', {
            property_id: propertyId,
            title: prop.title,
        });
        showToast(`"${prop.title}" approved and is now visible to tenants! ✅`, 'success');
        loadAdminDashboard();
    } catch (error) {
        showToast(`Failed to approve property: ${error.message}`, 'error');
    }
}

async function adminRejectProperty(propertyId) {
    const reason = prompt('Enter reason for rejecting this listing (shown to the landlord):', 'Incomplete or unverified property details.');
    if (reason === null) return;
    try {
        const prop = await window.propertyService.getPropertyById(propertyId);
        const { text, meta } = parsePropertyDescription(prop.description);
        const updatedDesc = encodePropertyDescription(text, {
            ...meta,
            approval_status: 'rejected',
            rejection_reason: reason.trim() || 'Incomplete or invalid listing details.',
        });
        await window.propertyService.updateProperty(propertyId, {
            availability_status: 'hidden',
            description: updatedDesc,
        });
        await window.adminService.logAction(currentUser.id, 'reject_property', {
            property_id: propertyId,
            title: prop.title,
            reason: reason.trim(),
        });
        showToast(`"${prop.title}" rejected and kept hidden from tenants.`, 'info');
        loadAdminDashboard();
    } catch (error) {
        showToast(`Failed to reject property: ${error.message}`, 'error');
    }
}

async function adminModerateProperty(propertyId, status) {
    try {
        await window.adminService.moderateProperty(currentUser.id, propertyId, status);
        showToast(`Property set to ${status}.`, 'success');
        loadAdminDashboard();
    } catch (error) {
        showToast(`Failed: ${error.message}`, 'error');
    }
}

async function adminDeleteProperty(propertyId, title) {
    if (!confirm(`Delete property "${title}"?`)) return;
    try {
        await window.adminService.deleteProperty(currentUser.id, propertyId, title);
        showToast('Property deleted.', 'info');
        loadAdminDashboard();
    } catch (error) {
        showToast(`Failed: ${error.message}`, 'error');
    }
}

async function loadAdminComplaints() {
    const el = document.getElementById('admin-complaints-list');
    if (!el) return;
    el.innerHTML = '<p>Loading complaints...</p>';

    try {
        const statusFilter = document.getElementById('admin-complaint-status-filter')?.value || '';
        const categoryFilter = document.getElementById('admin-complaint-category-filter')?.value || '';
        let list = await window.complaintService.getAllComplaints(statusFilter);
        if (categoryFilter) {
            list = list.filter(c => parseComplaintReason(c.reason).category === categoryFilter);
        }

        if (!list.length) {
            el.innerHTML = '<p style="color:#64748B;">No complaints found.</p>';
            return;
        }

        el.innerHTML = list.map(c => {
            const { category, details } = parseComplaintReason(c.reason);
            return `
            <div style="border:1.5px solid #FECACA;background:#FFFDFD;border-radius:12px;padding:15px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:12px;">
                <div style="flex:1;min-width:240px;">
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
                        <strong style="color:#1E293B;">${escapeHtml(c.property?.title || 'General Complaint')}</strong>
                        <span style="background:#FEE2E2;color:#991B1B;font-size:11.5px;font-weight:700;padding:3px 10px;border-radius:999px;">🏷️ ${escapeHtml(category)}</span>
                    </div>
                    <p style="color:#475569;margin:6px 0;">${escapeHtml(details)}</p>
                    <small style="color:#64748B;">Reported by: ${escapeHtml(c.reporter?.full_name || 'User')} · ${formatDateTime(c.created_at)}${c.resolved_at ? ` · Resolved: ${formatDate(c.resolved_at)}` : ''}</small>
                </div>
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                    ${statusBadgeHtml(c.status)}
                    <select onchange="adminUpdateComplaint('${c.complaint_id}', this.value)" style="padding:7px 10px;border:1.5px solid #D8D2C7;border-radius:8px;font-size:12px;">
                        ${['open', 'under_review', 'resolved', 'dismissed'].map(st => `<option value="${st}" ${c.status === st ? 'selected' : ''}>${st.replace(/_/g, ' ')}</option>`).join('')}
                    </select>
                </div>
            </div>
        `;
        }).join('');
    } catch (error) {
        el.innerHTML = `<div class="auth-alert show error">${escapeHtml(error.message)}</div>`;
    }
}

async function adminUpdateComplaint(complaintId, status) {
    try {
        await window.complaintService.updateComplaintStatus(complaintId, status, currentUser.id);
        await window.adminService.logAction(currentUser.id, `complaint_${status}`, { complaint_id: complaintId, status });
        showToast(`Complaint marked as ${status.replace(/_/g, ' ')}.`, 'success');
        loadAdminDashboard();
    } catch (error) {
        showToast(`Failed: ${error.message}`, 'error');
    }
}

async function loadAdminSystemRecords() {
    const el = document.getElementById('admin-system-records');
    if (!el) return;
    try {
        const records = await window.adminService.getSystemRecords(20);
        if (!records.length) {
            el.innerHTML = '<p style="color:#654321;">No audit records yet.</p>';
            return;
        }
        el.innerHTML = records.map(r => `
            <div style="border-bottom:1px solid #EAE6D6;padding:10px 4px;font-size:13px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;">
                <div><strong style="color:#8B4513;">${escapeHtml(r.action)}</strong> by ${escapeHtml(r.admin?.full_name || 'Admin')} — <code style="color:#654321;">${escapeHtml(JSON.stringify(r.details || {}))}</code></div>
                <small style="color:#888;">${formatDateTime(r.created_at)}</small>
            </div>
        `).join('');
    } catch (error) {
        el.innerHTML = `<div class="auth-alert show error">${escapeHtml(error.message)}</div>`;
    }
}

// ============================================================================
// Complaints Modal
// ============================================================================
function openComplaintModal(propertyId = '', reportedUserId = '', contextLabel = '') {
    if (!currentUser) {
        showToast('Please log in to file a complaint.', 'warning');
        return showPage('login');
    }
    const modal = document.getElementById('complaint-modal');
    if (!modal) return console.error('❌ #complaint-modal not found.');

    document.getElementById('complaint-property-id').value = propertyId || '';
    document.getElementById('complaint-reported-user-id').value = reportedUserId || '';
    document.getElementById('complaint-context-label').textContent = contextLabel
        ? `Reporting listing: ${contextLabel}`
        : 'Submit a general complaint or platform report';
    const catEl = document.getElementById('complaint-category');
    if (catEl) catEl.value = '';
    document.getElementById('complaint-reason').value = '';
    modal.classList.add('active');
}

function closeComplaintModal() {
    document.getElementById('complaint-modal')?.classList.remove('active');
}

async function handleSubmitComplaint(event) {
    event.preventDefault();
    if (!currentUser) return;
    const category = document.getElementById('complaint-category')?.value.trim() || '';
    const details = document.getElementById('complaint-reason')?.value.trim() || '';
    if (!category) return showToast('Please select a complaint category.', 'warning');

    const btn = document.getElementById('complaint-submit-btn');
    btn.disabled = true;
    btn.textContent = 'Submitting...';
    try {
        await window.complaintService.fileComplaint({
            reported_by: currentUser.id,
            property_id: document.getElementById('complaint-property-id').value || null,
            reported_user_id: document.getElementById('complaint-reported-user-id').value || null,
            reason: `[${category}] ${details}`,
        });
        showToast('Complaint submitted. Our admin team will review it.', 'success');
        closeComplaintModal();
        if (currentUser.role === 'tenant') loadTenantDashboard();
    } catch (error) {
        showToast(`Failed to submit complaint: ${error.message}`, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Submit Complaint';
    }
}

// ============================================================================
// Messaging Modal (Supabase Inquiries + Optional GetStream via /api/stream-token)
// ============================================================================
async function initOptionalStreamClient(session) {
    if (!session?.access_token || typeof window.StreamChat === 'undefined') return;
    try {
        const res = await fetch('/api/stream-token', {
            method: 'POST',
            headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) return;
        const { apiKey, userId, token } = await res.json();
        if (!apiKey || !token) return;
        streamClient = window.StreamChat.getInstance(apiKey);
        await streamClient.connectUser({ id: userId, name: currentUser?.full_name || 'User' }, token);
        isStreamConnected = true;
        const indicator = document.getElementById('chat-status-indicator');
        if (indicator) indicator.style.display = 'block';
    } catch {
        isStreamConnected = false;
    }
}

async function showMessages() {
    if (!currentUser) return showToast('Please log in to view messages.', 'warning');
    const modal = document.getElementById('messages-modal');
    if (!modal) return console.error('❌ #messages-modal not found.');
    modal.classList.add('active');
    await loadUserConversations();
}

function closeMessages() {
    document.getElementById('messages-modal')?.classList.remove('active');
}

function showNewMessageForm() {
    if (!currentUser) return showToast('Please log in to send a message.', 'warning');
    document.getElementById('new-message-modal')?.classList.add('active');
}

function closeNewMessage() {
    document.getElementById('new-message-modal')?.classList.remove('active');
    selectedNewRecipient = null;
}

function openMessageToUser(userId, userName, propertyId = '') {
    if (!currentUser) {
        showToast('Please log in to message the landlord.', 'warning');
        document.getElementById('property-modal')?.classList.remove('active');
        return showPage('login');
    }
    document.getElementById('property-modal')?.classList.remove('active');
    selectedNewRecipient = { id: userId, name: userName, propertyId: propertyId || null };
    const recInput = document.getElementById('recipient-search');
    const msgInput = document.getElementById('initial-message');
    if (recInput) recInput.value = userName;
    if (msgInput) msgInput.value = propertyId ? 'Hi! I am interested in your rental property. Is it still available?' : '';
    showNewMessageForm();
}

async function loadUserConversations() {
    const container = document.getElementById('conversations-container');
    if (!container || !currentUser) return;
    container.innerHTML = '<p style="color:#654321;">Loading conversations...</p>';

    try {
        activeConversations = await window.inquiryService.getConversations(currentUser.id);
        if (!activeConversations.length) {
            container.innerHTML = '<p style="color:#654321;font-size:14px;">No conversations yet. Click <strong>+ New Message</strong> to start one.</p>';
            return;
        }

        container.innerHTML = activeConversations.map(c => `
            <div onclick="selectConversation('${c.user.id}')" style="padding:12px;border-radius:8px;cursor:pointer;margin-bottom:8px;border:1.5px solid ${selectedConversationUserId === c.user.id ? '#8B4513' : '#ADD8E6'};background:${selectedConversationUserId === c.user.id ? '#E8F6FB' : '#fff'};">
                <div style="font-weight:700;color:#8B4513;">${escapeHtml(c.user.full_name || 'User')}</div>
                <div style="font-size:12px;color:#654321;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(c.lastMessage)}</div>
                <small style="color:#888;font-size:11px;">${formatDateTime(c.lastDate)}</small>
            </div>
        `).join('');
    } catch (error) {
        container.innerHTML = `<p style="color:#B42318;">${escapeHtml(error.message)}</p>`;
    }
}

function selectConversation(otherUserId) {
    selectedConversationUserId = otherUserId;
    const conv = activeConversations.find(c => c.user.id === otherUserId);
    if (!conv) return;
    selectedConversationPropertyId = conv.property?.property_id || null;

    document.getElementById('no-chat-selected').style.display = 'none';
    document.getElementById('chat-header').style.display = 'block';
    document.getElementById('chat-messages').style.display = 'block';
    document.getElementById('message-input-area').style.display = 'block';
    document.getElementById('chat-title').textContent = conv.user.full_name || 'User';
    document.getElementById('chat-subtitle').textContent = conv.property?.title ? `Re: ${conv.property.title}` : (conv.user.role || '');

    const messagesEl = document.getElementById('chat-messages');
    messagesEl.innerHTML = conv.messages.map(m => {
        const mine = m.sender_id === currentUser.id;
        return `
            <div style="display:flex;justify-content:${mine ? 'flex-end' : 'flex-start'};margin-bottom:10px;">
                <div style="max-width:75%;padding:10px 14px;border-radius:14px;background:${mine ? '#ADD8E6' : '#FFFFFF'};color:#8B4513;box-shadow:0 2px 6px rgba(0,0,0,0.08);">
                    <div>${escapeHtml(m.message)}</div>
                    <div style="font-size:10px;color:#654321;margin-top:4px;text-align:right;">${formatDateTime(m.date_sent)}</div>
                </div>
            </div>
        `;
    }).join('');

    scrollToBottom();
    loadUserConversations();
}

async function sendMessage() {
    const input = document.getElementById('message-input');
    const message = input?.value.trim() || '';
    if (!message || !selectedConversationUserId) return;
    try {
        await window.inquiryService.sendInquiry({
            receiver_id: selectedConversationUserId,
            property_id: selectedConversationPropertyId,
            message,
        });
        input.value = '';
        await loadUserConversations();
        selectConversation(selectedConversationUserId);
    } catch (error) {
        showToast(`Failed to send message: ${error.message}`, 'error');
    }
}

async function startNewConversation(event) {
    event.preventDefault();
    const message = document.getElementById('initial-message')?.value.trim() || '';
    if (!selectedNewRecipient?.id) {
        return showToast('Please select a recipient from the search results.', 'warning');
    }
    try {
        await window.inquiryService.sendInquiry({
            receiver_id: selectedNewRecipient.id,
            property_id: selectedNewRecipient.propertyId || null,
            message,
        });
        const targetId = selectedNewRecipient.id;
        closeNewMessage();
        document.getElementById('new-message-form')?.reset();
        showToast('Message sent!', 'success');
        await showMessages();
        selectConversation(targetId);
    } catch (error) {
        showToast(`Failed to send message: ${error.message}`, 'error');
    }
}

function showConversationsList() {
    document.getElementById('conversations-list')?.classList.remove('mobile-hidden');
    document.getElementById('chat-area')?.classList.remove('mobile-visible');
}

function scrollToBottom() {
    const c = document.getElementById('messages-container');
    if (c) c.scrollTop = c.scrollHeight;
}

// Notifications Modal (live activity: messages, application/approval updates & role alerts)
async function buildUserNotifications() {
    if (!currentUser) return [];
    const items = [];

    // 1. Incoming messages / inquiries
    const inquiries = await window.inquiryService.getUserInquiries(currentUser.id).catch(() => []);
    inquiries
        .filter(i => i.receiver_id === currentUser.id)
        .slice(-8)
        .forEach(i => {
            items.push({
                icon: '💬',
                title: `New message from ${i.sender?.full_name || 'User'}`,
                body: i.message,
                date: i.date_sent,
            });
        });

    // 2. Role-specific approval & activity updates
    if (currentUser.role === 'tenant') {
        const apps = await window.applicationService.getTenantApplications(currentUser.id).catch(() => []);
        apps.slice(0, 8).forEach(a => {
            items.push({
                icon: a.status === 'approved' ? '✅' : a.status === 'rejected' ? '❌' : '📝',
                title: `Application ${a.status.toUpperCase()}: ${a.property?.title || 'Property'}`,
                body: a.status === 'approved'
                    ? 'Your rental application has been approved by the landlord!'
                    : a.status === 'rejected'
                        ? 'Your rental application was not approved.'
                        : 'Your application is currently pending landlord review.',
                date: a.application_date,
            });
        });
    } else if (currentUser.role === 'landlord') {
        if (!currentUser.is_verified) {
            items.push({
                icon: '⏳',
                title: 'Landlord Verification Pending',
                body: 'An administrator will verify your account so you can publish rental properties.',
                date: currentUser.created_at || new Date().toISOString(),
            });
        }
        const apps = await window.applicationService.getLandlordApplications(currentUser.id).catch(() => []);
        apps.slice(0, 8).forEach(a => {
            items.push({
                icon: '📩',
                title: `Application (${a.status}) from ${a.tenant?.full_name || 'Tenant'}`,
                body: `For listing: ${a.property?.title || 'Property'}`,
                date: a.application_date,
            });
        });
    } else if (currentUser.role === 'admin') {
        const complaints = await window.complaintService.getAllComplaints('open').catch(() => []);
        complaints.slice(0, 8).forEach(c => {
            items.push({
                icon: '🚨',
                title: `Open Complaint: ${c.property?.title || 'General'}`,
                body: c.reason,
                date: c.created_at,
            });
        });
    }

    return items.sort((a, b) => new Date(b.date) - new Date(a.date));
}

async function refreshNotificationBadge() {
    if (!currentUser) return;
    try {
        const items = await buildUserNotifications();
        const badge = document.getElementById('notification-badge');
        const dot = document.getElementById('user-notification-indicator');
        if (badge) {
            badge.textContent = String(items.length);
            badge.style.display = items.length > 0 ? 'inline-block' : 'none';
        }
        if (dot) {
            dot.style.display = items.length > 0 ? 'block' : 'none';
        }
    } catch {
        // non-blocking
    }
}

async function showNotifications() {
    if (!currentUser) return;
    const modal = document.getElementById('notifications-modal');
    const listEl = document.getElementById('notifications-list');
    if (!modal || !listEl) return;
    modal.classList.add('active');
    listEl.innerHTML = '<p>Loading recent activity...</p>';

    try {
        const items = await buildUserNotifications();
        listEl.innerHTML = items.length === 0
            ? '<p style="color:#654321;">You\'re all caught up! No new notifications.</p>'
            : items.map(n => `
                <div style="border-bottom:1px solid #EAE6D6;padding:12px 6px;">
                    <strong style="color:#8B4513;">${n.icon} ${escapeHtml(n.title)}</strong>
                    <p style="color:#654321;margin:4px 0;">${escapeHtml(n.body)}</p>
                    <small style="color:#888;">${formatDateTime(n.date)}</small>
                </div>
            `).join('');
    } catch (error) {
        listEl.innerHTML = `<p style="color:#B42318;">${escapeHtml(error.message)}</p>`;
    }
}

function closeNotifications() { document.getElementById('notifications-modal')?.classList.remove('active'); }
function filterNotifications() { showNotifications(); }
function markAllAsRead() { showToast('All notifications reviewed.', 'info'); closeNotifications(); }

// ============================================================================
// Contact Us, FAQ & UI Event Wiring
// ============================================================================
function handleContact(event) {
    event.preventDefault();
    showToast('Thank you for contacting HousinGo! We will get back to you soon.', 'success');
    document.getElementById('contact-form')?.reset();
}

function socialLogin(platform) {
    showToast(`${platform} OAuth is not enabled yet. Please sign in with Email & Password.`, 'info');
}

function toggleFAQ(questionElement) {
    const item = questionElement?.closest('.faq-item');
    if (!item) return;
    const answer = item.querySelector('.faq-answer');
    const icon = item.querySelector('.faq-icon');
    const isOpen = answer.style.maxHeight && answer.style.maxHeight !== '0px';
    answer.style.maxHeight = isOpen ? '0px' : `${answer.scrollHeight + 40}px`;
    if (icon) icon.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(180deg)';
}

function wireAllUIListeners() {
    // Hamburger menu (Desktop & Mobile left sidebar drawer)
    const hamburger = document.getElementById('hamburger');
    if (hamburger) {
        hamburger.addEventListener('click', toggleNavDrawer);
        hamburger.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleNavDrawer();
            }
        });
    }

    // Home hero search & filters
    document.getElementById('search-btn')?.addEventListener('click', performHeroSearch);
    document.getElementById('search-input')?.addEventListener('keyup', e => {
        if (e.key === 'Enter') performHeroSearch();
    });
    document.getElementById('type-search')?.addEventListener('change', filterHomeProperties);
    document.getElementById('price-search')?.addEventListener('change', filterHomeProperties);
    document.querySelectorAll('#home-content .filter-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            document.querySelectorAll('#home-content .filter-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            selectedHomeKeyword = this.getAttribute('data-type') || '';
            filterHomeProperties();
        });
    });

    // Property details modal close
    document.getElementById('close-modal')?.addEventListener('click', () => {
        document.getElementById('property-modal')?.classList.remove('active');
    });

    // Close modals when clicking backdrop
    document.addEventListener('click', (e) => {
        ['property-modal', 'messages-modal', 'new-message-modal', 'notifications-modal', 'complaint-modal', 'admin-user-details-modal'].forEach(id => {
            const modal = document.getElementById(id);
            if (modal && e.target === modal) {
                modal.classList.remove('active');
                if (id === 'admin-user-details-modal') activeAdminDetailUserId = null;
            }
        });
    });

    // Login & Register forms
    const loginForm = document.getElementById('login-form');
    if (loginForm) loginForm.addEventListener('submit', handleLogin);
    else console.error('❌ #login-form not found.');

    const registerForm = document.getElementById('register-form');
    if (registerForm) registerForm.addEventListener('submit', handleRegister);
    else console.error('❌ #register-form not found.');

    // Password eye toggles
    document.querySelectorAll('[data-toggle-password]').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = document.getElementById(btn.getAttribute('data-toggle-password'));
            if (!target) return;
            const hidden = target.type === 'password';
            target.type = hidden ? 'text' : 'password';
            btn.textContent = hidden ? '🙈' : '👁️';
        });
    });

    // Interactive Role Cards on Register page
    const roleSelect = document.getElementById('reg-usertype');
    const roleCards = document.querySelectorAll('[data-role-card]');
    roleCards.forEach(card => {
        const activate = () => {
            roleCards.forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            if (roleSelect) roleSelect.value = card.getAttribute('data-role-card');
        };
        card.addEventListener('click', activate);
        card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } });
    });

    // Live Password Strength & Match
    const regPass = document.getElementById('reg-password');
    const regConfirm = document.getElementById('reg-confirm-password');
    const bar = document.getElementById('reg-password-strength-bar');
    const txt = document.getElementById('reg-password-strength-text');
    const matchTxt = document.getElementById('reg-password-match-text');

    const updateStrength = () => {
        if (!regPass || !bar || !txt) return;
        const v = regPass.value;
        let s = 0;
        if (v.length >= 6) s++;
        if (v.length >= 10) s++;
        if (/[A-Z]/.test(v) && /[a-z]/.test(v)) s++;
        if (/\d/.test(v)) s++;
        if (/[^A-Za-z0-9]/.test(v)) s++;
        if (!v) { bar.style.width = '0%'; txt.textContent = 'Use at least 6 characters'; txt.style.color = '#654321'; }
        else if (s <= 2) { bar.style.width = '35%'; bar.style.backgroundColor = '#FF6B6B'; txt.textContent = 'Weak password'; txt.style.color = '#B42318'; }
        else if (s === 3) { bar.style.width = '70%'; bar.style.backgroundColor = '#FFA500'; txt.textContent = 'Fair password'; txt.style.color = '#B54708'; }
        else { bar.style.width = '100%'; bar.style.backgroundColor = '#2E7D32'; txt.textContent = 'Strong password ✓'; txt.style.color = '#067647'; }
    };
    const updateMatch = () => {
        if (!regPass || !regConfirm || !matchTxt) return;
        if (!regConfirm.value) { matchTxt.textContent = ''; return; }
        matchTxt.textContent = regPass.value === regConfirm.value ? '✓ Passwords match' : '✗ Passwords do not match';
        matchTxt.style.color = regPass.value === regConfirm.value ? '#067647' : '#B42318';
    };
    regPass?.addEventListener('input', () => { updateStrength(); updateMatch(); });
    regConfirm?.addEventListener('input', updateMatch);

    // Property image file preview on Post/Edit Property page
    document.getElementById('property-images')?.addEventListener('change', (e) => {
        const preview = document.getElementById('image-preview');
        if (!preview) return;
        renderExistingImagePreview();
        const files = Array.from(e.target.files || []);
        files.forEach(file => {
            const reader = new FileReader();
            reader.onload = (ev) => {
                const wrap = document.createElement('div');
                wrap.innerHTML = `<img src="${ev.target.result}" style="width:100%;height:95px;object-fit:cover;border-radius:8px;border:2px solid #87CEEB;">`;
                preview.appendChild(wrap);
            };
            reader.readAsDataURL(file);
        });
    });

    // Recipient search in New Message modal (queries real profiles)
    const recSearch = document.getElementById('recipient-search');
    const recResults = document.getElementById('user-search-results');
    let searchTimer = null;
    recSearch?.addEventListener('input', () => {
        clearTimeout(searchTimer);
        const q = recSearch.value.trim();
        if (q.length < 2 || !recResults) { if (recResults) recResults.style.display = 'none'; return; }
        searchTimer = setTimeout(async () => {
            try {
                const { data, error } = await window.supabaseClient
                    .from('profiles')
                    .select('id, full_name, email, role')
                    .or(`full_name.ilike.%${q}%,email.ilike.%${q}%`)
                    .neq('id', currentUser?.id || '')
                    .limit(6);
                if (error) throw error;
                if (!data?.length) {
                    recResults.innerHTML = '<div style="padding:10px;color:#654321;">No users found.</div>';
                } else {
                    recResults.innerHTML = data.map(u => `
                        <div onclick="pickNewMessageRecipient('${u.id}', '${escapeJsAttr(u.full_name)}')" style="padding:10px 12px;cursor:pointer;border-bottom:1px solid #F5F5DC;">
                            <strong style="color:#8B4513;">${escapeHtml(u.full_name)}</strong> <small style="color:#0288D1;">(${escapeHtml(u.role)})</small><br>
                            <small style="color:#654321;">${escapeHtml(u.email)}</small>
                        </div>
                    `).join('');
                }
                recResults.style.display = 'block';
            } catch (err) {
                console.error('Recipient search error:', err);
            }
        }, 250);
    });
}

function pickNewMessageRecipient(id, name) {
    selectedNewRecipient = { id, name, propertyId: null };
    const input = document.getElementById('recipient-search');
    const results = document.getElementById('user-search-results');
    if (input) input.value = name;
    if (results) results.style.display = 'none';
}

// ============================================================================
// Boot Application (called right after pageLoader.js mounts all partials)
// ============================================================================
wireAllUIListeners();
checkAuthState();
loadHomeProperties();
