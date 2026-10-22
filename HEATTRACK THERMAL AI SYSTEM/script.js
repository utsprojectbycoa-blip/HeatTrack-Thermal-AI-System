// ============================================
// SUPABASE CONFIG
// ============================================
// Requires this tag in your HTML BEFORE this script:
// <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
// Values come from config.js, which heattrack.html loads BEFORE this file.
// config.js holds only the PUBLIC anon / publishable key (never a secret key).
const HEATTRACK_CONFIG = window.HEATTRACK_CONFIG || {};
const SUPABASE_URL = String(HEATTRACK_CONFIG.supabaseUrl || '').trim().replace(/\/+$/, '');
const SUPABASE_ANON_KEY = String(HEATTRACK_CONFIG.supabaseKey || '').trim();

// Refuse to run with missing settings or with a secret key in the browser
(function checkHeatTrackConfig() {
    let problem = '';
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        problem = 'HeatTrack settings are missing. Make sure config.js is in the same folder as heattrack.html and is loaded before script.js.';
    } else if (/^sb_secret_/i.test(SUPABASE_ANON_KEY)) {
        problem = 'config.js contains a SECRET key. Use the anon / publishable key instead.';
    } else {
        try {
            const part = SUPABASE_ANON_KEY.split('.')[1] || '';
            const payload = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
            if (payload.role === 'service_role') problem = 'config.js contains the service_role key. Use the anon / publishable key instead.';
        } catch (_) { /* publishable keys are not JWTs */ }
    }
    if (!problem) return;
    const show = () => {
        const box = document.createElement('div');
        box.setAttribute('role', 'alert');
        box.style.cssText = 'position:fixed;inset:1rem 1rem auto;z-index:99999;padding:1rem 1.25rem;border-radius:12px;background:#b91c1c;color:#fff;font:600 15px/1.4 system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.25)';
        box.textContent = problem;
        document.body.appendChild(box);
    };
    if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);
    throw new Error('HeatTrack: ' + problem);
})();

// NOTE: there are NO admin credentials in this file on purpose. Admins sign in with a
// normal Supabase account, and the database decides who is an admin through the
// is_admin() RPC (auth.uid() checked against the admins table, server-side).

// Detect a password-recovery link BEFORE the Supabase client cleans up the URL
const RECOVERY_LINK = /(^|[#&?])type=recovery/.test(location.hash + location.search);

// NOTE: the CDN already defines a global named "supabase", so the client is called "sb"
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// If your body-temperature columns are named differently, change them here
const DB_COLS = {
    lowTemp: 'lowest_body_temperature',
    highTemp: 'highest_body_temperature',
    avgTemp: 'average_body_temperature',
};

// Field length limits (change the numbers here and they apply everywhere)
const LIMITS = {
    name: { max: 25 },              // first name, last name
    username: { max: 20 },
    email: { max: 40 },
    password: { min: 8, max: 16 },  // password + confirm password
};

const GMAIL_EMAIL_RULE = /^[^\s@]+@gmail\.com$/i;

// Password rules (Sign Up, Reset Password and Edit Profile all use these)
const PASSWORD_RULE = /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[^A-Za-z0-9])\S{8,16}$/;
const PASSWORD_MSG = 'Password must be 8-16 characters with at least 1 uppercase letter, 1 lowercase letter, 1 number, and 1 special character (no spaces).';

// Ticks the requirement list and sets the Weak / Moderate / Strong / Very strong meter.
// items = the <li data-password-requirement> elements, wrapper = [data-password-strength-wrapper],
// label = the <span> inside the "Password strength:" line.
function updatePasswordChecklist(value, items, wrapper, label) {
    const requirements = {
        length: value.length >= LIMITS.password.min && value.length <= LIMITS.password.max,
        uppercase: /[A-Z]/.test(value),
        lowercase: /[a-z]/.test(value),
        special: /[^A-Za-z0-9]/.test(value),
        digit: /\d/.test(value),
    };
    items.forEach((item) => {
        item.classList.toggle('is-met', requirements[item.dataset.passwordRequirement]);
    });

    const score = Object.values(requirements).filter(Boolean).length;
    const strength = !value ? '' : score <= 2 ? 'weak' : score === 3 ? 'moderate' : score === 4 ? 'strong' : 'very-strong';
    const strengthNames = { weak: 'Weak', moderate: 'Moderate', strong: 'Strong', 'very-strong': 'Very strong' };
    if (wrapper) {
        if (strength) wrapper.dataset.passwordStrength = strength;
        else delete wrapper.dataset.passwordStrength;
    }
    if (label) {
        label.textContent = strengthNames[strength] || 'Not entered';
        label.dataset.strength = strength;
    }
}

// Forgot Password: a simpler Weak / Moderate / Strong meter.
// Strong only when every rule is met, i.e. the password will be accepted.
function updateForgotPasswordStrength(value, wrapper, label) {
    const score = [
        value.length >= LIMITS.password.min && value.length <= LIMITS.password.max,
        /[A-Z]/.test(value),
        /[a-z]/.test(value),
        /\d/.test(value),
        /[^A-Za-z0-9]/.test(value),
    ].filter(Boolean).length;
    const strength = !value ? '' : PASSWORD_RULE.test(value) ? 'strong' : score <= 2 ? 'weak' : 'moderate';
    if (wrapper) {
        // Reuse the sign-up border colours: red, orange, green
        if (strength) wrapper.dataset.passwordStrength = strength === 'strong' ? 'very-strong' : strength;
        else delete wrapper.dataset.passwordStrength;
    }
    if (label) {
        label.textContent = { weak: 'Weak', moderate: 'Moderate', strong: 'Strong' }[strength] || 'Not entered';
        label.dataset.strength = strength === 'strong' ? 'very-strong' : strength;
    }
}

// Blocks copy / cut / paste / drag in a password field (same as Sign Up)
function blockPasswordClipboard(input) {
    ['copy', 'cut', 'paste', 'drop', 'dragstart'].forEach((evt) => {
        input.addEventListener(evt, (e) => e.preventDefault());
    });
    input.addEventListener('contextmenu', (e) => e.preventDefault());
    input.addEventListener('keydown', (e) => {
        const key = e.key.toLowerCase();
        const mod = e.ctrlKey || e.metaKey;
        if ((mod && ['c', 'v', 'x', 'insert'].includes(key)) ||
            (e.shiftKey && ['insert', 'delete'].includes(key))) {
            e.preventDefault();
        }
    });
}

// Eye button: shows / hides EVERY password box in the same form at once
// (e.g. Password + Confirm Password switch together).
function togglePasswordGroup(toggle) {
    const own = toggle.parentElement.querySelector('input');
    const group = toggle.closest('form') || toggle.parentElement;
    const show = own ? own.type === 'password' : true;   // hidden now -> show all
    const groupName = toggle.dataset.passwordGroup || '';   // e.g. "device" for the API key
    group.querySelectorAll('[data-password-toggle]').forEach((btn) => {
        if ((btn.dataset.passwordGroup || '') !== groupName) return;
        const input = btn.parentElement.querySelector('input');
        if (input) input.type = show ? 'text' : 'password';
        btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
        btn.innerHTML = `<i data-lucide="${show ? 'eye-off' : 'eye'}"></i>`;
    });
    lucide.createIcons();
}

// Readonly-until-focus: inputs marked data-unlock-on-focus start readonly so the
// browser won't autofill saved logins into them, then become editable on focus.
document.querySelectorAll('[data-unlock-on-focus]').forEach((input) => {
    const unlock = () => { input.readOnly = false; };
    input.addEventListener('focus', unlock);
    input.addEventListener('pointerdown', unlock);
});

// Stops spaces from being typed or pasted into an input
function blockSpaces(input) {
    input.addEventListener('keydown', (e) => {
        if (e.key === ' ' || e.code === 'Space') e.preventDefault();
    });
    input.addEventListener('input', () => {
        if (!/\s/.test(input.value)) return;
        let cursor = null;
        try { cursor = input.selectionStart; } catch (_) {}
        const newPos = cursor !== null ? input.value.slice(0, cursor).replace(/\s/g, '').length : null;
        input.value = input.value.replace(/\s/g, '');
        if (newPos !== null) {
            try { input.setSelectionRange(newPos, newPos); } catch (_) {}
        }
    });
}
const INVALID_EMAIL_MSG = 'Invalid email address';

// Sets the minlength / maxlength attributes on inputs inside a form.
// Browsers then stop extra typing and trim pasted text automatically.
function applyFieldLimits(root, { passwords = false } = {}) {
    if (!root) return;
    const set = (selector, min, max) => root.querySelectorAll(selector).forEach((el) => {
        if (min) el.minLength = min;
        if (max) el.maxLength = max;
    });
    set('input[name="firstName"], input[name="lastName"]', null, LIMITS.name.max);
    set('input[name="username"]', null, LIMITS.username.max);
    set('input[name="email"]', null, LIMITS.email.max);
    if (passwords) {
        set('input[name="password"], input[name="confirmPassword"]', LIMITS.password.min, LIMITS.password.max);
    }
}

const SENSOR_HISTORY_LIMIT = 60;   // points kept on the environment chart
const DETECTION_LOAD_LIMIT = 1000; // most recent analytics rows loaded

// Initialize Lucide Icons
document.addEventListener('DOMContentLoaded', () => {
    initLogoutConfirm();
    initAuth();
    initAdminAccess();
    initProfile();
    initRouter();
    initSystem();
    initFaqAccordion();
    initMobileNavMenu();
    lucide.createIcons();
});

// ============================================
// AUTH (Supabase Auth)
// ============================================
function showAuthMessage(form, message, type = 'error') {
    if (!form) return;
    let el = form.querySelector('.ht-auth-msg');
    if (!el) {
        el = document.createElement('p');
        el.className = 'ht-auth-msg';
        el.setAttribute('role', 'alert');
        el.style.cssText = 'margin:0.75rem 0 0;font-size:14px;line-height:1.5;';
        const submit = form.querySelector('[type="submit"]');
        if (submit) submit.insertAdjacentElement('afterend', el);
        else form.appendChild(el);
    }
    el.style.color = type === 'error' ? '#dc2626' : '#16a34a';
    form.classList.remove('has-auth-error-autofocus');
    form.classList.toggle('has-auth-error', form.dataset.authForm === 'login' && Boolean(message) && type === 'error');
    const hasInfoIcon = message === 'Invalid username or password.';
    el.classList.toggle('ht-auth-msg--with-icon', hasInfoIcon);
    if (hasInfoIcon) {
        const icon = document.createElement('i');
        icon.dataset.lucide = 'info';
        icon.setAttribute('aria-hidden', 'true');
        el.replaceChildren(icon, document.createTextNode(message));
        lucide.createIcons();
    } else {
        el.textContent = message || '';
    }
    el.hidden = !message;
}

let loginLoadingState = null;

function setLoginFormBusy(form, busy) {
    if (!form) return;
    form.setAttribute('aria-busy', busy ? 'true' : 'false');
    form.querySelectorAll('input, button').forEach((control) => { control.disabled = busy; });
}

function showLoginLoading(kind, form, onTimeout) {
    const screen = document.getElementById('loginLoadingScreen');
    const status = document.getElementById('loginLoadingStatus');
    if (!screen || loginLoadingState) return;
    status.textContent = kind === 'admin'
        ? 'Verifying admin access...'
        : kind === 'forgot'
            ? 'Resetting your password…'
            : 'Signing you in...';
    screen.hidden = false;
    screen.classList.remove('is-hiding');
    document.body.classList.add('ht-login-loading-open');
    const startedAt = performance.now();
    loginLoadingState = {
        startedAt,
        timer: window.setTimeout(() => {
            onTimeout?.();
            hideLoginLoading();
        }, 15000),
    };
}

async function hideLoginLoading() {
    const screen = document.getElementById('loginLoadingScreen');
    const state = loginLoadingState;
    if (!screen || !state) return;
    window.clearTimeout(state.timer);
    loginLoadingState = null;
    const wait = Math.max(0, 1200 - (performance.now() - state.startedAt));
    if (wait) await new Promise((resolve) => window.setTimeout(resolve, wait));
    screen.classList.add('is-hiding');
    await new Promise((resolve) => window.setTimeout(resolve, 300));
    screen.hidden = true;
    screen.classList.remove('is-hiding');
    document.body.classList.remove('ht-login-loading-open');
}

let logoutDialogState = null;

function initLogoutConfirm() {
    const modal = document.getElementById('logoutConfirmModal');
    if (!modal) return;
    modal.querySelectorAll('[data-logout-dismiss]').forEach((element) => element.addEventListener('click', closeLogoutConfirm));
    modal.querySelector('[data-logout-confirm]')?.addEventListener('click', confirmLogout);
    document.addEventListener('keydown', (event) => {
        if (!logoutDialogState) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            closeLogoutConfirm();
            return;
        }
        if (event.key !== 'Tab') return;
        const focusable = [...modal.querySelectorAll('button:not([disabled])')];
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    });
}

function openLogoutConfirm(kind, trigger, callback) {
    const modal = document.getElementById('logoutConfirmModal');
    if (!modal || logoutDialogState) return;
    logoutDialogState = { kind, trigger, callback };
    modal.hidden = false;
    document.body.classList.add('ht-logout-modal-open');
    modal.querySelector('.ht-logout-modal__cancel')?.focus();
    lucide.createIcons();
}

function closeLogoutConfirm() {
    if (!logoutDialogState) return;
    const state = logoutDialogState;
    const confirm = document.querySelector('[data-logout-confirm]');
    if (confirm) {
        confirm.disabled = false;
        confirm.innerHTML = 'Yes, log out';
    }
    document.getElementById('logoutConfirmModal').hidden = true;
    document.body.classList.remove('ht-logout-modal-open');
    logoutDialogState = null;
    state.trigger?.focus();
}

const LOGOUT_SPINNER_MIN_MS = 700;

async function confirmLogout() {
    if (!logoutDialogState) return;
    const state = logoutDialogState;
    const confirm = document.querySelector('[data-logout-confirm]');
    if (confirm?.disabled) return;
    if (confirm) {
        confirm.disabled = true;
        confirm.innerHTML = '<span class="ht-logout-modal__spinner" aria-hidden="true"></span> Logging out...';
    }
    // Sign-out is near-instant, so hold the spinner briefly to make it visible
    await new Promise((resolve) => setTimeout(resolve, LOGOUT_SPINNER_MIN_MS));
    if (logoutDialogState !== state) return;   // dialog was cancelled meanwhile
    try {
        await state.callback();
    } catch (error) {
        console.error('Logout failed:', error);
        if (confirm) {
            confirm.disabled = false;
            confirm.innerHTML = 'Yes, log out';
        }
    }
}

function initAuth() {
    const authViews = {
        signup: document.getElementById('authSignup'),
        login: document.getElementById('authLogin'),
        forgot: document.getElementById('authForgot'),
    };
    const authApp = document.getElementById('authApp');
    const authWelcome = document.getElementById('authWelcome');
    if (!authApp) return;

    const signupForm = authApp.querySelector('form[data-auth-form="signup"]');
    const loginForm = authApp.querySelector('form[data-auth-form="login"]');
    const forgotForm = authApp.querySelector('form[data-auth-form="forgot"]');
    let recoveryMode = RECOVERY_LINK; // true once the user arrives from a reset-password email

    const focusLoginUsername = () => {
        const usernameInput = loginForm?.elements.username;
        usernameInput?.focus();
        loginForm?.classList.toggle('has-auth-error-autofocus', loginForm.classList.contains('has-auth-error'));
    };
    loginForm?.elements.username?.addEventListener('pointerdown', () => {
        loginForm.classList.remove('has-auth-error-autofocus');
    });

    authApp.querySelectorAll('input[type="email"]').forEach((input) => {
        input.addEventListener('input', () => {
            input.setCustomValidity(input.value && !GMAIL_EMAIL_RULE.test(input.value) ? INVALID_EMAIL_MSG : '');
        });
    });

    // Enforce length limits (25 names, 20 username, 40 email, 8-16 passwords)
    applyFieldLimits(signupForm, { passwords: true });
    applyFieldLimits(forgotForm, { passwords: true });
    // Login has no password limits (old passwords must still work), and its
    // username box also accepts an email, so it gets the longer email limit.
    if (loginForm?.elements.username) loginForm.elements.username.maxLength = LIMITS.email.max;

    // First / Last name: letters + single spaces only
    const cleanName = (str) =>
        str
            .replace(/[^\p{L}\p{M} ]/gu, '') // keep letters, accents and spaces
            .replace(/^ +/, '')              // no leading space
            .replace(/ {2,}/g, ' ');         // collapse double spaces

    authApp.querySelectorAll('input[name="firstName"], input[name="lastName"]').forEach((input) => {
        input.addEventListener('input', (e) => {
            if (e.isComposing) return;
            const cursor = input.selectionStart;
            const before = cleanName(input.value.slice(0, cursor));
            const cleaned = cleanName(input.value);
            if (cleaned !== input.value) {
                input.value = cleaned;
                input.setSelectionRange(before.length, before.length);
            }
        });

        // Remove any trailing space once the user is done typing
        const trimValue = () => { input.value = input.value.trim(); };
        input.addEventListener('blur', trimValue);
        input.addEventListener('change', trimValue);
    });

    // Disable copy / cut / paste in Password + Confirm Password (signup + forgot)
    authApp.querySelectorAll('form[data-auth-form="signup"], form[data-auth-form="forgot"]').forEach((form) => {
        form.querySelectorAll('input[name="password"], input[name="confirmPassword"]').forEach((input) => {
            ['copy', 'cut', 'paste', 'drop', 'dragstart'].forEach((evt) => {
                input.addEventListener(evt, (e) => e.preventDefault());
            });

            input.addEventListener('contextmenu', (e) => e.preventDefault());

            input.addEventListener('keydown', (e) => {
                const key = (e.key || '').toLowerCase();   // autofill sends keydown with no key
                const mod = e.ctrlKey || e.metaKey;
                if ((mod && ['c', 'v', 'x', 'insert'].includes(key)) ||
                    (e.shiftKey && ['insert', 'delete'].includes(key))) {
                    e.preventDefault();
                }
            });
        });
    });

    // ---- Field rules (signup + reset password) ----
    // PASSWORD_RULE and PASSWORD_MSG are defined at the top of this file

    // No spaces: username, email, password, confirm password (signup + forgot)
    const NO_SPACE_FIELDS = 'input[name="username"], input[name="email"], input[name="password"], input[name="confirmPassword"]';

    authApp.querySelectorAll('form[data-auth-form="signup"], form[data-auth-form="forgot"]').forEach((form) => {
        form.querySelectorAll(NO_SPACE_FIELDS).forEach((input) => {
            input.addEventListener('keydown', (e) => {
                if (e.key === ' ' || e.code === 'Space') e.preventDefault();
            });

            input.addEventListener('input', () => {
                if (!/\s/.test(input.value)) return;

                // type="email" inputs don't expose the cursor position, so guard it
                let cursor = null;
                try { cursor = input.selectionStart; } catch (_) {}
                const newPos = cursor !== null
                    ? input.value.slice(0, cursor).replace(/\s/g, '').length
                    : null;

                input.value = input.value.replace(/\s/g, '');

                if (newPos !== null) {
                    try { input.setSelectionRange(newPos, newPos); } catch (_) {}
                }
            });
        });
    });

    // Device ID number (digits only, padded to 3 on blur) + Device API key (no spaces)
    const signupFormEl = authApp.querySelector('form[data-auth-form="signup"]');
    const deviceNumberInput = signupFormEl?.elements.deviceNumber;
    const deviceKeyInput = signupFormEl?.elements.deviceApiKey;
    if (deviceNumberInput) {
        deviceNumberInput.addEventListener('input', () => {
            const digits = deviceNumberInput.value.replace(/\D/g, '').slice(0, 3);
            if (digits !== deviceNumberInput.value) deviceNumberInput.value = digits;
            deviceNumberInput.setCustomValidity('');
        });
        deviceNumberInput.addEventListener('blur', () => {
            const v = deviceNumberInput.value;
            if (v && v.length < 3) deviceNumberInput.value = v.padStart(3, '0');
        });
    }
    if (deviceKeyInput) {
        blockSpaces(deviceKeyInput);
        deviceKeyInput.addEventListener('input', () => deviceKeyInput.setCustomValidity(''));
    }

    // Password + Confirm Password validation
    authApp.querySelectorAll('form[data-auth-form="signup"], form[data-auth-form="forgot"]').forEach((form) => {
        const pwd = form.querySelector('input[name="password"]');
        const confirm = form.querySelector('input[name="confirmPassword"]');
        if (!pwd || !confirm) return;

        const isSignupForm = form.dataset.authForm === 'signup';
        const strengthWrapper = isSignupForm ? pwd.closest('[data-password-strength-wrapper]') : null;
        const requirementItems = isSignupForm ? [...form.querySelectorAll('[data-password-requirement]')] : [];
        const strengthLabel = isSignupForm ? form.querySelector('#signupPasswordStrength span') : null;
        const forgotWrapper = !isSignupForm ? pwd.closest('[data-password-strength-wrapper]') : null;
        const forgotLabel = !isSignupForm ? form.querySelector('#forgotPasswordHint span') : null;
        const updateSignupPasswordFeedback = () => {
            if (!isSignupForm) {
                updateForgotPasswordStrength(pwd.value, forgotWrapper, forgotLabel);
                return;
            }
            updatePasswordChecklist(pwd.value, requirementItems, strengthWrapper, strengthLabel);
        };

        const validatePasswords = () => {
            pwd.setCustomValidity(pwd.value && !PASSWORD_RULE.test(pwd.value) ? PASSWORD_MSG : '');
            confirm.setCustomValidity(confirm.value && confirm.value !== pwd.value ? 'Passwords do not match.' : '');
            updateSignupPasswordFeedback();
        };

        updateSignupPasswordFeedback();
        pwd.addEventListener('input', validatePasswords);
        confirm.addEventListener('input', validatePasswords);
    });

    let forgotHasSubmitted = false;
    const forgotErrors = {
        email: forgotForm?.querySelector('#forgotEmailError'),
        password: forgotForm?.querySelector('#forgotPasswordError'),
        confirm: forgotForm?.querySelector('#forgotConfirmError'),
    };

    function setForgotFieldState(input, error, message) {
        if (!input || !error) return;
        const invalid = Boolean(message);
        input.setAttribute('aria-invalid', invalid ? 'true' : 'false');
        error.textContent = message || '';
        error.hidden = !invalid;
    }

    function validateForgot(showErrors = false) {
        if (!forgotForm) return true;
        const email = forgotForm.elements.email;
        const password = forgotForm.elements.password;
        const confirm = forgotForm.elements.confirmPassword;
        const isReset = recoveryMode;
        const emailInvalid = !isReset && (!email.value.trim() || !GMAIL_EMAIL_RULE.test(email.value.trim()));
        const passwordInvalid = isReset && !PASSWORD_RULE.test(password.value);
        const confirmInvalid = isReset && (!confirm.value || confirm.value !== password.value);

        if (showErrors || forgotHasSubmitted) {
            setForgotFieldState(email, forgotErrors.email, emailInvalid ? (!email.value.trim() ? 'Email is required.' : INVALID_EMAIL_MSG) : '');
            setForgotFieldState(password, forgotErrors.password, passwordInvalid ? PASSWORD_MSG : '');
            setForgotFieldState(confirm, forgotErrors.confirm, confirmInvalid ? (confirm.value ? 'Passwords do not match.' : 'Confirmation is required.') : '');
        }
        return !emailInvalid && !passwordInvalid && !confirmInvalid;
    }

    forgotForm?.addEventListener('input', () => {
        if (forgotHasSubmitted) validateForgot();
    });

    // ---- Forgot password has two steps with Supabase ----
    //   'request' -> user enters email, we send a reset link
    //   'reset'   -> user came back from the email link, we set the new password
    // TIP: add data-auth-field to each field wrapper in the forgot form so hiding is exact.
    const FIELD_WRAP_SELECTOR = '[data-auth-field], .ht-field, .ht-auth__field, .ht-form__field, .ht-form-group';
    const fieldWrap = (input) => input.closest(FIELD_WRAP_SELECTOR) || input.closest('label') || input.parentElement;

    function setForgotMode(mode) {
        if (!forgotForm) return;
        const isReset = mode === 'reset';
        const submitBtn = forgotForm.querySelector('[type="submit"]');
        const emailInput = forgotForm.querySelector('input[name="email"]');
        const pwdInputs = forgotForm.querySelectorAll('input[name="password"], input[name="confirmPassword"]');
        const pwdLabels = forgotForm.querySelectorAll('[data-auth-field="password"], [data-auth-field="confirmPassword"]');
        const passwordHint = forgotForm.querySelector('#forgotPasswordHint');

        if (submitBtn) {
            submitBtn.textContent = isReset ? 'Update Password' : 'Send Reset Link';
        }

        if (emailInput) {
            emailInput.required = !isReset;
            emailInput.disabled = isReset;
            fieldWrap(emailInput)?.classList.toggle('u-hidden', isReset);
        }

        pwdInputs.forEach((input) => {
            input.required = isReset;
            input.disabled = !isReset;
            // Fallback for markup without data-auth-field wrappers
            if (!pwdLabels.length) fieldWrap(input)?.classList.toggle('u-hidden', !isReset);
        });

        pwdLabels.forEach((label) => label.classList.toggle('u-hidden', !isReset));
        if (passwordHint) passwordHint.classList.toggle('u-hidden', !isReset);

        if (isReset) {
            const emailError = forgotForm.querySelector('#forgotEmailError');
            if (emailError) emailError.hidden = true;
            setForgotFieldState(emailInput, emailError, '');
        }
    }

    function clearAuthForms() {
        forgotHasSubmitted = false;
        authApp.querySelectorAll('form[data-auth-form]').forEach((form) => {
            form.reset();
            form.classList.remove('has-submit-attempt');
            form.querySelectorAll('input').forEach((input) => {
                input.setCustomValidity('');
                input.removeAttribute('aria-invalid');
                input.dispatchEvent(new Event('input', { bubbles: true }));
            });
            form.querySelectorAll('[data-password-toggle]').forEach((toggle) => {
                const input = toggle.parentElement.querySelector('input');
                if (input) input.type = 'password';
                toggle.setAttribute('aria-label', 'Show password');
                toggle.innerHTML = '<i data-lucide="eye"></i>';
            });
        });
        authApp.querySelectorAll('.ht-auth__field-error').forEach((error) => {
            error.textContent = '';
            error.hidden = true;
        });
        authApp.querySelectorAll('.ht-auth__hint').forEach((hint) => {
            hint.classList.remove('is-invalid', 'is-valid');
        });
        // Re-render the eye icons that were just reset to raw <i data-lucide> tags
        if (window.lucide) lucide.createIcons();
    }

    const showAuthView = (view) => {
        clearAuthForms();
        Object.entries(authViews).forEach(([name, element]) => {
            if (name === 'forgot') element?.classList.toggle('u-hidden', name !== view);
            else element?.classList.toggle('is-active', name === view);
        });
        authApp.classList.toggle('ht-auth--login', view === 'login');
        authApp.classList.toggle('ht-auth--recovery', view === 'forgot');
        if (authWelcome && view !== 'forgot') {
            authWelcome.classList.toggle('is-login', view === 'login');
            window.clearTimeout(authWelcome.__contentTimer);
            authWelcome.__contentTimer = window.setTimeout(() => {
                authWelcome.querySelectorAll('[data-auth-welcome-content]').forEach((content) => {
                    content.classList.toggle('is-active', content.dataset.authWelcomeContent === view);
                });
            }, 650);
        }
        if (view === 'forgot') setForgotMode(recoveryMode ? 'reset' : 'request');

        // Clear old status messages when switching views
        authApp.querySelectorAll('.ht-auth-msg').forEach((el) => { el.textContent = ''; el.hidden = true; });

        document.title = `HeatTrack — ${view === 'signup' ? 'Create Account' : view === 'login' ? 'Sign In' : 'Forgot Password'}`;
    };

    showAuthView('login');

    authApp.addEventListener('click', (event) => {
        const trigger = event.target.closest('[data-auth-view]');
        if (!trigger) return;
        // Leaving the "set new password" step by hand cancels recovery mode
        if (recoveryMode && trigger.dataset.authView !== 'forgot') recoveryMode = false;
        showAuthView(trigger.dataset.authView);
    });

    authApp.querySelectorAll('[data-password-toggle]').forEach((toggle) => {
        toggle.addEventListener('click', () => togglePasswordGroup(toggle));
    });

    // Clear inline messages while the user edits a form
    authApp.querySelectorAll('form').forEach((form) => {
        form.addEventListener('input', () => showAuthMessage(form, ''));
    });

    // ---- Enter / leave the app ----
    async function enterApp(route) {
        const profile = await fetchCurrentProfile();
        if (!profile) {
            try { await sb.auth.signOut(); } catch (_) {}
            showAuthView('login');
            showAuthMessage(loginForm, 'We could not load your profile. Please try again.');
            return;
        }
        currentUser = profile;
        renderProfile();
        document.body.classList.remove('ht-auth-mode');
        document.querySelector('.ht-role-switcher')?.classList.add('u-hidden');
        authApp.classList.add('u-hidden');
        loadDeviceSettings();
        updateSystemToggleStates();
        drawAnnotations();
        refreshAccountSettings(currentUser.id);   // Camera Streams from the account
        showView(route || getRouteFromHash());
        await loadCloudData();
        subscribeRealtime(currentUser.id);
    }

    function resetToLogin() {
        // Close panels, mobile menu, toast, modal, fullscreen
        animatePanelClose(document.getElementById('settingsPanel'));
        animatePanelClose(document.getElementById('alertPanel'));
        document.getElementById('settingsBtn')?.classList.remove('is-active');
        document.getElementById('alertBtn')?.classList.remove('is-active');

        const nav = document.getElementById('mobileNav');
        const menuBtn = document.getElementById('navMenuToggle');
        nav?.classList.remove('is-open');
        menuBtn?.classList.remove('is-active');
        menuBtn?.setAttribute('aria-expanded', 'false');

        document.getElementById('alertToast')?.classList.remove('is-visible');
        closeRecommendationModal();
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});

        // Stop live updates and wipe the previous user's data from memory
        unsubscribeRealtime();
        resetDashboardData();

        // Clear all auth forms (values, validation messages, password visibility)
        authApp.querySelectorAll('form').forEach((form) => form.reset());
        authApp.querySelectorAll('input').forEach((input) => input.setCustomValidity(''));
        authApp.querySelectorAll('[data-password-toggle]').forEach((toggle) => {
            const input = toggle.parentElement.querySelector('input');
            if (input) input.type = 'password';
            toggle.setAttribute('aria-label', 'Show password');
            toggle.innerHTML = '<i data-lucide="eye"></i>';
        });

        // Remove the page hash (e.g. #live) without triggering a route change
        history.replaceState(null, '', location.pathname + location.search);
        resetProfile();

        // Back to the login screen
        document.body.classList.add('ht-auth-mode');
        document.querySelector('.ht-role-switcher')?.classList.remove('u-hidden');
        authApp.classList.remove('u-hidden');
        showAuthView('login');
        window.scrollTo(0, 0);
        lucide.createIcons();
    }

    // ---- Form handlers ----
    async function handleLogin(form) {
        const identifier = form.elements.username.value.trim();
        const password = form.elements.password?.value || '';
        let email = identifier;

        if (identifier.includes('@') && !GMAIL_EMAIL_RULE.test(identifier)) {
            showAuthMessage(form, INVALID_EMAIL_MSG);
            return;
        }

        // Supabase signs in with email, so look the email up from the username
        if (!identifier.includes('@')) {
            const { data, error } = await sb.rpc('get_email_by_username', { uname: identifier });
            if (error || !data) {
                showAuthMessage(form, 'Invalid username or password.');
                return;
            }
            email = data;
        }

        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) {
            showAuthMessage(
                form,
                error.message === 'Email not confirmed'
                    ? 'Please confirm your email address first, then sign in.'
                    : 'Incorrect password'
            );
            return;
        }

        // There's a real Supabase session now. Ask the database (not the client)
        // whether this account is an admin — is_admin() checks auth.uid() against
        // the admins table server-side, so this can't be spoofed from the browser.
        const { data: isAdmin } = await sb.rpc('is_admin');

        setLoginFormBusy(form, true);
        showLoginLoading(isAdmin ? 'admin' : 'user', form, () => showAuthMessage(form, 'Something went wrong. Please try again.'));

        if (isAdmin) {
            try {
                history.replaceState(null, '', '#admin-ui');
                setAuthRole('admin-ui');
                await initAdminUi();
                form.reset();
            } catch (err) {
                console.error('Admin initialization failed:', err);
                await sb.auth.signOut();
                history.replaceState(null, '', location.pathname + location.search);
                setAuthRole('user');
                showAuthMessage(form, 'Something went wrong. Please try again.');
            } finally {
                await hideLoginLoading();
                setLoginFormBusy(form, false);
            }
            return;
        }

        const profile = await fetchCurrentProfile();
        if (profile?.status !== 'approved') {
            await sb.auth.signOut();
            await hideLoginLoading();
            setLoginFormBusy(form, false);
            showAuthMessage(
                form,
                profile?.status === 'rejected'
                    ? 'Your account request was not approved. Contact the administrator for details.'
                    : 'Your account is awaiting admin approval.'
            );
            return;
        }

        form.reset();
        await enterApp('home');
    }

    async function handleSignup(form) {
        const usernameInput = form.elements.username;
        const username = usernameInput.value.trim();
        const email = form.elements.email.value.trim();
        const password = form.elements.password.value;

        if (!GMAIL_EMAIL_RULE.test(email)) {
            showAuthMessage(form, INVALID_EMAIL_MSG);
            return;
        }

        const { data: available, error: availError } = await sb.rpc('username_available', { uname: username });
        if (availError) throw availError;
        if (!available) {
            usernameInput.setCustomValidity('That username is already taken.');
            usernameInput.reportValidity();
            usernameInput.addEventListener('input', () => usernameInput.setCustomValidity(''), { once: true });
            return;
        }

        // Device: HT-PDCK- + 3 digits, checked against the registered devices
        const deviceNumberInput = form.elements.deviceNumber;
        const deviceKeyInput = form.elements.deviceApiKey;
        const deviceCode = 'HT-PDCK-' + deviceNumberInput.value.trim().padStart(3, '0');
        const deviceApiKey = deviceKeyInput.value;
        // device_check still names its parameter p_device_id; the value is devices.device_code
        const { data: deviceStatus, error: deviceError } = await sb.rpc('device_check', { p_device_id: deviceCode, p_api_key: deviceApiKey });
        if (deviceError) throw deviceError;
        if (deviceStatus !== 'ok') {
            const target = deviceStatus === 'taken' ? deviceNumberInput : deviceKeyInput;
            target.setCustomValidity(deviceStatus === 'taken'
                ? `${deviceCode} is already linked to another account.`
                : 'Device ID or API key is incorrect.');
            target.reportValidity();
            return;
        }

        // Password goes to Supabase Auth only (it is hashed there, never stored in our tables).
        // The database trigger reads these values to create the profiles row.
        // The device trigger (device_check_fix.sql) links the device to the new account;
        // the key stays because the mini PC logger signs its uploads with it.
        const { data, error } = await sb.auth.signUp({
            email,
            password,
            options: {
                data: {
                    firstname: form.elements.firstName.value.trim(),
                    lastname: form.elements.lastName.value.trim(),
                    username,
                    status: 'pending',
                    device_code: deviceCode,
                    device_id: deviceCode,   // older trigger versions read this key
                    device_api_key: deviceApiKey,
                },
                emailRedirectTo: location.origin + location.pathname,
            },
        });
        if (error) {
            // The device trigger rejects the sign-up if the device was claimed in the meantime
            showAuthMessage(form, /database error/i.test(error.message)
                ? 'Could not link the device. Check the Device ID and API key, or the device may already be linked.'
                : error.message);
            return;
        }

        if (data.session) await sb.auth.signOut(); // keep the original flow: sign up, then sign in

        form.reset();
        form.elements.password.dispatchEvent(new Event('input'));   // clear the password checklist too
        showAuthView('login');
        showAuthMessage(
            loginForm,
            // New accounts start as 'pending' until an admin approves them
            'Account created! Please wait for an admin to approve your account before signing in.',
            'success'
        );
    }

    async function handleForgot(form) {
        if (recoveryMode) {
            // Step 2: only an authenticated recovery session may change the password.
            const { data: { session } } = await sb.auth.getSession();
            if (!session?.user) {
                recoveryMode = false;
                setForgotMode('request');
                showAuthMessage(form, 'Please request a new reset link before changing your password.');
                return;
            }

            const password = form.elements.password.value;
            const { error } = await sb.auth.updateUser({ password });
            if (error) {
                showAuthMessage(form, error.message);
                return;
            }
            recoveryMode = false;
            await sb.auth.signOut();
            form.reset();
            showAuthView('login');
            showAuthMessage(loginForm, 'Password updated. Please sign in with your new password.', 'success');
        } else {
            // Step 1: send the reset link
            const email = form.elements.email.value.trim();
            if (!GMAIL_EMAIL_RULE.test(email)) {
                showAuthMessage(form, INVALID_EMAIL_MSG);
                return;
            }
            const { error } = await sb.auth.resetPasswordForEmail(email, {
                redirectTo: location.origin + location.pathname,
            });
            if (error) {
                showAuthMessage(form, error.message);
                return;
            }
            showAuthMessage(form, 'If an account exists for that email, a reset link is on its way.', 'success');
        }
    }

    authApp.querySelectorAll('[data-auth-form]').forEach((form) => {
        if (form.dataset.authForm === 'signup') {
            form.querySelector('[type="submit"]')?.addEventListener('click', () => {
                form.classList.add('has-submit-attempt');
            });
        }

        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            const type = form.dataset.authForm;
            const submitBtn = form.querySelector('[type="submit"]');
            if (submitBtn?.disabled) return;
            if (type === 'forgot') {
                forgotHasSubmitted = true;
                if (!validateForgot(true)) return;
            }
            if (type === 'login' && !form.reportValidity()) return;
            if (type === 'login' && (!form.elements.username.value.trim() || !form.elements.password.value)) {
                showAuthMessage(form, 'Please enter your username and password.');
                form.elements.username.value.trim() ? form.elements.password.focus() : focusLoginUsername();
                return;
            }
            if (type === 'login' && form.elements.username.value.includes('@') && !GMAIL_EMAIL_RULE.test(form.elements.username.value.trim())) {
                showAuthMessage(form, INVALID_EMAIL_MSG);
                focusLoginUsername();
                return;
            }
            if (submitBtn) submitBtn.disabled = true;
            // Spinner on the Log in / Sign up / Forgot Password button while the request runs
            const showSpinner = type === 'login' || type === 'signup' || type === 'forgot';
            if (showSpinner) {
                submitBtn?.classList.add('is-loading');
                submitBtn?.setAttribute('aria-busy', 'true');
            }
            showAuthMessage(form, '');
            try {
                if (type === 'login') await handleLogin(form);
                else if (type === 'signup') await handleSignup(form);
                else await handleForgot(form);
            } catch (err) {
                console.error('Auth error:', err);
                if (type === 'login') showAuthMessage(form, 'Something went wrong. Please try again.');
                else showAuthMessage(form, 'Something went wrong. Please check your connection and try again.');
            } finally {
                if (showSpinner) {
                    submitBtn?.classList.remove('is-loading');
                    submitBtn?.removeAttribute('aria-busy');
                }
                if (type === 'login') await hideLoginLoading();
                if (type === 'login') setLoginFormBusy(form, false);
                else if (submitBtn) submitBtn.disabled = false;
                if (type === 'login' && document.body.classList.contains('ht-auth-mode')) focusLoginUsername();
            }
        });
    });

    // ---- Logout ----
    document.getElementById('logoutBtn')?.addEventListener('click', (event) => {
        openLogoutConfirm('user', event.currentTarget, async () => {
            try { await sb.auth.signOut(); } catch (err) { console.error('Sign out failed:', err); }
            closeLogoutConfirm();
            resetToLogin();
        });
    });

    // ---- React to auth changes (recovery link, sign-out from another tab) ----
    // Keep this callback light: don't call other Supabase methods inside it.
    sb.auth.onAuthStateChange((event) => {
        if (event === 'PASSWORD_RECOVERY') {
            recoveryMode = true;
            showAuthView('forgot');
        } else if (event === 'SIGNED_OUT' && !document.body.classList.contains('ht-auth-mode')) {
            resetToLogin();
        }
    });

    // ---- Restore an existing session on page load ----
    (async () => {
        try {
            if (recoveryMode) {
                showAuthView('forgot');
                return;
            }
            // The admin pages handle their own session (see initAdminAccess)
            const bootAuth = document.documentElement.dataset.bootAuth;
            if (bootAuth === 'admin' || bootAuth === 'admin-ui') return;
            const { data: { session } } = await sb.auth.getSession();
            if (session) await enterApp(null);
        } catch (err) {
            console.error('Session restore failed:', err);
        }
    })();
}

