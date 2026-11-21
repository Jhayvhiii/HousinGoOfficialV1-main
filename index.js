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

function encodePropertyDescription(plainText, meta = {}) {
    const cleanText = (plainText || '').trim();
    const cleanedMeta = {
        type: meta.type || '',
        slots: meta.slots ? Number(meta.slots) : null,
        min_stay: (meta.min_stay || '').trim(),
        move_in_date: (meta.move_in_date || '').trim(),
        landmarks: (meta.landmarks || '').trim(),
        map_link: (meta.map_link || '').trim(),
        rules: (meta.rules || '').trim(),
        amenities: Array.isArray(meta.amenities) ? meta.amenities : [],
        contact_name: (meta.contact_name || '').trim(),
        contact_phone: (meta.contact_phone || '').trim(),
        lat: meta.lat !== undefined && meta.lat !== '' && !Number.isNaN(Number(meta.lat)) ? Number(meta.lat) : null,
        lng: meta.lng !== undefined && meta.lng !== '' && !Number.isNaN(Number(meta.lng)) ? Number(meta.lng) : null,
    };
    return `${cleanText}\n\n${META_OPEN}${JSON.stringify(cleanedMeta)}${META_CLOSE}`;
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
    const fullName = (profile?.full_name || authUser?.user_metadata?.full_name || '').trim();
    const parts = fullName ? fullName.split(/\s+/) : ['User'];
    const role = (profile?.role || authUser?.user_metadata?.role || 'tenant').toLowerCase();
    const status = (profile?.status || 'active').toLowerCase();
    const id = profile?.id || authUser?.id;
    const email = profile?.email || authUser?.email || '';
    const phone = profile?.phone || authUser?.user_metadata?.phone || '';

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
    const floatingChat = document.getElementById('floating-chat-button');
    const hamburger = document.getElementById('hamburger');
    const navMenu = document.getElementById('nav-menu');

    if (!navList) {
        console.error('❌ #nav-menu ul not found.');
        return;
    }

    if (currentUser) {
        const dash = getDashboardForRole(currentUser.role);
        const roleLabel = currentUser.role.charAt(0).toUpperCase() + currentUser.role.slice(1);
        navList.innerHTML = `
            <li><a href="#" data-nav="home" onclick="showPage('home'); return false;">Home</a></li>
            <li><a href="#" data-nav="${dash}" onclick="showPage('${dash}'); return false;">Dashboard</a></li>
            <li><a href="#" data-nav="about" onclick="showPage('about'); return false;">About Us</a></li>
            <li><a href="#" data-nav="contact" onclick="showPage('contact'); return false;">Contact Us</a></li>
            <li><a href="#" data-nav="help" onclick="showPage('help'); return false;">Help</a></li>
        `;
        if (profileDropdown) profileDropdown.style.display = 'block';
        if (userNameDisplay) userNameDisplay.textContent = `👤 ${currentUser.full_name} (${roleLabel})`;
        if (floatingChat) floatingChat.style.display = 'block';
        // Hide 3-line hamburger menu when logged in so it never overlaps the profile dropdown
        if (hamburger) {
            hamburger.style.setProperty('display', 'none', 'important');
            hamburger.classList.remove('active');
        }
        if (navMenu) navMenu.classList.remove('active');
    } else {
        navList.innerHTML = `
            <li><a href="#" data-nav="home" onclick="showPage('home'); return false;">Home</a></li>
            <li><a href="#" data-nav="about" onclick="showPage('about'); return false;">About Us</a></li>
            <li><a href="#" data-nav="login" onclick="showPage('login'); return false;">Log In</a></li>
            <li><a href="#" data-nav="register" onclick="showPage('register'); return false;">Register</a></li>
            <li><a href="#" data-nav="contact" onclick="showPage('contact'); return false;">Contact Us</a></li>
            <li><a href="#" data-nav="help" onclick="showPage('help'); return false;">Help</a></li>
        `;
        if (profileDropdown) profileDropdown.style.display = 'none';
        if (floatingChat) floatingChat.style.display = 'none';
        if (hamburger) hamburger.style.removeProperty('display');
    }
    setActiveNavLink(window.__currentPageName || 'home');
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
    if (!menu) return console.error('❌ #profile-dropdown-menu not found.');
    menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
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
    const hamburger = document.getElementById('hamburger');
    const navMenu = document.getElementById('nav-menu');
    if (hamburger) hamburger.classList.remove('active');
    if (navMenu) navMenu.classList.remove('active');

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
    setVal('settings-firstname', currentUser.first_name);
    setVal('settings-lastname', currentUser.last_name);
    setVal('settings-email', currentUser.email);
    setVal('settings-mobile', currentUser.phone);
    setVal('settings-role', `${currentUser.role.toUpperCase()}${currentUser.role === 'landlord' ? (currentUser.is_verified ? ' (Verified)' : ' (Pending Verification)') : ''}`);
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

    return `
        <div class="property-card" data-property-id="${p.property_id}" onmouseenter="highlightMapPin('${p.property_id}', true)" onmouseleave="highlightMapPin('${p.property_id}', false)" style="background:#fff;overflow:hidden;display:flex;flex-direction:column;">
            <div class="property-card-media">
                ${imgHtml}
                <div class="property-card-badge">${statusBadgeHtml(p.availability_status || 'available')}</div>
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
                    <button class="btn-secondary" onclick="applyForProperty('${p.property_id}')" style="padding:10px 14px;font-size:14px;">Apply</button>
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
        setPostPropertyPin(initialLat, initialLng);
    } else if (postPropertyPin) {
        postPropertyMap.removeLayer(postPropertyPin);
        postPropertyPin = null;
    }

    setTimeout(() => postPropertyMap?.invalidateSize(), 150);
}

function setPostPropertyPin(lat, lng) {
    const latEl = document.getElementById('property-lat');
    const lngEl = document.getElementById('property-lng');
    const lbl = document.getElementById('post-map-coords-label');
    if (latEl) latEl.value = lat.toFixed(6);
    if (lngEl) lngEl.value = lng.toFixed(6);
    if (lbl) lbl.textContent = `Pinned GPS: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;

    if (postPropertyMap) {
        if (postPropertyPin) {
            postPropertyPin.setLatLng([lat, lng]);
        } else {
            postPropertyPin = window.L.marker([lat, lng], { draggable: true }).addTo(postPropertyMap);
            postPropertyPin.on('dragend', (ev) => {
                const p = ev.target.getLatLng();
                setPostPropertyPin(p.lat, p.lng);
            });
        }
        postPropertyMap.panTo([lat, lng]);
    }
}