// Temporarily suppress tooltip/hover behavior (for touch interactions)
function suppressHoverTemporarily() {
    try {
        document.documentElement.classList.add('disable-hover');
        if (window._disableHoverTimer) clearTimeout(window._disableHoverTimer);
        window._disableHoverTimer = setTimeout(() => {
            document.documentElement.classList.remove('disable-hover');
            window._disableHoverTimer = null;
        }, 600);
    } catch (e) {
        // noop
    }
}

function initFaqAccordion() {
    document.querySelectorAll('.ht-faq__item').forEach((item) => {
        item.addEventListener('toggle', () => {
            if (item.open) lucide.createIcons();
        });
    });
}

// ============================================
// MOBILE NAVIGATION MENU
// ============================================
function closeHeaderPanels() {
    const settingsPanel = document.getElementById('settingsPanel');
    const alertPanel = document.getElementById('alertPanel');
    const settingsBtn = document.getElementById('settingsBtn');
    const alertBtn = document.getElementById('alertBtn');
    animatePanelClose(settingsPanel);
    settingsBtn?.classList.remove('is-active');
    animatePanelClose(alertPanel);
    alertBtn?.classList.remove('is-active');
}

function initMobileNavMenu() {
    const menuBtn = document.getElementById('navMenuToggle');
    const nav = document.getElementById('mobileNav');

    if (!menuBtn || !nav) return;

    const closeMenu = () => {
        nav.classList.remove('is-open');
        menuBtn.classList.remove('is-active');
        menuBtn.setAttribute('aria-expanded', 'false');
    };

    // Toggle menu on button click
    menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = nav.classList.toggle('is-open');
        menuBtn.classList.toggle('is-active', isOpen);
        menuBtn.setAttribute('aria-expanded', isOpen);
        // Close Settings and Alerts panels when hamburger menu opens
        if (isOpen) closeHeaderPanels();
    });

    // Suppress hover/tooltips briefly on touch interactions for hamburger
    menuBtn.addEventListener('touchstart', suppressHoverTemporarily, { passive: true });

    // Close menu when a nav link is clicked
    nav.querySelectorAll('.ht-nav__link').forEach((link) => {
        link.addEventListener('click', () => {
            closeMenu();
            closeHeaderPanels();
            suppressHoverTemporarily();
        });
    });

    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.ht-topnav')) {
            closeMenu();
            closeHeaderPanels();
            suppressHoverTemporarily();
        }
    });

    // Close menu on window resize if screen is large enough
    window.addEventListener('resize', () => {
        if (window.innerWidth >= 768) {
            closeMenu();
            closeHeaderPanels();
            suppressHoverTemporarily();
        }
    });
}

// Header panels (Alerts, Settings) start at the top each time they open or close
function resetPanelScroll(panel) {
    [panel, ...panel.querySelectorAll('*')].forEach((el) => {
        if (el.scrollTop) el.scrollTop = 0;
    });
}

function animatePanelOpen(panel) {
    if (!panel) return;
    if (panel.__pendingCloseListener) {
        panel.removeEventListener('transitionend', panel.__pendingCloseListener);
        panel.__pendingCloseListener = null;
    }
    panel.classList.remove('u-hidden');
    resetPanelScroll(panel);
    void panel.offsetWidth;
    panel.classList.add('is-open');
}

function animatePanelClose(panel) {
    if (!panel) return;
    panel.classList.remove('is-open');
    if (panel.__pendingCloseListener) {
        panel.removeEventListener('transitionend', panel.__pendingCloseListener);
        panel.__pendingCloseListener = null;
    }
    const finishClose = (event) => {
        if (event.propertyName === 'opacity') {
            resetPanelScroll(panel);   // after the fade, so the list doesn't jump while visible
            panel.classList.add('u-hidden');
            panel.removeEventListener('transitionend', finishClose);
            panel.__pendingCloseListener = null;
        }
    };
    panel.__pendingCloseListener = finishClose;
    panel.addEventListener('transitionend', finishClose);
}


// ============================================
// STATE MANAGEMENT
// ============================================
let currentView = 'home';
const intervals = {
    clock: null,
    sensor: null,
    detection: null,
    annotations: null,
};

const state = {
    detections: [],
    sensorHistory: {
        temp: [],
        humidity: [],
        labels: [],
        times: []     // full Date of each reading (for the chart tooltip)
    },
    currentPage: 1,
    pageSize: 10,
    // Detection Log filter: kind 'status' | 'urgency', level a STATUS_ORDER / severity code or 'ALL'
    logFilter: { kind: 'status', level: 'ALL' },
    // Detection Log period: 'all' | 'today' | 'last7' | 'last30' | 'custom' (see getLogDateBounds)
    alertCount: 0,
    alerts: [],
    alertsDisplayed: 0,
    alertsPageSize: 10,
    recommendationsDisplayed: 0,
    recommendationsPageSize: 8,
    cameraActive: true,     // this browser's Camera Streams choice (browser storage)
    alertsWanted: true,     // this browser's Alert Notifications choice (browser storage)
    alertsEnabled: true,    // alertsWanted, and only while the cameras are on
    lastToastDetection: null,
    stats: {
        stressCount: 0,
        mildCount: 0,
        normalCount: 0,
        totalScans: 0,
        criticalCount: 0
    }
};

// Severity levels
const severityLevels = ['CRITICAL', 'HIGH', 'MODERATE', 'LOW'];

// Recommendations based on severity
const recommendations = {
    CRITICAL: [
        { action: 'Activate emergency cooling now (sprinklers + fans at 100%)', icon: 'droplets', type: 'urgent', category: 'Suggested Action', tip: 'Start cooling within 1–3 minutes while confirming affected birds on-site.' },
        { action: 'Move high-temperature ducks to shaded recovery pen within 3 minutes', icon: 'move', type: 'urgent', category: 'Suggested Action', tip: 'Prioritize ducks with the highest thermal readings and visible distress.' },
        { action: 'Start intensive rehydration: cool clean water at multiple access points', icon: 'glass-water', type: 'urgent', category: 'Prevention', tip: 'Ensure water is cool—not cold enough to shock—and reachable from every zone.' },
        { action: 'Apply misting cycles every 2-3 minutes until surface temperature drops below 41.0°C', icon: 'cloud-rain', type: 'urgent', category: 'Environmental', tip: 'Pair misting with ventilation so humidity does not trap additional heat.' },
        { action: 'Escalate to veterinarian if severe signs persist for more than 10 minutes', icon: 'phone', type: 'urgent', category: 'Temperature', tip: 'Document surface temperatures and intervention times for veterinary review.' },
    ],
    HIGH: [
        { action: 'Run cooling fans at high speed and open all airflow panels', icon: 'fan', type: 'warning', category: 'Environmental', tip: 'Target stagnant zones where humidity and temperature combine to reduce evaporative cooling.' },
        { action: 'Replace drinking water now and recheck trough temperature every 20 minutes', icon: 'glass-water', type: 'warning', category: 'Prevention', tip: 'Warm water discourages drinking—increasing dehydration risk during heat events.' },
        { action: 'Separate crowded groups in the hottest zone to reduce heat load', icon: 'minimize-2', type: 'warning', category: 'Suggested Action', tip: 'Reduce collective body heat and improve access to cooler resting areas.' },
        { action: 'Inspect at-risk ducks every 10 minutes for panting, wing spread, or lethargy', icon: 'eye', type: 'warning', category: 'Temperature', tip: 'Cross-check thermal hotspots with RGB behavior cues before escalating.' },
        { action: 'Pause stressful handling and feeding activity until ambient temperature improves', icon: 'pause-circle', type: 'warning', category: 'Prevention', tip: 'Minimize additional metabolic heat from movement and digestion.' },
    ],
    MODERATE: [
        { action: 'Shift feeding to early morning or late afternoon to avoid peak heat', icon: 'clock', type: 'caution', category: 'Prevention', tip: 'Digestion raises body temperature—schedule feeds outside the hottest hours.' },
        { action: 'Confirm all drinkers are clean, flowing, and reachable from every section', icon: 'glass-water', type: 'caution', category: 'Prevention', tip: 'Blocked or distant drinkers are a common hidden cause of heat stress.' },
        { action: 'Deploy temporary shade and reduce direct sun exposure in open areas', icon: 'tent', type: 'caution', category: 'Environmental', tip: 'Shade can lower effective temperature by several degrees in exposed pens.' },
        { action: 'Track temperature and humidity trends every 15 minutes for early escalation', icon: 'activity', type: 'caution', category: 'Environmental', tip: 'Rising humidity with stable temperature still increases heat index risk.' },
        { action: 'Pre-stage cooling equipment so response is immediate if readings rise', icon: 'shield', type: 'caution', category: 'Suggested Action', tip: 'Fans, hoses, and staff assignments should be ready before conditions worsen.' },
    ],
    LOW: [
        { action: 'Continue routine monitoring and keep automated alerts enabled', icon: 'check-circle', type: 'info', category: 'Suggested Action', tip: 'Consistent monitoring catches sudden weather spikes between scheduled checks.' },
        { action: 'Maintain baseline ventilation and verify fan operation once per shift', icon: 'wind', type: 'info', category: 'Environmental', tip: 'Confirm airflow direction moves hot air out rather than recirculating it.' },
        { action: 'Log sensor and behavior data for daily heat-risk trend review', icon: 'file-text', type: 'info', category: 'Temperature', tip: 'Compare today\'s readings with the same time yesterday for early pattern detection.' },
        { action: 'Perform preventive check of water supply and backup cooling systems', icon: 'settings', type: 'info', category: 'Prevention', tip: 'Test backup systems before they are needed during an emergency heat event.' },
    ]
};

const REC_TYPE_CLASS = {
    urgent: 'ht-rec-card ht-rec-card--urgent',
    warning: 'ht-rec-card ht-rec-card--warning',
    caution: 'ht-rec-card ht-rec-card--caution',
    info: 'ht-rec-card ht-rec-card--info',
};

// Map severity levels to recommendation card CSS classes for consistent UI color uniformity
const REC_SEVERITY_CLASS = {
    CRITICAL: 'ht-rec-card ht-rec-card--critical',
    HIGH: 'ht-rec-card ht-rec-card--high',
    MODERATE: 'ht-rec-card ht-rec-card--moderate',
    LOW: 'ht-rec-card ht-rec-card--low',
};

function getRecCategoryLabel(rec) {
    return rec.category || 'Suggested Action';
}

function getRecTip(rec) {
    if (rec.tip) return rec.tip;
    const tips = {
        CRITICAL: 'Treat as highest priority—confirm on-site and recheck within 3 minutes.',
        HIGH: 'Apply cooling steps now and reassess barn conditions within 10 minutes.',
        MODERATE: 'Preventive measures recommended—monitor trends every 15 minutes.',
        LOW: 'Conditions are stable—maintain routine checks and alert readiness.',
    };
    return tips[rec.severity] || tips.MODERATE;
}

// ============================================
// INITIALIZATION
// ============================================
function initSystem() {
    updateTime();
    intervals.clock = setInterval(updateTime, 1000);

    // Update stats
    updateStats();
    updateSensorReadings();
    initCharts();
    if (isMonitorRoute()) {
        requestAnimationFrame(() => {
            if (typeof envChart !== 'undefined' && envChart) envChart.resize();
            if (typeof detectionChart !== 'undefined' && detectionChart) detectionChart.resize();
            if (typeof severityChart !== 'undefined' && severityChart) severityChart.resize();
        });
    }
    renderDetectionLogs();
    renderLiveDetections();
    renderRecommendations();
    renderAlerts();
    drawAnnotations();

    setAppDates();

    // Event listeners
    setupEventListeners();

    // Camera feeds are driven by live-feed.js, so local webcam detection
    // (enumerateDevices) is intentionally not run here. If you ever need the
    // "No camera connected" overlay to follow <img>/<video> changes automatically,
    // call observeMonitorMediaChanges() here.
}

// ============================================
// HASH ROUTER (Home, Live, Analytics, Insights)
// ============================================
const MONITOR_ROUTES = ['live', 'analytics', 'insights'];

function isMonitorRoute() {
    return MONITOR_ROUTES.includes(currentView);
}

function normalizeRoute(route) {
    if (route === 'dashboard') return 'live';
    if (MONITOR_ROUTES.includes(route) || route === 'home' || route === 'about' || route === 'faq' || route === 'profile') return route;
    return 'home';
}

const ABOUT_SECTION_HASHES = new Set([
    '#about-howto',
    '#about-guide',
    '#about-features',
    '#about-rec',
]);

const ABOUT_NAV_SECTIONS = [
    { id: 'about-howto', hash: '#about-howto' },
    { id: 'about-guide', hash: '#about-guide' },
    { id: 'about-features', hash: '#about-features' },
    { id: 'about-rec', hash: '#about-rec' },
];

let aboutNavScrollPending = false;

function getRouteFromHash() {
    const h = (location.hash || '').toLowerCase();
    if (h === '#live' || h === '#dashboard') return 'live';
    if (h === '#analytics') return 'analytics';
    if (h === '#insights') return 'insights';
    if (h === '#faq' || h === '#about-faq') return 'faq'; // old #about-faq links still work
    if (h === '#about' || ABOUT_SECTION_HASHES.has(h) || h.startsWith('#about-')) return 'about';
    if (h === '#home-guide') return 'home';
    if (h === '#profile') return 'profile';
    if (h === '#home') return 'home';
    return 'home';
}

function getAboutAnchorId() {
    const h = (location.hash || '').toLowerCase();
    if (ABOUT_SECTION_HASHES.has(h) || (h.startsWith('#about-') && h !== '#about')) {
        return h.slice(1);
    }
    return null;
}

function getAboutNavOffset() {
    const topnav = document.querySelector('.ht-topnav');
    const aboutNav = document.querySelector('.ht-about-nav');
    return (topnav?.offsetHeight || 64) + (aboutNav?.offsetHeight || 52) + 20;
}

function setActiveAboutNavLink(hash) {
    const targetHash = (hash || '').toLowerCase();
    document.querySelectorAll('.ht-about-nav__link').forEach((link) => {
        const href = (link.getAttribute('href') || '').toLowerCase();
        const isActive = href === targetHash;
        link.classList.toggle('ht-about-nav__link--active', isActive);
        link.setAttribute('aria-current', isActive ? 'location' : 'false');
        if (isActive) {
            link.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
        }
    });
}

function clearAboutNavActive() {
    document.querySelectorAll('.ht-about-nav__link').forEach((link) => {
        link.classList.remove('ht-about-nav__link--active');
        link.setAttribute('aria-current', 'false');
    });
}

function updateAboutNavActive() {
    if (currentView !== 'about') return;

    const scrollPos = window.scrollY + getAboutNavOffset();
    let activeHash = ABOUT_NAV_SECTIONS[0].hash;

    for (const section of ABOUT_NAV_SECTIONS) {
        const el = document.getElementById(section.id);
        if (!el) continue;
        const sectionTop = el.getBoundingClientRect().top + window.scrollY;
        if (sectionTop <= scrollPos) {
            activeHash = section.hash;
        }
    }

    setActiveAboutNavLink(activeHash);
}

function onAboutPageScroll() {
    if (currentView !== 'about') return;
    if (aboutNavScrollPending) return;
    aboutNavScrollPending = true;
    requestAnimationFrame(() => {
        aboutNavScrollPending = false;
        updateAboutNavActive();
    });
}

function syncDashboardIntervals() {
    const want = isMonitorRoute();
    if (want) {
        if (!intervals.annotations) {
            intervals.annotations = setInterval(updateAnnotations, 3000);
        }
    } else {
        if (intervals.annotations) {
            clearInterval(intervals.annotations);
            intervals.annotations = null;
        }
    }
}

function setAppDates() {
    const s = new Date().toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
    document.querySelectorAll('[data-date-today]').forEach((el) => {
        el.textContent = s;
    });
}

function showView(route) {
    if (window.getSelection) {
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed) {
            selection.removeAllRanges();
        }
    }
    if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
    }

    const viewIds = {
        home: 'view-home',
        about: 'view-about',
        faq: 'view-faq',
        live: 'view-live',
        analytics: 'view-analytics',
        insights: 'view-insights',
        profile: 'view-profile',
    };

    const titles = {
        home: 'HeatTrack — Home',
        about: 'HeatTrack — About',
        faq: 'HeatTrack — Frequently Asked Questions',
        live: 'HeatTrack — Live',
        analytics: 'HeatTrack — Analytics',
        insights: 'HeatTrack — Insights',
        profile: 'HeatTrack — Profile',
    };

    const previousView = currentView;
    currentView = normalizeRoute(route);
    if (previousView === 'live' && currentView !== 'live') {
        const normalCameraContainer = document.getElementById('normalCameraContainer');
        const thermalCameraContainer = document.getElementById('thermalCameraContainer');
        if (normalCameraContainer?.resetZoom) normalCameraContainer.resetZoom();
        if (thermalCameraContainer?.resetZoom) thermalCameraContainer.resetZoom();
    }
    // Leaving Analytics: the chip row starts at its first chip and the period panel is closed next time
    if (previousView === 'analytics' && currentView !== 'analytics') {
        resetLogChipsScroll();
        setLogPeriodPanel(false);
    }
    // Leaving the FAQ: close every open question so it starts collapsed next time
    if (previousView === 'faq' && currentView !== 'faq') {
        document.querySelectorAll('#view-faq details[open]').forEach((item) => { item.open = false; });
    }
    // Opening or leaving Insights: Results & Recommendations starts at the top
    if ((previousView === 'insights') !== (currentView === 'insights')) {
        const recList = document.getElementById('recommendationsList');
        if (recList) recList.scrollTop = 0;
    }

    document.documentElement.classList.remove('initial-dashboard');
    document.documentElement.removeAttribute('data-boot-route');

    Object.entries(viewIds).forEach(([name, id]) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.toggle('u-hidden', name !== currentView);
    });

    document.querySelectorAll('[data-nav]').forEach((el) => {
        const isActive = el.getAttribute('data-nav') === currentView;
        el.classList.toggle('ht-nav__link--active', isActive);
        el.setAttribute('aria-current', isActive ? 'page' : 'false');
    });

    document.title = titles[currentView] || titles.home;
    if (document.body.classList.contains('ht-auth-mode')) {
        document.title = 'HeatTrack — Create Account';
    }

    syncDashboardIntervals();

    if (currentView === 'live') {
        drawAnnotations();
    }

    setAppDates();

    const currentHash = (location.hash || '').toLowerCase();
    const routeHashes = ['#live', '#dashboard', '#analytics', '#insights', '#home', '#about', '#faq', '#profile'];
    const anchorId =
        currentView === 'about'
            ? getAboutAnchorId()
            : currentHash && !routeHashes.includes(currentHash)
              ? currentHash.slice(1)
              : null;

    if (currentView !== 'about') {
        clearAboutNavActive();
    }

    if (anchorId) {
        const target = document.getElementById(anchorId);
        if (target) {
            setActiveAboutNavLink('#' + anchorId);
            requestAnimationFrame(() => {
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                window.setTimeout(updateAboutNavActive, 450);
            });
            lucide.createIcons();
            return;
        }
    }

    if (currentView === 'about') {
        requestAnimationFrame(updateAboutNavActive);
    }

    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;

    requestAnimationFrame(() => {
        window.scrollTo(0, 0);
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
        if (isMonitorRoute()) {
            if (typeof envChart !== 'undefined' && envChart) envChart.resize();
            if (typeof detectionChart !== 'undefined' && detectionChart) detectionChart.resize();
            if (typeof severityChart !== 'undefined' && severityChart) severityChart.resize();
        }
    });

    lucide.createIcons();
}

function initAboutNav() {
    document.querySelectorAll('.ht-about-nav__link').forEach((link) => {
        link.addEventListener('click', (e) => {
            const href = (link.getAttribute('href') || '').trim();
            if (!href.startsWith('#')) return;
            e.preventDefault();
            const hash = href.toLowerCase();
            setActiveAboutNavLink(hash);
            if ((location.hash || '').toLowerCase() !== hash) {
                location.hash = hash;
            } else {
                showView('about');
            }
        });
    });

    window.addEventListener('scroll', onAboutPageScroll, { passive: true });
}

function initRouter() {
    window.addEventListener('hashchange', () => showView(getRouteFromHash()));
    initAboutNav();
    showView(getRouteFromHash());
}

// ============================================
// TIME & UTILITIES
// ============================================
function updateTime() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', {
        hour12: true,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    const timeEl = document.getElementById('liveTime');
    if (timeEl) timeEl.textContent = timeStr;
    const adminTimeEl = document.getElementById('adminLiveTime');
    if (adminTimeEl) adminTimeEl.textContent = timeStr;

    if (currentView !== 'live') return;

    const tsEls = ['normalTimestamp', 'thermalTimestamp'];
    tsEls.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = now.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
    });

    // Frame rates measured by the logger (set by livefeed.js); "--" when the
    // logger hasn't answered in the last 5 seconds
    const feed = window.liveFeedInfo;
    const feedFresh = feed && Date.now() - feed.at < 5000;
    const fpsText = (value) => (feedFresh && value ? `${value.toFixed(1)} FPS` : '-- FPS');
    const fpsValues = { normalFps: feed?.videoFps, thermalFps: feed?.thermalFps };
    Object.entries(fpsValues).forEach(([id, value]) => {
        const el = document.getElementById(id);
        if (el) el.textContent = fpsText(value);
    });
}

function formatTimestamp(date) {
    // Full date with year and 12-hour time, e.g. "October 9, 2026, 2:05:30 PM"
    return date.toLocaleString('en-US', {
        month: 'long', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit', second: '2-digit',
        hour12: true
    });
}

// 'yyyy-mm-dd' -> that day in local time (new Date('yyyy-mm-dd') would read it as UTC)
function parseDateInput(value, endOfDay = false) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
    if (!m) return null;
    const parsed = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (Number.isNaN(parsed.getTime())) return null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (parsed > today) return null;

    if (endOfDay) {
        parsed.setHours(23, 59, 59, 999);
    } else {
        parsed.setHours(0, 0, 0, 0);
    }
    return parsed;
}

// Date -> 'yyyy-mm-dd' in local time
function dateInputValue(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Period of the Detection Log: 'all' | 'today' | 'last7' | 'last30' (quick ranges)
// or 'custom' (the From / To dates in the period picker)
function getLogDateBounds() {
    const range = state.logPeriod;
    const now = new Date();
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    let start = null;

    if (range === 'all') {
        return { start: null, end: null };
    }

    if (range === 'today') {
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
        return { start, end };
    }

    if (range === 'last7') {
        start = new Date(end);
        start.setDate(start.getDate() - 6);
        start.setHours(0, 0, 0, 0);
    } else if (range === 'last30') {
        start = new Date(end);
        start.setDate(start.getDate() - 29);
        start.setHours(0, 0, 0, 0);
    } else if (range === 'custom') {
        const startVal = document.getElementById('logCustomStart')?.value;
        const endVal = document.getElementById('logCustomEnd')?.value;
        let parsedStart = parseDateInput(startVal);
        let parsedEnd = parseDateInput(endVal, true);
        if (parsedStart && parsedEnd) {
            // Dates picked the wrong way round: use them as earliest -> latest
            if (parsedStart > parsedEnd) {
                [parsedStart, parsedEnd] = [parseDateInput(endVal), parseDateInput(startVal, true)];
            }
            return { start: parsedStart, end: parsedEnd };
        }
        if (parsedStart) {
            start = parsedStart;
            return { start, end };
        }
        if (parsedEnd) {
            return { start: new Date(0), end: parsedEnd };
        }
    }

    return { start, end };
}

const LOG_PERIOD_NAMES = { all: 'All time', today: 'Today', last7: 'Last 7 days', last30: 'Last 30 days' };

// Text on the period button (and in the Excel header), e.g. 'Last 7 days' or 'Oct 1 – Oct 18, 2026'
function logPeriodLabel() {
    if (state.logPeriod !== 'custom') return LOG_PERIOD_NAMES[state.logPeriod] || LOG_PERIOD_NAMES.all;
    const { start, end } = getLogDateBounds();
    const day = (d, year = true) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}) });
    const hasStart = start && start.getTime() > 0;
    const startPicked = !!document.getElementById('logCustomStart')?.value;
    const endPicked = !!document.getElementById('logCustomEnd')?.value;
    if (hasStart && startPicked && endPicked) {
        if (day(start) === day(end)) return day(start);
        return start.getFullYear() === end.getFullYear() ? `${day(start, false)} – ${day(end)}` : `${day(start)} – ${day(end)}`;
    }
    if (hasStart && startPicked) return `From ${day(start)}`;
    if (endPicked) return `Until ${day(end)}`;
    return LOG_PERIOD_NAMES.all;
}

// Button text + which quick range is highlighted
function renderLogPeriod() {
    const text = logPeriodLabel();
    const filtered = text !== LOG_PERIOD_NAMES.all;
    const label = document.getElementById('logPeriodLabel');
    if (label) label.textContent = text;
    // Chip in the filter bar only while a period is on
    const chip = document.getElementById('logPeriodChip');
    if (chip) chip.hidden = !filtered;
    // Calendar icon: dot while a period is on, the period in its tooltip and label
    const btn = document.getElementById('logPeriodBtn');
    if (btn) {
        btn.classList.toggle('has-period', filtered);
        btn.title = `Period: ${text}`;
        btn.setAttribute('aria-label', `Choose a period (${text})`);
    }
    document.querySelectorAll('[data-log-period]').forEach((btn) => {
        const active = btn.dataset.logPeriod === state.logPeriod;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-pressed', String(active));
    });
}

function setLogPeriodPanel(open) {
    const panel = document.getElementById('logPeriodPanel');
    const btn = document.getElementById('logPeriodBtn');
    if (!panel || !btn) return;
    // Opening shows the month of the picked range (or this month); a start date
    // picked without an end date is dropped when the panel closes
    if (open !== panel.classList.contains('is-open')) {
        logCal.pendingStart = null;
        logCal.hover = null;
        if (open) {
            logCal.month = null;
            logCal.view = 'days';
        }
        renderLogCalendar();
    }
    if (open) positionLogPeriodPanel();
    // A class (not [hidden]) so the panel can fade in and out
    panel.classList.toggle('is-open', open);
    btn.setAttribute('aria-expanded', String(open));
    btn.classList.toggle('is-active', open);
}

// Places the (fixed) panel under the calendar button: lined up with its left edge,
// or its right edge on phones, always inside the screen. If there isn't room below
// but there is more above, it opens upward. It scrolls inside when it still doesn't fit.
function positionLogPeriodPanel() {
    const panel = document.getElementById('logPeriodPanel');
    const btn = document.getElementById('logPeriodBtn');
    if (!panel || !btn) return;
    const gap = 6;
    const margin = 8;
    const r = btn.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const width = panel.offsetWidth;
    let left = vw <= 640 ? r.right - width : r.left;
    left = Math.max(margin, Math.min(left, vw - width - margin));

    panel.style.maxHeight = '';
    const needed = panel.scrollHeight;
    const below = vh - r.bottom - gap - margin;
    const above = r.top - gap - margin;
    const upward = needed > below && above > below;
    const room = Math.max(upward ? above : below, 160);
    const height = Math.min(needed, room);
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(upward ? r.top - gap - height : r.bottom + gap)}px`;
    panel.style.maxHeight = `${Math.floor(room)}px`;
    panel.style.transformOrigin = `${upward ? 'bottom' : 'top'} ${vw <= 640 ? 'right' : 'left'}`;
}

const logPeriodPanelOpen = () => !!document.getElementById('logPeriodPanel')?.classList.contains('is-open');

// Sets a quick range (clears any picked dates) and redraws the log
function applyLogPeriod(period) {
    state.logPeriod = period;
    clearLogDateInput(document.getElementById('logCustomStart'));
    clearLogDateInput(document.getElementById('logCustomEnd'));
    logCal.pendingStart = null;
    state.currentPage = 1;
    renderLogPeriod();
    renderLogCalendar();
    renderDetectionLogs();
}

// Chip row back to its first chip (it scrolls sideways on narrow screens)
function resetLogChipsScroll(smooth = false) {
    const chips = document.getElementById('logFilterChips');
    if (!chips) return;
    if (smooth && typeof chips.scrollTo === 'function') chips.scrollTo({ left: 0, behavior: 'smooth' });
    else chips.scrollLeft = 0;
}

// Empties the picked start or end date
function clearLogDateInput(input) {
    if (input) input.value = '';
}

// ---- Range calendar (Pick dates) ----
// First click picks the start day, the second the end day (either order; the same
// day twice = that one day). The log updates once both are picked and the panel
// closes. Days after today can't be picked. Arrow keys move between days.
// The month title opens a month picker; its year title opens a year picker
// (12 years at a time), so far-off dates are a few clicks away.
// view: 'days' | 'months' | 'years'; yearEnd: last year shown in the year picker
const logCal = { month: null, pendingStart: null, hover: null, view: 'days', yearEnd: null };
const CAL_WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const CAL_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// First day of that month, but never past this month
function calClampMonth(year, month) {
    const today = calToday();
    const first = new Date(year, month, 1);
    return first > today ? new Date(today.getFullYear(), today.getMonth(), 1) : first;
}

const calToday = () => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; };
// A day button's 'yyyy-mm-dd' -> local midnight (future days too, unlike parseDateInput)
const calDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
const calDayLabel = (d) => d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

// The range to highlight: start picked and waiting for the end (follows the
// pointer), otherwise the range in use
function calRange() {
    if (logCal.pendingStart) {
        const other = logCal.hover || logCal.pendingStart;
        return other < logCal.pendingStart ? [other, logCal.pendingStart] : [logCal.pendingStart, other];
    }
    if (state.logPeriod !== 'custom') return [null, null];
    const from = parseDateInput(document.getElementById('logCustomStart')?.value);
    const to = parseDateInput(document.getElementById('logCustomEnd')?.value);
    return [from || to, to || from];
}

function renderLogCalendar(focusDay) {
    const box = document.getElementById('logCalendar');
    if (!box) return;
    const today = calToday();
    if (!logCal.month) {
        const [from] = calRange();
        const shown = from || today;
        logCal.month = new Date(shown.getFullYear(), shown.getMonth(), 1);
    }
    const year = logCal.month.getFullYear();
    const month = logCal.month.getMonth();
    const thisYear = today.getFullYear();
    const thisMonth = today.getMonth();
    const view = logCal.view;

    // Header (arrows step by a month, a year or 12 years) and body for the view
    let title, body, nextDisabled, prevLabel, nextLabel;
    if (view === 'years') {
        const end = logCal.yearEnd;
        const years = Array.from({ length: 12 }, (_, i) => end - 11 + i);
        title = `<span class="ht-cal__title" aria-live="polite">${end - 11} – ${end}</span>`;
        body = `<div class="ht-cal__picks" role="group" aria-label="Years">${years.map((y) => `
            <button type="button" class="ht-cal__pick${y === year ? ' is-selected' : ''}${y === thisYear ? ' is-today' : ''}"
                data-cal-year="${y}" aria-pressed="${y === year}"${y > thisYear ? ' disabled' : ''}>${y}</button>`).join('')}</div>`;
        nextDisabled = end >= thisYear;
        [prevLabel, nextLabel] = ['Earlier years', 'Later years'];
    } else if (view === 'months') {
        title = `<button type="button" class="ht-cal__title ht-cal__title--btn" data-cal-view="years" aria-live="polite"
            aria-label="${year}, choose a year">${year}<i data-lucide="chevron-down"></i></button>`;
        body = `<div class="ht-cal__picks" role="group" aria-label="Months of ${year}">${CAL_MONTHS.map((name, m) => {
            const future = year > thisYear || (year === thisYear && m > thisMonth);
            return `<button type="button" class="ht-cal__pick${m === month ? ' is-selected' : ''}${year === thisYear && m === thisMonth ? ' is-today' : ''}"
                data-cal-month="${m}" aria-pressed="${m === month}"${future ? ' disabled' : ''}>${name}</button>`;
        }).join('')}</div>`;
        nextDisabled = year >= thisYear;
        [prevLabel, nextLabel] = ['Previous year', 'Next year'];
    } else {
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const lead = new Date(year, month, 1).getDay();
        let days = '';
        for (let i = 0; i < lead; i++) days += '<span class="ht-cal__blank" aria-hidden="true"></span>';
        for (let d = 1; d <= daysInMonth; d++) {
            const date = new Date(year, month, d);
            const future = date > today;
            days += `<button type="button" class="ht-cal__day${date.getTime() === today.getTime() ? ' is-today' : ''}"
                data-cal-day="${dateInputValue(date)}" aria-label="${calDayLabel(date)}"${future ? ' disabled' : ''}>${d}</button>`;
        }
        const monthName = logCal.month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        title = `<button type="button" class="ht-cal__title ht-cal__title--btn" data-cal-view="months" aria-live="polite"
            aria-label="${monthName}, choose a month or year">${monthName}<i data-lucide="chevron-down"></i></button>`;
        body = `<div class="ht-cal__grid" role="group" aria-label="Days">
            ${CAL_WEEKDAYS.map((w) => `<span class="ht-cal__weekday" aria-hidden="true">${w}</span>`).join('')}
            ${days}
        </div>`;
        nextDisabled = year === thisYear && month === thisMonth;
        [prevLabel, nextLabel] = ['Previous month', 'Next month'];
    }

    const pending = !!logCal.pendingStart;
    const [from] = calRange();
    const hint = pending ? 'Now pick the end date'
        : from ? logPeriodLabel()
        : 'Pick a start date';
    box.innerHTML = `
        <div class="ht-cal__head">
            <button type="button" class="ht-cal__nav" data-cal-nav="-1" aria-label="${prevLabel}"><i data-lucide="chevron-left"></i></button>
            ${title}
            <button type="button" class="ht-cal__nav" data-cal-nav="1" aria-label="${nextLabel}"${nextDisabled ? ' disabled' : ''}><i data-lucide="chevron-right"></i></button>
        </div>
        ${body}
        <div class="ht-cal__foot">
            <span class="ht-cal__hint${pending ? ' is-pending' : ''}">${hint}</span>
            ${pending || from ? '<button type="button" class="ht-linkbtn" data-cal-clear>Clear</button>' : ''}
        </div>`;
    paintLogCalendarRange();
    if (window.lucide) lucide.createIcons();
    // A month with 6 week rows is taller: re-fit the open panel
    if (logPeriodPanelOpen()) positionLogPeriodPanel();
    if (focusDay) box.querySelector(`[data-cal-day="${dateInputValue(focusDay)}"]`)?.focus();
}

// Range colours only (no redraw), so hovering while picking the end stays smooth
function paintLogCalendarRange() {
    const [from, to] = calRange();
    document.querySelectorAll('#logCalendar [data-cal-day]').forEach((btn) => {
        const t = calDate(btn.dataset.calDay).getTime();
        const isStart = !!from && t === from.getTime();
        const isEnd = !!to && t === to.getTime();
        btn.classList.toggle('is-start', isStart);
        btn.classList.toggle('is-end', isEnd);
        btn.classList.toggle('is-in-range', !!from && !!to && t > from.getTime() && t < to.getTime());
        btn.setAttribute('aria-pressed', String(isStart || isEnd));
    });
}

function pickLogCalendarDay(date) {
    if (!logCal.pendingStart) {
        logCal.pendingStart = date;
        logCal.hover = null;
        renderLogCalendar(date);
        return;
    }
    let [from, to] = [logCal.pendingStart, date];
    if (to < from) [from, to] = [to, from];
    document.getElementById('logCustomStart').value = dateInputValue(from);
    document.getElementById('logCustomEnd').value = dateInputValue(to);
    logCal.pendingStart = null;
    logCal.hover = null;
    state.logPeriod = 'custom';
    state.currentPage = 1;
    renderLogPeriod();
    renderDetectionLogs();
    setLogPeriodPanel(false);
}

function initLogCalendar() {
    const box = document.getElementById('logCalendar');
    if (!box) return;
    // Redraws in another view and keeps keyboard focus in the calendar
    const showView = (view) => {
        logCal.view = view;
        renderLogCalendar();
        (box.querySelector('.ht-cal__pick.is-selected:not(:disabled)')
            || box.querySelector('.ht-cal__title--btn')
            || box.querySelector('.ht-cal__day:not(:disabled)'))?.focus();
    };
    box.addEventListener('click', (e) => {
        const nav = e.target.closest('[data-cal-nav]');
        if (nav && !nav.disabled) {
            const step = Number(nav.dataset.calNav);
            if (logCal.view === 'years') {
                logCal.yearEnd = Math.min(logCal.yearEnd + step * 12, calToday().getFullYear());
            } else if (logCal.view === 'months') {
                logCal.month = calClampMonth(logCal.month.getFullYear() + step, logCal.month.getMonth());
            } else {
                logCal.month = new Date(logCal.month.getFullYear(), logCal.month.getMonth() + step, 1);
            }
            renderLogCalendar();
            box.querySelector(`[data-cal-nav="${nav.dataset.calNav}"]:not(:disabled)`)?.focus();
            return;
        }
        // Month title -> month picker; year title -> year picker (12 years, ending
        // at this year or the block that holds the shown year)
        const viewBtn = e.target.closest('[data-cal-view]');
        if (viewBtn) {
            if (viewBtn.dataset.calView === 'years') {
                const thisYear = calToday().getFullYear();
                logCal.yearEnd = thisYear - Math.floor((thisYear - logCal.month.getFullYear()) / 12) * 12;
            }
            showView(viewBtn.dataset.calView);
            return;
        }
        const yearBtn = e.target.closest('[data-cal-year]');
        if (yearBtn && !yearBtn.disabled) {
            logCal.month = calClampMonth(Number(yearBtn.dataset.calYear), logCal.month.getMonth());
            showView('months');
            return;
        }
        const monthBtn = e.target.closest('[data-cal-month]');
        if (monthBtn && !monthBtn.disabled) {
            logCal.month = new Date(logCal.month.getFullYear(), Number(monthBtn.dataset.calMonth), 1);
            showView('days');
            return;
        }
        if (e.target.closest('[data-cal-clear]')) {
            if (logCal.pendingStart) {
                logCal.pendingStart = null;   // drops only the half-picked range; the period in use stays
                renderLogCalendar();
            } else {
                applyLogPeriod('all');
            }
            return;
        }
        const day = e.target.closest('[data-cal-day]');
        if (day && !day.disabled) pickLogCalendarDay(calDate(day.dataset.calDay));
    });
    // While picking the end date, the range follows the pointer / keyboard focus
    const follow = (e) => {
        const day = e.target.closest?.('[data-cal-day]');
        if (!logCal.pendingStart || !day || day.disabled) return;
        const date = calDate(day.dataset.calDay);
        if (logCal.hover && logCal.hover.getTime() === date.getTime()) return;
        logCal.hover = date;
        paintLogCalendarRange();
    };
    box.addEventListener('mouseover', follow);
    box.addEventListener('focusin', follow);
    box.addEventListener('keydown', (e) => {
        // Escape in the month / year picker steps back toward the days (instead of closing the panel)
        if (e.key === 'Escape' && logCal.view !== 'days') {
            e.preventDefault();
            e.stopPropagation();
            showView(logCal.view === 'years' ? 'months' : 'days');
            return;
        }
        const day = e.target.closest('[data-cal-day]');
        const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
        if (!day || !step) return;
        e.preventDefault();
        const next = calDate(day.dataset.calDay);
        next.setDate(next.getDate() + step);
        if (next > calToday()) return;
        if (next.getMonth() !== logCal.month.getMonth() || next.getFullYear() !== logCal.month.getFullYear()) {
            logCal.month = new Date(next.getFullYear(), next.getMonth(), 1);
            renderLogCalendar(next);
        } else {
            box.querySelector(`[data-cal-day="${dateInputValue(next)}"]`)?.focus();
        }
    });
    renderLogCalendar();
}

function initLogPeriod() {
    const btn = document.getElementById('logPeriodBtn');
    const panel = document.getElementById('logPeriodPanel');
    if (!btn || !panel) return;

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        setLogPeriodPanel(!logPeriodPanelOpen());
    });
    // Clicks inside the panel (dates, quick ranges) don't count as "outside"
    panel.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => setLogPeriodPanel(false));
    // The panel is fixed to the screen: keep it under the button while the page
    // scrolls or resizes (scroll inside the panel itself doesn't move it)
    const follow = (e) => {
        if (!logPeriodPanelOpen() || panel.contains(e.target)) return;
        positionLogPeriodPanel();
    };
    window.addEventListener('scroll', follow, { capture: true, passive: true });
    window.addEventListener('resize', follow);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && logPeriodPanelOpen()) {
            setLogPeriodPanel(false);
            btn.focus();
        }
    });

    // Quick range: replaces any picked dates and closes the panel
    panel.querySelectorAll('[data-log-period]').forEach((preset) => {
        preset.addEventListener('click', () => {
            applyLogPeriod(preset.dataset.logPeriod);
            setLogPeriodPanel(false);
        });
    });
    // x on the period chip: back to All time
    document.querySelector('[data-log-period-clear]')?.addEventListener('click', () => applyLogPeriod('all'));
    initLogCalendar();
    renderLogPeriod();
}

async function toggleFullscreen(element) {
    if (!element || !document.fullscreenEnabled) return;
    if (element.classList.contains('camera-feed--offline') || !state.cameraActive) return;
    try {
        if (document.fullscreenElement === element) {
            await document.exitFullscreen();
        } else if (!document.fullscreenElement) {
            await element.requestFullscreen();
        }
    } catch (error) {
        console.error('Fullscreen toggle failed:', error);
    }
}

function syncCameraZoomCursor(container) {
    if (!container) return;
    const isFull = document.fullscreenElement === container;
    const isOffline = container.classList.contains('camera-feed--offline') || !state.cameraActive;
    container.classList.toggle('camera-feed--fullscreen', isFull);
    container.title = isFull
        ? 'Click to exit fullscreen'
        : isOffline
            ? 'Camera streams are off'
            : 'Click to expand fullscreen';
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function initWheelZoom(container) {
    if (!container) return;
    const layer = container.querySelector('.camera-zoom-layer');
    if (!layer) return;

    const zoom = {
        scale: 1,
        min: 1,
        max: 3.5,
        x: 0,
        y: 0,
        isPanning: false,
        panStartX: 0,
        panStartY: 0,
        originX: 0,
        originY: 0,
    };
    const drag = {
        downX: 0,
        downY: 0,
        moved: false,
        suppressClickUntil: 0,
    };
    let rafPending = false;

    function clampPan() {
        const rect = container.getBoundingClientRect();
        const w = rect.width || 0;
        const h = rect.height || 0;
        if (!w || !h) return;

        // With transform-origin: 0 0 and transform: translate(x,y) scale(s)
        // Keep the scaled layer covering the container:
        // x ∈ [w - w*s, 0], y ∈ [h - h*s, 0]
        const minX = w - w * zoom.scale;
        const minY = h - h * zoom.scale;
        zoom.x = clamp(zoom.x, minX, 0);
        zoom.y = clamp(zoom.y, minY, 0);
    }

    function applyNow() {
        clampPan();
        layer.style.transform = `translate3d(${zoom.x}px, ${zoom.y}px, 0) scale(${zoom.scale})`;
        const zoomed = zoom.scale > 1.001;
        container.classList.toggle('camera-zooming', zoomed);
        container.classList.toggle('is-panning', zoom.isPanning);
    }

    function apply() {
        if (rafPending) return;
        rafPending = true;
        requestAnimationFrame(() => {
            rafPending = false;
            applyNow();
        });
    }

    function reset() {
        zoom.scale = 1;
        zoom.x = 0;
        zoom.y = 0;
        zoom.isPanning = false;
        applyNow();
    }

    // Expose a reset helper so navigation can restore camera zoom.
    container.resetZoom = reset;

    function getPoint(e) {
        const rect = container.getBoundingClientRect();
        return {
            cx: e.clientX - rect.left,
            cy: e.clientY - rect.top
        };
    }

    container.addEventListener('dblclick', (e) => {
        e.preventDefault();
        reset();
    });

    // If user dragged (pan attempt), suppress the click that would toggle fullscreen
    container.addEventListener('click', (e) => {
        if (Date.now() < drag.suppressClickUntil) {
            e.preventDefault();
            e.stopImmediatePropagation();
        }
    }, true);

    container.addEventListener('wheel', (e) => {
        // allow page scroll if not hovering the camera
        e.preventDefault();

        const { cx, cy } = getPoint(e);
        const oldScale = zoom.scale;
        const delta = -e.deltaY;
        const zoomFactor = delta > 0 ? 1.12 : 1 / 1.12;
        const newScale = clamp(oldScale * zoomFactor, zoom.min, zoom.max);
        if (Math.abs(newScale - oldScale) < 0.0001) return;

        // Zoom towards cursor: keep (cx,cy) stable in screen space
        const scaleRatio = newScale / oldScale;
        zoom.x = cx - (cx - zoom.x) * scaleRatio;
        zoom.y = cy - (cy - zoom.y) * scaleRatio;
        zoom.scale = newScale;

        // If returning to 1x, snap to origin
        if (zoom.scale <= 1.001) {
            zoom.scale = 1;
            zoom.x = 0;
            zoom.y = 0;
        }

        apply();
    }, { passive: false });

    container.addEventListener('pointerdown', (e) => {
        drag.downX = e.clientX;
        drag.downY = e.clientY;
        drag.moved = false;

        if (zoom.scale <= 1.001) return;
        // Don't start panning when clicking on overlay controls
        if (e.target.closest('button, select, input, a, label')) return;
        zoom.isPanning = true;
        container.setPointerCapture(e.pointerId);
        zoom.panStartX = e.clientX;
        zoom.panStartY = e.clientY;
        zoom.originX = zoom.x;
        zoom.originY = zoom.y;
        applyNow();
    });

    container.addEventListener('pointermove', (e) => {
        const dx = e.clientX - drag.downX;
        const dy = e.clientY - drag.downY;
        if (!drag.moved && (dx * dx + dy * dy) > (6 * 6)) {
            drag.moved = true;
        }
        if (!zoom.isPanning) return;
        zoom.x = zoom.originX + (e.clientX - zoom.panStartX);
        zoom.y = zoom.originY + (e.clientY - zoom.panStartY);
        apply();
    });

    // If user dragged (even at 1x), suppress the click-to-fullscreen.
    container.addEventListener('pointerup', () => {
        if (drag.moved) drag.suppressClickUntil = Date.now() + 250;
    });

    function endPan(e) {
        if (!zoom.isPanning) return;
        zoom.isPanning = false;
        try {
            container.releasePointerCapture(e.pointerId);
        } catch (_) { /* ignore */ }
        apply();
    }

    container.addEventListener('pointerup', endPan);
    container.addEventListener('pointercancel', endPan);
    container.addEventListener('pointerleave', (e) => {
        // only end if pointer isn't captured
        if (!zoom.isPanning) return;
        endPan(e);
    });

    // If fullscreen changes, sizes change; re-clamp pan
    document.addEventListener('fullscreenchange', apply);
    window.addEventListener('resize', apply);

    applyNow();
}

// The recommendation for one result: Gemini's text when it has been generated
// (see requestAiRecommendation), otherwise the guideline text for its severity.
// The icon and card colour always come from the severity.
// Results with the same severity each get a different guideline action
// (picked by the result's id, so a result always shows the same one).
function recommendationFor(detection, severity = detection?.severity || 'MODERATE') {
    const recs = recommendations[severity] || recommendations.MODERATE;
    const variant = Math.abs(Number(detection?.dbId) || 0);
    const base = recs[variant % recs.length] || { action: 'Review detection details and follow farm protocol.', icon: 'clipboard-list', type: 'info' };
    // AI text only belongs to the result's own severity (the check-in can raise the level)
    const ownLevel = !!detection && detection.severity === severity;
    const ai = ownLevel && detection.ai ? detection.ai : null;
    const rec = { ...base, ai, variant, analyticsId: ownLevel ? (detection.dbId ?? null) : null };
    if (ai) {
        rec.action = ai.action || base.action;
        rec.tip = ai.tip || base.tip;
        rec.category = ai.category || base.category;
    }
    return rec;
}

function buildRecommendationFromDetection(detection) {
    const severity = detection?.severity || 'MODERATE';
    return {
        ...recommendationFor(detection, severity),
        id: `toast-${detection.id}`,
        timestamp: formatTimestamp(detection.timestamp),
        severity,
        status: detection.status,
        bodyTemp: detection.bodyTemp,
        ambientTemp: detection.ambientTemp,
        detectionRef: detection,          // to look up its own air temperature if needed
        lowTemp: detection.lowTemp ?? null,
        highTemp: detection.highTemp ?? null,
        duckCount: detection.count ?? null,
        batchCount: detection.batchCount ?? null,
        // The analytics table has no confidence column, so this stays null unless you add one
        confidence: detection.confidence != null ? Math.round(detection.confidence * 100) : null,
        isHeatStress: detection.isHeatStress,
        detectionId: detection.id
    };
}

/**
 * Single source of truth for KPI cards and Detection Snapshot modals.
 * Each analytics row is a batch, so we add up duck_count instead of counting rows.
 */
// Ducks per status (comfort / mild / moderate / severe) and per urgency
// (routine / monitor / urgent / critical)
function getDetectionCounts(detections = summaryDetections()) {
    const counts = { comfort: 0, mild: 0, moderate: 0, severe: 0, routine: 0, monitor: 0, urgent: 0, critical: 0 };
    const statusKey = { COMFORT: 'comfort', MILD: 'mild', MODERATE: 'moderate', SEVERE: 'severe' };
    const urgencyKey = { LOW: 'routine', MODERATE: 'monitor', HIGH: 'urgent', CRITICAL: 'critical' };

    for (const d of detections) {
        const n = d.count ?? 1;
        if (statusKey[d.status]) counts[statusKey[d.status]] += n;
        if (urgencyKey[d.severity]) counts[urgencyKey[d.severity]] += n;
    }
    counts.total = counts.comfort + counts.mild + counts.moderate + counts.severe;
    return counts;
}

// KPI cards: one per status (element ids kept from the older 3-status cards)
function applyDetectionCountsToStats(counts = getDetectionCounts()) {
    state.stats.normalCount = counts.comfort;
    state.stats.mildCount = counts.mild;
    state.stats.stressCount = counts.moderate;
    state.stats.criticalCount = counts.severe;

    const set = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = n; };
    set('normalCount', counts.comfort);
    set('mildCount', counts.mild);
    set('stressCount', counts.moderate);
    set('criticalCount', counts.severe);
}

// ============================================
// SENSOR READINGS
// ============================================
function updateSensorReadings(temp, humidity) {
    const latestTemp = state.sensorHistory.temp.length > 0 ? state.sensorHistory.temp[state.sensorHistory.temp.length - 1] : null;
    const latestHumidity = state.sensorHistory.humidity.length > 0 ? state.sensorHistory.humidity[state.sensorHistory.humidity.length - 1] : null;
    temp = typeof temp === 'number' ? temp : latestTemp;
    humidity = typeof humidity === 'number' ? humidity : latestHumidity;

    // Temperature
    const tempEl = document.getElementById('tempValue');
    if (tempEl) tempEl.textContent = typeof temp === 'number' ? temp.toFixed(1) : '--';
    const tempPercent = typeof temp === 'number' ? Math.min(100, Math.max(0, ((temp - 20) / 30) * 100)) : 0;
    // Same levels as the check-in alerts, so the bar colour matches the recommendations
    const tempLevel = checkinLevelFromTemp(temp);
    const tempZone = { LOW: ['ok', 'Normal'], MODERATE: ['caution', 'Moderate'], HIGH: ['warn', 'High'], CRITICAL: ['danger', 'Critical'] }[tempLevel];
    setMeter('temp', tempPercent, temp, tempZone);

    // Humidity
    const humidEl = document.getElementById('humidValue');
    if (humidEl) humidEl.textContent = typeof humidity === 'number' ? humidity.toFixed(1) : '--';
    const humidPercent = typeof humidity === 'number' ? Math.min(100, Math.max(0, humidity)) : 0;
    // Above 70% RH the ducks can't cool off well by panting; below 40% the air is dry
    let humidZone = null;
    if (typeof humidity === 'number') {
        if (humidity > 85) humidZone = ['danger', 'Very humid'];
        else if (humidity > 70) humidZone = ['warn', 'Humid'];
        else if (humidity >= 40) humidZone = ['ok', 'Normal'];
        else humidZone = ['caution', 'Dry'];
    }
    setMeter('humid', humidPercent, humidity, humidZone);

    const tempTrendEl = document.getElementById('tempTrend');
    if (tempTrendEl) {
        let tempTrend = null;
        if (state.sensorHistory.temp.length >= 2) {
            const last = state.sensorHistory.temp[state.sensorHistory.temp.length - 1];
            const prev = state.sensorHistory.temp[state.sensorHistory.temp.length - 2];
            if (typeof last === 'number' && typeof prev === 'number') {
                tempTrend = last - prev;
            }
        }
        tempTrendEl.classList.toggle('ht-trend--up', tempTrend > 0);
        tempTrendEl.classList.toggle('ht-trend--down', tempTrend < 0);
        const tempTrendText = tempTrendEl.querySelector('span');
        if (tempTrendText) {
            tempTrendText.textContent = tempTrend === null ? '--' : `${tempTrend >= 0 ? '+' : ''}${tempTrend.toFixed(1)}`;
        }
    }

    const humidTrendEl = document.getElementById('humidTrend');
    if (humidTrendEl) {
        let humidTrend = null;
        if (state.sensorHistory.humidity.length >= 2) {
            const last = state.sensorHistory.humidity[state.sensorHistory.humidity.length - 1];
            const prev = state.sensorHistory.humidity[state.sensorHistory.humidity.length - 2];
            if (typeof last === 'number' && typeof prev === 'number') {
                humidTrend = last - prev;
            }
        }
        humidTrendEl.classList.toggle('ht-trend--up', humidTrend > 0);
        humidTrendEl.classList.toggle('ht-trend--down', humidTrend < 0);
        const humidTrendText = humidTrendEl.querySelector('span');
        if (humidTrendText) {
            humidTrendText.textContent = humidTrend === null ? '--' : `${humidTrend >= 0 ? '+' : ''}${humidTrend.toFixed(1)}`;
        }
    }
    // Update the DHT22 ACTIVE badge visibility after sensor refresh
    updateDHTBadge();
}

// Fills a sensor meter and colours it by zone. zone = [colour key, label] or null when there's no reading.
function setMeter(prefix, percent, value, zone) {
    const meter = document.getElementById(prefix + 'Meter');
    const bar = document.getElementById(prefix + 'Bar');
    const level = document.getElementById(prefix + 'Level');
    const zoneKey = zone ? zone[0] : 'none';
    if (bar) {
        bar.style.width = percent + '%';
        bar.dataset.zone = zoneKey;
    }
    if (level) {
        level.textContent = zone ? zone[1] : '--';
        level.dataset.zone = zoneKey;
    }
    if (meter) {
        if (typeof value === 'number') meter.setAttribute('aria-valuenow', value.toFixed(1));
        else meter.removeAttribute('aria-valuenow');
        meter.setAttribute('aria-valuetext', zone ? zone[1] : 'No reading');
    }
}

// ACTIVE only while the DHT22 is really sending: the logger saves a reading
// about every 10 s, so nothing newer than this means no sensor / not responding
// (same limit as MAX_READING_AGE_SEC in heatstress_logger.py)
const DHT_ACTIVE_MS = 2 * 60 * 1000;

// Toggle the DHT22 badge between ACTIVE and INACTIVE.
function updateDHTBadge() {
    try {
        const tempEl = document.getElementById('tempValue');
        const panel = tempEl ? tempEl.closest('.ht-panel') : null;
        const badge = panel ? panel.querySelector('.ht-rec-indicator') : null;
        if (!badge) return;

        // Old readings in the history don't count: only a recent one from the DHT22
        const sensorPresent = !!state.lastDhtAt && Date.now() - state.lastDhtAt.getTime() <= DHT_ACTIVE_MS;

        // Always show the indicator, but toggle between ACTIVE and INACTIVE states
        const dot = badge.querySelector('.ht-live-dot');
        const label = badge.querySelector('.ht-mono-label');

        // Ensure badge is visible
        badge.style.display = '';

        if (sensorPresent) {
            if (dot) {
                dot.classList.remove('ht-live-dot--inactive');
                dot.classList.add('ht-live-dot--green');
            }
            if (label) {
                label.classList.remove('ht-mono-label--inactive');
                label.classList.add('ht-mono-label--green');
                label.textContent = 'ACTIVE';
            }
        } else {
            if (dot) {
                dot.classList.remove('ht-live-dot--green', 'ht-live-dot--thermal');
                dot.classList.add('ht-live-dot--inactive');
            }
            if (label) {
                label.classList.remove('ht-mono-label--green');
                label.classList.add('ht-mono-label--inactive');
                label.textContent = 'INACTIVE';
            }
        }
    } catch (e) {
        // Fail silently; badge is non-critical.
    }
}

// Re-check every 10 s so the badge turns INACTIVE when readings stop arriving
setInterval(updateDHTBadge, 10000);

// Detection Log entries: first detections and the readings every 30 minutes
// after them (see logEntryLabels)
function logEntryDetections() {
    const rows = summaryDetections();
    const entries = logEntryLabels(rows);
    return rows.filter((d) => entries.has(d.id));
}

// KPI cards count only the 30-minute readings (log entries labelled '30 min',
// every 30 minutes from the first detection); the first detection is not added
function isThirtyMinuteReading(d, entries = logEntryLabels()) {
    return entries.get(d.id) === '30 min';
}

// The 30-minute readings: what the KPI cards and the Severity / Detection
// Distribution charts count
function thirtyMinuteReadings() {
    const rows = summaryDetections();
    const entries = logEntryLabels(rows);
    return rows.filter((d) => isThirtyMinuteReading(d, entries));
}

function updateStats() {
    applyDetectionCountsToStats(getDetectionCounts(thirtyMinuteReadings()));
}

// ============================================
// ANNOTATION DRAWING
// ============================================
function drawAnnotations() {
    updateAnnotations();
}

function updateCameraUI(hasCamera) {
    state.cameraActive = !!hasCamera;
    const cameraToggle = document.getElementById('cameraToggle');
    if (cameraToggle) {
        cameraToggle.checked = !!hasCamera;
        cameraToggle.disabled = !hasCamera;
    }

    const containers = [
        document.getElementById('normalCameraContainer'),
        document.getElementById('thermalCameraContainer')
    ];

    containers.forEach(container => {
        if (!container) return;
        const notice = container.querySelector('.ht-camera__no-camera');
        if (notice) notice.remove();
        container.classList.remove('ht-camera--no-input');
        container.removeAttribute('data-offline-text');
    });

    updateSystemToggleStates();
}

function updateAnnotations() {
    if (currentView !== 'live') return;
    const normalContainer = document.getElementById('normalAnnotations');
    const thermalContainer = document.getElementById('thermalAnnotations');
    const normalStats = document.getElementById('normalDuckStats');
    const thermalStats = document.getElementById('thermalDuckStats');

    if (normalContainer) normalContainer.innerHTML = '';
    if (thermalContainer) thermalContainer.innerHTML = '';

    const counts = getDetectionCounts();
    const statsHtml = `
        <div>Ducks: ${counts.total}</div>
        ${statusLinesHtml(counts)}
    `;
    // RGB panel: duck count from the model, statuses from the thermal camera's
    // live readings of the same ducks (both set by livefeed.js)
    const live = window.liveDetection;
    const liveStatus = liveStatusCounts(window.liveThermal);
    const liveHtml = live ? `
        <div>Ducks: ${live.ducks ?? '--'}</div>
        ${statusLinesHtml(liveStatus)}
    ` : statsHtml;
    // Only touch the page when the text changes (no needless redraws)
    setHtmlIfChanged(normalStats, liveHtml);
    setHtmlIfChanged(thermalStats, liveThermalHtml(window.liveThermal) ?? statsHtml);
}

function setHtmlIfChanged(el, html) {
    if (el && el.__html !== html) {
        el.innerHTML = html;
        el.__html = html;
    }
}

// One line per status for the camera panels; counts null -> '--'
function statusLinesHtml(counts) {
    const show = (n) => (counts ? n : '--');
    return `
        <div>Thermal Comfort: ${show(counts?.comfort)}</div>
        <div>Mild Heat Stress: ${show(counts?.mild)}</div>
        <div>Moderate Heat Stress: ${show(counts?.moderate)}</div>
        <div>Severe Heat Stress: ${show(counts?.severe)}</div>
    `;
}

// Comfort / Mild / Moderate / Severe counts from the live thermal readings, or null
function liveStatusCounts(thermal) {
    if (!thermal || !Array.isArray(thermal.ducks_now)) return null;
    const counts = { comfort: 0, mild: 0, moderate: 0, severe: 0 };
    const key = { COMFORT: 'comfort', MILD: 'mild', MODERATE: 'moderate', SEVERE: 'severe' };
    thermal.ducks_now.filter((t) => typeof t === 'number').forEach((t) => { counts[key[statusFromTemp(t)]] += 1; });
    return counts;
}

// Live surface temperatures from the thermal camera (window.liveThermal, set by
// livefeed.js from the logger's /stats). Uses the same thresholds as the
// Detection Log colours. Returns null when there is no live thermal data.
// Status by surface temperature (homepage Status & Urgency Levels):
// 35.7 °C or below Thermal Comfort · 35.8 to 43.6 Mild Heat Stress
// · 43.7 to 44.9 Moderate Heat Stress · 45.0 or above Severe Heat Stress
const LIVE_TEMP_LEVELS = { mild: 35.7, stress: 43.6, critical: 44.9 };   // °C: above mild = Mild, above stress = Moderate, above critical = Severe

// The four statuses, coolest first. cls: Detection Log badge / live list colour
const STATUS_ORDER = ['COMFORT', 'MILD', 'MODERATE', 'SEVERE'];
const STATUS_INFO = {
    COMFORT: { label: 'Thermal Comfort', log: 'ok', live: 'ok', icon: 'check-circle', color: '#22c55e', border: '#16a34a' },
    MILD: { label: 'Mild Heat Stress', log: 'warn', live: 'mild', icon: 'sun', color: '#f59e0b', border: '#d97706' },
    MODERATE: { label: 'Moderate Heat Stress', log: 'moderate', live: 'moderate', icon: 'alert-triangle', color: '#f97316', border: '#ea580c' },
    SEVERE: { label: 'Severe Heat Stress', log: 'stress', live: 'stress', icon: 'siren', color: '#ef4444', border: '#dc2626' },
};
const statusInfo = (status) => STATUS_INFO[status] || STATUS_INFO.COMFORT;
const statusLabel = (status) => statusInfo(status).label;

function statusFromTemp(t) {
    if (t > LIVE_TEMP_LEVELS.critical) return 'SEVERE';
    if (t > LIVE_TEMP_LEVELS.stress) return 'MODERATE';
    if (t > LIVE_TEMP_LEVELS.mild) return 'MILD';
    return 'COMFORT';
}

// Same badge markup everywhere (Detection Log, result details)
function statusBadgeHtml(status) {
    const info = statusInfo(status);
    return `<div class="ht-log-status ht-log-status--${info.log}"><i data-lucide="${info.icon}"></i><span>${info.label.toUpperCase()}</span></div>`;
}

// Severity code -> urgency badge text (ROUTINE / MONITOR / URGENT / CRITICAL)
const urgencyBadge = (level) => urgencyName(level).toUpperCase();

function liveThermalHtml(thermal) {
    if (!thermal || !Array.isArray(thermal.ducks_now)) return null;
    const temps = thermal.ducks_now.filter((t) => typeof t === 'number');
    const unmeasured = thermal.ducks_now.length - temps.length;
    const hottest = temps.length ? `${Math.max(...temps).toFixed(1)}°C` : '--';
    return `
        <div>Ducks: ${thermal.ducks_now.length}${unmeasured ? ` (${unmeasured} not measured)` : ''}</div>
        ${statusLinesHtml(liveStatusCounts(thermal))}
        <div>Hottest: ${hottest}</div>
    `;
}

// ============================================
// RENDERING FUNCTIONS
// ============================================
function renderDetectionLogs() {
    const tbody = document.getElementById('detectionLogBody');
    renderLogFilterChips();
    const filtered = getFilteredLogDetections();

    const totalPages = Math.ceil(filtered.length / state.pageSize) || 1;
    state.currentPage = Math.min(state.currentPage, totalPages);
    const startIndex = (state.currentPage - 1) * state.pageSize;
    const pageData = filtered.slice(startIndex, startIndex + state.pageSize);
    // Worked out over all results, so the status filter doesn't break a run
    const durations = logEntryLabels();

    if (!pageData.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="ht-footnote" style="text-align:center; padding:1.5rem 0; font-size:15px; line-height:1.6;">No detections found. Live event data will populate here once available.</td>
            </tr>
        `;
    } else {
        tbody.innerHTML = pageData.map(d => {
            const sevPill = d.severity === 'CRITICAL' ? 'ht-pill ht-pill--critical' :
                d.severity === 'HIGH' ? 'ht-pill ht-pill--high' :
                d.severity === 'MODERATE' ? 'ht-pill ht-pill--moderate' :
                'ht-pill ht-pill--low';

            const flash = d.status === 'MODERATE' || d.status === 'SEVERE' ? ' ht-log-row--flash' : '';
            // One cell per header column: lowest / average / highest surface temperature
            const tempCell = (t) => {
                if (t == null) return '<td class="ht-log-cell--mono">--</td>';
                const cls = t > LIVE_TEMP_LEVELS.stress ? 'ht-log-temp--hi' : t > LIVE_TEMP_LEVELS.mild ? 'ht-log-temp--mid' : 'ht-log-temp--ok';
                return `<td class="ht-log-cell--mono ${cls}">${t.toFixed(1)}°C</td>`;
            };
            const batch = d.batchCount != null ? escapeHtml(String(d.batchCount)) : '--';

            // Each analytics row is one batch, so its duck_count is shown directly
            const duckLabel = `${d.count} duck${d.count !== 1 ? 's' : ''}`;

            return `
                <tr class="ht-log-row-clickable${flash}" data-detection-id="${d.id}">
                    <td class="ht-log-cell--mono">${formatTimestamp(d.timestamp)}${intervalBadge(durations.get(d.id))}</td>
                    <td>${statusBadgeHtml(d.status)}</td>
                    ${tempCell(d.lowTemp)}
                    ${tempCell(d.avgTemp)}
                    ${tempCell(d.highTemp)}
                    <td class="ht-log-cell--mono ht-log-dur">${duckLabel}</td>
                    <td class="ht-log-cell--mono" style="font-size:.78em;word-break:break-all" title="${batch}">${batch}</td>
                    <td><span class="${sevPill}">${urgencyBadge(d.severity)}</span></td>
                </tr>
            `;
        }).join('');

        tbody.querySelectorAll('tr[data-detection-id]').forEach(row => {
            row.addEventListener('click', () => {
                const id = row.getAttribute('data-detection-id');
                const detection = state.detections.find(item => item.id === id);
                if (!detection) return;
                const currentTemp = state.sensorHistory.temp[state.sensorHistory.temp.length - 1] ?? null;
                const rec = buildRecommendationFromDetection(detection);
                openRecommendationModal(rec, currentTemp);
            });
        });
    }

    document.getElementById('logCount').textContent = `Showing ${pageData.length} of ${filtered.length} records`;
    document.getElementById('pageInfo').textContent = `${state.currentPage}/${totalPages}`;
    lucide.createIcons();
}

function renderLiveDetections() {
    const container = document.getElementById('liveDetections');
    if (!container) return;
    const recent = detailDetections().slice(0, 8);

    if (!recent.length) {
        container.innerHTML = `<div class="ht-panel__note">No live detections available yet. As live data arrives, this list will update automatically.</div>`;
        return;
    }

    container.innerHTML = recent.map(d => {
        const info = statusInfo(d.status);

        return `
            <div class="ht-live-item ht-live-item--${info.live}">
                <div class="ht-live-item__ico">
                    <i data-lucide="${info.icon}"></i>
                </div>
                <div class="ht-live-item__main">
                    <div class="ht-live-item__row">
                        <span class="ht-live-item__tag">${info.label.toUpperCase()}</span>
                    </div>
                    <div class="ht-live-item__meta">${d.bodyTemp}°C • ${d.count} duck${d.count !== 1 ? 's' : ''} • ${urgencyName(d.severity)}</div>
                </div>
                <div class="ht-live-item__time">${formatRelativeTime(d.timestamp)}</div>
            </div>
        `;
    }).join('');

    lucide.createIcons();
}

const formatCardTemp = (v) => (typeof v === 'number' && v > 0 ? `${v.toFixed(1)}°C` : '--');

// Ambient temperature of a result = the highest DHT22 air temperature during its
// interval (the same reading the severity model used). Old readings are not kept
// in memory, so each result on screen is looked up once and remembered on it
// (undefined = not looked up yet, null = no reading in that interval).
const ambientLookups = new Set();

async function loadAmbientTemps(detections) {
    const uid = currentUser?.id;
    const todo = detections.filter((d) => d.ambientTemp === undefined && d.dbId != null
        && d.timestamp instanceof Date && !ambientLookups.has(d.dbId));
    if (!uid || !todo.length) return;
    todo.forEach((d) => ambientLookups.add(d.dbId));

    const found = await Promise.all(todo.map(async (d) => {
        const to = d.timestamp;
        const from = new Date(to.getTime() - (d.interval || 10) * 60 * 1000);
        const { data, error } = await sb.from('environment').select('temperature')
            .eq('userid', uid)
            .gte('timestamp', from.toISOString()).lte('timestamp', to.toISOString())
            .not('temperature', 'is', null)
            .order('temperature', { ascending: false }).limit(1).maybeSingle();
        if (error) {
            ambientLookups.delete(d.dbId);   // try again on the next refresh
            return false;
        }
        d.ambientTemp = data ? toNum(data.temperature) : null;
        return true;
    }));
    if (found.some(Boolean)) renderRecommendations();
}