function useCurrentGpsForProperty() {
    if (!navigator.geolocation) return showToast('GPS not supported by this browser.', 'warning');
    showToast('Getting your current GPS coordinates...', 'info');
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            initPostPropertyMap(pos.coords.latitude, pos.coords.longitude);
            setPostPropertyPin(pos.coords.latitude, pos.coords.longitude);
            showToast('GPS pin placed at your current location!', 'success');
        },
        (err) => showToast(`GPS error: ${err.message}`, 'error'),
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
            meta.slots ? `<div style="background:#FAF8F5;padding:10px 14px;border-radius:10px;border:1px solid #EAE5DC;"><small style="color:#64748B;display:block;">Available Slots</small><strong style="color:#1E293B;">🛏️ ${meta.slots}</strong></div>` : '',
            meta.min_stay ? `<div style="background:#FAF8F5;padding:10px 14px;border-radius:10px;border:1px solid #EAE5DC;"><small style="color:#64748B;display:block;">Minimum Stay</small><strong style="color:#1E293B;">⏳ ${escapeHtml(meta.min_stay)}</strong></div>` : '',
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

        const amenitiesDetailHtml = Array.isArray(meta.amenities) && meta.amenities.length > 0
            ? `<div style="margin-bottom:18px;">
                 <strong style="display:block;color:#2C1E16;margin-bottom:8px;">✨ Amenities &amp; Inclusions</strong>
                 <div style="display:flex;flex-wrap:wrap;gap:8px;">${meta.amenities.map(a => `<span style="background:#EEF6FA;color:#0F4C81;font-size:13px;font-weight:600;padding:5px 12px;border-radius:999px;">${AMENITY_ICONS[a] || '✓'} ${escapeHtml(a)}</span>`).join('')}</div>
               </div>`
            : '';

        const rulesDetailHtml = meta.rules
            ? `<div style="background:#FFF8E1;border:1px solid #FDE68A;padding:14px;border-radius:10px;margin-bottom:18px;">
                 <strong style="display:block;color:#92400E;margin-bottom:4px;">📜 House Rules &amp; Conditions</strong>
                 <p style="color:#78350F;margin:0;font-size:14px;white-space:pre-line;">${escapeHtml(meta.rules)}</p>
               </div>`
            : '';

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
            <div style="background:#FAF8F5;border:1px solid #EAE5DC;padding:15px;border-radius:10px;margin-bottom:20px;">
                <strong style="color:#2C1E16;">Landlord:</strong> ${escapeHtml(meta.contact_name || property.landlord?.full_name || 'Property Owner')}
                ${property.landlord?.is_verified ? ' <span style="color:#2E7D32;font-weight:700;">✔ Verified</span>' : ''}
                ${(meta.contact_phone || property.landlord?.phone) ? `<br><strong style="color:#2C1E16;">Phone:</strong> ${escapeHtml(meta.contact_phone || property.landlord?.phone)}` : ''}
            </div>
            <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:26px;">
                ${canEditThisProperty ? `<button class="btn" onclick="document.getElementById('property-modal').classList.remove('active'); openEditPropertyForm('${property.property_id}')" style="flex:1;min-width:160px;padding:12px;">✏️ Edit Property Details</button>` : ''}
                ${!isOwner ? `<button class="btn" onclick="applyForProperty('${property.property_id}')" style="flex:1;min-width:140px;padding:12px;">📝 Apply Now</button>` : ''}
                ${!isOwner && property.landlord_id ? `<button class="btn-secondary" onclick="openMessageToUser('${property.landlord_id}', '${escapeJsAttr(property.landlord?.full_name || 'Landlord')}', '${property.property_id}')" style="flex:1;min-width:140px;padding:12px;">💬 Message Landlord</button>` : ''}
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
        setTxt('tenant-stat-total', apps.length);
        setTxt('tenant-stat-approved', apps.filter(a => a.status === 'approved').length);
        setTxt('tenant-stat-pending', apps.filter(a => a.status === 'pending').length);
        setTxt('tenant-stat-reviews', reviews.length);

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
                : complaints.map(c => `
                    <div style="border:1.5px solid #EAE6D6;border-radius:10px;padding:16px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
                        <div>
                            <strong style="color:#8B4513;">${escapeHtml(c.property?.title || 'General Complaint')}</strong>
                            <p style="color:#654321;margin:4px 0;">${escapeHtml(c.reason)}</p>
                            <small style="color:#888;">Filed: ${formatDate(c.created_at)}</small>
                        </div>
                        ${statusBadgeHtml(c.status)}
                    </div>
                `).join('');
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

    if (listEl) listEl.innerHTML = '<p>Loading your properties...</p>';
    if (appsEl) appsEl.innerHTML = '<p>Loading applications...</p>';
    if (inqEl) inqEl.innerHTML = '<p>Loading inquiries...</p>';

    try {
        const [properties, summary, applications, inquiries] = await Promise.all([
            window.propertyService.getLandlordProperties(currentUser.id),
            window.propertyService.getLandlordSummary(currentUser.id),
            window.applicationService.getLandlordApplications(currentUser.id),
            window.inquiryService.getUserInquiries(currentUser.id),
        ]);

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
                ? '<p style="color:#654321;">You haven\'t listed any properties yet.</p>'
                : properties.map(p => `
                    <div style="border:2px solid #ADD8E6;border-radius:10px;padding:18px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:14px;">
                        <div>
                            <h3 style="color:#8B4513;margin:0 0 6px;">${escapeHtml(p.title)}</h3>
                            <p style="color:#654321;margin:0 0 6px;">📍 ${escapeHtml(p.location)} · <strong>${formatPeso(p.price)}/mo</strong></p>
                            <small style="color:#888;">Photos: ${Array.isArray(p.image_urls) ? p.image_urls.length : 0} · Updated: ${formatDate(p.updated_at || p.created_at)}</small>
                        </div>
                        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                            <select onchange="handleLandlordStatusChange('${p.property_id}', this.value)" style="padding:8px 10px;border:2px solid #ADD8E6;border-radius:8px;font-weight:600;color:#8B4513;">
                                ${['available', 'occupied', 'hidden'].map(st => `<option value="${st}" ${p.availability_status === st ? 'selected' : ''}>${st.charAt(0).toUpperCase() + st.slice(1)}</option>`).join('')}
                            </select>
                            <button class="btn-secondary" onclick="openPropertyDetails('${p.property_id}')" style="padding:8px 14px;font-size:13px;">👁️ Preview</button>
                            <button class="btn-secondary" onclick="openEditPropertyForm('${p.property_id}')" style="padding:8px 14px;font-size:13px;">✏️ Edit Details</button>
                            <button class="btn-secondary" onclick="handleLandlordDeleteProperty('${p.property_id}')" style="padding:8px 14px;font-size:13px;color:#B42318;border-color:#FF6B6B;">🗑 Delete</button>
                        </div>
                    </div>
                `).join('');
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
        setVal('min-stay', meta.min_stay || '');
        setVal('move-in-date', meta.move_in_date || '');
        setVal('nearby-landmarks', meta.landmarks || '');
        setVal('location-link', meta.map_link || '');
        setVal('property-description', cleanDesc);
        setVal('property-rules', meta.rules || '');
        setVal('property-availability-status', prop.availability_status || 'available');
        setVal('contact-name', meta.contact_name || currentUser?.full_name || '');
        setVal('contact-number', meta.contact_phone || currentUser?.phone || '');
        setVal('property-lat', meta.lat ?? '');
        setVal('property-lng', meta.lng ?? '');

        const savedAmenities = new Set(Array.isArray(meta.amenities) ? meta.amenities : []);
        document.querySelectorAll('#post-property-form input[name="amenity"]').forEach(cb => {
            cb.checked = savedAmenities.has(cb.value);
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
    const availability_status = document.getElementById('property-availability-status')?.value || 'available';
    const checkedAmenities = Array.from(document.querySelectorAll('#post-property-form input[name="amenity"]:checked')).map(cb => cb.value);
    const description = encodePropertyDescription(plainDescription, {
        type: document.getElementById('property-type')?.value || '',
        slots: document.getElementById('available-slots')?.value || 1,
        min_stay: document.getElementById('min-stay')?.value || '',
        move_in_date: document.getElementById('move-in-date')?.value || '',
        landmarks: document.getElementById('nearby-landmarks')?.value || '',
        map_link: document.getElementById('location-link')?.value || '',
        rules: document.getElementById('property-rules')?.value || '',
        amenities: checkedAmenities,
        contact_name: document.getElementById('contact-name')?.value.trim() || '',
        contact_phone: document.getElementById('contact-number')?.value.trim() || '',
        lat: document.getElementById('property-lat')?.value || '',
        lng: document.getElementById('property-lng')?.value || '',
    });
    const fileInput = document.getElementById('property-images');
    const submitBtn = document.getElementById('post-property-submit-btn');

    submitBtn.disabled = true;
    submitBtn.textContent = editId ? '⏳ Saving...' : '⏳ Publishing...';

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
                title, location, price, description, availability_status, image_urls: uploadedUrls,
            });
            showToast('Property updated successfully!', 'success');
        } else {
            await window.propertyService.createProperty({
                landlord_id: currentUser.id,
                title, location, price, description, availability_status, image_urls: uploadedUrls,
            });
            showToast('Property published successfully! 🎉', 'success');
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

        if (!users.length) {
            el.innerHTML = '<p style="color:#654321;">No matching users found.</p>';
            return;
        }

        el.innerHTML = users.map(u => `
            <div style="border:1.5px solid #ADD8E6;border-radius:10px;padding:14px 16px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
                <div>
                    <strong style="color:#8B4513;">${escapeHtml(u.full_name)}</strong>
                    <span style="margin-left:8px;font-size:12px;font-weight:700;text-transform:uppercase;color:#0288D1;">${escapeHtml(u.role)}</span>
                    ${u.role === 'landlord' ? (u.is_verified ? ' <span style="color:#2E7D32;font-size:12px;font-weight:700;">✔ Verified</span>' : ' <span style="color:#B54708;font-size:12px;font-weight:700;">⏳ Unverified</span>') : ''}
                    <div style="font-size:13px;color:#654321;">${escapeHtml(u.email)} ${u.phone ? `· ${escapeHtml(u.phone)}` : ''}</div>
                </div>
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                    ${statusBadgeHtml(u.status)}
                    ${u.role === 'landlord' ? `<button class="btn" onclick="adminVerifyLandlord('${u.id}', ${!u.is_verified})" style="padding:7px 12px;font-size:12px;">${u.is_verified ? 'Revoke Verify' : '✔ Verify Landlord'}</button>` : ''}
                    ${u.id !== currentUser.id ? `<button class="btn-secondary" onclick="adminToggleUserStatus('${u.id}', '${u.status === 'suspended' ? 'active' : 'suspended'}')" style="padding:7px 12px;font-size:12px;${u.status === 'suspended' ? 'color:#1B5E20;border-color:#2E7D32;' : 'color:#B42318;border-color:#FF6B6B;'}">${u.status === 'suspended' ? 'Activate' : 'Suspend'}</button>` : ''}
                </div>
            </div>
        `).join('');
    } catch (error) {
        el.innerHTML = `<div class="auth-alert show error">${escapeHtml(error.message)}</div>`;
    }
}