function renderRecommendations() {
    const container = document.getElementById('recommendationsList');
    const activeRecs = [];

    // One recommendation per 30-minute reading with ducks (newest first), on the
    // 30-minute steps (see logEntryLabels). Slots without ducks have no row.
    const duckDetections = detailDetections().filter(d => d.count > 0);
    const currentTemp = state.sensorHistory.temp.length > 0 ? state.sensorHistory.temp[state.sensorHistory.temp.length - 1] : null;

    if (!duckDetections.length) {
        container.innerHTML = `
            <div class="ht-footnote" style="text-align:center; padding:1.5rem 0; font-size:15px; line-height:1.6;">
                No ducks detected yet, so there are no recommendations. The first recommendation appears 20 minutes after ducks are first detected, then every 30 minutes.
            </div>
        `;
        lucide.createIcons();
        return;
    }

    duckDetections.forEach(d => {
        activeRecs.push({
            ...recommendationFor(d, recommendations[d.severity] ? d.severity : 'LOW'),
            id: `duck-${d.id}`,
            detectionId: d.id,
            timestamp: formatTimestamp(d.timestamp),
            timestampMs: d.timestamp instanceof Date ? d.timestamp.getTime() : Date.now(),
            severity: d.severity,
            status: d.status,
            bodyTemp: d.bodyTemp,
            ambientTemp: d.ambientTemp,
            detectionRef: d,                  // the modal looks up its own air temperature
            lowTemp: d.lowTemp ?? null,
            highTemp: d.highTemp ?? null,
            duckCount: d.count ?? null,
            batchCount: d.batchCount ?? null,
            confidence: d.confidence != null ? Math.round(d.confidence * 100) : null,
            isHeatStress: d.isHeatStress
        });
    });

    // Sort all active recommendations so latest items appear first
    activeRecs.sort((a, b) => (b.timestampMs || 0) - (a.timestampMs || 0));

    // Ensure the latest recommendations are shown first and preserve older items when the user expands the list
    if (state.recommendationsDisplayed === 0 && activeRecs.length > 0) {
        state.recommendationsDisplayed = state.recommendationsPageSize;
    }
    const toShow = Math.min(state.recommendationsDisplayed, activeRecs.length);
    const displayRecs = activeRecs.slice(0, toShow);
    const hasMore = toShow < activeRecs.length;

    let html = displayRecs.map(r => {
        const cardClass = REC_SEVERITY_CLASS[r.severity] || REC_SEVERITY_CLASS.LOW;
        const ambientText = r.ambientTemp === undefined ? '...' : formatCardTemp(r.ambientTemp);
        const tip = escapeHtml(getRecTip(r));

        return `
            <button type="button" data-rec-id="${r.id}" class="${cardClass}" role="listitem">
                <div class="ht-rec-card__inner">
                    <div class="ht-rec-card__badge">
                        <i data-lucide="${r.icon}"></i>
                    </div>
                    <div class="ht-rec-card__content">
                        <div class="ht-rec-card__top">
                            <div class="ht-rec-card__action">${escapeHtml(r.action)}</div>
                            <span class="ht-rec-sev">${urgencyBadge(r.severity)}</span>
                        </div>
                        <div class="ht-rec-card__meta">
                            <span class="ht-rec-card__category">Surface Temp ${formatCardTemp(r.bodyTemp)}</span>
                            <span class="ht-rec-card__category">Ambient Temp ${ambientText}</span>
                        </div>
                        <p class="ht-rec-card__tip">${tip}</p>
                        <div class="ht-rec-card__time">${r.timestamp}</div>
                    </div>
                </div>
            </button>
        `;
    }).join('');

    // Add "Show More" button if there are more recommendations
    if (hasMore) {
        html += `
            <div style="padding: 0.75rem 0; text-align: center;">
                <button type="button" id="recShowMore" class="ht-btn ht-btn--ghost">
                    Show More Recommendations
                </button>
            </div>
        `;
    }

    container.innerHTML = html;

    // Air temperature of each result on screen (looked up once per result)
    loadAmbientTemps(displayRecs.map((r) => state.detections.find((d) => `duck-${d.id}` === r.id)).filter(Boolean));

    // Ask Gemini for the results on screen that have no AI text yet
    displayRecs.forEach((r) => { if (!r.ai && r.analyticsId != null) requestAiRecommendation(r.analyticsId); });

    container.querySelectorAll('[data-rec-id]').forEach(btn => {
        btn.addEventListener('click', () => {
            const recId = btn.getAttribute('data-rec-id');
            const selected = displayRecs.find(r => r.id === recId);
            if (selected) {
                openRecommendationModal(selected, currentTemp);
            }
        });
    });

    // Attach "Show More" handler
    const showMoreBtn = container.querySelector('#recShowMore');
    if (showMoreBtn) {
        showMoreBtn.addEventListener('click', () => {
            state.recommendationsDisplayed += state.recommendationsPageSize;
            renderRecommendations();
        });
    }

    lucide.createIcons();
}

function openRecommendationModal(rec, currentTemp, { keepScroll = false } = {}) {
    const modal = document.getElementById('recommendationModal');
    const body = document.getElementById('recommendationModalBody');
    if (!modal || !body) return;

    // Not looked up yet: fetch this result's own air temperature, then refresh the modal
    const ref = rec.detectionRef;
    if (ref && ref.ambientTemp === undefined && ref.dbId != null && !ref._ambientPending) {
        ref._ambientPending = true;
        loadAmbientTemps([ref]).finally(() => {
            ref._ambientPending = false;
            if (ref.ambientTemp === undefined) ref.ambientTemp = null;   // lookup failed or no reading
            const m = document.getElementById('recommendationModal');
            const stillOpen = m && m.classList.contains('is-open') && m.dataset.recId === String(rec.id);
            if (stillOpen) openRecommendationModal({ ...rec, ambientTemp: ref.ambientTemp }, currentTemp, { keepScroll: true });
        });
    }

    // Gemini's text for this result when it exists; guideline text otherwise
    const ai = rec.ai || null;
    // Always 5 lines: the AI's list, topped up from the guideline text if it gave fewer
    const pick = (aiList, fallback) => {
        const lines = Array.isArray(aiList) ? aiList.filter(Boolean) : [];
        const seen = new Set(lines.map((l) => l.toLowerCase()));
        fallback.forEach((l) => { if (!seen.has(l.toLowerCase())) { seen.add(l.toLowerCase()); lines.push(l); } });
        return lines.slice(0, REC_LIST_LENGTH);
    };
    const guidanceLines = pick(ai?.suggested_actions, getRecommendationGuidance(rec));
    const resultSummary = getRecommendationResultSummary(rec, currentTemp);
    const headline = getRecommendationHeadline(rec);
    const preventionTips = pick(ai?.prevention, getRecommendationPreventionTips(rec));
    // Summary: Gemini's explanation + insights when it has answered, the built-in summary otherwise
    const summaryLines = ai
        ? [ai.explanation, ...(ai.environmental_insights || []), ...(ai.temperature_guidance || [])].filter(Boolean)
        : getRecommendationSummary(rec, currentTemp);

    // Where the text came from (shown under the headline)
    const lastFail = rec.analyticsId != null ? aiRec.failedAt.get(rec.analyticsId) : null;
    const canGenerate = !ai && rec.analyticsId != null && aiRec.enabled
        && !(lastFail && Date.now() - lastFail < AI_REC_RETRY_AFTER_MS);
    // (nothing is shown when the text is the built-in fallback)
    const sourceLabel = ai
        ? `<span class="ht-ai-badge"><i data-lucide="sparkles"></i>AI-generated · ${aiProviderName(ai.model)}</span>`
        : canGenerate
            ? '<span class="ht-ai-badge ht-ai-badge--pending"><span class="ht-ai-badge__spinner" aria-hidden="true"></span>Generating AI recommendation...</span>'
            : '';
    openRecState = { rec, currentTemp };
    if (canGenerate) requestAiRecommendation(rec.analyticsId, true);
    const severityClass = rec.severity ? rec.severity.toLowerCase() : 'low';
    const heroClass = `ht-modal-hero ht-modal-hero--${severityClass}`;
    // Row 1: Temperature Readings (full width). Row 2: Duck/Batch Count, then Urgency Level
    const snapshotGroups = [
        { key: 'temperature', title: 'Temperature Readings', icon: 'thermometer' },
        { key: 'counts', title: 'Detection Count', icon: 'scan-search' },
        { key: 'severity', title: 'Urgency Level', icon: 'gauge' },
    ];
    const kvItemHtml = (item) => {
        // Counts: big number + small unit; everything else: plain value
        const valueHtml = typeof item.count === 'number'
            ? `<span class="ht-modal-kv__num">${item.count}</span><span class="ht-modal-kv__unit">${item.unit}</span>`
            : item.value;
        return `
            <div class="ht-modal-kv__item${item.tone ? ` ht-modal-kv__item--${item.tone}` : ''}">
                ${item.label ? `<div class="ht-modal-kv__label">${item.icon ? `<i data-lucide="${item.icon}"></i>` : ''}<span class="ht-modal-kv__label-text">${item.label}</span></div>` : ''}
                <div class="ht-modal-kv__val">${valueHtml}</div>
            </div>
        `;
    };
    const resultHtml = snapshotGroups.map(group => {
        const groupItems = resultSummary.filter(item => item.group === group.key);
        if (!groupItems.length) return '';
        return `
            <div class="ht-modal-kv-group ht-modal-kv-group--${group.key}">
                <div class="ht-modal-kv-group__head">
                    <i data-lucide="${group.icon}"></i>
                    <span class="ht-modal-kv-group__title">${group.title}</span>
                </div>
                <div class="ht-modal-kv">${groupItems.map(kvItemHtml).join('')}</div>
            </div>
        `;
    }).join('');
    // Bold the key figures (°C, %, minutes) so each line can be scanned quickly.
    // Text is escaped first: AI lines come from Gemini.
    const emphasize = (line) => escapeHtml(line).replace(
        /(\d+(?:\.\d+)?(?:[–-]\d+(?:\.\d+)?)?\s?(?:°C|%|minutes?|min))/g,
        '<strong>$1</strong>'
    );
    const listItems = (lines) => lines.map(line => `<li>${emphasize(line)}</li>`).join('');
    const guidanceHtml = listItems(guidanceLines);
    const preventionHtml = listItems(preventionTips);
    const summaryHtml = listItems(summaryLines);
    const metaHtml = headline.meta.map(m => `<span${m.cls ? ` class="${m.cls}"` : ''}>${m.text}</span>`).join('');

    body.innerHTML = `
        <div class="${heroClass}">
            <div class="ht-modal-row">
                <div class="ht-modal-result">
                    <span class="ht-modal-result__label">Detection Result</span>
                    <h3 class="ht-modal-action">${headline.title}</h3>
                </div>
                <span class="ht-modal-sev">${urgencyBadge(rec.severity)}</span>
            </div>
            <p class="ht-modal-meta">${metaHtml}${sourceLabel ? `<span class="ht-modal-meta__src">${sourceLabel}</span>` : ''}</p>
        </div>

        <div class="ht-modal-detail-grid">
            <div class="ht-modal-detail-card ht-modal-detail-card--full">
                <div class="ht-modal-detail-card__head">
                    <i data-lucide="clipboard-list"></i>
                    <span>Detection Details</span>
                </div>
                <div class="ht-modal-snapshot">${resultHtml}</div>
            </div>
            <!-- Order: understand what happened → act now → prevent -->
            <div class="ht-modal-detail-card ht-modal-detail-card--summary">
                <div class="ht-modal-detail-card__head">
                    <i data-lucide="file-text"></i>
                    <span>Summary</span>
                </div>
                <ul class="ht-modal-list">${summaryHtml}</ul>
            </div>
            <div class="ht-modal-detail-card ht-modal-detail-card--actions">
                <div class="ht-modal-detail-card__head">
                    <i data-lucide="zap"></i>
                    <span>Suggested Actions</span>
                </div>
                <ul class="ht-modal-list">${guidanceHtml}</ul>
            </div>
            <div class="ht-modal-detail-card ht-modal-detail-card--prevent">
                <div class="ht-modal-detail-card__head">
                    <i data-lucide="shield"></i>
                    <span>Heat Stress Prevention</span>
                </div>
                <ul class="ht-modal-list">${preventionHtml}</ul>
            </div>
        </div>

        <div class="ht-modal-callout">
            <h4><i data-lucide="info"></i> <span>Disclaimer</span></h4>
            <p>
                These results and recommendations are assistive only and may contain errors. Always confirm with direct on-site observation of the ducks and follow your established farm protocol or veterinary guidance before taking critical action.
            </p>
        </div>
    `;

    // Every scrollable part of the modal (the body scrolls; on phones the dialog/overlay can too)
    const resetScrollPosition = () => {
        [body, modal.querySelector('.ht-modal__dialog'), modal].forEach((el) => {
            if (!el) return;
            el.scrollTop = 0;
            el.scrollLeft = 0;
        });
    };

    // Open modal first so layout/overflow values are stable, then start at the top
    // every time it opens (on all screen sizes). A refresh of the open modal (AI
    // text arriving) keeps the reader's place instead.
    modal.dataset.recId = String(rec.id);
    modal.classList.add('is-open');
    if (!keepScroll) {
        resetScrollPosition();
        requestAnimationFrame(resetScrollPosition);
    }
    lucide.createIcons();
}

// Which AI wrote a recommendation, from the model id the recommend function saves
function aiProviderName(model) {
    const m = String(model || '').toLowerCase();
    if (m.startsWith('gemini')) return 'Google Gemini';
    if (m.startsWith('groq/')) return 'Groq (Llama)';
    if (m.startsWith('openrouter/')) return 'OpenRouter';
    return 'AI';
}

function closeRecommendationModal() {
    const modal = document.getElementById('recommendationModal');
    if (!modal) return;
    modal.classList.remove('is-open');
    openRecState = null;
    // Back to the top once it has faded out (opening resets it too)
    setTimeout(() => {
        if (modal.classList.contains('is-open')) return;
        [modal.querySelector('.ht-modal__body'), modal.querySelector('.ht-modal__dialog'), modal]
            .forEach((el) => { if (el) el.scrollTop = 0; });
    }, 300);
}

// ============================================
// AI RECOMMENDATIONS (Google Gemini via the "recommend" Edge Function)
// ============================================
// Each result is sent to Gemini once; the answer is saved on the analytics row
// (ai_recommendation), so later page loads just read it. Requests run one at a
// time to stay within Gemini's free-tier rate limit. Until a result has AI
// text, the guideline text is shown, so the dashboard never waits on Gemini.
const AI_REC_FUNCTION = 'recommend';
const AI_REC_GAP_MS = 7000;              // one request per 7 s (~8.5/min), under Gemini Flash's 10 per minute
const AI_REC_RATE_LIMIT_PAUSE_MS = 60 * 1000;
const AI_REC_DAILY_LIMIT_PAUSE_MS = 30 * 60 * 1000;   // every AI is out for the day: check again in 30 min
const AI_REC_RETRY_AFTER_MS = 5 * 60 * 1000;

const aiRec = {
    enabled: true,          // turned off for this visit if the function or API key is missing
    queue: [],              // analytics ids waiting for Gemini
    busy: false,
    pausedUntil: 0,
    failedAt: new Map(),    // analytics id -> time of the last failure (retried later)
};
let openRecState = null;    // the recommendation currently open in the detail modal

function requestAiRecommendation(analyticsId, urgent = false) {
    if (!aiRec.enabled || analyticsId == null || !currentUser) return;
    const detection = state.detections.find((d) => d.dbId === analyticsId);
    if (!detection || detection.ai) return;
    const failed = aiRec.failedAt.get(analyticsId);
    if (failed && Date.now() - failed < AI_REC_RETRY_AFTER_MS) return;
    const index = aiRec.queue.indexOf(analyticsId);
    if (index !== -1) {
        if (!urgent) return;
        aiRec.queue.splice(index, 1);
    }
    if (urgent) aiRec.queue.unshift(analyticsId); else aiRec.queue.push(analyticsId);
    processAiRecQueue();
}

async function processAiRecQueue() {
    if (aiRec.busy || !aiRec.queue.length) return;
    const wait = aiRec.pausedUntil - Date.now();
    if (wait > 0) { setTimeout(processAiRecQueue, wait); return; }

    aiRec.busy = true;
    const analyticsId = aiRec.queue.shift();
    try {
        const detection = state.detections.find((d) => d.dbId === analyticsId);
        if (!detection || detection.ai) return;
        const { data, error } = await sb.functions.invoke(AI_REC_FUNCTION, { body: { analytics_id: analyticsId } });
        if (error) {
            const status = error.context?.status;
            let info = {};
            try { info = (await error.context.json()) || {}; } catch (_) {}
            const code = info.error || '';
            if (status === 404 && !code) {
                // The Edge Function itself is not deployed
                disableAiRecommendations('Deploy supabase/functions/recommend (see ai_recommendations.sql).');
            } else if (code === 'not_configured') {
                disableAiRecommendations('Set the GEMINI_API_KEY secret for the recommend Edge Function.');
            } else if (status === 429) {
                // Every AI provider is at its limit (the function already tried them all)
                aiRec.pausedUntil = Date.now() + (info.daily ? AI_REC_DAILY_LIMIT_PAUSE_MS : AI_REC_RATE_LIMIT_PAUSE_MS);
                aiRec.queue.unshift(analyticsId);    // try this one again after the pause
            } else {
                // info.tried: why each AI provider failed (from the recommend function)
                console.warn('HeatTrack: AI recommendation failed for result', analyticsId, status, code || error.message, info.tried || '');
                aiRec.failedAt.set(analyticsId, Date.now());
                refreshOpenRecommendation(analyticsId);
            }
            return;
        }
        if (data?.recommendation) {
            detection.ai = data.recommendation;
            renderRecommendations();
            refreshOpenRecommendation(analyticsId);
        }
    } catch (err) {
        console.warn('HeatTrack: AI recommendation request failed', err);
        aiRec.failedAt.set(analyticsId, Date.now());
        refreshOpenRecommendation(analyticsId);
    } finally {
        aiRec.busy = false;
        if (aiRec.queue.length) setTimeout(processAiRecQueue, AI_REC_GAP_MS);
    }
}

function disableAiRecommendations(reason) {
    if (aiRec.enabled) console.warn('HeatTrack: AI recommendations are off, showing guideline text. ' + reason);
    aiRec.enabled = false;
    aiRec.queue = [];
    if (openRecState) refreshOpenRecommendation(openRecState.rec.analyticsId);
}

// Re-draw the detail modal if it is showing this result (AI text arrived or failed)
function refreshOpenRecommendation(analyticsId) {
    const modal = document.getElementById('recommendationModal');
    if (!openRecState || !modal?.classList.contains('is-open') || openRecState.rec.analyticsId !== analyticsId) return;
    const { rec, currentTemp } = openRecState;
    const detection = state.detections.find((d) => d.dbId === analyticsId);
    const fresh = detection ? { ...rec, ...recommendationFor(detection, rec.severity) } : rec;
    // keep the scroll position while swapping in the new text
    const body = document.getElementById('recommendationModalBody');
    const top = body?.scrollTop || 0;
    const failed = !fresh.ai && aiRec.failedAt.has(analyticsId);
    openRecommendationModal(failed ? { ...fresh, analyticsId: null } : fresh, currentTemp, { keepScroll: true });
    if (body) body.scrollTop = top;
}

// Fallback lists start at a different item for each result, so two results
// with the same severity don't show the same list (Gemini's text replaces them)
function rotateForResult(list, rec) {
    const shift = (rec?.variant || 0) % list.length;
    return list.slice(shift).concat(list.slice(0, shift));
}

// Suggested Actions and Heat Stress Prevention both show this many lines
const REC_LIST_LENGTH = 5;

// Lead line first (skipped if missing or already in the list), then the list, cut to 5
function withLead(lead, list) {
    const rest = lead ? list.filter((l) => l.toLowerCase() !== lead.toLowerCase()) : list;
    return (lead ? [lead, ...rest] : rest).slice(0, REC_LIST_LENGTH);
}

function getRecommendationGuidance(rec) {
    const guidanceBySeverity = {
        CRITICAL: [
            'Start cooling right away and keep the hottest birds apart.',
            'Watch response for 1–3 minutes and be ready to escalate.',
            'Keep water available and avoid extra handling.',
            'Run misting with strong ventilation so humidity does not trap heat.',
            'Call a veterinarian if severe signs last more than 10 minutes.'
        ],
        HIGH: [
            'Turn fans and shade on high, then recheck in 10 minutes.',
            'Reduce crowding and delay non-essential activity.',
            'Focus on the hottest zones first.',
            'Watch for panting, wing spreading, or lethargy every 10 minutes.',
            'Open all airflow panels to move hot air out of the barn.'
        ],
        MODERATE: [
            'Use preventive cooling and monitor the trend.',
            'Check drinkers, vents, and shade coverage.',
            'Be ready to act if temperatures rise again.',
            'Recheck temperature and humidity every 15 minutes.',
            'Add temporary shade over sunny open areas.'
        ],
        LOW: [
            'Keep regular monitoring active.',
            'Verify water and airflow are working.',
            'Note any new heat spikes for the next check.',
            'Keep automated alerts switched on.',
            'Check fan operation once per shift.'
        ]
    };

    // Lead with the result's guideline action, like Prevention leads with its tip
    return withLead(rec.action, rotateForResult(guidanceBySeverity[rec.severity] || guidanceBySeverity.MODERATE, rec));
}

// Modal heading: the detection result plus its key facts (time, confidence)
function getRecommendationHeadline(rec) {
    // The result's status: "Thermal Comfort", or e.g. "Mild Heat Stress Detected"
    const status = getRecStatus(rec);
    const title = status === 'COMFORT' ? statusLabel(status) : `${statusLabel(status)} Detected`;

    const meta = [];
    // cls: the date/time uses the same mono style as the card's timestamp
    if (rec.timestamp) meta.push({ text: rec.timestamp, cls: 'ht-modal-meta__time' });
    if (rec.confidence) meta.push({ text: `Confidence ${rec.confidence}%` });

    return { title, meta };
}

function getRecommendationPreventionTips(rec) {
    const bySeverity = {
        CRITICAL: [
            'Open airflow and keep water available.',
            'Avoid unnecessary movement or handling.',
            'Keep the hottest animals separated from the group.',
            'Provide cool, not cold, water at several drinking points.',
            'Hold feeding until surface temperatures come down.'
        ],
        HIGH: [
            'Boost shade and fan output where it is hottest.',
            'Check that all birds can reach water easily.',
            'Delay extra handling until conditions calm.',
            'Replace warm trough water and recheck it every 20 minutes.',
            'Move feeding to the cooler early morning or late afternoon.'
        ],
        MODERATE: [
            'Check vents, water, and shade before heat rises.',
            'Move cooling equipment closer if needed.',
            'Track the trend for any quick changes.',
            'Keep drinkers clean, flowing, and reachable from every section.',
            'Schedule feeding outside the hottest hours of the day.'
        ],
        LOW: [
            'Keep normal checks active and log peak readings.',
            'Confirm fans and water are working properly.',
            'Stay ready for a quick response if heat rises.',
            'Test backup cooling before hot weather arrives.',
            'Review daily heat trends to spot rising risk early.'
        ]
    };

    return withLead(rec.tip, rotateForResult(bySeverity[rec.severity] || bySeverity.MODERATE, rec));
}

// Summary card (when there is no Gemini text): what was found, the conditions
// behind it, and what it means, each as one short line
function getRecommendationSummary(rec, currentTemp) {
    const counts = getDetectionCounts();
    const total = counts.total;
    const humidValue = state.sensorHistory.humidity[state.sensorHistory.humidity.length - 1];
    const tempStr = typeof currentTemp === 'number' ? `${currentTemp.toFixed(1)}°C` : null;
    const humidStr = typeof humidValue === 'number' ? `${humidValue.toFixed(0)}%` : null;
    const bodyStr = rec.bodyTemp != null ? `${rec.bodyTemp}°C` : null;

    const lines = [];

    // 1. What was found
    if (total > 0) {
        const affected = counts.mild + counts.moderate + counts.severe;
        lines.push(
            `${affected} of ${total} ducks show signs of heat stress` +
            (counts.severe > 0 ? `, including ${counts.severe} with Severe Heat Stress.` : '.')
        );
    } else {
        lines.push('No duck detections are available yet, so this is based on barn conditions.');
    }

    // 2. Conditions behind it
    if (bodyStr && tempStr) {
        const struggling = rec.severity === 'CRITICAL' || rec.severity === 'HIGH';
        lines.push(
            `Surface temperature reached ${bodyStr} while the barn is at ${tempStr}` +
            (struggling ? ', so ducks are struggling to shed heat.' : ', which is still manageable.')
        );
    } else if (tempStr) {
        lines.push(`The barn is at ${tempStr}; ducks lose heat less easily as the barn gets warmer.`);
    }
    if (humidStr) {
        lines.push(`Humidity is ${humidStr}; higher humidity reduces cooling through panting.`);
    }

    // 3. What it means
    const meaning = {
        CRITICAL: 'Urgency is Critical: act immediately and confirm on-site.',
        HIGH: 'Urgency is Urgent: start cooling now before it gets worse.',
        MODERATE: 'Urgency is Monitor: take preventive steps and watch the trend.',
        LOW: 'Urgency is Routine: keep routine monitoring in place.',
    };
    lines.push(meaning[rec.severity] || meaning.MODERATE);

    return lines;
}

// Duck recommendations carry the detection status (from the surface temperature);
// check-ins without one take the status that usually goes with their urgency
function getRecStatus(rec) {
    return STATUS_INFO[rec.status] ? rec.status : (STATUS_OF_SEVERITY[rec.severity] || 'COMFORT');
}

// Urgency Level: this result's level compared with the 30-minute reading before it.
// Up = worse (toward Critical), down = better (toward Routine).
function severityChangeHtml(rec) {
    const readings = detailDetections().filter((d) => d.timestamp instanceof Date);
    const own = readings.find((d) => d.id === rec.detectionId);
    if (!own) return '—';
    const previous = readings
        .filter((d) => d.timestamp < own.timestamp)
        .sort((a, b) => b.timestamp - a.timestamp)[0];
    if (!previous) {
        return '<span class="ht-sev-change ht-sev-change--first"><i data-lucide="flag"></i>First reading</span>';
    }
    const rank = (sev) => severityLevels.length - 1 - severityLevels.indexOf(sev);   // LOW 0 ... CRITICAL 3
    const diff = rank(own.severity) - rank(previous.severity);
    const prevLabel = urgencyName(previous.severity);
    const prevTime = previous.timestamp.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const [cls, icon, text] = diff > 0 ? ['up', 'trending-up', `Up from ${prevLabel}`]
        : diff < 0 ? ['down', 'trending-down', `Down from ${prevLabel}`]
        : ['same', 'minus', 'No changes'];
    return `<span class="ht-sev-change ht-sev-change--${cls}"><i data-lucide="${icon}"></i>${text}</span>`
        + `<span class="ht-sev-change__time"><span class="ht-sev-change__dot" aria-hidden="true">·</span>Previous reading ${prevTime}</span>`;
}

function getRecommendationResultSummary(rec, currentTemp) {
    // The result's own air temperature (highest DHT22 reading in its interval). A saved
    // detection never falls back to the CURRENT reading (that would show e.g. this
    // evening's temperature for a midday result); only check-ins without a record do.
    const own = rec.detectionRef ? rec.detectionRef.ambientTemp : rec.ambientTemp;
    const ambientValue = typeof own === 'number' ? own
        : (rec.detectionRef ? null : (typeof rec.ambientTemp === 'number' ? rec.ambientTemp : currentTemp));
    const ambientTemp = typeof ambientValue === 'number' ? `${ambientValue.toFixed(1)}°C`
        : (rec.detectionRef && own === undefined ? 'Loading…' : 'No reading');
    const detectedTemp = rec.bodyTemp != null ? `${rec.bodyTemp}°C` : ambientTemp;

    // Same badge markup as the Detection Log History status column
    const statusBadge = statusBadgeHtml(getRecStatus(rec));

    // group: which Detection Details section the item renders in; icon: lucide icon beside
    // the label; count + unit: big-number layout; tone: colored dot for severity levels
    const items = [
        { group: 'temperature', icon: 'activity', label: 'Status', value: statusBadge },
        { group: 'temperature', icon: 'thermometer', label: 'Surface Temperature', value: detectedTemp },
        { group: 'temperature', icon: 'home', label: 'Ambient Temperature', value: ambientTemp },
    ];

    const countItem = (icon, label, raw, unit) => {
        const n = raw == null ? NaN : Number(raw);
        return Number.isFinite(n)
            ? { group: 'counts', icon, label, count: n, unit: `${unit}${n !== 1 ? 's' : ''}` }
            : { group: 'counts', icon, label, value: '—' };
    };
    items.push(
        countItem('bird', 'Duck Count', rec.duckCount, 'duck'),
        countItem('layers', 'Batch Count', rec.batchCount, 'batch'),
    );

    // Urgency Level shows this result's own urgency (it can differ from the status,
    // e.g. Mild Heat Stress made Urgent by hot, humid air). All ducks of a reading
    // share it, so instead of a duck count it shows the change from the previous reading
    const level = severityLevels.includes(rec.severity) ? rec.severity : 'LOW';
    items.push({ group: 'severity', tone: level.toLowerCase(), label: urgencyName(level), value: severityChangeHtml(rec) });

    // Extra batch details from the analytics table (only for detection-based recommendations)
    if (rec.lowTemp != null && rec.highTemp != null) {
        items.splice(2, 0, { group: 'temperature', icon: 'arrow-left-right', label: 'Surface Temperature Range', value: `${rec.lowTemp}–${rec.highTemp}°C` });
    }
    return items;
}

function formatRelativeTime(date) {
    const diff = (Date.now() - date.getTime()) / 1000;
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ============================================
// ALERTS SYSTEM
// ============================================
// Notifications are kept in this browser per account (read ones included), so a
// reload or signing in again shows the same list with its read/unread state.
// Up to the latest 100 are kept.
const alertsStorageKey = () => (currentUser?.id ? `heattrack-alerts-${currentUser.id}` : null);

function saveAlerts() {
    const key = alertsStorageKey();
    if (!key) return;
    try {
        localStorage.setItem(key, JSON.stringify(state.alerts.slice(0, 100)));
    } catch (_) { /* storage full or blocked: the list still works for this visit */ }
}

function loadSavedAlerts() {
    const key = alertsStorageKey();
    let saved = [];
    try {
        saved = JSON.parse(localStorage.getItem(key) || '[]');
    } catch (_) { saved = []; }
    // Dates come back from storage as text
    state.alerts = (Array.isArray(saved) ? saved : []).map((a) => ({
        ...a,
        timestamp: a.timestamp ? new Date(a.timestamp) : new Date(),
        viewedAt: a.viewedAt ? new Date(a.viewedAt) : null,
    }));
    state.alertsDisplayed = 0;
    updateAlertBadge();
    renderAlerts();
}

// ============================================
// READ STATE: which notifications are read is kept in Supabase
// (notification_reads, see notification_reads.sql), one row per read item, so
// reading on one browser marks it read for the whole account.
// ============================================
async function fetchReadItemIds(userId) {
    if (!userId) return null;
    const { data, error } = await sb.from('notification_reads').select('item_id').eq('user_id', userId);
    if (error) {
        console.warn('HeatTrack: could not load read notifications. Run notification_reads.sql?', error);
        return null;
    }
    return new Set(data.map((row) => row.item_id));
}

function saveReadItemIds(userId, itemIds) {
    if (!userId || !itemIds.length) return;
    sb.from('notification_reads')
        .upsert(itemIds.map((item_id) => ({ user_id: userId, item_id })), { onConflict: 'user_id,item_id', ignoreDuplicates: true })
        .then(({ error }) => { if (error) console.warn('HeatTrack: could not save read notifications', error); });
}

// User notifications read on any browser of this account ('alert:<id>')
let alertReadIds = new Set();
const alertItemId = (id) => `alert:${id}`;

// Marks the listed alerts read here (no save: they are already read in the cloud)
function applyAlertReads() {
    let changed = false;
    state.alerts.forEach((a) => {
        if (!a.viewed && alertReadIds.has(alertItemId(a.id))) {
            a.viewed = true;
            a.viewedAt = new Date();
            changed = true;
        }
    });
    if (!changed) return;
    updateAlertBadge();
    saveAlerts();
    renderAlerts();
}

// Loads the account's read state; alerts read only in this browser (from before
// the read state was shared) are sent up so the other browsers follow too
async function refreshAlertReads(userId) {
    const ids = await fetchReadItemIds(userId);
    if (ids && userId === currentUser?.id) mergeAlertReads(userId, ids);
}

function mergeAlertReads(userId, ids) {
    alertReadIds = ids;
    const localOnly = state.alerts
        .filter((a) => a.viewed && !ids.has(alertItemId(a.id)))
        .map((a) => alertItemId(a.id));
    localOnly.forEach((id) => alertReadIds.add(id));
    saveReadItemIds(userId, localOnly);
    applyAlertReads();
}

function markAlertsRead(alerts) {
    const ids = alerts.map((a) => alertItemId(a.id));
    ids.forEach((id) => alertReadIds.add(id));
    saveReadItemIds(currentUser?.id, ids);
}

// ============================================
// SETTINGS
// Camera Streams is saved for the account in Supabase (user_settings, see
// user_settings.sql): turning it off on one browser turns it off on every
// browser signed in to the account. This browser keeps the last known value
// so the page starts with it before Supabase answers.
// Alert Notifications is saved in this browser only (per account), so each
// browser / device chooses for itself.
// ============================================
const settingsKey = () => (currentUser?.id ? `heattrack-settings-${currentUser.id}` : null);
// Alert choice saved before the settings moved into settingsKey
const oldAlertsPrefKey = () => (currentUser?.id ? `heattrack-alerts-on-${currentUser.id}` : null);
// Bumped on every Camera Streams change here, so an older answer from Supabase
// that arrives afterwards doesn't undo it
let cameraChangeSeq = 0;

function loadDeviceSettings() {
    let saved = null;
    let oldAlerts = null;
    try {
        saved = JSON.parse(localStorage.getItem(settingsKey()) || 'null');
        oldAlerts = localStorage.getItem(oldAlertsPrefKey());
    } catch (_) { /* no storage, or unreadable: use the defaults */ }
    // Never saved = everything on
    state.cameraActive = saved?.camera !== false;
    state.alertsWanted = saved ? saved.alerts !== false : oldAlerts !== 'off';
}

function saveDeviceSettings() {
    const key = settingsKey();
    if (!key) return;
    try {
        localStorage.setItem(key, JSON.stringify({
            camera: state.cameraActive,     // last known account value (see above)
            alerts: state.alertsWanted,
        }));
    } catch (_) { /* no storage */ }
}

// Takes the account's Camera Streams value (from Supabase or Realtime)
function applyAccountSettings(row) {
    if (!row || typeof row.camera_streams !== 'boolean') return;
    if (row.camera_streams === state.cameraActive) return;
    state.cameraActive = row.camera_streams;
    updateSystemToggleStates();
    drawAnnotations();
    saveDeviceSettings();
}

// A missing row means Camera Streams is on
async function refreshAccountSettings(userId) {
    if (!userId) return;
    const seq = cameraChangeSeq;
    const { data, error } = await sb.from('user_settings').select('camera_streams').eq('user_id', userId).maybeSingle();
    if (error) {
        console.warn('HeatTrack: could not load the account settings. Run user_settings.sql?', error);
        return;
    }
    if (userId !== currentUser?.id || seq !== cameraChangeSeq) return;   // signed out, or changed here meanwhile
    applyAccountSettings(data || { camera_streams: true });
}

function saveAccountSettings() {
    const userId = currentUser?.id;
    if (!userId) return;
    cameraChangeSeq += 1;
    sb.from('user_settings')
        .upsert({ user_id: userId, camera_streams: state.cameraActive, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
        .then(({ error }) => { if (error) console.warn('HeatTrack: could not save the account settings', error); });
}

// Heat-stress notifications: the 30-minute readings with Urgent or Critical
// urgency (see heatStressAlertIds). Covers results loaded
// with the page and results that arrive live.
// New ones start unread; read ones stay in the list. The bell counts only the unread ones.
const ALERT_LIST_LIMIT = 100;

function syncResultAlerts() {
    const alertIds = heatStressAlertIds();
    // Drop entries that no longer raise an alert: old check-ins, repeated
    // 30-minute rows and extra results inside a block (results no longer loaded stay)
    const loaded = new Set(state.detections.map((d) => d.id));
    const before = state.alerts.length;
    state.alerts = state.alerts.filter((a) => a.kind !== 'checkin' && (!loaded.has(a.id) || alertIds.has(a.id)));
    if (state.alerts.length !== before) saveAlerts();

    const known = new Set(state.alerts.map((a) => a.id));
    const added = summaryDetections()
        .filter((d) => alertIds.has(d.id) && !known.has(d.id))
        .map((d) => {
            // Already read on another browser of this account
            const read = alertReadIds.has(alertItemId(d.id));
            return { ...d, viewed: read, viewedAt: read ? new Date() : null };
        });
    if (added.length) {
        state.alerts = state.alerts.concat(added)
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
            .slice(0, ALERT_LIST_LIMIT);
        saveAlerts();
    }
    updateAlertBadge();
    renderAlerts();
}

// The bell's number = alerts not read yet; hidden when everything has been read
function updateAlertBadge() {
    state.alertCount = state.alerts.filter((a) => !a.viewed).length;
    const readAll = document.getElementById('readAllAlerts');
    if (readAll) readAll.disabled = state.alertCount === 0;
    const badge = document.getElementById('alertBadge');
    if (!badge) return;
    badge.textContent = state.alertCount > 99 ? '99+' : String(state.alertCount);
    badge.classList.toggle('u-hidden', state.alertCount === 0);
}

function renderAlerts() {
    const alertList = document.getElementById('alertList');
    if (!alertList) return;

    // Ensure the latest alerts are shown first and preserve older alerts when the user expands the list
    if (state.alertsDisplayed === 0 && state.alerts.length > 0) {
        state.alertsDisplayed = state.alertsPageSize;
    }
    const toShow = Math.min(state.alertsDisplayed, state.alerts.length);
    const displayAlerts = state.alerts.slice(0, toShow);
    const hasMore = toShow < state.alerts.length;

    let html = '';
    if (displayAlerts.length === 0) {
        html = '<p class="ht-alert-panel__empty">No alerts yet</p>';
    } else {
        html = displayAlerts.map(a => {
            const viewedClass = a.viewed ? 'ht-alert-item--viewed' : 'ht-alert-item--unviewed';
            // Critical = red (default), Urgent = orange
            const levelClass = isCriticalLevel(a.severity) ? 'ht-alert-item--critical' : 'ht-alert-item--urgent';
            return `
                <button type="button" data-alert-id="${a.id}" class="ht-alert-item ${viewedClass} ${levelClass}">
                    <div class="ht-alert-item__row">
                        <i data-lucide="${alertIcon(a.severity)}"></i>
                        <div class="ht-alert-item__body">
                            <div class="ht-alert-item__title"><span class="ht-alert-item__title-text">${alertTitle(a)}</span></div>
                            <div class="ht-alert-item__meta">
                                <span class="ht-alert-item__sub">${a.bodyTemp}°C • ${urgencyName(a.severity)}</span>
                                <span class="ht-alert-item__time">${formatRelativeTime(a.timestamp)}</span>
                            </div>
                        </div>
                    </div>
                </button>
            `;
        }).join('');

        // Add "Show More" button if there are more alerts
        if (hasMore) {
            html += `
                <div style="padding: 0.75rem 0; text-align: center;">
                    <button type="button" id="alertShowMore" class="ht-btn ht-btn--ghost">
                        Show More Notifications
                    </button>
                </div>
            `;
        }
    }

    alertList.innerHTML = html;

    // Attach click handlers to mark alerts as viewed
    alertList.querySelectorAll('[data-alert-id]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const alertId = btn.dataset.alertId;
            markAlertAsViewed(alertId);
            const alert = state.alerts.find(a => a.id === alertId);
            if (alert) {
                // The stored copy can be older than the result (e.g. before its AI text arrived)
                const detection = state.detections.find((d) => d.id === alert.id) || alert;
                const rec = buildRecommendationFromDetection(detection);
                openRecommendationModal(rec, state.sensorHistory.temp[state.sensorHistory.temp.length - 1]);
            }
        });
    });

    // Attach "Show More" handler
    const showMoreBtn = alertList.querySelector('#alertShowMore');
    if (showMoreBtn) {
        showMoreBtn.addEventListener('click', () => {
            state.alertsDisplayed += state.alertsPageSize;
            renderAlerts();
        });
    }

    lucide.createIcons();
}

function markAlertAsViewed(alertId) {
    const alert = state.alerts.find(a => a.id === alertId);
    if (alert && !alert.viewed) {
        alert.viewed = true;
        alert.viewedAt = new Date();
        updateAlertBadge();   // one fewer unread; the notification itself stays in the list
        saveAlerts();
        markAlertsRead([alert]);
        renderAlerts();
    }
}

// Pop-up (lower right) for heat stress alerts.
// It pops up for Urgent or Critical urgency (HIGH or CRITICAL severity), whatever
// the status: a Mild row made Urgent by hot, humid air alerts too.
let toastTimer = null;
const TOAST_LEVELS = ['HIGH', 'CRITICAL'];
const isToastLevel = (level) => TOAST_LEVELS.includes(String(level || '').toUpperCase());
// Severity -> the urgency name used on the homepage (Status & Urgency Levels)
const URGENCY_NAME = { LOW: 'Routine', MODERATE: 'Monitor', HIGH: 'Urgent', CRITICAL: 'Critical' };
const urgencyName = (level) => URGENCY_NAME[String(level || '').toUpperCase()] || String(level || '');
const isCriticalLevel = (level) => String(level || '').toUpperCase() === 'CRITICAL';
// Title = the status (e.g. Severe Heat Stress); the urgency is already on the badge
const alertTitle = (detection) => statusLabel(getRecStatus(detection));
// Same icons as the homepage cards: Urgent = alert-triangle, Critical = siren
const alertIcon = (level) => (isCriticalLevel(level) ? 'siren' : 'alert-triangle');

const fmtTemp = (t) => (t != null && t !== '--' && !Number.isNaN(Number(t)) ? `${Number(t).toFixed(1)}°C` : '--');

function showToast(detection) {
    if (!state.alertsEnabled || !isToastLevel(detection?.severity)) return;
    state.lastToastDetection = detection;
    let action = '';
    try { action = buildRecommendationFromDetection(detection).action || ''; } catch { /* no recommendation text */ }
    const stats = [['Surface temp', fmtTemp(detection.bodyTemp)]];
    if (detection.ambientTemp != null) stats.push(['Barn', fmtTemp(detection.ambientTemp)]);
    if (detection.count != null) stats.push(['Ducks', String(detection.count)]);
    renderToast({
        level: detection.severity,
        title: alertTitle(detection),
        icon: alertIcon(detection.severity),
        stats,
        action: action || `Urgency: ${urgencyName(detection.severity)}. Open the details for the recommended actions.`,
        timestamp: detection.timestamp,
    });
}

// Fills the pop-up card (same look as the old check-in card: colored top strip
// and level badge, readings, the recommended action, Dismiss / View details)
function renderToast({ kind = 'heatstress', level = 'LOW', title, icon, stats = [], stale = false, action, timestamp }) {
    const toast = document.getElementById('alertToast');
    if (!toast) return;
    toast.dataset.kind = kind;
    toast.dataset.level = level;
    toast.querySelector('.ht-toast__icon').innerHTML = `<i data-lucide="${icon}"></i>`;
    document.getElementById('toastTitle').textContent = title;
    document.getElementById('toastLevel').textContent = urgencyName(level).toUpperCase();   // ROUTINE / MONITOR / URGENT / CRITICAL

    const statsEl = document.getElementById('toastStats');
    statsEl.innerHTML = '';
    stats.forEach(([label, value]) => {
        const span = document.createElement('span');
        span.append(`${label} `);
        const b = document.createElement('b');
        b.textContent = value;
        span.appendChild(b);
        statsEl.appendChild(span);
    });
    document.getElementById('toastStale').hidden = !stale;
    document.getElementById('toastMessage').textContent = action;
    const at = new Date(timestamp);
    document.getElementById('toastTime').textContent = Number.isNaN(at.getTime())
        ? '' : at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    lucide.createIcons();

    toast.classList.add('is-visible');
    // Restart the 5-second timer so a new pop-up isn't closed early by the previous one
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 5000);
}

function updateSystemToggleStates() {
    const cameraToggle = document.getElementById('cameraToggle');
    const alertToggle = document.getElementById('alertToggle');
    const normalCameraContainer = document.getElementById('normalCameraContainer');
    const thermalCameraContainer = document.getElementById('thermalCameraContainer');

    // Alerts need the cameras; this device's choice comes back with them
    state.alertsEnabled = state.alertsWanted && state.cameraActive;

    if (cameraToggle) {
        cameraToggle.checked = state.cameraActive;
        cameraToggle.disabled = false;
    }
    if (alertToggle) {
        alertToggle.checked = state.alertsEnabled;
        alertToggle.disabled = !state.cameraActive;
    }

    [normalCameraContainer, thermalCameraContainer].forEach((container) => {
        if (!container) return;
        container.classList.toggle('camera-feed--offline', !state.cameraActive);
        container.title = state.cameraActive ? 'Click to expand fullscreen' : 'Camera streams are off';
    });

    // Live badge state is managed by monitor media presence detection
    updateMonitorPresenceUI();

    if (!state.alertsEnabled) {
        document.getElementById('alertToast')?.classList.remove('is-visible');
    }
}

// ============================================
// CHARTS
// ============================================
let envChart, detectionChart, severityChart;
// Detection Distribution: one slice per status (hidden ones toggled from the legend)
const detectionLegendState = { COMFORT: false, MILD: false, MODERATE: false, SEVERE: false };

const detectionStatusLabels = STATUS_ORDER.map(statusLabel);

function initCharts() {
    const chartDefaults = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { display: false }
        }
    };

    // Environmental Trend Chart
    const envCtx = document.getElementById('envChart').getContext('2d');
    envChart = new Chart(envCtx, {
        type: 'line',
        data: {
            labels: state.sensorHistory.labels,
            datasets: [
                {
                    label: 'Temperature (°C)',
                    data: state.sensorHistory.temp,
                    borderColor: '#f97316',
                    backgroundColor: 'rgba(249, 115, 22, 0.08)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                },
                {
                    label: 'Humidity (%)',
                    data: state.sensorHistory.humidity,
                    borderColor: '#60a5fa',
                    backgroundColor: 'rgba(96, 165, 250, 0.08)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                },
            ]
        },
        options: {
            ...chartDefaults,
            scales: {
                x: {
                    display: false,
                },
                y: {
                    grid: {
                        color: 'rgba(226, 232, 240, 0.8)',
                        drawBorder: false,
                    },
                    ticks: {
                        color: '#64748b',
                        font: { size: 10, family: 'JetBrains Mono' },
                        padding: 8,
                    }
                }
            },
            interaction: {
                intersect: false,
                mode: 'index',
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#ffffff',
                    borderColor: '#e2e8f0',
                    borderWidth: 1,
                    titleColor: '#475569',
                    bodyColor: '#1e293b',
                    titleFont: { size: 10 },
                    bodyFont: { size: 11, family: 'JetBrains Mono' },
                    padding: 10,
                    cornerRadius: 8,
                    callbacks: {
                        // Full date beside the 12-hour time, e.g. "October 9, 2026, 2:05:30 PM"
                        title: (items) => {
                            const item = items[0];
                            const at = item ? state.sensorHistory.times[item.dataIndex] : null;
                            return at ? formatTimestamp(at) : (item?.label || '');
                        },
                    },
                }
            }
        }
    });

    // Detection Distribution Chart (Doughnut)
    const detCtx = document.getElementById('detectionChart').getContext('2d');
    detectionChart = new Chart(detCtx, {
        type: 'doughnut',
        data: {
            labels: detectionStatusLabels,
            datasets: [{
                data: [state.stats.normalCount || 0, state.stats.mildCount || 0, state.stats.stressCount || 0, state.stats.criticalCount || 0],
                backgroundColor: STATUS_ORDER.map((s) => STATUS_INFO[s].color),
                borderColor: STATUS_ORDER.map((s) => STATUS_INFO[s].border),
                borderWidth: 2,
                hoverBorderWidth: 4,
                hoverBorderColor: STATUS_ORDER.map(() => '#ffffff'),
            }]
        },
        options: {
            ...chartDefaults,
            animation: {
                duration: 500,
                easing: 'easeOutCubic',
                animateRotate: true,
                animateScale: true,
            },
            plugins: {
                legend: {
                    display: false,
                },
                tooltip: {
                    backgroundColor: '#ffffff',
                    borderColor: '#e2e8f0',
                    borderWidth: 1,
                    titleColor: '#475569',
                    bodyColor: '#1e293b',
                    bodyFont: { size: 11, family: 'JetBrains Mono' },
                    padding: 10,
                    cornerRadius: 8,
                }
            }
        }
    });

    renderDetectionLegend();

    // Severity Chart (Bar)
    const sevCtx = document.getElementById('severityChart').getContext('2d');
    const severityData = getSeverityData();
    severityChart = new Chart(sevCtx, {
        type: 'bar',
        data: {
            labels: ['Routine', 'Monitor', 'Urgent', 'Critical'],   // urgency, same order as getSeverityData()
            datasets: [{
                label: 'Ducks',
                data: severityData,
                backgroundColor: [
                    'rgba(34, 197, 94, 0.7)',
                    'rgba(234, 179, 8, 0.7)',
                    'rgba(249, 115, 22, 0.7)',
                    'rgba(239, 68, 68, 0.7)',
                ],
                borderColor: [
                    '#22c55e',
                    '#eab308',
                    '#f97316',
                    '#ef4444',
                ],
                borderWidth: 1,
                borderRadius: 6,
                barPercentage: 0.6,
            }]
        },
        options: {
            ...chartDefaults,
            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        color: '#475569',
                        font: {
                            size: 12,
                            family: 'DM Sans, system-ui, sans-serif',
                            style: 'normal',
                            weight: '400',
                        },
                    }
                },
                y: {
                    grid: {
                        color: 'rgba(226, 232, 240, 0.8)',
                        drawBorder: false,
                    },
                    ticks: {
                        color: '#475569',
                        font: {
                            size: 12,
                            family: 'DM Sans, system-ui, sans-serif',
                            style: 'normal',
                            weight: '400',
                        },
                        stepSize: 1,
                    }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#ffffff',
                    borderColor: '#e2e8f0',
                    borderWidth: 1,
                    titleColor: '#475569',
                    bodyColor: '#1e293b',
                    titleFont: { size: 10 },
                    bodyFont: { size: 11, family: 'JetBrains Mono' },
                    padding: 10,
                    bodySpacing: 4,
                    cornerRadius: 8,
                    displayColors: true,
                    callbacks: {
                        title: (items) => {
                            const item = Array.isArray(items) ? items[0] : items;
                            return item?.label || '';
                        },
                        label: (context) => {
                            const value = context.parsed?.y ?? context.raw;
                            return `${value}`;
                        }
                    }
                }
            }
        }
    });
}

// Severity chart counts ducks (sum of duck_count) of the 30-minute readings,
// matching the KPI cards
function getSeverityData() {
    const readings = thirtyMinuteReadings();
    const sum = (sev) => readings
        .filter(d => d.severity === sev)
        .reduce((total, d) => total + (d.count ?? 1), 0);
    // Routine -> Critical, matching the chart's labels and colours
    return [sum('LOW'), sum('MODERATE'), sum('HIGH'), sum('CRITICAL')];
}

function updateEnvChart() {
    if (!envChart) return;
    envChart.data.labels = state.sensorHistory.labels;
    envChart.data.datasets[0].data = state.sensorHistory.temp;
    envChart.data.datasets[1].data = state.sensorHistory.humidity;
    envChart.update('none');
}

// Same 30-minute readings as the KPI cards
function getDetectionDistributionValues() {
    return getDetectionDistributionCounts().map((count, idx) => (detectionLegendState[STATUS_ORDER[idx]] ? 0 : count));
}

// Ducks per status (same order as STATUS_ORDER), hidden slices included
function getDetectionDistributionCounts() {
    const readings = thirtyMinuteReadings();
    return STATUS_ORDER.map((status) => readings
        .filter(d => d.status === status)
        .reduce((total, d) => total + (d.count ?? 1), 0));
}

function renderDetectionLegend() {
    const legendDiv = document.getElementById('detectionLegend');
    if (!legendDiv || !detectionChart) return;
    const colors = detectionChart.data.datasets[0].backgroundColor;

    legendDiv.innerHTML = STATUS_ORDER.map((status, idx) => `
        <button type="button" class="ht-detection-legend-item${detectionLegendState[status] ? ' is-hidden' : ''}" data-detection-status="${status}"
            aria-pressed="${!detectionLegendState[status]}">
            <span class="ht-detection-legend-swatch" style="background:${colors[idx]};"></span>
            <span>${detectionStatusLabels[idx]}</span>
        </button>
    `).join('');

    legendDiv.querySelectorAll('[data-detection-status]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const status = btn.getAttribute('data-detection-status');
            detectionLegendState[status] = !detectionLegendState[status];
            renderDetectionLegend();
            updateDetectionChart();
        });
    });
}

function updateDetectionChart() {
    if (!detectionChart) return;
    detectionChart.data.datasets[0].data = getDetectionDistributionValues();
    detectionChart.update();
    renderDetectionLegend();
}

function updateSeverityChart() {
    if (!severityChart) return;
    severityChart.data.datasets[0].data = getSeverityData();
    severityChart.update('none');
}

// ============================================
// EXCEL EXPORT
// ============================================
function xlsStyle(id, o = {}) {
    const font = '<Font' + (o.bold ? ' ss:Bold="1"' : '') + ' ss:Size="' + (o.size || 11) + '" ss:FontName="Calibri"' + (o.color ? ' ss:Color="' + o.color + '"' : '') + '/>';
    const fill = o.fill ? '<Interior ss:Color="' + o.fill + '" ss:Pattern="Solid"/>' : '';
    const align = o.h ? '<Alignment ss:Horizontal="' + o.h + '" ss:Vertical="Center"' + (o.wrap ? ' ss:WrapText="1"' : '') + '/>' : '';
    const borders = o.borders
        ? '<Borders>' + o.borders.map(([pos, w, c]) => '<Border ss:LineStyle="Continuous" ss:Weight="' + w + '" ss:Color="' + c + '" ss:Position="' + pos + '"/>').join('') + '</Borders>'
        : '';
    const numFmt = o.numFmt ? '<NumberFormat ss:Format="' + o.numFmt + '"/>' : '';
    return '<Style ss:ID="' + id + '">' + font + fill + align + borders + numFmt + '</Style>';
}

// The rows the Detection Log shows for the chosen filters (status + period).
// Generate Report uses the same rows, so the file always matches the screen.
// Only first detections and the readings every 30 minutes after them are listed (see logEntryLabels),
// (the KPI cards count the '30 min' ones only).
// allRows: also the 10-minute readings between the 30-minute steps (Excel only)
function getFilteredLogDetections({ allRows = false } = {}) {
    // Strictly match the row's own Status or Urgency column (not its 30-minute peak)
    const { kind, level } = state.logFilter;
    const rows = logRowsInPeriod({ allRows });
    if (level === 'ALL') return rows;
    return rows.filter((d) => (kind === 'status' ? d.status : d.severity) === level);
}

// The log rows inside the chosen period, before the status / urgency filter
function logRowsInPeriod({ allRows = false } = {}) {
    const { start, end } = getLogDateBounds();
    // One entry per moment: the 30-minute peak rides along on its entry
    const rows = attachThirtyMinutePeaks(allRows ? summaryDetections() : logEntryDetections());
    if (!start && !end) return rows;
    return rows.filter(d => {
        const ts = d.timestamp instanceof Date ? d.timestamp : new Date(d.timestamp);
        if (start && ts < start) return false;
        if (end && ts > end) return false;
        return true;
    });
}

// Filter chips: one set per kind, in severity order, each with its own colour
const LOG_FILTER_CHIPS = {
    status: STATUS_ORDER.map((s) => ({ level: s, label: STATUS_INFO[s].label, color: STATUS_INFO[s].color })),
    urgency: [
        { level: 'LOW', color: '#22c55e' },
        { level: 'MODERATE', color: '#f59e0b' },
        { level: 'HIGH', color: '#f97316' },
        { level: 'CRITICAL', color: '#ef4444' },
    ],
};

// Text for the Excel header, e.g. 'Urgency Level – Urgent'
function logFilterLabel() {
    const { kind, level } = state.logFilter;
    if (level === 'ALL') return 'All Records';
    return kind === 'status' ? `Status – ${STATUS_INFO[level].label}` : `Urgency Level – ${URGENCY_NAME[level]}`;
}

// Redraws the Status / Urgency switch and the chips with their record counts (for the chosen period)
function renderLogFilterChips() {
    const box = document.getElementById('logFilterChips');
    if (!box) return;
    const { kind, level } = state.logFilter;
    const rows = logRowsInPeriod();
    const count = (lvl) => rows.filter((d) => (kind === 'status' ? d.status : d.severity) === lvl).length;
    const chip = (lvl, label, color) => `
        <button type="button" class="ht-log-chip${level === lvl ? ' is-active' : ''}" data-log-level="${lvl}"
            aria-pressed="${level === lvl}"${color ? ` style="--chip:${color}"` : ''}>
            ${color ? '<span class="ht-log-chip__dot" aria-hidden="true"></span>' : ''}${label}<b>${lvl === 'ALL' ? rows.length : count(lvl)}</b>
        </button>`;

    document.querySelectorAll('[data-log-kind]').forEach((btn) => {
        const active = btn.dataset.logKind === kind;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-pressed', String(active));
    });
    box.innerHTML = chip('ALL', 'All Records')
        + LOG_FILTER_CHIPS[kind].map((c) => chip(c.level, c.label || URGENCY_NAME[c.level], c.color)).join('');
}

function exportDetectionsToExcel() {
    // Every 10-minute reading, not only the Detection Log entries
    // Rows that fit no 10-minute mark (e.g. test rows seconds apart) are left out
    const minutesIn = countDurations();   // Duration column: 10 / 20 / 30 min
    const rows = getFilteredLogDetections({ allRows: true }).filter((d) => minutesIn.has(d.id));
    // Summary boxes count the same way as the KPI cards: the listed entries
    // (readings after every 30 minutes of monitoring, not the first detection)
    // in the chosen filters
    const durations = logEntryLabels();   // same badges as the Detection Log
    const counts = getDetectionCounts(rows.filter((d) => isThirtyMinuteReading(d, durations)));
    const totalDucks = counts.total || 0;
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    // Local date/time as Excel's DateTime value (no time zone shift)
    const xlsDate = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
        + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + '.000';

    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    // An empty "Number" cell makes Excel refuse the file, so empty values are text
    const numCell = (style, value, digits) => (value == null || Number.isNaN(Number(value)))
        ? '<Cell ss:StyleID="' + style + '"><Data ss:Type="String">--</Data></Cell>'
        : '<Cell ss:StyleID="' + style + '"><Data ss:Type="Number">' + Number(value).toFixed(digits) + '</Data></Cell>';
    const textCell = (style, text, merge = 0) =>
        '<Cell' + (merge ? ' ss:MergeAcross="' + merge + '"' : '') + ' ss:StyleID="' + style + '"><Data ss:Type="String">' + esc(text) + '</Data></Cell>';

    const allSides = (color) => ['Top', 'Bottom', 'Left', 'Right'].map((p) => [p, 1, color]);
    const white = allSides('#FFFFFF');

    // ---- Styles (same colours as before) ----
    let styleXml = '<Styles>';
    styleXml += xlsStyle('sTitle', { bold: true, size: 20, color: '#FFFFFF', fill: '#F4A15D', h: 'Center', borders: [['Bottom', 2.4, '#FB923C']] });
    styleXml += xlsStyle('sSpacer', { size: 11 });
    styleXml += xlsStyle('sGenerated', { bold: true, size: 10, color: '#F3F3F3', fill: '#FFA75F', h: 'Left', borders: allSides('#FB923C') });
    styleXml += xlsStyle('sCardNormalVal', { bold: true, size: 11, color: '#274E13', fill: '#70F09F', h: 'Center' });
    styleXml += xlsStyle('sCardMildVal', { bold: true, size: 11, color: '#783F04', fill: '#F7BC5B', h: 'Center' });
    styleXml += xlsStyle('sCardModerateVal', { bold: true, size: 11, color: '#9A3412', fill: '#FDBA74', h: 'Center' });
    styleXml += xlsStyle('sCardHeatstressVal', { bold: true, size: 11, color: '#CE2B1D', fill: '#FF9494', h: 'Center' });
    styleXml += xlsStyle('sCardNormalLbl', { bold: true, size: 11, color: '#FFFFFF', fill: '#4ADE80', h: 'Center' });
    styleXml += xlsStyle('sCardMildLbl', { bold: true, size: 11, color: '#FFFFFF', fill: '#F59E0B', h: 'Center' });
    styleXml += xlsStyle('sCardModerateLbl', { bold: true, size: 11, color: '#FFFFFF', fill: '#FB923C', h: 'Center' });
    styleXml += xlsStyle('sCardHeatstressLbl', { bold: true, size: 11, color: '#FFFFFF', fill: '#F87171', h: 'Center' });
    styleXml += xlsStyle('sAvgTempLbl', { bold: true, size: 11, color: '#FFFFFF', fill: '#FB923C', h: 'Left', borders: allSides('#FB923C') });
    styleXml += xlsStyle('sAvgTempVal', { bold: true, size: 11, color: '#9A3412', fill: '#FDBA74', h: 'Center', borders: allSides('#FB923C'), numFmt: '0.0&quot; °C&quot;' });
    styleXml += xlsStyle('sHeader', { bold: true, size: 11, color: '#FFFFFF', fill: '#FB923C', h: 'Center', wrap: true, borders: white });
    // Timestamps are real Excel dates, so the column sorts and filters by time
    const tsFmt = 'mmmm d, yyyy, h:mm:ss AM/PM';
    styleXml += xlsStyle('sDataRow1Timestamp', { size: 10, fill: '#FFCBA2', h: 'Center', borders: white, numFmt: tsFmt });
    styleXml += xlsStyle('sDataRow2Timestamp', { size: 10, fill: '#FFDDC2', h: 'Center', borders: white, numFmt: tsFmt });
    // Surface temps always show one decimal
    styleXml += xlsStyle('sTempRow1', { size: 10, fill: '#FFCBA2', h: 'Center', borders: white, numFmt: '0.0' });
    styleXml += xlsStyle('sTempRow2', { size: 10, fill: '#FFDDC2', h: 'Center', borders: white, numFmt: '0.0' });
    styleXml += xlsStyle('sNote', { size: 9, color: '#6B7280', h: 'Left', wrap: true });
    styleXml += xlsStyle('sStatusNormal', { size: 10, color: '#FFFFFF', fill: '#4ADE80', h: 'Center', borders: white });
    styleXml += xlsStyle('sStatusMild', { size: 10, color: '#FFFFFF', fill: '#F59E0B', h: 'Center', borders: white });
    styleXml += xlsStyle('sStatusModerate', { size: 10, color: '#FFFFFF', fill: '#FB923C', h: 'Center', borders: white });
    styleXml += xlsStyle('sStatusHeatstress', { size: 10, color: '#FFFFFF', fill: '#F87171', h: 'Center', borders: white });
    styleXml += xlsStyle('sSevLow', { size: 10, color: '#FFFFFF', fill: '#4ADE80', h: 'Center', borders: white });
    styleXml += xlsStyle('sSevModerate', { size: 10, color: '#FFFFFF', fill: '#FACC15', h: 'Center', borders: white });
    styleXml += xlsStyle('sSevHigh', { size: 10, color: '#FFFFFF', fill: '#FB923C', h: 'Center', borders: white });
    styleXml += xlsStyle('sSevCritical', { size: 10, color: '#FFFFFF', fill: '#F87171', h: 'Center', borders: white });
    styleXml += xlsStyle('sDataCenterRow1', { size: 10, fill: '#FFCBA2', h: 'Center', borders: white });
    styleXml += xlsStyle('sDataCenterRow2', { size: 10, fill: '#FFDDC2', h: 'Center', borders: white });
    styleXml += xlsStyle('sRecRow1', { size: 10, fill: '#FFCBA2', h: 'Left', wrap: true, borders: white });
    styleXml += xlsStyle('sRecRow2', { size: 10, fill: '#FFDDC2', h: 'Left', wrap: true, borders: white });
    styleXml += '</Styles>';

    // ---- Columns: A margin | B-C Timestamp | D Duration | E Status | F Lowest | G Average |
    //      H Highest | I Duck Count | J Batch Count | K Urgency Level | L-M Top Recommendation ----
    // B-C fit the longest timestamp ("September 30, 2026, 12:05:30 PM"); a date that
    // doesn't fit shows as ##### in Excel
    const colWidths = [22, 95, 95, 70, 80, 80, 80, 80, 70, 75, 75, 120, 120];
    const span = colWidths.length - 2;          // MergeAcross for full-width rows (B..M)
    let tableXml = '<Table>' + colWidths.map((w) => '<Column ss:Width="' + w + '"/>').join('');
    const fullRow = (height, style, text) =>
        '<Row ss:Height="' + height + '"><Cell/>' + textCell(style, text, span) + '</Row>';
    const spacerRow = fullRow(15, 'sSpacer', '');

    // Which filters produced this report
    const { start, end } = getLogDateBounds();
    const fmtDay = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    let period = logPeriodLabel();
    if (state.logPeriod !== 'custom' && start && end && start.getTime() > 0) period += ' (' + fmtDay(start) + (fmtDay(start) === fmtDay(end) ? '' : ' to ' + fmtDay(end)) + ')';
    const generated = now.toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
    });

    tableXml += '<Row ss:Height="15"><Cell/></Row>';
    tableXml += fullRow(26, 'sTitle', 'HeatTrack Analytics Report');
    tableXml += spacerRow;
    tableXml += fullRow(18, 'sGenerated', 'Generated: ' + generated);
    tableXml += fullRow(18, 'sGenerated', 'Filter: ' + logFilterLabel() + '   |   Period: ' + period
        // Total = the ducks of all four statuses, the same sum as the boxes below
        + '   |   Total Records: ' + totalDucks);
    tableXml += spacerRow;

    // ---- Summary boxes: one per status (with share of all ducks) ----
    const share = (n) => (totalDucks ? ' (' + Math.round(((n || 0) / totalDucks) * 100) + '%)' : '');
    const cards = [
        ['sCardNormalVal', 'sCardNormalLbl', counts.comfort, 'Thermal Comfort' + share(counts.comfort)],
        ['sCardMildVal', 'sCardMildLbl', counts.mild, 'Mild Heat Stress' + share(counts.mild)],
        ['sCardModerateVal', 'sCardModerateLbl', counts.moderate, 'Moderate Heat Stress' + share(counts.moderate)],
        ['sCardHeatstressVal', 'sCardHeatstressLbl', counts.severe, 'Severe Heat Stress' + share(counts.severe)],
    ];
    const cardStart = [2, 5, 8, 11];            // columns B, E, H, K (3 wide each, B..M)
    tableXml += '<Row ss:Height="22"><Cell/>' + cards.map((c, i) =>
        '<Cell ss:Index="' + cardStart[i] + '" ss:MergeAcross="2" ss:StyleID="' + c[0] + '"><Data ss:Type="Number">' + (c[2] || 0) + '</Data></Cell>').join('') + '</Row>';
    tableXml += '<Row ss:Height="22"><Cell/>' + cards.map((c, i) =>
        '<Cell ss:Index="' + cardStart[i] + '" ss:MergeAcross="2" ss:StyleID="' + c[1] + '"><Data ss:Type="String">' + c[3] + '</Data></Cell>').join('') + '</Row>';
    tableXml += spacerRow;

    // ---- Average body temperature: mean of the Average Surface Temp column below ----
    const avgTemps = rows.map((d) => d.avgTemp).filter((t) => t != null && !Number.isNaN(Number(t))).map(Number);
    const avgBodyTemp = avgTemps.length ? avgTemps.reduce((sum, t) => sum + t, 0) / avgTemps.length : null;
    tableXml += '<Row ss:Height="22"><Cell/>'
        + textCell('sAvgTempLbl', 'Average Body Temperature (' + avgTemps.length + ' reading' + (avgTemps.length === 1 ? '' : 's') + ')', 8)
        + '<Cell ss:MergeAcross="2" ss:StyleID="sAvgTempVal">' + (avgBodyTemp == null
            ? '<Data ss:Type="String">--</Data>'
            : '<Data ss:Type="Number">' + avgBodyTemp.toFixed(1) + '</Data>') + '</Cell>'
        + '</Row>';
    tableXml += spacerRow;

    // ---- Table header (same columns as the Detection Log) ----
    tableXml += '<Row ss:Height="30"><Cell/>'
        + textCell('sHeader', 'Timestamp', 1)
        + ['Duration', 'Status', 'Lowest Surface Temp (°C)', 'Average Surface Temp (°C)', 'Highest Surface Temp (°C)',
           'Duck Count', 'Batch Count', 'Urgency Level'].map((h) => textCell('sHeader', h)).join('')
        + textCell('sHeader', 'Top Recommendation', 1)
        + '</Row>';
    // Row number of the header: frozen on screen and repeated on every printed page
    const headerRow = (tableXml.match(/<Row/g) || []).length;

    // ---- Data rows ----
    rows.forEach((d) => {
        // Minutes into the count: 10, 20, 30 (the Detection Log's '30 min' step),
        // then 10, 20, 30 again; older rows without an interval were 30-minute rows
        const interval = minutesIn.get(d.id) || '30 min';
        // Darker fill (Row1) for 30-minute rows, lighter (Row2) for 10-minute rows
        const odd = interval === '30 min';
        const rowN = odd ? 'Row1' : 'Row2';
        const tempCell = (t) => numCell('sTemp' + rowN, t, 1);
        const ts = d.timestamp instanceof Date ? d.timestamp : new Date(d.timestamp);
        const tsCell = Number.isNaN(ts.getTime())
            ? textCell(odd ? 'sDataRow1Timestamp' : 'sDataRow2Timestamp', '--', 1)
            : '<Cell ss:MergeAcross="1" ss:StyleID="' + (odd ? 'sDataRow1Timestamp' : 'sDataRow2Timestamp') + '"><Data ss:Type="DateTime">' + xlsDate(ts) + '</Data></Cell>';
        const sevText = urgencyName(severityLevels.includes(d.severity) ? d.severity : 'LOW');
        const center = odd ? 'sDataCenterRow1' : 'sDataCenterRow2';
        const recStyle = odd ? 'sRecRow1' : 'sRecRow2';
        const statusText = statusLabel(d.status);
        const statusStyle = { COMFORT: 'sStatusNormal', MILD: 'sStatusMild', MODERATE: 'sStatusModerate', SEVERE: 'sStatusHeatstress' }[d.status] || 'sStatusNormal';
        const sevStyle = d.severity === 'CRITICAL' ? 'sSevCritical' : d.severity === 'HIGH' ? 'sSevHigh'
            : d.severity === 'MODERATE' ? 'sSevModerate' : 'sSevLow';
        const recText = buildRecommendationFromDetection(d)?.action || '';
        const rowHeight = Math.max(24, (Math.ceil(recText.length / 45) + 1) * 14);
        const batch = d.batchCount != null && /^\d+$/.test(String(d.batchCount))
            ? numCell(center, d.batchCount, 0)
            : textCell(center, d.batchCount ?? '--');

        tableXml += '<Row ss:Height="' + rowHeight + '"><Cell/>'
            + tsCell
            + textCell(center, interval)
            + textCell(statusStyle, statusText)
            + tempCell(d.lowTemp)
            + tempCell(d.avgTemp)
            + tempCell(d.highTemp)
            + numCell(center, d.count ?? 0, 0)
            + batch
            + textCell(sevStyle, sevText)
            + textCell(recStyle, recText, 1)
            + '</Row>';
    });

    if (!rows.length) {
        tableXml += fullRow(30, 'sDataCenterRow1', 'No detections for the selected events and period.');
    }
    tableXml += spacerRow;
    tableXml += fullRow(28, 'sNote', 'Duration: minutes into each 30-minute step of monitoring (10, 20, 30, then 10, 20, 30 again). The first detection is 10 min; after 10 minutes with no reading, counting starts again at 10 min. Totals count the 30 min readings only. '
        + 'Results and recommendations are assistive only. Always confirm with on-site observation and follow your farm protocol or veterinary guidance.');
    tableXml += '</Table>';

    const sheetName = 'HeatTrack Report';
    const xml = '<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?>'
        + '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office"'
        + ' xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">'
        + styleXml + '<Worksheet ss:Name="' + sheetName + '">'
        // Print the table header at the top of every page
        + '<Names><NamedRange ss:Name="Print_Titles" ss:RefersTo="=\'' + sheetName + '\'!R' + headerRow + '"/></Names>'
        + tableXml
        // Print / PDF: landscape, all columns on one page width, page numbers in the footer
        + '<WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><PageSetup><Layout x:Orientation="Landscape"/>'
        + '<Footer x:Margin="0.2" x:Data="&amp;LHeatTrack Analytics Report&amp;RPage &amp;P of &amp;N"/>'
        + '<PageMargins x:Left="0.3" x:Right="0.3" x:Top="0.4" x:Bottom="0.5"/></PageSetup><FitToPage/>'
        + '<Print><FitWidth>1</FitWidth><FitHeight>0</FitHeight><ValidPrinterInfo/></Print>'
        // Keep everything down to the table header in view while scrolling
        + '<FreezePanes/><FrozenNoSplit/><SplitHorizontal>' + headerRow + '</SplitHorizontal>'
        + '<TopRowBottomPane>' + headerRow + '</TopRowBottomPane><ActivePane>2</ActivePane>'
        + '</WorksheetOptions>'
        + '</Worksheet></Workbook>';

    // The link must be on the page, and the file kept a moment, for every browser to download it
    const blob = new Blob([xml], { type: 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // Local date and time (toISOString is UTC, which can be the wrong day)
    a.download = 'heattrack_report_' + xlsDate(now).slice(0, 10) + '_' + pad(now.getHours()) + pad(now.getMinutes()) + '.xls';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
}

// ============================================
// EVENT LISTENERS
// ============================================
function setupEventListeners() {
    const alertBtn = document.getElementById('alertBtn');
    const settingsBtn = document.getElementById('settingsBtn');

    // Settings -> FAQ button: close the settings panel when leaving for the FAQ page
    document.querySelector('.ht-settings-faq-link')?.addEventListener('click', closeHeaderPanels);

    // Suppress hover/tooltips on touch for alert/settings
    alertBtn?.addEventListener('touchstart', suppressHoverTemporarily, { passive: true });
    settingsBtn?.addEventListener('touchstart', suppressHoverTemporarily, { passive: true });

    // Alert button
    alertBtn?.addEventListener('click', () => {
        const panel = document.getElementById('alertPanel');
        const settingsPanel = document.getElementById('settingsPanel');
        const menuBtn = document.getElementById('navMenuToggle');
        const nav = document.getElementById('mobileNav');
        const wasHidden = panel.classList.contains('u-hidden');

        if (wasHidden) {
            animatePanelOpen(panel);
            alertBtn.classList.add('is-active');
            animatePanelClose(settingsPanel);
            settingsBtn?.classList.remove('is-active');
            nav?.classList.remove('is-open');
            menuBtn?.classList.remove('is-active');
            menuBtn?.setAttribute('aria-expanded', 'false');
        } else {
            animatePanelClose(panel);
            alertBtn.classList.remove('is-active');
            suppressHoverTemporarily();
        }
    });

    // "View alerts" buttons elsewhere on the page (e.g. About) open the bell's panel.
    // stopPropagation keeps the outside-click handler below from closing it again.
    document.querySelectorAll('[data-open-alerts]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (document.getElementById('alertPanel')?.classList.contains('u-hidden')) alertBtn?.click();
        });
    });

    // Settings button
    settingsBtn?.addEventListener('click', () => {
        const panel = document.getElementById('settingsPanel');
        const alertPanel = document.getElementById('alertPanel');
        const menuBtn = document.getElementById('navMenuToggle');
        const nav = document.getElementById('mobileNav');
        const wasHidden = panel.classList.contains('u-hidden');

        if (wasHidden) {
            animatePanelOpen(panel);
            settingsBtn.classList.add('is-active');
            animatePanelClose(alertPanel);
            alertBtn?.classList.remove('is-active');
            nav?.classList.remove('is-open');
            menuBtn?.classList.remove('is-active');
            menuBtn?.setAttribute('aria-expanded', 'false');
        } else {
            animatePanelClose(panel);
            settingsBtn.classList.remove('is-active');
            suppressHoverTemporarily();
        }
    });

    // Prevent clicks inside panels from bubbling and triggering outside-click close
    const alertPanel = document.getElementById('alertPanel');
    const settingsPanel = document.getElementById('settingsPanel');

    alertPanel?.addEventListener('click', (e) => {
        e.stopPropagation();
    });

    settingsPanel?.addEventListener('click', (e) => {
        e.stopPropagation();
    });

    // Close panels on outside click (but not when clicking inside the panels)
    document.addEventListener('click', (e) => {
        const alertPanel = document.getElementById('alertPanel');
        const settingsPanel = document.getElementById('settingsPanel');
        if (!alertPanel || !settingsPanel || !alertBtn || !settingsBtn) return;
        if (!alertPanel.contains(e.target) && !alertBtn.contains(e.target)) {
            animatePanelClose(alertPanel);
            alertBtn.classList.remove('is-active');
            suppressHoverTemporarily();
        }
        if (!settingsPanel.contains(e.target) && !settingsBtn.contains(e.target)) {
            animatePanelClose(settingsPanel);
            settingsBtn.classList.remove('is-active');
            suppressHoverTemporarily();
        }
    });

    // Read all: marks every notification as read (they stay in the list)
    document.getElementById('readAllAlerts')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const now = new Date();
        const unread = state.alerts.filter((a) => !a.viewed);
        unread.forEach((a) => { a.viewed = true; a.viewedAt = now; });
        updateAlertBadge();
        saveAlerts();
        markAlertsRead(unread);   // read on every browser of this account
        renderAlerts();
        lucide.createIcons();
    });

    // Close toast
    document.getElementById('closeToast')?.addEventListener('click', () => {
        const toast = document.getElementById('alertToast');
        toast.classList.remove('is-visible');
    });

    // "View details": open the recommendation details and mark the alert as viewed
    document.getElementById('toastDetails')?.addEventListener('click', () => {
        document.getElementById('alertToast')?.classList.remove('is-visible');
        const detection = state.lastToastDetection;
        if (!detection) return;
        if (detection.id) {
            markAlertAsViewed(detection.id);
        }
        const currentTemp = state.sensorHistory.temp.length > 0 ? state.sensorHistory.temp[state.sensorHistory.temp.length - 1] : null;
        openRecommendationModal(buildRecommendationFromDetection(detection), currentTemp);
    });

    // Recommendation modal controls
    document.getElementById('closeRecommendationModal')?.addEventListener('click', closeRecommendationModal);
    document.getElementById('recommendationModalBackdrop')?.addEventListener('click', closeRecommendationModal);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeRecommendationModal();
        }
    });

    // Log filter: the Status / Urgency switch picks the chip set (and clears the choice),
    // a chip filters by that one level
    document.querySelectorAll('[data-log-kind]').forEach((btn) => {
        btn.addEventListener('click', () => {
            if (state.logFilter.kind === btn.dataset.logKind) return;
            state.logFilter = { kind: btn.dataset.logKind, level: 'ALL' };
            state.currentPage = 1;
            renderDetectionLogs();
            resetLogChipsScroll(true);   // the new set starts at its first chip
        });
    });
    const logChips = document.getElementById('logFilterChips');
    let chipDrag = null;      // mouse drag in progress: { x, left, moved }
    let chipDragged = false;  // the last drag moved, so its click is not a chip pick
    logChips?.addEventListener('click', (e) => {
        if (chipDragged) { chipDragged = false; return; }
        const chip = e.target.closest('[data-log-level]');
        if (!chip) return;
        state.logFilter.level = chip.dataset.logLevel;
        state.currentPage = 1;
        renderDetectionLogs();
    });
    // On narrow screens the chips sit on one line that scrolls sideways. Touch swipes
    // scroll natively; a mouse can drag the row or use the wheel, since the scrollbar is hidden
    logChips?.addEventListener('pointerdown', (e) => {
        if (e.pointerType !== 'mouse' || logChips.scrollWidth <= logChips.clientWidth) return;
        chipDrag = { x: e.clientX, left: logChips.scrollLeft, moved: false };
    });
    window.addEventListener('pointermove', (e) => {
        if (!chipDrag) return;
        const dx = e.clientX - chipDrag.x;
        if (Math.abs(dx) > 5) chipDrag.moved = true;
        if (chipDrag.moved) logChips.scrollLeft = chipDrag.left - dx;
    });
    window.addEventListener('pointerup', () => {
        if (chipDrag?.moved) chipDragged = true;
        chipDrag = null;
    });
    logChips?.addEventListener('wheel', (e) => {
        if (logChips.scrollWidth <= logChips.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
        e.preventDefault();
        logChips.scrollLeft += e.deltaY;
    }, { passive: false });

    initLogPeriod();

    // Pagination
    document.getElementById('prevPage')?.addEventListener('click', () => {
        if (state.currentPage > 1) {
            state.currentPage--;
            renderDetectionLogs();
        }
    });

    document.getElementById('nextPage')?.addEventListener('click', () => {
        state.currentPage++;
        renderDetectionLogs();
    });

    // Export logs to Excel
    document.getElementById('exportLogs')?.addEventListener('click', exportDetectionsToExcel);

    // Fullscreen camera expansion
    const normalCameraContainer = document.getElementById('normalCameraContainer');
    const thermalCameraContainer = document.getElementById('thermalCameraContainer');
    if (normalCameraContainer) {
        normalCameraContainer.addEventListener('click', () => {
            if (!state.cameraActive) return;
            toggleFullscreen(normalCameraContainer);
        });
        syncCameraZoomCursor(normalCameraContainer);
        initWheelZoom(normalCameraContainer);
    }
    if (thermalCameraContainer) {
        thermalCameraContainer.addEventListener('click', () => {
            if (!state.cameraActive) return;
            toggleFullscreen(thermalCameraContainer);
        });
        syncCameraZoomCursor(thermalCameraContainer);
        initWheelZoom(thermalCameraContainer);
    }
    document.addEventListener('fullscreenchange', () => {
        syncCameraZoomCursor(normalCameraContainer);
        syncCameraZoomCursor(thermalCameraContainer);
    });

    // Camera Streams applies to the whole account; Alert Notifications to this browser only
    document.getElementById('cameraToggle')?.addEventListener('change', (e) => {
        state.cameraActive = e.target.checked;
        updateSystemToggleStates();
        drawAnnotations();
        saveDeviceSettings();
        saveAccountSettings();
    });

    document.getElementById('alertToggle')?.addEventListener('change', (e) => {
        state.alertsWanted = e.target.checked;
        saveDeviceSettings();
        updateSystemToggleStates();
    });

    updateSystemToggleStates();

    // Navigation links: ensure clicking a nav control always activates the view
    document.querySelectorAll('[data-nav]').forEach((navEl) => {
        navEl.addEventListener('click', (e) => {
            e.preventDefault();
            const target = navEl.getAttribute('data-nav');
            if (!target) return;

            // Show the view and scroll to top even if already on the same route
            showView(target);

            // Update the URL hash if it's different; avoid redundant hashchange
            const desiredHash = `#${target}`;
            if ((location.hash || '').toLowerCase() !== desiredHash.toLowerCase()) {
                location.hash = desiredHash;
            } else {
                try {
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                } catch (_) {
                    window.scrollTo(0, 0);
                }
            }
        });
    });
}