async function adminVerifyLandlord(userId, isVerified) {
    try {
        await window.adminService.verifyLandlord(currentUser.id, userId, isVerified);
        showToast(isVerified ? 'Landlord verified!' : 'Landlord verification revoked.', 'success');
        loadAdminDashboard();
    } catch (error) {
        showToast(`Failed: ${error.message}`, 'error');
    }
}

async function adminToggleUserStatus(userId, newStatus) {
    try {
        await window.adminService.updateUserStatus(currentUser.id, userId, newStatus);
        showToast(`User status updated to ${newStatus}.`, 'success');
        loadAdminDashboard();
    } catch (error) {
        showToast(`Failed: ${error.message}`, 'error');
    }
}

async function loadAdminProperties() {
    const el = document.getElementById('admin-properties-list');
    if (!el) return;
    el.innerHTML = '<p>Loading properties...</p>';

    try {
        const props = await window.adminService.getAllProperties({
            search: document.getElementById('admin-prop-search')?.value || '',
            status: document.getElementById('admin-prop-status-filter')?.value || '',
        });

        if (!props.length) {
            el.innerHTML = '<p style="color:#654321;">No properties found.</p>';
            return;
        }

        el.innerHTML = props.map(p => `
            <div style="border:1.5px solid #ADD8E6;border-radius:10px;padding:14px 16px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
                <div>
                    <strong style="color:#8B4513;">${escapeHtml(p.title)}</strong> — <strong style="color:#0288D1;">${formatPeso(p.price)}/mo</strong>
                    <div style="font-size:13px;color:#654321;">📍 ${escapeHtml(p.location)} · Landlord: ${escapeHtml(p.landlord?.full_name || '—')}</div>
                </div>
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                    ${statusBadgeHtml(p.availability_status)}
                    <select onchange="adminModerateProperty('${p.property_id}', this.value)" style="padding:7px 10px;border:2px solid #ADD8E6;border-radius:8px;font-size:12px;">
                        ${['available', 'occupied', 'hidden', 'removed'].map(st => `<option value="${st}" ${p.availability_status === st ? 'selected' : ''}>${st}</option>`).join('')}
                    </select>
                    <button class="btn-secondary" onclick="adminDeleteProperty('${p.property_id}', '${escapeJsAttr(p.title)}')" style="padding:7px 12px;font-size:12px;color:#B42318;border-color:#FF6B6B;">Delete</button>
                </div>
            </div>
        `).join('');
    } catch (error) {
        el.innerHTML = `<div class="auth-alert show error">${escapeHtml(error.message)}</div>`;
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
        const list = await window.complaintService.getAllComplaints(statusFilter);

        if (!list.length) {
            el.innerHTML = '<p style="color:#654321;">No complaints found.</p>';
            return;
        }

        el.innerHTML = list.map(c => `
            <div style="border:1.5px solid #FFCDD2;background:#FFFDFD;border-radius:10px;padding:15px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:12px;">
                <div style="flex:1;min-width:240px;">
                    <strong style="color:#8B4513;">${escapeHtml(c.property?.title || 'General Complaint')}</strong>
                    <p style="color:#654321;margin:6px 0;">${escapeHtml(c.reason)}</p>
                    <small style="color:#654321;">Reported by: ${escapeHtml(c.reporter?.full_name || 'User')} · ${formatDateTime(c.created_at)}${c.resolved_at ? ` · Resolved: ${formatDate(c.resolved_at)}` : ''}</small>
                </div>
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                    ${statusBadgeHtml(c.status)}
                    <select onchange="adminUpdateComplaint('${c.complaint_id}', this.value)" style="padding:7px 10px;border:2px solid #ADD8E6;border-radius:8px;font-size:12px;">
                        ${['open', 'under_review', 'resolved', 'dismissed'].map(st => `<option value="${st}" ${c.status === st ? 'selected' : ''}>${st.replace(/_/g, ' ')}</option>`).join('')}
                    </select>
                </div>
            </div>
        `).join('');
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
    document.getElementById('complaint-reason').value = '';
    modal.classList.add('active');
}

function closeComplaintModal() {
    document.getElementById('complaint-modal')?.classList.remove('active');
}

async function handleSubmitComplaint(event) {
    event.preventDefault();
    if (!currentUser) return;
    const btn = document.getElementById('complaint-submit-btn');
    btn.disabled = true;
    btn.textContent = 'Submitting...';
    try {
        await window.complaintService.fileComplaint({
            reported_by: currentUser.id,
            property_id: document.getElementById('complaint-property-id').value || null,
            reported_user_id: document.getElementById('complaint-reported-user-id').value || null,
            reason: document.getElementById('complaint-reason').value,
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
    // Hamburger menu
    const hamburger = document.getElementById('hamburger');
    const navMenu = document.getElementById('nav-menu');
    if (hamburger && navMenu) {
        hamburger.addEventListener('click', () => {
            hamburger.classList.toggle('active');
            navMenu.classList.toggle('active');
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
        ['property-modal', 'messages-modal', 'new-message-modal', 'notifications-modal', 'complaint-modal'].forEach(id => {
            const modal = document.getElementById(id);
            if (modal && e.target === modal) modal.classList.remove('active');
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