// Determine whether a container has a visible media source (img or video)
function mediaPresentInContainer(container) {
    if (!container) return false;
    const video = container.querySelector('video');
    const img = container.querySelector('img');
    if (video) {
        if (video.srcObject) return true;
        if (video.currentSrc && video.currentSrc.trim() !== '') return true;
        if (video.readyState && video.readyState > 0) return true;
    }
    if (img) {
        // Live feeds from livefeed.js count only once a real frame has arrived
        // and the camera is still sending (a stream with no frames is just black)
        if (img.dataset.feed) return img.dataset.live === '1' && (img.dataset.state || 'streaming') === 'streaming';
        if (img.src && img.src.trim() !== '') return true;
    }
    return false;
}

function getMonitorsHaveMedia() {
    const normalContainer = document.getElementById('normalCameraContainer');
    const thermalContainer = document.getElementById('thermalCameraContainer');
    const normalHas = mediaPresentInContainer(normalContainer);
    const thermalHas = mediaPresentInContainer(thermalContainer);
    return { normalHas, thermalHas, any: normalHas || thermalHas };
}

function updateMonitorPresenceUI() {
    const normalContainer = document.getElementById('normalCameraContainer');
    const thermalContainer = document.getElementById('thermalCameraContainer');
    const { normalHas, thermalHas } = getMonitorsHaveMedia();
    // Respect the user Camera Streams toggle — if streams are turned off, do not
    // show the "No Camera Connected" message. Instead show "Camera Streams Disabled".
    const cameraToggle = document.getElementById('cameraToggle');
    const streamsEnabled = cameraToggle ? cameraToggle.checked : true;

    [[normalContainer, normalHas], [thermalContainer, thermalHas]].forEach(([container, has]) => {
        if (!container) return;
        const notice = container.querySelector('.ht-camera__no-camera');
        if (notice) notice.remove();
        container.classList.remove('ht-camera--no-input');

        const hardwareAbsent = cameraToggle ? cameraToggle.disabled && !cameraToggle.checked : false;
        const shouldShowOffline = !streamsEnabled || !has;
        const feedText = container.querySelector('img[data-feed]')?.dataset.offlineText;
        const offlineText = !streamsEnabled
            ? (hardwareAbsent ? 'Camera not connected' : 'Camera streams disabled')
            : (feedText || 'Camera not connected');

        container.classList.toggle('camera-feed--offline', shouldShowOffline);
        if (shouldShowOffline) {
            container.dataset.offlineText = offlineText;
            // Only cut the stream when streams are off; otherwise keep it connecting
            // in the background so the picture comes back as soon as frames arrive
            if (!streamsEnabled) stopMediaInContainer(container);
        } else {
            container.removeAttribute('data-offline-text');
        }
    });

    // LIVE badge lights up only while the live picture is showing
    document.querySelectorAll('.ht-live-badge').forEach((badge, index) => {
        const monitorHasMedia = index === 0 ? normalHas : thermalHas;
        badge.classList.toggle('ht-live-badge--disabled', !(streamsEnabled && monitorHasMedia));
    });
}

function stopMediaInContainer(container) {
    if (!container) return;
    // Stop video elements
    const videos = container.querySelectorAll('video');
    videos.forEach((v) => {
        try {
            v.pause();
            if (v.srcObject && v.srcObject.getTracks) {
                v.srcObject.getTracks().forEach(t => t.stop());
            }
            v.srcObject = null;
            v.removeAttribute('src');
            v.load?.();
        } catch (e) {
            // ignore
        }
    });
    // Clear images
    const imgs = container.querySelectorAll('img');
    imgs.forEach((img) => {
        try {
            img.removeAttribute('src');
        } catch (e) {}
    });
}

function observeMonitorMediaChanges() {
    const normalContainer = document.getElementById('normalCameraContainer');
    const thermalContainer = document.getElementById('thermalCameraContainer');
    const obsConfig = { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcObject'] };
    const debounced = (() => {
        let t = null;
        return () => {
            clearTimeout(t);
            t = setTimeout(() => updateMonitorPresenceUI(), 150);
        };
    })();

    const observer = new MutationObserver(() => debounced());
    if (normalContainer) observer.observe(normalContainer, obsConfig);
    if (thermalContainer) observer.observe(thermalContainer, obsConfig);

    // Also run once to initialize
    updateMonitorPresenceUI();
}

// ============================================
// PROFILE (Supabase "profiles" table)
// ============================================
let currentUser = null;
let profileStatusTimer = null;

// Database columns are lowercase (firstname), the UI uses camelCase (firstName)
function mapProfileRow(row) {
    return {
        id: row.id,
        firstName: row.firstname || '',
        lastName: row.lastname || '',
        username: row.username || '',
        email: row.email || '',
        role: row.role || '',
        status: row.status || 'approved',
        createdAt: row.created_at || null,
    };
}

async function fetchCurrentProfile() {
    const { data: { user }, error: userError } = await sb.auth.getUser();
    if (userError || !user) return null;

    let { data, error } = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
    if (error) {
        console.error('Could not load profile:', error);
        return null;
    }

    // Safety net: create the profile if the signup trigger did not (e.g. accounts made before it existed)
    if (!data) {
        const meta = user.user_metadata || {};
        const fallback = {
            id: user.id,
            firstname: meta.firstname || '',
            lastname: meta.lastname || '',
            username: meta.username || (user.email || '').split('@')[0],
            email: user.email,
            status: meta.status || 'pending',
        };
        const inserted = await sb.from('profiles').insert(fallback).select().single();
        if (inserted.error) {
            console.error('Could not create profile:', inserted.error);
            return null;
        }
        data = inserted.data;
    }
    // The user's own device (row-level security lets them read only their own row)
    const { data: device, error: deviceError } = await sb.from('devices').select('device_code').eq('owner_id', user.id).maybeSingle();
    if (deviceError) console.warn('Could not load the linked device:', deviceError);
    return { ...mapProfileRow(data), deviceCode: device?.device_code || '' };
}

function renderProfile() {
    const form = document.getElementById('profileForm');
    if (!form) return;
    const u = currentUser || { firstName: '', lastName: '', username: '', email: '', createdAt: null };

    form.elements.firstName.value = u.firstName;
    form.elements.lastName.value = u.lastName;
    form.elements.username.value = u.username;
    form.elements.email.value = u.email;
    if (form.elements.deviceCode) form.elements.deviceCode.value = u.deviceCode || '';

    const fullName = `${u.firstName} ${u.lastName}`.trim();
    const initials = (u.firstName.charAt(0) + u.lastName.charAt(0)) || u.username.charAt(0) || '?';

    document.getElementById('profileFullName').textContent = fullName || u.username || '--';
    document.getElementById('profileHandle').textContent = u.username ? '@' + u.username : '';
    document.getElementById('profileAvatar').textContent = initials;
    document.getElementById('profileSince').textContent = u.createdAt
        ? 'Member since ' + new Date(u.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
        : '';
}

// Empties the password fields, hides the typed text and resets the checklist
function resetProfilePasswordFields() {
    const form = document.getElementById('profileForm');
    if (!form) return;
    ['currentPassword', 'newPassword', 'confirmNewPassword'].forEach((name) => {
        const input = form.elements[name];
        if (!input) return;
        input.value = '';
        input.setCustomValidity('');
    });
    form.querySelectorAll('#profilePasswordSection [data-password-toggle]').forEach((toggle) => {
        const input = toggle.parentElement.querySelector('input');
        if (input) input.type = 'password';
        toggle.setAttribute('aria-label', 'Show password');
        toggle.innerHTML = '<i data-lucide="eye"></i>';
    });
    updatePasswordChecklist(
        '',
        [...form.querySelectorAll('#profilePasswordRequirements [data-password-requirement]')],
        form.querySelector('#profilePasswordSection [data-password-strength-wrapper]'),
        form.querySelector('#profilePasswordStrength span'),
    );
    lucide.createIcons();
}

function setProfileEditing(on) {
    const form = document.getElementById('profileForm');
    if (!form) return;
    form.querySelectorAll('input:not([data-locked])').forEach((input) => { input.readOnly = !on; });
    form.elements.username?.setCustomValidity('');
    resetProfilePasswordFields();
    document.getElementById('profilePasswordSection')?.classList.toggle('u-hidden', !on);
    document.getElementById('profileEditBtn').classList.toggle('u-hidden', on);
    document.getElementById('profileActions').classList.toggle('u-hidden', !on);
    document.getElementById('profileStatus').classList.add('u-hidden');
    if (on) form.elements.firstName.focus();
}

function showProfileStatus(message, duration = 3000, type = 'success') {
    const el = document.getElementById('profileStatus');
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('ht-profile__status--error', type === 'error');
    el.classList.remove('u-hidden');
    clearTimeout(profileStatusTimer);
    profileStatusTimer = setTimeout(() => el.classList.add('u-hidden'), duration);
}

function resetProfile() {
    currentUser = null;
    setProfileEditing(false);
    renderProfile();
}

function initProfile() {
    const form = document.getElementById('profileForm');
    if (!form) return;

    applyFieldLimits(form); // names 25, username 20, email 40

    // Names: letters + single spaces only
    const cleanName = (str) => str
        .replace(/[^\p{L}\p{M} ]/gu, '')
        .replace(/^ +/, '')
        .replace(/ {2,}/g, ' ');

    ['firstName', 'lastName'].forEach((name) => {
        const input = form.elements[name];
        input.addEventListener('input', (e) => {
            if (e.isComposing) return;
            const cursor = input.selectionStart;
            const before = cleanName(input.value.slice(0, cursor));
            const cleaned = cleanName(input.value);
            if (cleaned !== input.value) {
                input.value = cleaned;
                input.setSelectionRange(before.length, before.length);
            }
        });
        input.addEventListener('blur', () => { input.value = input.value.trim(); });
    });

    // Username: no spaces (same rule as Sign Up)
    blockSpaces(form.elements.username);
    form.elements.username.addEventListener('input', () => form.elements.username.setCustomValidity(''));

    // ---- Optional password change ----
    const currentPwd = form.elements.currentPassword;
    const newPwd = form.elements.newPassword;
    const confirmPwd = form.elements.confirmNewPassword;
    const pwRequirementItems = [...form.querySelectorAll('#profilePasswordRequirements [data-password-requirement]')];
    const pwStrengthWrapper = form.querySelector('#profilePasswordSection [data-password-strength-wrapper]');
    const pwStrengthLabel = form.querySelector('#profilePasswordStrength span');

    newPwd.maxLength = LIMITS.password.max;
    confirmPwd.maxLength = LIMITS.password.max;
    [currentPwd, newPwd, confirmPwd].forEach(blockSpaces);
    [newPwd, confirmPwd].forEach(blockPasswordClipboard);

    // Empty New Password = keep the current password (nothing else is required)
    const validateProfilePasswords = () => {
        const changing = newPwd.value !== '';
        newPwd.setCustomValidity(changing && !PASSWORD_RULE.test(newPwd.value) ? PASSWORD_MSG : '');
        confirmPwd.setCustomValidity(
            (changing || confirmPwd.value) && confirmPwd.value !== newPwd.value ? 'Passwords do not match.' : ''
        );
        currentPwd.setCustomValidity(changing && !currentPwd.value ? 'Enter your current password to set a new one.' : '');
        updatePasswordChecklist(newPwd.value, pwRequirementItems, pwStrengthWrapper, pwStrengthLabel);
    };
    [currentPwd, newPwd, confirmPwd].forEach((input) => input.addEventListener('input', validateProfilePasswords));

    form.querySelectorAll('#profilePasswordSection [data-password-toggle]').forEach((toggle) => {
        toggle.addEventListener('click', () => togglePasswordGroup(toggle));
    });

    document.getElementById('profileEditBtn').addEventListener('click', () => {
        if (currentUser) setProfileEditing(true);
    });

    document.getElementById('profileCancelBtn').addEventListener('click', () => {
        renderProfile();            // discard unsaved changes
        setProfileEditing(false);
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!currentUser) return;

        validateProfilePasswords();
        if (!form.reportValidity()) return;

        const saveBtn = form.querySelector('[type="submit"]');
        if (saveBtn) saveBtn.disabled = true;

        try {
            const next = {
                firstName: form.elements.firstName.value.trim(),
                lastName: form.elements.lastName.value.trim(),
                username: form.elements.username.value.trim(),
            };
            const newPassword = newPwd.value;

            // 1. Changing the password? Check the current password first.
            if (newPassword) {
                const { data: { user } } = await sb.auth.getUser();
                const { error: checkError } = await sb.auth.signInWithPassword({
                    email: user?.email || currentUser.email,
                    password: currentPwd.value,
                });
                if (checkError) {
                    currentPwd.setCustomValidity('Your current password is incorrect.');
                    currentPwd.reportValidity();
                    return;
                }
            }

            // 2. Save name + username (email cannot be changed here)
            const { error } = await sb
                .from('profiles')
                .update({ firstname: next.firstName, lastname: next.lastName, username: next.username })
                .eq('id', currentUser.id);

            if (error) {
                if (error.code === '23505') { // unique violation -> username taken
                    const usernameInput = form.elements.username;
                    usernameInput.setCustomValidity('That username is already taken.');
                    usernameInput.reportValidity();
                } else {
                    console.error('Profile update failed:', error);
                    showProfileStatus('Could not save your changes. Please try again.', 4000, 'error');
                }
                return;
            }

            currentUser = { ...currentUser, firstName: next.firstName, lastName: next.lastName, username: next.username };

            // 3. Set the new password
            let message = 'Profile updated successfully.';
            let type = 'success';
            if (newPassword) {
                const { error: pwError } = await sb.auth.updateUser({ password: newPassword });
                if (!pwError) {
                    message = 'Profile and password updated successfully.';
                } else {
                    console.error('Password update failed:', pwError);
                    type = 'error';
                    message = pwError.code === 'same_password'
                        ? 'Profile saved, but the new password must be different from your current password.'
                        : 'Profile saved, but the password could not be changed: ' + pwError.message;
                }
            }

            renderProfile();
            setProfileEditing(false);
            showProfileStatus(message, type === 'error' ? 6000 : 3000, type);
        } finally {
            if (saveBtn) saveBtn.disabled = false;
        }
    });
}

// ============================================
// 10-MINUTE REFRESH (recommendations + insights panels)
// Fires on the clock at :00, :10, :20, :30, :40, :50 while a user is signed in.
// No notification or pop-up: only heat-stress results raise those.
// ============================================
const CHECKIN_EVERY_MS = 10 * 60 * 1000;
let checkinTimer = null;

function checkinLevelFromTemp(temp) {
    if (typeof temp !== 'number') return null;
    if (temp > 40) return 'CRITICAL';
    if (temp > 37) return 'HIGH';
    if (temp > 34) return 'MODERATE';
    return 'LOW';
}

function checkinUserActive() {
    const userUi = document.getElementById('user-ui');
    return !!currentUser
        && !document.body.classList.contains('ht-auth-mode')
        && !!userUi && !userUi.classList.contains('u-hidden');
}

function runCheckin() {
    if (!checkinUserActive()) return;

    // Refresh the Recommendations + Insights panels on the same rhythm
    renderRecommendations();
    renderLiveDetections();
    updateStats();
}

// Next :00 / :10 / :20 ... boundary (re-scheduled every time, so it never drifts)
function scheduleCheckin() {
    clearTimeout(checkinTimer);
    const wait = CHECKIN_EVERY_MS - (Date.now() % CHECKIN_EVERY_MS) + 500;
    checkinTimer = setTimeout(() => {
        try { runCheckin(); } catch (err) { console.error('Check-in failed:', err); }
        scheduleCheckin();
    }, wait);
}

document.addEventListener('DOMContentLoaded', () => {
    scheduleCheckin();
});

// ============================================
// SUPABASE DATA LAYER (environment + analytics)
// ============================================
let realtimeChannel = null;

const toNum = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v))) ? null : Number(v);

// Saved status -> COMFORT / MILD / MODERATE / SEVERE. Accepts the new names and
// the older NORMAL / MILD / HEAT STRESS (Heat Stress is split by the saved
// severity: CRITICAL -> Severe, otherwise Moderate); anything else falls back safely
function normalizeStatus(value, severity) {
    const s = String(value || '').trim().toUpperCase().replace(/[_-]+/g, ' ');
    if (s === 'SEVERE' || s === 'SEVERE HEAT STRESS') return 'SEVERE';
    if (s === 'MODERATE' || s === 'MODERATE HEAT STRESS') return 'MODERATE';
    if (s === 'MILD' || s === 'MILD HEAT STRESS') return 'MILD';
    if (s === 'HEAT STRESS' || s === 'HEATSTRESS') return severity === 'CRITICAL' ? 'SEVERE' : 'MODERATE';
    return 'COMFORT';
}

function normalizeSeverity(value) {
    const s = String(value || '').trim().toUpperCase();
    return severityLevels.includes(s) ? s : 'LOW';
}

// analytics row -> the "detection" shape the UI already understands
// Status follows the row's highest surface temperature strictly (Status & Urgency
// Levels on the homepage): Thermal Comfort / Mild / Moderate / Severe Heat Stress
// (see statusFromTemp). Severity (urgency) is the one the logger saved: it starts
// from the surface temperature and the DHT22 air reading can move it one level,
// so e.g. a Mild row can be HIGH (Urgent). Severe Heat Stress is always CRITICAL.
// Rows without a temperature keep their saved status.
// The status that usually goes with each urgency (for rows/check-ins without a status)
const STATUS_OF_SEVERITY = { LOW: 'COMFORT', MODERATE: 'MILD', HIGH: 'MODERATE', CRITICAL: 'SEVERE' };

function levelForRow(highTemp, savedSeverity, savedStatus) {
    const hasTemp = highTemp != null && !Number.isNaN(highTemp);
    const status = hasTemp ? statusFromTemp(highTemp) : (savedStatus || STATUS_OF_SEVERITY[savedSeverity] || 'COMFORT');
    const severity = status === 'SEVERE' ? 'CRITICAL' : savedSeverity;
    return { severity, status };
}

function mapAnalyticsRow(row) {
    const low = toNum(row[DB_COLS.lowTemp]);
    const high = toNum(row[DB_COLS.highTemp]);
    const avg = toNum(row[DB_COLS.avgTemp]);
    const savedSeverity = normalizeSeverity(row.severity);
    const level = levelForRow(high, savedSeverity, row.status ? normalizeStatus(row.status, savedSeverity) : null);
    const status = level.status;
    // 10 = 10-minute slot row, 30 = 30-minute window row; rows saved before
    // the interval column existed are 30-minute rows
    const hasInterval = row.interval_minutes != null;
    const interval = hasInterval ? Number(row.interval_minutes) : 30;
    // 30-minute rows report the window's HIGHEST surface temperature
    const bodyTemp = (interval === 30 && hasInterval ? (high ?? avg) : (avg ?? high)) ?? low ?? 0;

    return {
        id: `A-${row.id}`,
        dbId: row.id,
        timestamp: new Date(row.timestamp),
        status,
        isHeatStress: status !== 'COMFORT',
        bodyTemp: parseFloat(bodyTemp.toFixed(1)),
        lowTemp: low !== null ? parseFloat(low.toFixed(1)) : null,
        avgTemp: avg !== null ? parseFloat(avg.toFixed(1)) : null,
        highTemp: high !== null ? parseFloat(high.toFixed(1)) : null,
        count: Math.max(0, parseInt(row.duck_count, 10) || 0),
        batchCount: row.batch_count ?? null,
        confidence: null, // no confidence column in the analytics table
        severity: level.severity,
        interval,
        hasInterval,
        ai: row.ai_recommendation || null,   // written by the "recommend" Edge Function (Gemini)
        deviceId: row.device_id ?? null,
    };
}

// At :00 and :30 the logger saves two rows for the same moment: the 10-minute
// row and the 30-minute peak row. The Detection Log (and its report) shows
// them as ONE entry: the listed entry carries the 30-minute peak (peak30) of
// the 30-minute row saved at the same moment, shown as a badge.
const PAIR_WINDOW_MS = 2 * 60 * 1000;

function attachThirtyMinutePeaks(list) {
    const peaks = state.detections.filter((d) => d.hasInterval && d.interval === 30
        && d.timestamp instanceof Date && !Number.isNaN(d.timestamp.getTime()));
    return list.map((d) => {
        if (d.hasInterval && d.interval === 30) return d;      // already the 30-minute row
        const t = d.timestamp.getTime();
        let match = null;
        for (const p of peaks) {
            if (p.deviceId && d.deviceId && p.deviceId !== d.deviceId) continue;
            const gap = Math.abs(p.timestamp.getTime() - t);
            if (gap <= PAIR_WINDOW_MS && (!match || gap < Math.abs(match.timestamp.getTime() - t))) match = p;
        }
        if (!match) return d;
        return { ...d, peak30: {
            id: match.id, highTemp: match.highTemp, bodyTemp: match.bodyTemp, count: match.count,
            status: match.status, severity: match.severity, batchCount: match.batchCount,
        } };
    });
}

function peak30Text(d) {
    if (!d.peak30) return '';
    const temp = d.peak30.highTemp ?? d.peak30.bodyTemp;
    return `30 min peak${temp != null ? ' ' + temp.toFixed(1) + '°C' : ''} · ${d.peak30.count} duck${d.peak30.count !== 1 ? 's' : ''}`;
}

// Totals (KPI cards, charts) use the 10-minute rows, so they update every
// 10 minutes. A 30-minute row only repeats the 10-minute rows inside its
// window, so it is left out when those exist (ducks aren't counted twice).
// When its window has no 10-minute rows (none saved, or older data), the
// 30-minute row is used instead, so charts aren't empty while the log has data.
// Old rows from before the interval column stay.
function summaryDetections() {
    const tenMinuteTimes = state.detections
        .filter((d) => d.hasInterval && d.interval === 10 && d.timestamp instanceof Date)
        .map((d) => d.timestamp.getTime());
    const windowCovered = (d) => {
        const end = d.timestamp instanceof Date ? d.timestamp.getTime() : NaN;
        const start = end - 30 * 60 * 1000;
        return tenMinuteTimes.some((t) => t > start && t <= end);
    };
    return state.detections.filter((d) => !(d.hasInterval && d.interval === 30) || !windowCovered(d));
}

// Insights page Results (live list) and Recommendations show only the 30-minute
// readings (20 minutes after the first detection, then every 30 minutes); first
// detections are left out
function detailDetections() {
    return thirtyMinuteReadings();
}

// Alerts (bell + pop-up): the 30-minute readings (see logEntryLabels) whose
// urgency is Urgent or Critical (HIGH / CRITICAL severity), whatever the status,
// e.g. first detection 12:10 -> 12:30, 1:00. First detections and the results
// between readings raise nothing.
// Returns the ids of the results that raise an alert.
function heatStressAlertIds(rows = summaryDetections()) {
    const entries = logEntryLabels(rows);
    return new Set(rows.filter((d) => isToastLevel(d.severity) && isThirtyMinuteReading(d, entries)).map((d) => d.id));
}

// Detection Log entries, whatever the status. The first detection is the first
// 10-minute result, which covers the 10 minutes before it. Monitoring counts
// from the start of that slot, so the first 30-minute reading comes 20 minutes
// after the first detection, then every 30 minutes:
//   first detection 12:10 -> readings at 12:30, 1:00, 1:30 ...
// A status change doesn't restart it. Only when there is no reading for
// 10 minutes (no saved result: no ducks, or ducks without a surface temperature)
// does the next result start a new count as a new first detection.
// Older data from before the interval column keeps 30-minute steps and gaps.
//   - first detection: listed, no label
//   - result on each 30-minute step: listed, label '30 min'
// Everything else is hidden. Returns id -> label ('' or '30 min').
const LOG_EVERY_MS = 30 * 60 * 1000;
const SLOT_MS = 10 * 60 * 1000;
const MARK_SLACK_MS = 60 * 1000;

const isSlotRow = (d) => d.hasInterval && d.interval === 10;

// Each row's count: { firstAt, isFirst }, oldest first. firstAt is when its count
// started (the start of the first detection's 10-minute slot).
function countRuns(rows = summaryDetections()) {
    const sorted = rows
        .filter((d) => d.timestamp instanceof Date && !Number.isNaN(d.timestamp.getTime()))
        .slice()
        .sort((a, b) => a.timestamp - b.timestamp);
    let prev = null;
    let firstAt = null;
    return sorted.map((d) => {
        // Back-to-back readings are 10 minutes apart; a longer gap means a slot
        // had no reading (no ducks, or no surface temperature), so counting restarts.
        // Only old rows without an interval keep the 30-minute gap.
        const maxGap = prev && (d.hasInterval || prev.hasInterval) ? SLOT_MS : LOG_EVERY_MS;
        const isFirst = !prev || d.timestamp - prev.timestamp > maxGap + MARK_SLACK_MS;
        if (isFirst) firstAt = d.timestamp.getTime() - (isSlotRow(d) ? SLOT_MS : 0);
        prev = d;
        return { d, firstAt, isFirst };
    });
}

// Excel Duration: minutes into the current 30-minute step, 10 -> 20 -> 30, then
// 10 -> 20 -> 30 again while monitoring continues; a new count starts at 10.
// Rows that aren't 10-minute readings (30-minute and older rows) are '30 min'.
// Each 10-minute mark keeps one row only, the closest (the '30 min' row on a
// 30-minute mark). Rows saved seconds apart (e.g. test timing) fit no mark, so
// they get no label and are left out of the Excel file.
function countDurations(rows = summaryDetections()) {
    const labels = logEntryLabels(rows);
    const out = new Map();
    const slotPick = new Map();   // "firstAt:tens" -> { d, tens, dist }
    countRuns(rows).forEach(({ d, firstAt }) => {
        if (!isSlotRow(d)) {
            out.set(d.id, '30 min');
            return;
        }
        const since = d.timestamp.getTime() - firstAt;
        const tens = Math.max(1, Math.round(since / SLOT_MS));
        const isStep = labels.get(d.id) === '30 min';
        const dist = isStep ? -1 : Math.abs(since - tens * SLOT_MS);   // the step row always wins
        const key = firstAt + ':' + tens;
        const best = slotPick.get(key);
        if (!best || dist < best.dist) slotPick.set(key, { d, tens, dist });
    });
    slotPick.forEach(({ d, tens, dist }) => {
        // A 30-minute mark belongs to the '30 min' row only
        if (dist === -1) out.set(d.id, '30 min');
        else if (tens % 3 !== 0) out.set(d.id, (tens % 3) * 10 + ' min');
    });
    return out;
}

function logEntryLabels(rows = summaryDetections()) {
    const shown = new Map();
    // One entry per 30-minute step: the row closest to the mark. Rows saved
    // seconds apart (e.g. test timing) would otherwise all fall in the slack.
    const stepPick = new Map();   // "firstAt:step" -> { id, dist }
    countRuns(rows).forEach(({ d, firstAt, isFirst }) => {
        if (isFirst) {
            shown.set(d.id, '');
        } else {
            const since = d.timestamp.getTime() - firstAt;
            const offset = since % LOG_EVERY_MS;
            const onStep = offset < MARK_SLACK_MS || offset > LOG_EVERY_MS - MARK_SLACK_MS;
            if (since >= LOG_EVERY_MS - MARK_SLACK_MS && onStep) {
                const step = Math.round(since / LOG_EVERY_MS);
                const dist = Math.abs(since - step * LOG_EVERY_MS);
                const key = firstAt + ':' + step;
                const best = stepPick.get(key);
                if (!best || dist < best.dist) stepPick.set(key, { id: d.id, dist });
            }
        }
    });
    stepPick.forEach(({ id }) => shown.set(id, '30 min'));
    return shown;
}

function intervalBadge(label) {
    if (!label) return '';
    const style = 'background:#fff7ed;color:#c2410c';
    return ` <span style="display:inline-block;margin-left:.4rem;padding:.05rem .45rem;border-radius:999px;font:700 .68rem 'DM Sans',system-ui,sans-serif;vertical-align:middle;${style}">${label}</span>`;
}

function pushSensorPoint(row) {
    const temp = toNum(row.temperature);
    const humidity = toNum(row.humidity);
    const label = new Date(row.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    state.sensorHistory.temp.push(temp);
    state.sensorHistory.humidity.push(humidity);
    state.sensorHistory.labels.push(label);
    const takenAt = new Date(row.timestamp);
    state.sensorHistory.times.push(Number.isNaN(takenAt.getTime()) ? null : takenAt);
    if (!Number.isNaN(takenAt.getTime()) && (!state.lastSensorAt || takenAt > state.lastSensorAt)) {
        state.lastSensorAt = takenAt;
    }
    // Time of the newest row that actually holds a DHT22 value (drives the ACTIVE badge)
    if ((typeof temp === 'number' || typeof humidity === 'number') && !Number.isNaN(takenAt.getTime())
        && (!state.lastDhtAt || takenAt > state.lastDhtAt)) {
        state.lastDhtAt = takenAt;
    }

    while (state.sensorHistory.temp.length > SENSOR_HISTORY_LIMIT) {
        state.sensorHistory.temp.shift();
        state.sensorHistory.humidity.shift();
        state.sensorHistory.labels.shift();
        state.sensorHistory.times.shift();
    }
}

// Re-draw everything that depends on detections / sensor data
function refreshDashboard() {
    updateStats();
    updateSensorReadings();
    updateEnvChart();
    updateDetectionChart();
    updateSeverityChart();
    renderDetectionLogs();
    renderLiveDetections();
    renderRecommendations();
    renderAlerts();
    updateAnnotations();
}

function resetDashboardData() {
    // Settings go back to the defaults until the next account's are loaded
    state.cameraActive = true;
    state.alertsWanted = true;
    updateSystemToggleStates();
    state.detections = [];
    state.lastEnvId = null;
    state.sensorHistory.temp = [];
    state.sensorHistory.humidity = [];
    state.sensorHistory.labels = [];
    state.sensorHistory.times = [];
    state.alerts = [];
    alertReadIds = new Set();
    state.alertCount = 0;
    state.alertsDisplayed = 0;
    state.recommendationsDisplayed = 0;
    state.currentPage = 1;
    // The next account starts with the whole log, unfiltered
    state.logFilter = { kind: 'status', level: 'ALL' };
    state.logPeriod = 'all';
    clearLogDateInput(document.getElementById('logCustomStart'));
    clearLogDateInput(document.getElementById('logCustomEnd'));
    setLogPeriodPanel(false);
    renderLogPeriod();
    resetLogChipsScroll();
    state.lastToastDetection = null;
    state.lastSensorAt = null;
    state.lastDhtAt = null;
    document.getElementById('alertBadge')?.classList.add('u-hidden');
    refreshDashboard();
}

// Initial load: latest sensor readings + recent analytics batches for the signed-in user
async function loadCloudData() {
    const uid = currentUser?.id;
    if (!uid) return;

    const [envRes, analyticsRes, readIds] = await Promise.all([
        sb.from('environment').select('*').eq('userid', uid)
            .order('timestamp', { ascending: false }).limit(SENSOR_HISTORY_LIMIT),
        sb.from('analytics').select('*').eq('userid', uid)
            .order('timestamp', { ascending: false }).limit(DETECTION_LOAD_LIMIT),
        fetchReadItemIds(uid),
    ]);
    alertReadIds = readIds || new Set();

    if (envRes.error) console.error('Could not load environment data:', envRes.error);
    if (analyticsRes.error) console.error('Could not load analytics data:', analyticsRes.error);

    // Environment rows arrive newest-first; the chart needs oldest-first
    state.lastDhtAt = null;
    state.sensorHistory.temp = [];
    state.sensorHistory.humidity = [];
    state.sensorHistory.labels = [];
    state.sensorHistory.times = [];
    (envRes.data || []).slice().reverse().forEach(pushSensorPoint);
    state.lastEnvId = (envRes.data || []).reduce((m, r) => Math.max(m, r.id ?? 0), 0) || null;

    // Detections stay newest-first (the UI expects that order)
    state.detections = (analyticsRes.data || []).map(mapAnalyticsRow);

    // This account's earlier notifications (read and unread), plus a notification
    // for every heat-stress result that is not in the list yet
    loadSavedAlerts();
    syncResultAlerts();
    // Read on another browser of this account = read here too (and the other way round)
    if (readIds) mergeAlertReads(uid, readIds);

    state.currentPage = 1;
    state.recommendationsDisplayed = 0;
    refreshDashboard();
}

function handleEnvironmentInsert(row) {
    if (row.id != null) {
        if (state.lastEnvId != null && row.id <= state.lastEnvId) return;   // already shown
        state.lastEnvId = row.id;
    }
    pushSensorPoint(row);
    updateSensorReadings();
    updateEnvChart();
    // Recommendations/insights refresh every 10 minutes (see 10-MINUTE REFRESH),
    // not on every reading. Heat-stress detections still refresh them immediately.
}

function handleAnalyticsInsert(row) {
    const detection = mapAnalyticsRow(row);
    if (state.detections.some(d => d.id === detection.id)) return; // already loaded

    state.detections.unshift(detection);
    refreshDashboard();

    // Listed in Alerts & Notifications when it's a 30-minute reading with Urgent
    // or Critical urgency; the pop-up follows the same rule and the alerts setting
    syncResultAlerts();
    const raisesAlert = heatStressAlertIds().has(detection.id);
    if (state.alertsEnabled && raisesAlert) {
        showToast(detection);
    }
}

// Live updates: new rows written by your device/backend appear instantly
function subscribeRealtime(userId) {
    unsubscribeRealtime();
    realtimeChannel = sb
        .channel('heattrack-live-' + userId)
        .on('postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'environment', filter: `userid=eq.${userId}` },
            (payload) => handleEnvironmentInsert(payload.new))
        .on('postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'analytics', filter: `userid=eq.${userId}` },
            (payload) => handleAnalyticsInsert(payload.new))
        .on('postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'notification_reads', filter: `user_id=eq.${userId}` },
            (payload) => {
                alertReadIds.add(payload.new.item_id);
                applyAlertReads();
            })
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'user_settings', filter: `user_id=eq.${userId}` },
            (payload) => applyAccountSettings(payload.new))   // Camera Streams changed on another browser
        .subscribe((status) => {
            if (status === 'CHANNEL_ERROR') console.warn('Realtime channel error. Is Realtime enabled for these tables?');
        });
    startPolling(userId);
}

// ---- Fallback: check for new rows once a minute ----
// Realtime pushes new rows instantly, but only if it is switched on for the
// tables in Supabase. This makes sure the page never stays stale until a reload.
const POLL_EVERY_MS = 60 * 1000;
let pollTimer = null;
let pollBusy = false;

async function pollNewRows(userId) {
    if (pollBusy || document.hidden) return;
    pollBusy = true;
    try {
        const lastAnalyticsId = state.detections.reduce((m, d) => Math.max(m, d.dbId ?? 0), 0);
        const [analyticsRes, envRes] = await Promise.all([
            sb.from('analytics').select('*').eq('userid', userId)
                .gt('id', lastAnalyticsId).order('id', { ascending: true }).limit(200),
            sb.from('environment').select('*').eq('userid', userId)
                .gt('id', state.lastEnvId ?? 0).order('id', { ascending: true }).limit(SENSOR_HISTORY_LIMIT),
        ]);
        (envRes.data || []).forEach(handleEnvironmentInsert);
        (analyticsRes.data || []).forEach(handleAnalyticsInsert);   // oldest first, so newest ends on top
        await refreshAlertReads(userId);   // notifications read on another browser
        await refreshAccountSettings(userId);   // Camera Streams changed on another browser
    } catch (err) {
        console.warn('HeatTrack: could not check for new rows', err);
    } finally {
        pollBusy = false;
    }
}

function startPolling(userId) {
    stopPolling();
    pollTimer = setInterval(() => pollNewRows(userId), POLL_EVERY_MS);
}

function stopPolling() {
    clearInterval(pollTimer);
    pollTimer = null;
}

function unsubscribeRealtime() {
    stopPolling();
    if (realtimeChannel) {
        sb.removeChannel(realtimeChannel);
        realtimeChannel = null;
    }
}

// ============================================
// ADMIN (Supabase Auth + is_admin() check — no credentials in the browser)
// ============================================
// Roles: 'user'     -> normal login screen (#authApp)
//        'admin'    -> separate admin sign-in screen (#adminAuth), if your HTML has one
//        'admin-ui' -> the admin dashboard (#admin-ui)
function setAuthRole(role) {
    const adminAuth = document.getElementById('adminAuth');
    if (role === 'admin' && !adminAuth) role = 'user'; // no admin sign-in screen in this HTML
    const isAdmin = role === 'admin';
    const isAdminUi = role === 'admin-ui';
    const authApp = document.getElementById('authApp');
    const adminUi = document.getElementById('admin-ui');
    document.body.classList.toggle('ht-admin-auth-mode', isAdmin);
    document.body.classList.toggle('ht-admin-ui-mode', isAdminUi);
    authApp?.classList.toggle('u-hidden', isAdmin || isAdminUi);
    adminAuth?.classList.toggle('u-hidden', !isAdmin);
    adminUi?.classList.toggle('u-hidden', !isAdminUi);
    document.querySelectorAll('[data-auth-role]').forEach((button) => {
        const active = button.dataset.authRole === role;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-current', active ? 'page' : 'false');
    });
    document.querySelector('.ht-role-switcher')?.classList.toggle('u-hidden', isAdminUi);
    document.title = isAdminUi ? 'HeatTrack — Admin' : isAdmin ? 'HeatTrack — Admin Sign In' : 'HeatTrack — Sign In';
}

async function initAdminAccess() {
    const adminAuth = document.getElementById('adminAuth');
    const adminForm = adminAuth?.querySelector('form[data-auth-form="admin-login"]');
    const adminMessage = document.getElementById('adminAuthMessage');
    const showAdminMessage = (text) => {
        if (!adminMessage) return;
        adminMessage.textContent = text;
        adminMessage.hidden = !text;
    };

    // ---- User / Admin switcher on the sign-in page ----
    document.querySelectorAll('[data-auth-role]').forEach((button) => {
        button.addEventListener('click', () => {
            const role = button.dataset.authRole;
            history.replaceState(null, '', role === 'admin' ? '#admin' : location.pathname + location.search);
            setAuthRole(role);
        });
    });

    // ---- Admin sign-in form: real Supabase sign-in, then a server-side admin check ----
    if (adminForm) {
        const usernameInput = adminForm.elements.username;
        const passwordInput = adminForm.elements.password;
        if (usernameInput) usernameInput.maxLength = LIMITS.email.max;

        adminForm.addEventListener('input', () => showAdminMessage(''));
        adminForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (adminForm.getAttribute('aria-busy') === 'true') return;
            showAdminMessage('');

            const identifier = usernameInput.value.trim();
            const password = passwordInput.value;
            if (!identifier || !password) {
                showAdminMessage('Please enter your username and password.');
                (identifier ? passwordInput : usernameInput).focus();
                return;
            }

            const deny = async (signedIn) => {
                if (signedIn) { try { await sb.auth.signOut(); } catch (_) {} }
                showAdminMessage('Access denied. Incorrect username or password.');
                passwordInput.value = '';
            };

            setLoginFormBusy(adminForm, true);
            showLoginLoading('admin', adminForm, () => showAdminMessage('Something went wrong. Please try again.'));
            let failed = true;
            try {
                let email = identifier;
                if (!identifier.includes('@')) {
                    const { data, error } = await sb.rpc('get_email_by_username', { uname: identifier });
                    if (error || !data) { await deny(false); return; }
                    email = data;
                }

                const { error: signInError } = await sb.auth.signInWithPassword({ email, password });
                if (signInError) { await deny(false); return; }

                const { data: isAdmin, error: adminError } = await sb.rpc('is_admin');
                if (adminError || !isAdmin) { await deny(true); return; }

                history.replaceState(null, '', '#admin-ui');
                setAuthRole('admin-ui');
                await initAdminUi();
                adminForm.reset();
                failed = false;
            } catch (err) {
                console.error('Admin sign-in failed:', err);
                try { await sb.auth.signOut(); } catch (_) {}
                history.replaceState(null, '', '#admin');
                setAuthRole('admin');
                showAdminMessage('Something went wrong. Please try again.');
            } finally {
                await hideLoginLoading();
                setLoginFormBusy(adminForm, false);
                if (failed) passwordInput.focus();
            }
        });
    }

    // ---- Admin logout ----
    document.getElementById('adminLogoutBtn')?.addEventListener('click', (event) => {
        openLogoutConfirm('admin', event.currentTarget, async () => {
            try { await sb.auth.signOut(); } catch (err) { console.error('Sign out failed:', err); }
            adminProfiles = [];
            adminDevices = [];
            adminDeviceTrash = [];
            stopAdminReads();
            adminSelf = null;
            adminSelfHasRow = false;
            renderAdminSelf();
            closeLogoutConfirm();
            if (adminForm) {
                // Back to the dedicated admin sign-in screen
                history.replaceState(null, '', '#admin');
                adminForm.reset();
                showAdminMessage('');
                setAuthRole('admin');
                adminForm.elements.username?.focus();
            } else {
                // No admin sign-in screen: back to the normal login
                history.replaceState(null, '', location.pathname + location.search);
                setAuthRole('user');
                document.getElementById('authApp')?.classList.remove('u-hidden');
                document.getElementById('authLogin')?.classList.add('is-active');
                document.getElementById('authSignup')?.classList.remove('is-active');
                document.querySelector('#authLogin input[name="username"]')?.focus();
            }
        });
    });

    // ---- Page boot ----
    const bootAuth = document.documentElement.dataset.bootAuth;
    if (bootAuth === 'admin') {
        setAuthRole('admin');
        return;
    }
    if (bootAuth !== 'admin-ui') {
        setAuthRole('user');
        return;
    }

    // This is the admin dashboard — require a real, currently signed-in admin account.
    // A missing/expired session, or a signed-in account that isn't in the admins
    // table, both fall back to the sign-in screen.
    try {
        const { data: { session } } = await sb.auth.getSession();
        const isAdmin = session ? (await sb.rpc('is_admin')).data : false;

        if (session && isAdmin) {
            setAuthRole('admin-ui');
            await initAdminUi();
        } else {
            if (session) await sb.auth.signOut(); // signed in, but not an admin
            history.replaceState(null, '', adminForm ? '#admin' : location.pathname + location.search);
            setAuthRole(adminForm ? 'admin' : 'user');
        }
    } catch (err) {
        console.error('Admin session check failed:', err);
        setAuthRole(adminForm ? 'admin' : 'user');
    }
}

let adminProfiles = [];
let adminIds = new Set(); // accounts in the admins table (hidden from account management)
// Sort settings per table. dir: 1 = ascending, -1 = descending
const adminSort = {
    users: { key: 'createdAt', dir: -1 },   // newest registered first
    pending: { key: 'createdAt', dir: -1 },
};
let adminUiBound = false; // listeners are attached once, even after logging out and back in
let adminSelf = null;      // the signed-in admin's own profile (My Profile tab)
let adminSelfHasRow = false;
let adminProfileStatusTimer = null;

// Every profile except admin accounts
function adminVisibleProfiles() {
    return adminProfiles.filter((profile) => !adminIds.has(profile.id));
}

// Asks the database which accounts are admins (admin_list_admin_ids() only answers admins)
async function loadAdminIds() {
    const { data, error } = await sb.rpc('admin_list_admin_ids');
    if (error) {
        console.warn('Could not load the admin list (run the admin_list_admin_ids SQL in Supabase). Admins will be shown.', error);
        adminIds = new Set();
        return;
    }
    adminIds = new Set((data || []).map((row) => (typeof row === 'string' ? row : row?.admin_list_admin_ids || row?.user_id)).filter(Boolean));
}

function adminSortValue(profile, key) {
    if (key === 'createdAt') return profile.createdAt ? new Date(profile.createdAt).getTime() || 0 : 0;
    if (key === 'name') return adminFullName(profile).toLowerCase();
    return String(profile[key] || '').toLowerCase();
}

// Sorts rows for a table ('users' or 'pending'); ties fall back to username A-Z
function adminSortRows(rows, table) {
    const { key, dir } = adminSort[table];
    return rows.sort((a, b) => {
        const x = adminSortValue(a, key);
        const y = adminSortValue(b, key);
        const diff = typeof x === 'number' ? x - y : x.localeCompare(y);
        return diff * dir || String(a.username || '').localeCompare(String(b.username || ''));
    });
}

// Keeps the dropdown, the order button and the column arrows in step with adminSort
function syncAdminSortControls(table) {
    const { key, dir } = adminSort[table];
    const view = document.querySelector(`[data-admin-view="${table}"]`);
    if (!view) return;
    const select = view.querySelector('[data-admin-sort-select]');
    if (select) select.value = key;
    const dirBtn = view.querySelector('[data-admin-sort-dir]');
    if (dirBtn) {
        const label = dir === 1 ? 'Ascending' : 'Descending';
        dirBtn.setAttribute('aria-label', `Sort order: ${label}`);
        dirBtn.querySelector('[data-admin-sort-dir-label]').textContent = label;
        dirBtn.querySelector('.ht-admin-ui__sort-arrow').textContent = dir === 1 ? '\u2191' : '\u2193';
    }
    view.querySelectorAll('th [data-admin-sort]').forEach((button) => {
        const active = button.dataset.adminSort === key;
        button.classList.toggle('is-sorted', active);
        button.dataset.sortDir = active ? (dir === 1 ? 'asc' : 'desc') : '';
        button.closest('th').setAttribute('aria-sort', active ? (dir === 1 ? 'ascending' : 'descending') : 'none');
    });
}

function setAdminSort(table, key, dir) {
    adminSort[table] = { key, dir };
    if (table === 'users') renderAdminUsers();
    else renderAdminPending();
}

function adminFullName(profile) {
    return `${profile.firstName || ''} ${profile.lastName || ''}`.trim() || 'Not provided';
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function adminFormatDate(value) {
    return value ? new Date(value).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : 'Not provided';
}

function showAdminToast(message, type = 'success') {
    const toast = document.getElementById('adminUiToast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = `ht-admin-ui__toast is-visible ht-admin-ui__toast--${type}`;
    clearTimeout(toast.__timer);
    toast.__timer = setTimeout(() => toast.classList.remove('is-visible'), 3200);
}

function adminSetView(view) {
    document.querySelectorAll('[data-admin-view]').forEach((section) => section.classList.toggle('u-hidden', section.dataset.adminView !== view));
    document.querySelectorAll('[data-admin-route]').forEach((link) => {
        const active = link.dataset.adminRoute === view;
        link.classList.toggle('is-active', active);
        if (link.classList.contains('ht-nav__link')) link.classList.toggle('ht-nav__link--active', active);
    });
    document.getElementById('adminNav')?.classList.remove('is-open');
    document.getElementById('adminMenuToggle')?.setAttribute('aria-expanded', 'false');
    if (view === 'overview') renderAdminSummary();
    if (view === 'pending') renderAdminPending();
    if (view === 'users') { renderAdminUsers(); renderAdminDevices(); }
    if (document.getElementById('adminProfileForm')) {
        setAdminProfileEditing(false);   // leaving or opening My Profile discards unsaved edits
        if (view === 'profile') renderAdminSelf();
    }
    adminResetScroll(document.querySelector(`[data-admin-view="${view}"]`));
}

// Scrollable parts of an admin page (tables and lists) that start at the top
const ADMIN_SCROLL_AREAS = '.ht-table-scroll, .ht-adash__recent, .ht-admin-device__list';

// Every newly opened admin page starts at the top: the window and each table/list in it
function adminResetScroll(view) {
    const reset = () => {
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
        view?.querySelectorAll(ADMIN_SCROLL_AREAS).forEach((el) => {
            el.scrollTop = 0;
            el.scrollLeft = 0;
        });
    };
    reset();
    requestAnimationFrame(reset);   // again once the view has laid out
}

function adminSetText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function adminInitials(profile) {
    return ((profile.firstName || '').charAt(0) + (profile.lastName || '').charAt(0) || (profile.username || '?').charAt(0)).toUpperCase();
}

// Device ID linked to an account (devices.owner_id), or '' when none
function adminDeviceCodeFor(profileId) {
    return adminDevices.find((device) => device.owner_id === profileId)?.device_code || '';
}

// Pending requests the admin has already seen ("Read all" in the bell panel).
// Kept per admin account in Supabase (notification_reads, 'signup:<profile id>'),
// so every browser the admin is signed in on shows the same state. The bell
// counts only the unread ones, so a new sign-up request shows up again even
// after everything was read.
let adminReadSet = new Set();
let adminReadsChannel = null;
const adminSignupItemId = (profileId) => `signup:${profileId}`;
// Read state saved in this browser before it was shared across browsers
const adminOldReadKey = () => `heattrack-admin-read-${adminSelf?.id || currentUser?.id || 'admin'}`;

function adminReadIds() {
    return new Set([...adminReadSet]
        .filter((id) => id.startsWith('signup:'))
        .map((id) => id.slice('signup:'.length)));
}

function adminSaveReadIds(ids) {
    const added = [...ids].map(adminSignupItemId).filter((id) => !adminReadSet.has(id));
    added.forEach((id) => adminReadSet.add(id));
    saveReadItemIds(adminSelf?.id, added);
}

// Loads the admin's read state (plus any old per-browser one, sent up once)
// and follows reads made on the admin's other browsers
async function loadAdminReads() {
    const uid = adminSelf?.id;
    if (!uid) return;
    const ids = await fetchReadItemIds(uid);
    if (!ids) return;
    adminReadSet = ids;
    try {
        const old = JSON.parse(localStorage.getItem(adminOldReadKey()) || '[]');
        if (Array.isArray(old) && old.length) adminSaveReadIds(old);
        localStorage.removeItem(adminOldReadKey());
    } catch (_) { /* no storage */ }

    if (adminReadsChannel) sb.removeChannel(adminReadsChannel);
    adminReadsChannel = sb
        .channel('heattrack-admin-reads-' + uid)
        .on('postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'notification_reads', filter: `user_id=eq.${uid}` },
            (payload) => {
                adminReadSet.add(payload.new.item_id);
                renderAdminSummary();
            })
        .subscribe();
}

function stopAdminReads() {
    if (adminReadsChannel) sb.removeChannel(adminReadsChannel);
    adminReadsChannel = null;
    adminReadSet = new Set();
}

// How many pending requests the bell panel shows
const ADMIN_ALERT_PAGE_SIZE = 10;
let adminAlertsShown = ADMIN_ALERT_PAGE_SIZE;

// One <li> for the dashboard Pending / Recent lists and the bell panel
function adminDashItem(profile, actions, unread = false) {
    const pending = profile.status !== 'approved';
    const right = actions && pending
        ? `<div class="ht-adash__recent-actions"><button type="button" class="ht-adash__mini ht-adash__mini--ok" data-admin-accept="${profile.id}" aria-label="Accept ${escapeHtml(profile.username)}"><i data-lucide="check"></i></button><button type="button" class="ht-adash__mini ht-adash__mini--no" data-admin-reject="${profile.id}" aria-label="Reject ${escapeHtml(profile.username)}"><i data-lucide="x"></i></button></div>`
        : `<span class="ht-adash__chip ht-adash__chip--${pending ? 'pending' : 'approved'}">${pending ? 'Pending' : 'Approved'}</span>`;
    // Pending items (dashboard card + bell panel) open the Pending page when clicked
    const link = actions && pending
        ? ` ht-adash__recent-item--link" data-admin-pending-item="${profile.id}" role="link" tabindex="0" aria-label="Review ${escapeHtml(adminFullName(profile))} on the Pending page`
        : '';
    return `<li class="ht-adash__recent-item${unread ? ' ht-adash__recent-item--unread' : ''}${link}"><span class="ht-adash__avatar">${escapeHtml(adminInitials(profile))}</span><div class="ht-adash__recent-info"><strong>${escapeHtml(adminFullName(profile))}</strong><span class="ht-adash__recent-meta"><span class="ht-adash__recent-user">@${escapeHtml(profile.username)}</span><span class="ht-adash__recent-email" title="${escapeHtml(profile.email)}">· ${escapeHtml(profile.email)}</span></span></div><span class="ht-adash__recent-date">${adminFormatDate(profile.createdAt)}</span>${right}</li>`;
}

function renderAdminSummary() {
    const visible = adminVisibleProfiles();
    const approved = visible.filter((profile) => profile.status === 'approved').length;
    const pendingRows = adminSortRows(visible.filter((profile) => profile.status !== 'approved'), 'pending');
    const pending = pendingRows.length;
    const linked = adminDevices.filter((device) => device.owner_id).length;

    adminSetText('adminTotalUsers', visible.length);
    adminSetText('adminPendingUsers', pending);
    adminSetText('adminApprovedUsers', approved);
    adminSetText('adminRegisteredDevices', adminDevices.length);
    adminSetText('adminDashDevicesNote', `${linked} linked · ${adminDevices.length - linked} available`);
    adminSetText('adminDashPendingNote', pending ? 'Accounts waiting for review' : 'All caught up');
    adminSetText('adminDashName', adminSelf?.firstName || adminSelf?.username || 'Admin');

    // Account Status card
    const rate = visible.length ? Math.round((approved / visible.length) * 100) : 0;
    adminSetText('adminDashRate', `${rate}%`);
    document.getElementById('adminDashDonut')?.style.setProperty('--rate', rate);
    adminSetText('adminDashLegendApproved', approved);
    adminSetText('adminDashLegendPending', pending);

    // Pending Requests card + bell panel
    const pendingList = document.getElementById('adminDashPending');
    if (pendingList) {
        pendingList.innerHTML = pendingRows.length
            ? pendingRows.map((profile) => adminDashItem(profile, true)).join('')
            : '<li class="ht-adash__empty"><i data-lucide="circle-check"></i>No pending requests</li>';
    }
    const readIds = adminReadIds();
    const unread = pendingRows.filter((profile) => !readIds.has(profile.id)).length;
    const alertList = document.getElementById('adminAlertList');
    if (alertList) {
        // Newest 10 first; "Show More Requests" adds 10 more (same as the user's notifications)
        const shownRows = pendingRows.slice(0, adminAlertsShown);
        const showMore = shownRows.length < pendingRows.length
            ? `<div style="padding: 0.75rem 0; text-align: center;">
                    <button type="button" id="adminAlertShowMore" class="ht-btn ht-btn--ghost">
                        Show More Requests
                    </button>
                </div>`
            : '';
        alertList.innerHTML = pendingRows.length
            ? `<ul class="ht-adash__recent">${shownRows.map((profile) => adminDashItem(profile, true, !readIds.has(profile.id))).join('')}</ul>${showMore}`
            : '<p class="ht-alert-panel__empty">No pending requests</p>';
    }
    const readAll = document.getElementById('adminReadAll');
    if (readAll) readAll.disabled = unread === 0;
    const badge = document.getElementById('adminAlertBadge');
    if (badge) {
        badge.textContent = unread > 99 ? '99+' : unread;
        badge.classList.toggle('u-hidden', unread === 0);
    }

    // Recent Sign-ups card: newest accounts of any status
    const recentList = document.getElementById('adminDashRecent');
    if (recentList) {
        const recent = [...visible].sort((a, b) => adminSortValue(b, 'createdAt') - adminSortValue(a, 'createdAt')).slice(0, 8);
        recentList.innerHTML = recent.length
            ? recent.map((profile) => adminDashItem(profile, false)).join('')
            : '<li class="ht-adash__empty">No accounts yet</li>';
    }
    lucide.createIcons();
}

const ADMIN_PAGE_SIZE = 10;
const adminPage = { pending: 1, users: 1 };

// Fills a table body for one page and updates its "Showing x of y" + page counter
function renderAdminTable(table, rows, rowHtml, emptyText, noun) {
    const body = document.getElementById(table === 'users' ? 'adminUsersBody' : 'adminPendingBody');
    if (!body) return;
    const pages = Math.max(1, Math.ceil(rows.length / ADMIN_PAGE_SIZE));
    adminPage[table] = Math.min(Math.max(1, adminPage[table]), pages);
    const start = (adminPage[table] - 1) * ADMIN_PAGE_SIZE;
    const pageRows = rows.slice(start, start + ADMIN_PAGE_SIZE);
    body.innerHTML = pageRows.length
        ? pageRows.map(rowHtml).join('')
        : `<tr><td colspan="7" class="ht-adash__empty">${emptyText}</td></tr>`;
    const prefix = table === 'users' ? 'adminUsers' : 'adminPending';
    adminSetText(`${prefix}Count`, `Showing ${pageRows.length} of ${rows.length} ${noun}`);
    adminSetText(`${prefix}PageInfo`, `${adminPage[table]}/${pages}`);
    document.querySelectorAll(`[data-admin-page="${table}"]`).forEach((button) => {
        const step = Number(button.dataset.adminPageStep);
        button.disabled = step < 0 ? adminPage[table] <= 1 : adminPage[table] >= pages;
    });
    lucide.createIcons();
}

function adminMatchesSearch(profile, inputId) {
    const search = (document.getElementById(inputId)?.value || '').toLowerCase().trim();
    return `${profile.username} ${adminFullName(profile)} ${profile.email} ${adminDeviceCodeFor(profile.id)}`.toLowerCase().includes(search);
}

// Free-text cell: cut with "…" at the column's maximum width, full value on hover
function adminClipCell(text) {
    const safe = escapeHtml(text);
    return `<span class="ht-admin-ui__clip" title="${safe}">${safe}</span>`;
}

function adminDeviceCell(profile) {
    return adminClipCell(adminDeviceCodeFor(profile.id) || 'Not linked');
}

function adminIdentityCells(profile) {
    return `<td>${adminClipCell(profile.username)}</td><td>${adminClipCell(adminFullName(profile))}</td><td>${adminClipCell(profile.email)}</td><td>${adminDeviceCell(profile)}</td>`;
}

function renderAdminPending() {
    const rows = adminSortRows(adminVisibleProfiles().filter((profile) => profile.status !== 'approved' && adminMatchesSearch(profile, 'adminPendingSearch')), 'pending');
    syncAdminSortControls('pending');
    renderAdminTable('pending', rows, (profile) => `<tr>${adminIdentityCells(profile)}<td>${adminFormatDate(profile.createdAt)}</td><td><span class="ht-admin-ui__status ht-admin-ui__status--pending">Pending</span></td><td><div class="ht-admin-ui__actions"><button type="button" class="ht-btn ht-btn--small ht-btn--ghost ht-admin-ui__btn--accept" data-admin-accept="${profile.id}"><i data-lucide="check"></i>Accept</button><button type="button" class="ht-btn ht-btn--small ht-btn--ghost ht-admin-ui__btn--danger" data-admin-reject="${profile.id}"><i data-lucide="x"></i>Reject</button></div></td></tr>`, 'No pending requests', 'requests');
}

function renderAdminUsers() {
    const rows = adminVisibleProfiles().filter((profile) => profile.status === 'approved' && adminMatchesSearch(profile, 'adminUserSearch'));
    adminSortRows(rows, 'users');
    syncAdminSortControls('users');
    renderAdminTable('users', rows, (profile) => `<tr>${adminIdentityCells(profile)}<td>${adminFormatDate(profile.createdAt)}</td><td><span class="ht-adash__chip ht-adash__chip--approved">Approved</span></td><td><div class="ht-admin-ui__actions"><button type="button" class="ht-btn ht-btn--small ht-btn--ghost" data-admin-edit="${profile.id}"><i data-lucide="pencil"></i>Edit</button><button type="button" class="ht-btn ht-btn--small ht-btn--ghost ht-admin-ui__btn--danger" data-admin-delete="${profile.id}"><i data-lucide="trash-2"></i>Delete</button></div></td></tr>`, 'No approved accounts', 'users');
}

// Re-renders everything that shows account / device counts
function renderAdminAll() {
    renderAdminSummary();
    renderAdminPending();
    renderAdminUsers();
    renderAdminDevices();
}

// ============================================
// ADMIN — DEVICE REGISTRY
// ============================================
let adminDevices = [];      // rows of public.devices
let adminDeviceTrash = [];  // { device_code, deleted_at } from admin_list_device_trash()
let adminDeviceFilter = 'all';
let adminDeviceTrashReady = true; // false when device_trash.sql has not been run in Supabase

// Turns a failed trash RPC into a message the admin can act on
function adminTrashErrorText(error, fallback) {
    // PGRST202 / 42883 / 404: the function is not installed (or PostgREST has not reloaded its schema yet)
    if (error?.code === 'PGRST202' || error?.code === '42883' || error?.status === 404) {
        // Supabase's own text says which function is missing (the trash one, or one it calls)
        return `Device trash is not set up. Run device_trash.sql in the Supabase SQL Editor.${error?.message ? ` (${error.message})` : ''}`;
    }
    return error?.message ? `${fallback} ${error.message}` : fallback;
}

// Edit Device: the Device ID / API key functions come from device_api_key.sql
function adminDeviceSqlErrorText(error, fallback) {
    if (error?.code === 'PGRST202' || error?.code === '42883' || error?.status === 404) {
        return 'Editing the Device ID / API key is not set up. Run device_api_key.sql in the Supabase SQL Editor.';
    }
    return `${fallback} ${error?.message || ''}`.trim();
}

async function loadAdminDevices() {
    // devices is protected by row-level security (an admin's own query sees no rows),
    // so the list comes from admin_list_devices() in admin_devices.sql
    let { data, error } = await sb.rpc('admin_list_devices');
    if (error) {
        // Function not installed yet: try the table directly (works if an admin read policy exists)
        const direct = await sb.from('devices').select('id, device_code, owner_id, device_name, device_url, url_updated_at, claimed_at, created_at').order('device_code');
        if (!direct.error && direct.data?.length) ({ data, error } = direct);
    }
    if (error) {
        console.error('Could not load devices (run admin_devices.sql in Supabase):', error);
        showAdminToast('Could not load the device registry. Run admin_devices.sql in Supabase.', 'error');
        adminDevices = [];
    } else {
        adminDevices = data || [];
    }
    const trash = await sb.rpc('admin_list_device_trash');
    if (trash.error) console.warn('Device trash unavailable (run device_trash.sql in Supabase).', trash.error);
    adminDeviceTrashReady = !trash.error;
    adminDeviceTrash = trash.error ? [] : (trash.data || []);
    checkAdminDeviceReach();
}

// A saved device_url only means the logger once started a tunnel: it stays saved
// when the mini PC loses power or crashes. So "Online" is decided by asking the
// logger's /stats at that address (same request the live feed makes).
const ADMIN_DEVICE_CHECK_MS = 60 * 1000;
const ADMIN_DEVICE_TIMEOUT_MS = 8000;
const adminDeviceReach = new Map();   // device_url -> true (answered) | false (no answer)
let adminDeviceCheckTimer = null;

async function checkAdminDeviceReach() {
    const urls = [...new Set(adminDevices.map((device) => device.device_url).filter(Boolean))];
    const results = await Promise.all(urls.map(async (url) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), ADMIN_DEVICE_TIMEOUT_MS);
        try {
            const base = url.replace(/\/video\/?(\?.*)?$/, '');
            const res = await fetch(`${base}/stats?t=${Date.now()}`, { cache: 'no-store', signal: controller.signal });
            return [url, res.ok];
        } catch (_) {
            return [url, false];
        } finally {
            clearTimeout(timer);
        }
    }));
    let changed = false;
    results.forEach(([url, ok]) => {
        if (adminDeviceReach.get(url) !== ok) changed = true;
        adminDeviceReach.set(url, ok);
    });
    if (changed) renderAdminDevices();
}

function renderAdminDevices() {
    const list = document.getElementById('adminDeviceList');
    if (!list) return;
    const linked = adminDevices.filter((device) => device.owner_id);
    const counts = { all: adminDevices.length, linked: linked.length, available: adminDevices.length - linked.length, trash: adminDeviceTrash.length };
    document.querySelectorAll('[data-device-count]').forEach((el) => { el.textContent = counts[el.dataset.deviceCount] ?? 0; });
    document.querySelectorAll('[data-device-filter]').forEach((button) => {
        const active = button.dataset.deviceFilter === adminDeviceFilter;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
    });

    const search = (document.getElementById('adminDeviceSearch')?.value || '').toLowerCase().trim();
    let html;
    if (adminDeviceFilter === 'trash') {
        const rows = adminDeviceTrash.filter((item) => item.device_code.toLowerCase().includes(search));
        html = rows.map((item) => {
            const daysLeft = Math.max(0, 30 - Math.floor((Date.now() - new Date(item.deleted_at).getTime()) / 86400000));
            const code = escapeHtml(item.device_code);
            return `<li class="ht-admin-device__item ht-admin-device__item--trash"><span class="ht-admin-device__icon"><i data-lucide="trash-2"></i></span><div class="ht-admin-device__info"><div class="ht-admin-device__row"><span class="ht-admin-device__code">${code}</span></div><span class="ht-admin-device__meta">Deleted ${adminFormatDate(item.deleted_at)} · ${daysLeft} day${daysLeft === 1 ? '' : 's'} left</span></div><div class="ht-admin-device__tools"><button type="button" class="ht-admin-device__copy" data-device-restore="${code}" aria-label="Restore ${code}" data-tooltip="Restore"><i data-lucide="rotate-ccw"></i></button><button type="button" class="ht-admin-device__copy ht-admin-device__copy--danger" data-device-purge="${code}" aria-label="Delete ${code} permanently" data-tooltip="Delete permanently"><i data-lucide="x"></i></button></div></li>`;
        }).join('');
    } else {
        const rows = adminDevices.filter((device) => {
            if (adminDeviceFilter === 'linked' && !device.owner_id) return false;
            if (adminDeviceFilter === 'available' && device.owner_id) return false;
            const owner = adminFindProfile(device.owner_id);
            const text = `${device.device_code} ${owner ? `${owner.username} ${adminFullName(owner)}` : ''}`.toLowerCase();
            return text.includes(search);
        });
        html = rows.map((device) => {
            const owner = adminFindProfile(device.owner_id);
            // No address: offline. Address saved: online only once the logger has answered.
            const reach = device.device_url ? adminDeviceReach.get(device.device_url) : false;
            const online = reach === true;
            const reachText = online ? 'Online' : reach === undefined ? 'Checking...' : 'Offline';
            const code = escapeHtml(device.device_code);
            const ownerText = device.owner_id
                ? `<span>Owner:</span> ${escapeHtml(owner ? `${adminFullName(owner)} (@${owner.username})` : 'Unknown account')}`
                : '<span>No owner yet</span>';
            return `<li class="ht-admin-device__item"><span class="ht-admin-device__icon${online ? ' is-online' : ''}"><i data-lucide="cpu"></i></span><div class="ht-admin-device__info"><div class="ht-admin-device__row"><span class="ht-admin-device__code">${code}</span><span class="ht-adash__chip ht-adash__chip--${device.owner_id ? 'approved' : 'pending'}">${device.owner_id ? 'Linked' : 'Available'}</span></div><span class="ht-admin-device__owner">${ownerText}</span><span class="ht-admin-device__meta"><span class="ht-admin-device__dot${online ? ' is-online' : ''}"></span>${reachText}</span></div><div class="ht-admin-device__tools"><button type="button" class="ht-admin-device__copy" data-device-copy="${code}" aria-label="Copy ${code}" data-tooltip="Copy Device ID"><i data-lucide="copy"></i></button><button type="button" class="ht-admin-device__copy" data-device-edit="${code}" aria-label="Edit ${code}" data-tooltip="Edit"><i data-lucide="pencil"></i></button><button type="button" class="ht-admin-device__copy ht-admin-device__copy--danger" data-device-delete="${code}" aria-label="Delete ${code}" data-tooltip="Delete"><i data-lucide="trash-2"></i></button></div></li>`;
        }).join('');
    }
    const emptyText = adminDeviceFilter === 'trash' ? 'Trash is empty' : search ? 'No devices match your search' : 'No devices registered yet';
    list.innerHTML = html || `<li class="ht-admin-device__empty"><i data-lucide="${adminDeviceFilter === 'trash' ? 'trash-2' : 'cpu'}"></i>${emptyText}</li>`;
    lucide.createIcons();
}

function showAdminDeviceStatus(message, type = 'success') {
    const status = document.getElementById('adminDeviceStatus');
    if (!status) return;
    status.textContent = message;
    status.className = `ht-profile__status ht-profile__status--${type}`;
    clearTimeout(status.__timer);
    status.__timer = setTimeout(() => status.classList.add('u-hidden'), 4000);
}

// Digits only, padded to 3 on blur (same as the sign-up Device ID box)
function bindDeviceNumberInput(input) {
    if (!input) return;
    input.addEventListener('input', () => {
        const digits = input.value.replace(/\D/g, '').slice(0, 3);
        if (digits !== input.value) input.value = digits;
    });
    input.addEventListener('blur', () => {
        if (input.value && input.value.length < 3) input.value = input.value.padStart(3, '0');
    });
}

const DEVICE_RESULT_MSG = {
    exists: 'That Device ID is already registered.',
    in_trash: 'That Device ID is in the trash. Restore it or delete it permanently first.',
    invalid: 'Check the Device ID and API key format.',
    not_found: 'That device no longer exists.',
    linked: 'This device is linked to an account, so it cannot be changed or deleted.',
    has_readings: 'This device has saved readings, so it cannot be deleted.',
};

function initAdminDevices() {
    const form = document.getElementById('adminDeviceForm');
    const editForm = document.getElementById('adminDeviceEditForm');
    const editModal = document.getElementById('adminDeviceModal');
    bindDeviceNumberInput(form?.elements.deviceNumber);
    bindDeviceNumberInput(editForm?.elements.deviceNumber);
    [form?.elements.deviceKey, editForm?.elements.deviceKey].forEach((input) => input && blockSpaces(input));
    [form, editForm].forEach((f) => f?.querySelectorAll('[data-password-toggle]').forEach((toggle) => toggle.addEventListener('click', () => togglePasswordGroup(toggle))));

    // Generate a random 32-character key (letters and numbers) and show it so it can be noted down
    // (Register Device and Edit Device both have the button)
    [form, editForm].forEach((f) => f?.querySelector('[data-generate-device-key]')?.addEventListener('click', (event) => {
        event.preventDefault();   // the Edit Device button sits inside a <label>
        const input = f.elements.deviceKey;
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let key = '';
        while (key.length < 32) {
            for (const b of crypto.getRandomValues(new Uint8Array(32))) {
                // 248 = 4 * 62: skip higher bytes so every character is equally likely
                if (b < 248 && key.length < 32) key += chars[b % chars.length];
            }
        }
        input.readOnly = false;
        input.value = key;
        input.setCustomValidity('');
        if (input.type === 'password') togglePasswordGroup(input.parentElement.querySelector('[data-password-toggle]'));
        if (f === editForm) adminSetText('adminDeviceKeyHint', 'New key generated. Note it down: it replaces the current key when you save.');
        input.focus();
    }));

    document.getElementById('adminDeviceSearch')?.addEventListener('input', renderAdminDevices);
    document.querySelectorAll('[data-device-filter]').forEach((button) => button.addEventListener('click', () => {
        adminDeviceFilter = button.dataset.deviceFilter;
        renderAdminDevices();
    }));

    form?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const number = form.elements.deviceNumber.value.trim().padStart(3, '0');
        const key = form.elements.deviceKey.value;
        const url = form.elements.deviceUrl.value.trim();
        if (!/^(?!000)\d{3}$/.test(number)) { showAdminDeviceStatus('Enter a Device ID number from 001 to 999.', 'error'); form.elements.deviceNumber.focus(); return; }
        if (!/^[A-Za-z0-9_-]{8,64}$/.test(key)) { showAdminDeviceStatus('API key must be 8-64 letters, numbers, - or _.', 'error'); form.elements.deviceKey.focus(); return; }
        if (url && !/^https?:\/\/\S+$/i.test(url)) { showAdminDeviceStatus('Device URL must start with http:// or https://', 'error'); form.elements.deviceUrl.focus(); return; }
        const code = 'HT-PDCK-' + number;
        const { data, error } = await sb.rpc('admin_register_device', { p_device_code: code, p_api_key: key, p_device_url: url || null });
        if (error) { console.error('Register device failed:', error); showAdminDeviceStatus('Could not register the device: ' + error.message, 'error'); return; }
        if (data && data !== 'ok') { showAdminDeviceStatus(DEVICE_RESULT_MSG[data] || `Could not register the device (${data}).`, 'error'); return; }
        form.reset();
        await loadAdminDevices();
        renderAdminAll();
        showAdminDeviceStatus(`${code} registered.`);
        showAdminToast(`${code} registered.`);
    });
    form?.addEventListener('reset', () => document.getElementById('adminDeviceStatus')?.classList.add('u-hidden'));

    document.getElementById('adminDeviceList')?.addEventListener('click', async (event) => {
        const button = event.target.closest('button');
        if (!button || button.getAttribute('aria-disabled') === 'true') return;
        const { deviceCopy, deviceEdit, deviceDelete, deviceRestore, devicePurge } = button.dataset;

        if (deviceCopy) {
            try { await navigator.clipboard.writeText(deviceCopy); showAdminToast(`${deviceCopy} copied.`); }
            catch (_) { showAdminToast('Could not copy the Device ID.', 'error'); }
        } else if (deviceEdit) {
            const device = adminDevices.find((item) => item.device_code === deviceEdit);
            if (!device || !editForm) return;
            editForm.reset();
            editForm.elements.deviceCode.value = device.device_code;
            editForm.elements.deviceNumber.value = device.device_code.replace(/^HT-PDCK-/, '');
            editForm.elements.deviceNumber.readOnly = !!device.owner_id;
            editForm.elements.deviceUrl.value = device.device_url || '';
            adminSetText('adminDeviceCodeHint', device.owner_id ? 'Linked to an account, so the Device ID cannot be changed.' : '');
            adminSetText('adminDeviceKeyHint', 'The current key is stored hashed and cannot be shown.');
            document.getElementById('adminDeviceEditError')?.classList.add('u-hidden');
            editModal?.classList.remove('u-hidden');
        } else if (deviceDelete) {
            const device = adminDevices.find((item) => item.device_code === deviceDelete);
            const owner = device?.owner_id ? adminFindProfile(device.owner_id) : null;
            const linkedNote = device?.owner_id ? ` It is linked to ${owner ? `@${owner.username}` : 'an account'}, who will lose access to it until it is restored.` : '';
            openAdminConfirm(`Move ${deviceDelete} and its saved readings to the trash?${linkedNote} You can restore it within 30 days.`, async () => {
                const { data, error } = await sb.rpc('admin_trash_device', { p_device_code: deviceDelete });
                if (error) console.error('Trash device failed:', error);
                if (error || data !== 'ok') { showAdminToast(error ? adminTrashErrorText(error, 'Could not delete the device.') : (DEVICE_RESULT_MSG[data] || 'Could not delete the device.'), 'error'); return; }
                await loadAdminDevices(); renderAdminAll(); showAdminToast(`${deviceDelete} moved to the trash.`);
            });
        } else if (deviceRestore) {
            const { data, error } = await sb.rpc('admin_restore_device', { p_device_code: deviceRestore });
            if (error) console.error('Restore device failed:', error);
            if (error || data !== 'ok') { showAdminToast(error ? adminTrashErrorText(error, 'Could not restore the device.') : data === 'exists' ? 'A device with that ID is already registered.' : (DEVICE_RESULT_MSG[data] || 'Could not restore the device.'), 'error'); return; }
            await loadAdminDevices(); renderAdminAll(); showAdminToast(`${deviceRestore} restored.`);
        } else if (devicePurge) {
            openAdminConfirm(`Delete ${devicePurge} and its saved readings permanently? This cannot be undone.`, async () => {
                const { data, error } = await sb.rpc('admin_purge_device', { p_device_code: devicePurge });
                if (error) console.error('Purge device failed:', error);
                if (error || (data && data !== 'ok')) { showAdminToast(error ? adminTrashErrorText(error, 'Could not delete the device.') : (DEVICE_RESULT_MSG[data] || 'Could not delete the device.'), 'error'); await loadAdminDevices(); renderAdminAll(); return; }
                await loadAdminDevices(); renderAdminAll(); showAdminToast(`${devicePurge} deleted permanently.`);
            });
        }
    });

    editForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const errorEl = document.getElementById('adminDeviceEditError');
        const fail = (message) => { errorEl.textContent = message; errorEl.classList.remove('u-hidden'); };
        const oldCode = editForm.elements.deviceCode.value;
        const device = adminDevices.find((item) => item.device_code === oldCode);
        const number = editForm.elements.deviceNumber.value.trim().padStart(3, '0');
        const newCode = 'HT-PDCK-' + number;
        const key = editForm.elements.deviceKey.value;
        const url = editForm.elements.deviceUrl.value.trim();
        if (!device) return fail(DEVICE_RESULT_MSG.not_found);
        if (!/^(?!000)\d{3}$/.test(number)) return fail('Enter a Device ID number from 001 to 999.');
        if (key && !/^[A-Za-z0-9_-]{8,64}$/.test(key)) return fail('API key must be 8-64 letters, numbers, - or _.');
        if (url && !/^https?:\/\/\S+$/i.test(url)) return fail('Device URL must start with http:// or https://');

        let code = oldCode;
        if (newCode !== oldCode) {
            const { data, error } = await sb.rpc('admin_update_device_code', { p_device_code: oldCode, p_new_code: newCode });
            if (error || data !== 'ok') return fail(error ? adminDeviceSqlErrorText(error, 'Could not change the Device ID:') : (DEVICE_RESULT_MSG[data] || 'Could not change the Device ID.'));
            code = newCode;
        }
        if (key) {
            const { data, error } = await sb.rpc('admin_update_device_key', { p_device_code: code, p_api_key: key });
            if (error || data !== 'ok') return fail(error ? adminDeviceSqlErrorText(error, 'Could not change the API key:') : (DEVICE_RESULT_MSG[data] || 'Could not change the API key.'));
        }
        if (url !== (device.device_url || '')) {
            const { data, error } = await sb.rpc('admin_update_device_url', { p_device_code: code, p_url: url || null });
            if (error || data !== 'ok') return fail(error ? 'Could not change the Device URL: ' + error.message : (DEVICE_RESULT_MSG[data] || 'Could not change the Device URL.'));
        }
        editModal.classList.add('u-hidden');
        await loadAdminDevices();
        renderAdminAll();
        showAdminToast(`${code} updated.`);
    });
}

function adminFindProfile(id) { return adminProfiles.find((profile) => profile.id === id); }

function openAdminConfirm(message, callback) {
    const modal = document.getElementById('adminConfirmModal');
    document.getElementById('adminConfirmMessage').textContent = message;
    modal?.classList.remove('u-hidden');
    const submit = document.getElementById('adminConfirmSubmit');
    submit.onclick = async () => { modal.classList.add('u-hidden'); await callback(); };
}

async function updateAdminProfile(id, values) {
    const duplicate = adminProfiles.some((profile) => profile.id !== id && profile.username.toLowerCase() === values.username.toLowerCase());
    if (duplicate) throw new Error('That username is already taken.');
    const profile = adminFindProfile(id);
    // The sign-in email lives in Supabase Auth, so change it there (and in profiles) server-side
    if (values.email && values.email.toLowerCase() !== (profile?.email || '').toLowerCase()) {
        const { data: emailResult, error: emailError } = await sb.rpc('admin_update_user_email', { target_user: id, new_email: values.email });
        if (emailError) throw emailError;
        if (emailResult === 'exists') throw new Error('That email is already used by another account.');
        if (emailResult === 'invalid') throw new Error(INVALID_EMAIL_MSG);
        values.email = values.email.trim().toLowerCase();
    }
    const { error } = await sb.from('profiles').update({ firstname: values.firstName, lastname: values.lastName, username: values.username }).eq('id', id);
    if (error) throw error;
    Object.assign(profile, values);
}

// ============================================
// ADMIN — MY PROFILE (own name, username, password)
// ============================================
async function loadAdminSelf() {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) { adminSelf = null; return; }
    const { data, error } = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
    if (error) console.error('Could not load your admin profile:', error);
    adminSelfHasRow = !!data;
    const row = data ? mapProfileRow(data) : { id: user.id, firstName: '', lastName: '', username: '', createdAt: user.created_at };
    // Email always comes from Supabase Auth (it can't be changed here)
    adminSelf = { ...row, email: user.email || row.email || '', createdAt: row.createdAt || user.created_at || null };
}

function renderAdminSelf() {
    const form = document.getElementById('adminProfileForm');
    if (!form) return;
    const u = adminSelf || { firstName: '', lastName: '', username: '', email: '', createdAt: null };
    form.elements.firstName.value = u.firstName || '';
    form.elements.lastName.value = u.lastName || '';
    form.elements.username.value = u.username || '';
    form.elements.email.value = u.email || '';
    const fullName = `${u.firstName || ''} ${u.lastName || ''}`.trim();
    const initials = ((u.firstName || '').charAt(0) + (u.lastName || '').charAt(0)) || (u.username || '').charAt(0) || 'A';
    document.getElementById('adminProfileFullName').textContent = fullName || u.username || 'Admin';
    document.getElementById('adminProfileHandle').textContent = u.username ? '@' + u.username : '';
    document.getElementById('adminProfileAvatar').textContent = initials;
    document.getElementById('adminProfileSince').textContent = u.createdAt
        ? 'Admin since ' + new Date(u.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
        : '';
}

function resetAdminPasswordFields() {
    const form = document.getElementById('adminProfileForm');
    if (!form) return;
    ['currentPassword', 'newPassword', 'confirmNewPassword'].forEach((name) => {
        form.elements[name].value = '';
        form.elements[name].setCustomValidity('');
    });
    form.querySelectorAll('[data-password-toggle]').forEach((toggle) => {
        const input = toggle.parentElement.querySelector('input');
        if (input) input.type = 'password';
        toggle.setAttribute('aria-label', 'Show password');
        toggle.innerHTML = '<i data-lucide="eye"></i>';
    });
    updatePasswordChecklist('',
        [...form.querySelectorAll('#adminProfilePasswordRequirements [data-password-requirement]')],
        form.querySelector('#adminProfilePasswordSection [data-password-strength-wrapper]'),
        form.querySelector('#adminProfilePasswordStrength span'));
    lucide.createIcons();
}

function setAdminProfileEditing(on) {
    const form = document.getElementById('adminProfileForm');
    if (!form) return;
    form.querySelectorAll('input:not([data-locked])').forEach((input) => { input.readOnly = !on; });
    form.elements.username.setCustomValidity('');
    resetAdminPasswordFields();
    document.getElementById('adminProfilePasswordSection').classList.toggle('u-hidden', !on);
    document.getElementById('adminProfileEditBtn').classList.toggle('u-hidden', on);
    document.getElementById('adminProfileActions').classList.toggle('u-hidden', !on);
    document.getElementById('adminProfileStatus').classList.add('u-hidden');
    if (on) form.elements.firstName.focus();
}

function showAdminProfileStatus(message, type = 'success') {
    const el = document.getElementById('adminProfileStatus');
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('ht-profile__status--error', type === 'error');
    el.classList.remove('u-hidden');
    clearTimeout(adminProfileStatusTimer);
    adminProfileStatusTimer = setTimeout(() => el.classList.add('u-hidden'), type === 'error' ? 6000 : 3500);
}

function initAdminProfile() {
    const form = document.getElementById('adminProfileForm');
    if (!form) return;

    // Names: letters + single spaces only (same as sign-up)
    const cleanName = (str) => str.replace(/[^\p{L}\p{M} ]/gu, '').replace(/^ +/, '').replace(/ {2,}/g, ' ');
    ['firstName', 'lastName'].forEach((name) => {
        const input = form.elements[name];
        input.maxLength = LIMITS.name.max;
        input.addEventListener('input', (e) => {
            if (e.isComposing) return;
            const cursor = input.selectionStart;
            const before = cleanName(input.value.slice(0, cursor));
            const cleaned = cleanName(input.value);
            if (cleaned !== input.value) {
                input.value = cleaned;
                input.setSelectionRange(before.length, before.length);
            }
        });
        input.addEventListener('blur', () => { input.value = input.value.trim(); });
    });
    form.elements.username.maxLength = LIMITS.username.max;
    blockSpaces(form.elements.username);
    form.elements.username.addEventListener('input', () => form.elements.username.setCustomValidity(''));

    // Optional password change
    const currentPwd = form.elements.currentPassword;
    const newPwd = form.elements.newPassword;
    const confirmPwd = form.elements.confirmNewPassword;
    const items = [...form.querySelectorAll('#adminProfilePasswordRequirements [data-password-requirement]')];
    const wrapper = form.querySelector('#adminProfilePasswordSection [data-password-strength-wrapper]');
    const label = form.querySelector('#adminProfilePasswordStrength span');
    newPwd.maxLength = LIMITS.password.max;
    confirmPwd.maxLength = LIMITS.password.max;
    [currentPwd, newPwd, confirmPwd].forEach(blockSpaces);
    [newPwd, confirmPwd].forEach(blockPasswordClipboard);

    const validatePasswords = () => {
        const changing = newPwd.value !== '';
        newPwd.setCustomValidity(changing && !PASSWORD_RULE.test(newPwd.value) ? PASSWORD_MSG : '');
        confirmPwd.setCustomValidity((changing || confirmPwd.value) && confirmPwd.value !== newPwd.value ? 'Passwords do not match.' : '');
        currentPwd.setCustomValidity(changing && !currentPwd.value ? 'Enter your current password to set a new one.' : '');
        updatePasswordChecklist(newPwd.value, items, wrapper, label);
    };
    [currentPwd, newPwd, confirmPwd].forEach((input) => input.addEventListener('input', validatePasswords));
    form.querySelectorAll('[data-password-toggle]').forEach((toggle) => {
        toggle.addEventListener('click', () => togglePasswordGroup(toggle));
    });

    document.getElementById('adminProfileEditBtn').addEventListener('click', () => {
        if (adminSelf) setAdminProfileEditing(true);
    });
    document.getElementById('adminProfileCancelBtn').addEventListener('click', () => {
        renderAdminSelf();
        setAdminProfileEditing(false);
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!adminSelf) return;
        validatePasswords();
        if (!form.reportValidity()) return;

        const next = {
            firstName: form.elements.firstName.value.trim(),
            lastName: form.elements.lastName.value.trim(),
            username: form.elements.username.value.trim(),
        };
        const taken = adminProfiles.some((p) => p.id !== adminSelf.id && (p.username || '').toLowerCase() === next.username.toLowerCase());
        if (taken) {
            form.elements.username.setCustomValidity('That username is already taken.');
            form.elements.username.reportValidity();
            return;
        }

        const saveBtn = form.querySelector('[type="submit"]');
        if (saveBtn) saveBtn.disabled = true;
        try {
            const newPassword = newPwd.value;

            // 1. Changing the password? Check the current one first.
            if (newPassword) {
                const { error: checkError } = await sb.auth.signInWithPassword({ email: adminSelf.email, password: currentPwd.value });
                if (checkError) {
                    currentPwd.setCustomValidity('Your current password is incorrect.');
                    currentPwd.reportValidity();
                    return;
                }
            }

            // 2. Save name + username (creates the profile row if this admin doesn't have one yet)
            const values = { firstname: next.firstName, lastname: next.lastName, username: next.username };
            const { error } = adminSelfHasRow
                ? await sb.from('profiles').update(values).eq('id', adminSelf.id)
                : await sb.from('profiles').insert({ id: adminSelf.id, email: adminSelf.email, status: 'approved', ...values });
            if (error) {
                if (error.code === '23505') {
                    form.elements.username.setCustomValidity('That username is already taken.');
                    form.elements.username.reportValidity();
                } else {
                    console.error('Admin profile update failed:', error);
                    showAdminProfileStatus('Could not save your changes. Please try again.', 'error');
                }
                return;
            }
            adminSelfHasRow = true;
            adminSelf = { ...adminSelf, ...next };
            const listed = adminFindProfile(adminSelf.id);
            if (listed) Object.assign(listed, next);

            // 3. Set the new password
            let message = 'Profile updated successfully.';
            let type = 'success';
            if (newPassword) {
                const { error: pwError } = await sb.auth.updateUser({ password: newPassword });
                if (!pwError) message = 'Profile and password updated successfully.';
                else {
                    console.error('Password update failed:', pwError);
                    type = 'error';
                    message = pwError.code === 'same_password'
                        ? 'Profile saved, but the new password must be different from your current password.'
                        : 'Profile saved, but the password could not be changed: ' + pwError.message;
                }
            }

            renderAdminSelf();
            setAdminProfileEditing(false);
            showAdminProfileStatus(message, type);
            showAdminToast(message, type);
        } finally {
            if (saveBtn) saveBtn.disabled = false;
        }
    });
}

// ============================================
// ADMIN WEATHER CARD (Open-Meteo)
// ============================================
// Uses the browser's location if allowed, else Pateros. Refreshed at most
// every 15 minutes (the last result is kept between page loads).
const WEATHER_FALLBACK = { lat: 14.5454, lon: 121.0687, place: 'Pateros, Metro Manila' };
const WEATHER_EVERY_MS = 15 * 60 * 1000;
const WEATHER_CACHE_KEY = 'ht-admin-weather';
let adminWeatherTimer = null;

// Heat index tiers, same as the card's guide
function weatherRisk(heatIndex) {
    if (heatIndex < 27) return 'low';
    if (heatIndex < 33) return 'moderate';
    if (heatIndex < 42) return 'high';
    return 'critical';
}

// Open-Meteo weather code -> [description, lucide icon]
function weatherLook(code, isDay) {
    if (code === 0) return ['Clear sky', isDay ? 'sun' : 'moon'];
    if (code <= 2) return ['Partly cloudy', isDay ? 'cloud-sun' : 'cloud-moon'];
    if (code === 3) return ['Overcast', 'cloud'];
    if (code === 45 || code === 48) return ['Fog', 'cloud-fog'];
    if (code >= 51 && code <= 57) return ['Drizzle', 'cloud-drizzle'];
    if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return ['Rain', 'cloud-rain'];
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return ['Snow', 'snowflake'];
    if (code >= 95) return ['Thunderstorm', 'cloud-lightning'];
    return ['--', 'cloud-sun'];
}

function adminWeatherLocation() {
    return new Promise((resolve) => {
        if (!navigator.geolocation) return resolve(null);
        navigator.geolocation.getCurrentPosition(
            (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
            () => resolve(null),   // denied, unavailable or timed out
            { timeout: 10000, maximumAge: WEATHER_EVERY_MS }
        );
    });
}

// Place name for the coordinates: BigDataCloud first, OpenStreetMap if that fails
async function adminWeatherPlace(lat, lon) {
    const lookups = [
        async () => {
            const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
            if (!r.ok) return null;
            const j = await r.json();
            const province = (j.localityInfo?.administrative || []).find((a) => a.adminLevel === 4)?.name;
            return [j.locality || j.city, province || j.principalSubdivision];
        },
        async () => {
            const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=14&accept-language=en`);
            if (!r.ok) return null;
            const a = (await r.json()).address || {};
            return [a.town || a.city || a.municipality || a.village, a.state || a.region];
        },
    ];
    for (const lookup of lookups) {
        try {
            const parts = ((await lookup()) || []).filter(Boolean);
            if (parts.length) return [...new Set(parts)].join(', ');
        } catch { /* try the next service */ }
    }
    return null;
}

async function fetchAdminWeather() {
    const coords = await adminWeatherLocation();
    const { lat, lon } = coords || WEATHER_FALLBACK;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
        + '&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,is_day&timezone=auto';
    const [res, place] = await Promise.all([fetch(url), coords ? adminWeatherPlace(lat, lon) : null]);
    if (!res.ok) throw new Error('Open-Meteo ' + res.status);
    const { current } = await res.json();
    return {
        at: Date.now(),
        lat,
        lon,
        placeFound: !coords || !!place,   // false: only coordinates, look the name up again next time
        place: place || (coords ? `${lat.toFixed(2)}, ${lon.toFixed(2)}` : WEATHER_FALLBACK.place + ' (default)'),
        temp: current.temperature_2m,
        humidity: current.relative_humidity_2m,
        heatIndex: current.apparent_temperature,
        code: current.weather_code,
        isDay: current.is_day === 1,
    };
}

function renderAdminWeather(w) {
    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    const [desc, icon] = weatherLook(w.code, w.isDay);
    set('adminWeatherPlace', w.place);
    set('adminWeatherTemp', `${Math.round(w.temp)}°C`);
    set('adminWeatherDesc', desc);
    set('adminWeatherFeels', `${Math.round(w.heatIndex)}°C`);
    set('adminWeatherHumid', `${Math.round(w.humidity)}%`);
    set('adminWeatherUpdated', 'Updated ' + new Date(w.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }));
    const iconEl = document.getElementById('adminWeatherIcon');
    if (iconEl) {
        iconEl.innerHTML = `<i data-lucide="${icon}"></i>`;
        lucide.createIcons();
    }
    const risk = weatherRisk(w.heatIndex);
    document.querySelectorAll('.ht-adash__guide-list [data-risk]').forEach((li) => {
        li.classList.toggle('is-current', li.dataset.risk === risk);
    });
}

async function loadAdminWeather() {
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(WEATHER_CACHE_KEY)); } catch { /* no storage */ }
    if (cached && Date.now() - cached.at < WEATHER_EVERY_MS) {
        renderAdminWeather(cached);
        // The name lookup failed last time: try again instead of keeping the coordinates
        if (cached.placeFound === false && cached.lat != null) {
            const place = await adminWeatherPlace(cached.lat, cached.lon);
            if (place) {
                cached.place = place;
                cached.placeFound = true;
                renderAdminWeather(cached);
                try { localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(cached)); } catch { /* no storage */ }
            }
        }
        return;
    }
    try {
        const w = await fetchAdminWeather();
        renderAdminWeather(w);
        try { localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(w)); } catch { /* no storage */ }
    } catch (e) {
        console.warn('Weather fetch failed:', e);
        if (cached) {
            renderAdminWeather(cached);   // show the last result rather than nothing
        } else {
            document.getElementById('adminWeatherPlace').textContent = 'Location unavailable';
            document.getElementById('adminWeatherDesc').textContent = 'Weather unavailable. Retrying in 15 minutes.';
            document.getElementById('adminWeatherUpdated').textContent = 'Offline';
        }
    }
}

function initAdminWeather() {
    if (!document.getElementById('adminWeatherTemp')) return;
    loadAdminWeather();
    clearInterval(adminWeatherTimer);
    adminWeatherTimer = setInterval(loadAdminWeather, WEATHER_EVERY_MS);
}

async function initAdminUi() {
    const adminUi = document.getElementById('admin-ui');
    if (!adminUi) return;
    const { data, error } = await sb.from('profiles').select('*');
    if (error) {
        showAdminToast('Could not load user accounts. Add the profiles.status column if it is missing.', 'error');
        return;
    }
    adminProfiles = data.map(mapProfileRow);
    await loadAdminIds();
    await loadAdminSelf();
    await loadAdminReads();
    await loadAdminDevices();
    adminSetView('overview');
    renderAdminAll();

    if (adminUiBound) return;
    adminUiBound = true;
    initAdminProfile();
    initAdminDevices();
    initAdminWeather();
    // Back on this tab: pick up requests read on the admin's other browsers
    // (Realtime normally does this instantly)
    document.addEventListener('visibilitychange', async () => {
        if (document.hidden || !adminSelf?.id) return;
        const ids = await fetchReadItemIds(adminSelf.id);
        if (!ids) return;
        ids.forEach((id) => adminReadSet.add(id));
        renderAdminSummary();
    });
    clearInterval(adminDeviceCheckTimer);
    adminDeviceCheckTimer = setInterval(() => { if (adminDevices.length) checkAdminDeviceReach(); }, ADMIN_DEVICE_CHECK_MS);

    document.querySelectorAll('[data-admin-route]').forEach((link) => link.addEventListener('click', () => adminSetView(link.dataset.adminRoute)));
    document.getElementById('adminUserSearch')?.addEventListener('input', () => { adminPage.users = 1; renderAdminUsers(); });
    document.getElementById('adminPendingSearch')?.addEventListener('input', () => { adminPage.pending = 1; renderAdminPending(); });
    document.querySelectorAll('[data-admin-page]').forEach((button) => button.addEventListener('click', () => {
        const table = button.dataset.adminPage;
        adminPage[table] += Number(button.dataset.adminPageStep);
        if (table === 'users') renderAdminUsers(); else renderAdminPending();
        // A new page of the table starts at its first row
        const scroller = button.closest('.ht-panel')?.querySelector('.ht-table-scroll');
        if (scroller) { scroller.scrollTop = 0; scroller.scrollLeft = 0; }
    }));
    // Bell: opens the Pending Requests panel
    const alertBtn = document.getElementById('adminAlertBtn');
    const alertPanel = document.getElementById('adminAlertPanel');
    // Read all: every request pending right now counts as seen
    document.getElementById('adminReadAll')?.addEventListener('click', () => {
        const readIds = adminReadIds();
        adminVisibleProfiles()
            .filter((profile) => profile.status !== 'approved')
            .forEach((profile) => readIds.add(profile.id));
        adminSaveReadIds(readIds);
        renderAdminSummary();
    });
    // Show More Requests: the list is redrawn, so the click must not reach the
    // outside-click handler below (the button is no longer in the panel by then)
    document.getElementById('adminAlertList')?.addEventListener('click', (event) => {
        if (!event.target.closest('#adminAlertShowMore')) return;
        event.stopPropagation();
        adminAlertsShown += ADMIN_ALERT_PAGE_SIZE;
        renderAdminSummary();
    });
    alertBtn?.addEventListener('click', (event) => {
        event.stopPropagation();
        const open = alertPanel.classList.toggle('is-open');
        alertPanel.inert = !open;
        alertBtn.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', (event) => {
        if (!alertPanel?.classList.contains('is-open') || alertPanel.contains(event.target)) return;
        alertPanel.classList.remove('is-open');
        alertPanel.inert = true;
        alertBtn?.setAttribute('aria-expanded', 'false');
    });
    // A pending request (bell panel or the dashboard's Pending Requests card) opens the
    // Pending page; its Accept / Reject buttons keep doing their own job
    const openPendingItem = (item) => {
        adminSaveReadIds(new Set([item.dataset.adminPendingItem]));   // opened = seen
        renderAdminSummary();                                          // bell count drops by one
        alertPanel?.classList.remove('is-open');
        if (alertPanel) alertPanel.inert = true;
        alertBtn?.setAttribute('aria-expanded', 'false');
        adminSetView('pending');
    };
    document.addEventListener('click', (event) => {
        const item = event.target.closest('[data-admin-pending-item]');
        if (item && !event.target.closest('button')) openPendingItem(item);
    });
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const item = event.target.closest?.('[data-admin-pending-item]');
        if (!item || event.target !== item) return;
        event.preventDefault();
        openPendingItem(item);
    });
    // Sorting: "Sort by" dropdown, Ascending/Descending button, and clickable column titles
    document.querySelectorAll('[data-admin-sort-select]').forEach((select) => select.addEventListener('change', () => {
        const table = select.dataset.adminSortSelect;
        // New choice starts in its natural order: newest first for dates, A-Z for text
        setAdminSort(table, select.value, select.value === 'createdAt' ? -1 : 1);
    }));
    document.querySelectorAll('[data-admin-sort-dir]').forEach((button) => button.addEventListener('click', () => {
        const table = button.dataset.adminSortDir;
        setAdminSort(table, adminSort[table].key, adminSort[table].dir * -1);
    }));
    document.querySelectorAll('th [data-admin-sort]').forEach((button) => button.addEventListener('click', () => {
        const table = button.closest('[data-admin-view]')?.dataset.adminView;
        if (!adminSort[table]) return;
        const key = button.dataset.adminSort;
        // Same column again = flip the order; new column = newest first for dates, A-Z for text
        const dir = adminSort[table].key === key ? adminSort[table].dir * -1 : (key === 'createdAt' ? -1 : 1);
        setAdminSort(table, key, dir);
    }));
    document.getElementById('adminMenuToggle')?.addEventListener('click', () => {
        const nav = document.getElementById('adminNav');
        const open = nav.classList.toggle('is-open');
        document.getElementById('adminMenuToggle').setAttribute('aria-expanded', String(open));
    });
    document.querySelectorAll('[data-admin-modal-close], [data-admin-confirm-cancel]').forEach((button) => button.addEventListener('click', () => button.closest('.ht-admin-ui__modal')?.classList.add('u-hidden')));

    adminUi.addEventListener('click', async (event) => {
        const accept = event.target.closest('[data-admin-accept]');
        if (accept) {
            const { error: acceptError } = await sb.from('profiles').update({ status: 'approved' }).eq('id', accept.dataset.adminAccept);
            if (acceptError) {
                console.error('Approve account failed:', acceptError);
                showAdminToast(`Could not approve the account. ${acceptError.message || ''}`.trim(), 'error');
            }
            else { adminFindProfile(accept.dataset.adminAccept).status = 'approved'; renderAdminAll(); showAdminToast('Account approved.'); }
        }
        const reject = event.target.closest('[data-admin-reject]');
        if (reject) openAdminConfirm('Reject this request? This cannot be undone.', async () => {
            // Deleting just the profiles row isn't enough — the person's Supabase Auth
            // account would still exist and they could log in again and get a fresh
            // pending profile. admin_delete_user removes the actual account, which
            // cascades and removes the profile (and their data) with it.
            const { error: rejectError } = await sb.rpc('admin_delete_user', { target_user: reject.dataset.adminReject });
            if (rejectError) showAdminToast('Could not reject the request.', 'error');
            else { adminProfiles = adminProfiles.filter((profile) => profile.id !== reject.dataset.adminReject); await loadAdminDevices(); renderAdminAll(); showAdminToast('Request rejected.'); }
        });
        const edit = event.target.closest('[data-admin-edit]');
        if (edit) {
            const profile = adminFindProfile(edit.dataset.adminEdit);
            const form = document.getElementById('adminUserForm');
            Object.entries({ id: profile.id, firstName: profile.firstName, lastName: profile.lastName, username: profile.username, email: profile.email }).forEach(([key, value]) => { form.elements[key].value = value || ''; });
            document.getElementById('adminUserFormError').classList.add('u-hidden');
            document.getElementById('adminUserModal').classList.remove('u-hidden');
        }
        const reset = event.target.closest('[data-admin-reset]');
        if (reset) {
            const profile = adminFindProfile(reset.dataset.adminReset);
            if (!profile?.email) {
                showAdminToast('This user has no email address on file.', 'error');
            } else {
                openAdminConfirm(`Send a password reset email to ${profile.email}?`, async () => {
                    // Same email as "Forgot password?" on the login screen; the link opens
                    // HeatTrack's reset screen where the user chooses a new password.
                    const { error: resetError } = await sb.auth.resetPasswordForEmail(profile.email, {
                        redirectTo: location.origin + location.pathname,
                    });
                    if (!resetError) showAdminToast(`Password reset link sent to ${profile.email}.`);
                    else if (resetError.status === 429) showAdminToast('Too many emails sent. Please wait a while and try again.', 'error');
                    else showAdminToast('Could not send the reset email: ' + resetError.message, 'error');
                });
            }
        }
        const remove = event.target.closest('[data-admin-delete]');
        if (remove) {
            const profile = adminFindProfile(remove.dataset.adminDelete);
            openAdminConfirm(`Delete user ${profile.username}? This cannot be undone.`, async () => {
                // Same reasoning as reject: remove the real account, not just the profile row.
                const { error: deleteError } = await sb.rpc('admin_delete_user', { target_user: profile.id });
                if (deleteError) showAdminToast('Could not delete the user.', 'error');
                else { adminProfiles = adminProfiles.filter((item) => item.id !== profile.id); await loadAdminDevices(); renderAdminAll(); showAdminToast('User deleted.'); }
            });
        }
    });

    document.getElementById('adminUserForm')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const error = document.getElementById('adminUserFormError');
        const values = { firstName: form.elements.firstName.value.trim(), lastName: form.elements.lastName.value.trim(), username: form.elements.username.value.trim(), email: form.elements.email.value.trim() };
        if (!form.reportValidity()) return;
        try { await updateAdminProfile(form.elements.id.value, values); document.getElementById('adminUserModal').classList.add('u-hidden'); renderAdminAll(); showAdminToast('User updated successfully.'); }
        catch (err) { error.textContent = err.message || 'Could not update the user.'; error.classList.remove('u-hidden'); showAdminToast(error.textContent, 'error'); }
    });
}
