

// ====================================================================
// GROWHAZ SAAS AUTH, SSO, WALLET BILLING & NEO4J / GUARD UI
// ====================================================================
const AUTH_TOKEN_KEY = 'growhaz_bot_jwt';
let currentUser = null;
let currentBilling = null;
let isAuthenticated = true;
let _lastBillingErrorPrompt = 0;

function escSaasHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

const _nativeFetch = window.fetch.bind(window);
// Native direct fetch without external auth gating


function showAuthError(msg) {
    const errBox = document.getElementById('auth-error-box');
    const okBox = document.getElementById('auth-success-box');
    if (okBox) okBox.classList.add('hidden');
    if (errBox) {
        errBox.textContent = msg || 'Authentication failed.';
        errBox.classList.remove('hidden');
    }
}

function showAuthSuccess(msg) {
    const errBox = document.getElementById('auth-error-box');
    const okBox = document.getElementById('auth-success-box');
    if (errBox) errBox.classList.add('hidden');
    if (okBox) {
        okBox.textContent = msg || 'Success!';
        okBox.classList.remove('hidden');
    }
}

function showAuthScreen(showLoading = false) {
    const screen = document.getElementById('auth-screen');
    const loadingBox = document.getElementById('auth-loading-state');
    const mainBox = document.getElementById('auth-main-box');
    if (screen) screen.classList.remove('hidden');
    if (loadingBox) loadingBox.classList.toggle('hidden', !showLoading);
    if (mainBox) mainBox.classList.toggle('hidden', showLoading);
}

function switchAuthTab(tab) {
    const isReg = tab === 'register';
    const tabLogin = document.getElementById('auth-tab-login');
    const tabReg = document.getElementById('auth-tab-register');
    const formLogin = document.getElementById('auth-login-form');
    const formReg = document.getElementById('auth-register-form');
    const errBox = document.getElementById('auth-error-box');
    const okBox = document.getElementById('auth-success-box');
    if (errBox) errBox.classList.add('hidden');
    if (okBox) okBox.classList.add('hidden');

    if (formLogin) formLogin.classList.toggle('hidden', isReg);
    if (formReg) formReg.classList.toggle('hidden', !isReg);
    if (tabLogin) {
        tabLogin.className = isReg
            ? 'py-2 rounded-lg text-slate-600 hover:text-slate-900 transition'
            : 'py-2 rounded-lg bg-white text-emerald-700 shadow-sm transition';
    }
    if (tabReg) {
        tabReg.className = isReg
            ? 'py-2 rounded-lg bg-white text-emerald-700 shadow-sm transition'
            : 'py-2 rounded-lg text-slate-600 hover:text-slate-900 transition';
    }
}

function onAuthSuccess(user, billing) {
    isAuthenticated = true;
    currentUser = user || currentUser;
    if (billing) currentBilling = billing;

    const screen = document.getElementById('auth-screen');
    if (screen) screen.classList.add('hidden');

    const emailEl = document.getElementById('mnav-user-email');
    if (emailEl && currentUser && currentUser.email) {
        emailEl.textContent = currentUser.email.split('@')[0];
    }
    const brandTitle = document.getElementById('header-brand-title');
    if (brandTitle) {
        const bname = (currentUser && currentUser.business_name) || '';
        brandTitle.textContent = bname ? `${bname} Desk` : 'Growhaz Support Desk';
    }

    refreshBillingUI(currentBilling);
    fetchData(true);
    refreshGraphAndSecurityPanels();
}

async function bootstrapAuthAndDashboard() {
    isAuthenticated = true;
    const screen = document.getElementById('auth-screen');
    if (screen) screen.classList.add('hidden');
    try {
        await fetchData(true);
    } catch (_) {}
}

async function handleGrowhazLogin(e) {
    e.preventDefault();
    const email = (document.getElementById('auth-login-email')?.value || '').trim();
    const password = document.getElementById('auth-login-password')?.value || '';
    const btn = document.getElementById('auth-login-btn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1.5"></i> Signing In...';
    }
    try {
        const res = await _nativeFetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (!res.ok || !data.access_token) {
            showAuthError(data.detail || data.error || 'Invalid email or password.');
            return;
        }
        localStorage.setItem(AUTH_TOKEN_KEY, data.access_token);
        onAuthSuccess(data.user, data.billing);
    } catch (err) {
        showAuthError('Login error: ' + err.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Sign In to Workspace';
        }
    }
}

async function handleGrowhazRegister(e) {
    e.preventDefault();
    const fullName = (document.getElementById('auth-reg-name')?.value || '').trim();
    const email = (document.getElementById('auth-reg-email')?.value || '').trim();
    const password = document.getElementById('auth-reg-password')?.value || '';
    const btn = document.getElementById('auth-reg-btn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1.5"></i> Creating Account...';
    }
    try {
        const res = await _nativeFetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ full_name: fullName, email, password })
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
            showAuthError(data.detail || data.error || 'Registration failed.');
            return;
        }
        if (data.needs_email_verification || !data.access_token) {
            showAuthSuccess(data.message || 'Verification email sent! Confirm your email and sign in.');
            switchAuthTab('login');
            const loginEmail = document.getElementById('auth-login-email');
            if (loginEmail) loginEmail.value = email;
            return;
        }
        localStorage.setItem(AUTH_TOKEN_KEY, data.access_token);
        onAuthSuccess(data.user, data.billing);
    } catch (err) {
        showAuthError('Registration error: ' + err.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Register & Claim 3 Free Demos';
        }
    }
}

function logoutGrowhazUser() {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    isAuthenticated = false;
    currentUser = null;
    currentBilling = null;
    if (typeof closeMobileNav === 'function') closeMobileNav();
    showAuthScreen(false);
}

async function refreshBillingUI(billingObj = null) {
    let b = billingObj;
    if (!b && isAuthenticated) {
        try {
            const res = await fetch('/api/billing/status');
            if (res.ok) {
                const data = await res.json();
                b = data.billing;
            }
        } catch (_) {}
    }
    if (!b) return;
    currentBilling = b;

    const coins = Math.floor(Number((b.wallet && b.wallet.balance) || 0));
    const hc = document.getElementById('header-wallet-coins');
    const mc = document.getElementById('mnav-wallet-coins');
    const pt = document.getElementById('header-plan-tag');
    if (hc) hc.textContent = String(coins);
    if (mc) mc.textContent = String(coins);
    if (pt) {
        pt.textContent = b.is_admin ? 'ADMIN' : (b.plan && b.plan.active ? String(b.plan.tier).toUpperCase() : 'PAYG');
    }

    const banner = document.getElementById('demo-onboarding-banner');
    const demoCountEl = document.getElementById('demo-remaining-count');
    if (demoCountEl) demoCountEl.textContent = String(b.demo_remaining ?? 0);
    if (banner) {
        if (b.needs_meta_setup && !b.is_admin) {
            banner.classList.remove('hidden');
        } else {
            banner.classList.add('hidden');
        }
    }

    const modal = document.getElementById('billing-modal');
    if (modal && !modal.classList.contains('hidden')) {
        renderBillingModal(b);
    }
}

function renderBillingModal(b) {
    if (!b) return;
    const coins = Math.floor(Number((b.wallet && b.wallet.balance) || 0));
    const balEl = document.getElementById('billing-modal-balance');
    if (balEl) balEl.textContent = `${coins} Coins (₹${coins})`;

    const titleEl = document.getElementById('billing-summary-title');
    const subEl = document.getElementById('billing-summary-subtitle');
    const mode = b.billing_mode === 'byo_meta' ? 'byo_meta' : 'managed_meta';

    if (titleEl) {
        if (b.is_admin) {
            titleEl.textContent = 'Platform Owner Workspace (Admin)';
        } else if (b.plan && b.plan.active) {
            titleEl.textContent = `Active Plan: ${String(b.plan.tier).toUpperCase()} — ${b.plan.remaining}/${b.plan.quota} 24h convs left`;
        } else {
            titleEl.textContent = `Pay-As-You-Go (${mode === 'byo_meta' ? 'Own Meta ₹1/conv' : 'Managed Meta ₹2/conv'})`;
        }
    }
    if (subEl) {
        const metaNote = b.has_own_meta
            ? 'Own Meta Credentials Connected (50% Half-Price Rates Unlocked)'
            : `Free Demos left: ${b.demo_remaining ?? 0}/${b.demo_limit ?? 3} (No Meta setup needed to test)`;
        subEl.textContent = metaNote;
    }

    const cardManaged = document.getElementById('mode-card-managed');
    const cardByo = document.getElementById('mode-card-byo');
    if (cardManaged) {
        cardManaged.className = mode === 'managed_meta'
            ? 'text-left p-3.5 rounded-2xl border-2 border-emerald-500 bg-emerald-50/70 transition space-y-1'
            : 'text-left p-3.5 rounded-2xl border-2 border-slate-200 bg-white hover:border-emerald-300 transition space-y-1';
    }
    if (cardByo) {
        cardByo.className = mode === 'byo_meta'
            ? 'text-left p-3.5 rounded-2xl border-2 border-indigo-500 bg-indigo-50/70 transition space-y-1'
            : 'text-left p-3.5 rounded-2xl border-2 border-slate-200 bg-white hover:border-indigo-300 transition space-y-1';
    }

    const grid = document.getElementById('billing-plans-grid');
    if (grid) {
        const catalog = b.plans_catalog || {
            starter: { name: 'Starter', conversations: 600, managed_meta_price: 999, byo_meta_price: 499 },
            growth: { name: 'Growth', conversations: 2000, managed_meta_price: 2499, byo_meta_price: 1199 },
            pro: { name: 'Pro Scale', conversations: 5000, managed_meta_price: 4999, byo_meta_price: 2499 }
        };
        const activeTier = b.plan && b.plan.active ? b.plan.tier : '';
        grid.innerHTML = ['starter', 'growth', 'pro'].map(pid => {
            const p = catalog[pid];
            const price = mode === 'byo_meta' ? p.byo_meta_price : p.managed_meta_price;
            const strike = mode === 'byo_meta' ? `<span class="line-through text-slate-400 text-[11px] mr-1">₹${p.managed_meta_price}</span>` : '';
            const isPopular = pid === 'growth';
            const isCurrent = activeTier === pid;
            return `
                <div class="p-3.5 rounded-2xl border ${isPopular ? 'border-emerald-400 bg-emerald-50/40 shadow-sm' : 'border-slate-200 bg-slate-50/60'} flex flex-col justify-between space-y-3">
                    <div>
                        <div class="flex items-center justify-between gap-1">
                            <span class="font-extrabold text-slate-900 text-sm">${escSaasHtml(p.name)}</span>
                            ${isPopular ? '<span class="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-600 text-white">Popular</span>' : ''}
                        </div>
                        <div class="mt-1.5 flex items-baseline gap-1">
                            ${strike}
                            <span class="text-xl font-extrabold text-slate-900">₹${price}</span>
                            <span class="text-[11px] text-slate-500">/ month</span>
                        </div>
                        <p class="text-[11px] text-slate-600 font-semibold mt-1">${Number(p.conversations).toLocaleString()} conversations (24h)</p>
                    </div>
                    <button type="button" onclick="subscribePlan('${pid}')"
                            class="w-full py-2 rounded-xl font-bold text-xs transition ${isCurrent ? 'bg-slate-800 text-white' : (mode === 'byo_meta' ? 'bg-indigo-600 hover:bg-indigo-700 text-white' : 'bg-emerald-600 hover:bg-emerald-700 text-white')}">
                        ${isCurrent ? 'Current Plan (Renew)' : `Activate (${price} Coins)`}
                    </button>
                </div>
            `;
        }).join('');
    }
    calcBillingPreview();
}

function openBillingModal() {}
function closeBillingModal() {}

function closeBillingModal() {
    const modal = document.getElementById('billing-modal');
    if (modal) modal.classList.add('hidden');
}

function calcBillingPreview() {
    const countEl = document.getElementById('billing-calc-count');
    const resEl = document.getElementById('billing-calc-result');
    const noteEl = document.getElementById('billing-calc-mode-note');
    const count = Math.max(1, parseInt(countEl?.value || '200', 10) || 200);
    const mode = currentBilling && currentBilling.billing_mode === 'byo_meta' ? 'byo_meta' : 'managed_meta';
    const rate = mode === 'byo_meta' ? 1 : 2;
    const total = count * rate;
    if (resEl) resEl.textContent = `${total.toLocaleString()} Coins (₹${total.toLocaleString()})`;
    if (noteEl) noteEl.textContent = mode === 'byo_meta' ? 'Own Meta @ ₹1/conv (Infra only)' : 'Managed Meta @ ₹2/conv';
}

async function setBillingMode(mode) {
    try {
        const res = await fetch('/api/billing/mode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ billing_mode: mode })
        });
        const data = await res.json();
        if (res.ok && data.billing) {
            currentBilling = data.billing;
            renderBillingModal(currentBilling);
            refreshBillingUI(currentBilling);
        }
    } catch (err) {
        alert('Unable to switch mode: ' + err.message);
    }
}

async function subscribePlan(planId) {
    const mode = (currentBilling && currentBilling.billing_mode) || 'managed_meta';
    const catalog = (currentBilling && currentBilling.plans_catalog) || {};
    const p = catalog[planId] || { name: planId, managed_meta_price: 999, byo_meta_price: 499 };
    const price = mode === 'byo_meta' ? p.byo_meta_price : p.managed_meta_price;
    if (!confirm(`Activate ${p.name} monthly plan for ${price} Growhaz Wallet Coins (₹${price})?`)) return;

    try {
        const res = await fetch('/api/billing/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ plan_id: planId, billing_mode: mode })
        });
        const data = await res.json();
        if (res.ok && data.success) {
            alert(data.message || 'Plan activated!');
            currentBilling = data.billing;
            renderBillingModal(currentBilling);
            refreshBillingUI(currentBilling);
        } else if (res.status !== 402) {
            alert(data.detail || data.message || 'Plan activation failed.');
        }
    } catch (err) {
        alert('Error activating plan: ' + err.message);
    }
}

async function confirmWithBillingEstimate(phones, fallbackPrompt) {
    return confirm(fallbackPrompt);
}

async function refreshGraphAndSecurityPanels() {
    if (!isAuthenticated) return;
    try {
        const [gRes, sRes] = await Promise.all([
            fetch('/api/dashboard/graph/status'),
            fetch('/api/dashboard/security-events')
        ]);
        if (gRes.ok) {
            const gData = await gRes.json();
            const neo = gData.neo4j || {};
            const pill = document.getElementById('neo4j-status-pill');
            if (pill) {
                if (neo.connected) {
                    pill.textContent = neo.provider === 'supabase' ? 'Supabase Cloud Live' : 'Neo4j Aura Live';
                    pill.className = 'px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-extrabold';
                    pill.title = neo.uri_host ? `Connected to ${neo.uri_host}` : 'Cloud database connected';
                } else {
                    pill.textContent = neo.mode || 'Local Fallback';
                    pill.className = 'px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-extrabold';
                    pill.title = neo.error || 'Using local SQLite fallback';
                }
            }
            const nc = document.getElementById('neo4j-node-count');
            const ec = document.getElementById('neo4j-edge-count');
            const mc = document.getElementById('neo4j-msg-count');
            if (nc) nc.textContent = String(neo.node_count ?? 0);
            if (ec) ec.textContent = String(neo.relationship_count ?? 0);
            if (mc) mc.textContent = String(neo.message_nodes ?? 0);
        }
        if (sRes.ok) {
            const sData = await sRes.json();
            const modelLbl = document.getElementById('guard-model-label');
            const cntEl = document.getElementById('stat-blocked-attacks');
            const listEl = document.getElementById('guard-events-list');
            const events = sData.events || [];
            if (modelLbl && sData.guard_model) modelLbl.textContent = sData.guard_model;
            if (cntEl) cntEl.textContent = String(events.length);
            if (listEl) {
                if (events.length === 0) {
                    listEl.innerHTML = '<span class="text-slate-400 italic">No prompt-injection attempts recorded yet.</span>';
                } else {
                    listEl.innerHTML = events.slice(0, 10).map(ev => `
                        <div class="p-2 rounded-lg bg-rose-50/60 border border-rose-100 flex items-start justify-between gap-2">
                            <div class="min-w-0">
                                <div class="font-bold text-rose-800 truncate">${escSaasHtml(ev.reason || ev.detector || 'Blocked Prompt')}</div>
                                <div class="text-[10px] text-slate-600 truncate">${escSaasHtml((ev.message_preview || '').slice(0, 120))}</div>
                            </div>
                            <span class="text-[9px] font-mono text-rose-600 flex-shrink-0">${escSaasHtml(ev.detector || 'Guard')}</span>
                        </div>
                    `).join('');
                }
            }
        }
    } catch (_) {}
}

async function queryNeo4jGraph() {
    const q = (document.getElementById('neo4j-search-input')?.value || '').trim();
    const box = document.getElementById('neo4j-query-results');
    if (box) box.innerHTML = '<span class="text-purple-600"><i class="fas fa-spinner fa-spin mr-1"></i> Querying Supabase Cloud DB...</span>';
    try {
        const res = await fetch('/api/dashboard/graph/query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: q })
        });
        const data = await res.json();
        const edges = (data.neo4j && data.neo4j.edges) || [];
        const dna = data.dna_matches || [];
        if (box) {
            if (edges.length === 0 && dna.length === 0) {
                box.innerHTML = '<span class="text-slate-400 italic">No matching Knowledge Graph edges or DNA facts found.</span>';
                return;
            }
            const edgeHtml = edges.map(e => `
                <div class="flex items-center gap-1.5 text-[11px] py-0.5">
                    <span class="font-bold text-slate-800">${escSaasHtml(e.source)}</span>
                    <span class="px-1.5 py-0.2 rounded bg-purple-100 text-purple-800 font-mono text-[10px]">${escSaasHtml(e.relation)}</span>
                    <span class="font-semibold text-indigo-700">${escSaasHtml(e.target)}</span>
                </div>
            `).join('');
            const dnaHtml = dna.slice(0, 4).map(d => `
                <div class="text-[10px] text-emerald-700 font-medium py-0.5">🧬 ${escSaasHtml(typeof d === 'string' ? d : (d.text || d.name || JSON.stringify(d)))}</div>
            `).join('');
            box.innerHTML = edgeHtml + dnaHtml;
        }
    } catch (err) {
        if (box) box.innerHTML = `<span class="text-rose-600">Error querying graph: ${escSaasHtml(err.message)}</span>`;
    }
}

async function testPromptGuardFromDashboard() {
    const inputEl = document.getElementById('guard-test-input');
    const btnEl = document.getElementById('guard-test-btn');
    const resEl = document.getElementById('guard-test-result');
    const text = (inputEl?.value || '').trim();
    if (!text) return;
    if (btnEl) {
        btnEl.disabled = true;
        btnEl.textContent = 'Scanning...';
    }
    try {
        const res = await fetch('/api/dashboard/test-guard', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        });
        const data = await res.json();
        if (resEl) {
            resEl.classList.remove('hidden');
            if (data.blocked) {
                resEl.className = 'p-2.5 rounded-xl text-[11px] font-bold bg-rose-100 border border-rose-200 text-rose-800';
                resEl.textContent = `🛡️ BLOCKED (${data.detector}, ${Math.round(data.latency_ms || 0)}ms): ${data.reason || 'Unsafe prompt injection'}`;
            } else {
                resEl.className = 'p-2.5 rounded-xl text-[11px] font-bold bg-emerald-100 border border-emerald-200 text-emerald-800';
                resEl.textContent = `✅ SAFE (${data.detector}, ${Math.round(data.latency_ms || 0)}ms): Allowed to reach AI engine.`;
            }
        }
        refreshGraphAndSecurityPanels();
    } catch (err) {
        if (resEl) {
            resEl.classList.remove('hidden');
            resEl.className = 'p-2.5 rounded-xl text-[11px] font-bold bg-rose-100 text-rose-800';
            resEl.textContent = 'Scan error: ' + err.message;
        }
    } finally {
        if (btnEl) {
            btnEl.disabled = false;
            btnEl.textContent = 'Scan Input';
        }
    }
}

async function openCustomerGraphModal() {
    if (typeof closeChatActionsMenu === 'function') closeChatActionsMenu();
    if (!currentPhone) {
        alert('Select a customer chat first to inspect their Customer Knowledge Graph.');
        return;
    }
    const modal = document.getElementById('graph-modal');
    if (modal) modal.classList.remove('hidden');
    const profileBox = document.getElementById('graph-modal-profile');
    const nodesBox = document.getElementById('graph-modal-nodes');
    const edgesBox = document.getElementById('graph-modal-edges');
    const epBox = document.getElementById('graph-modal-episodes');
    const titleEl = document.getElementById('graph-modal-title');
    if (titleEl) titleEl.textContent = `Knowledge Graph • ${currentPhone}`;
    if (profileBox) profileBox.textContent = 'Fetching Supabase Cloud subgraph...';

    try {
        const res = await fetch(`/api/dashboard/graph/customer/${encodeURIComponent(currentPhone)}`);
        const data = await res.json();
        const prof = data.profile || {};
        const graph = data.graph || {};
        if (profileBox) {
            const parts = [
                prof.contact_name ? `Name: ${prof.contact_name}` : null,
                prof.business_name ? `Business: ${prof.business_name}` : null,
                prof.business_type ? `Category: ${prof.business_type}` : null,
                prof.locality ? `Area: ${prof.locality}` : null,
                prof.existing_ecosystem ? `Tools: ${prof.existing_ecosystem}` : null
            ].filter(Boolean);
            profileBox.textContent = parts.length > 0 ? parts.join('  •  ') : 'No structured profile extracted yet. Chat naturally with this customer to build their Knowledge Graph.';
        }
        const nodes = graph.nodes || [];
        const edges = graph.edges || [];
        const episodes = graph.episodes || [];
        if (nodesBox) {
            nodesBox.innerHTML = nodes.length === 0
                ? '<span class="text-slate-400 italic">No graph entity nodes yet.</span>'
                : nodes.map(n => `<div class="p-1.5 rounded-lg bg-white border border-slate-200 flex items-center justify-between gap-2"><span class="font-bold text-slate-800 truncate">${escSaasHtml(n.name || n.id)}</span><span class="px-1.5 py-0.5 rounded bg-teal-100 text-teal-800 text-[10px] font-mono">${escSaasHtml(n.label || 'Entity')}</span></div>`).join('');
        }
        if (edgesBox) {
            edgesBox.innerHTML = edges.length === 0
                ? '<span class="text-slate-400 italic">No graph relationships yet.</span>'
                : edges.map(e => `<div class="p-1.5 rounded-lg bg-white border border-slate-200 text-[11px]"><span class="font-bold">${escSaasHtml(e.source)}</span> <span class="text-indigo-600 font-mono text-[10px]">[${escSaasHtml(e.relation)}]</span> <span class="font-semibold">${escSaasHtml(e.target)}</span></div>`).join('');
        }
        if (epBox) {
            epBox.innerHTML = episodes.length === 0
                ? '<span class="text-slate-400 italic">No episodes logged yet.</span>'
                : episodes.map(ep => {
                    const txt = typeof ep === 'string'
                        ? ep
                        : `${ep.content || ''}${ep.timestamp ? ' (' + String(ep.timestamp).slice(0, 16).replace('T', ' ') + ')' : ''}`;
                    return `<div class="p-1.5 rounded-lg bg-white border border-slate-200 text-[11px] text-slate-700">${escSaasHtml(txt)}</div>`;
                }).join('');
        }
    } catch (err) {
        if (profileBox) profileBox.textContent = 'Error loading Knowledge Graph: ' + err.message;
    }
}

function closeGraphModal() {
    const modal = document.getElementById('graph-modal');
    if (modal) modal.classList.add('hidden');
}

// ====================================================================
// MOBILE RESPONSIVENESS HELPERS
// ====================================================================
let mobileActivePane = 'list';
let lastViewportIsDesktop = window.innerWidth >= 768;

function showMobileChat() {
    mobileActivePane = 'chat';
    if (window.innerWidth < 768) {
        const paneList = document.getElementById('pane-conversations');
        const paneChat = document.getElementById('pane-chat');
        if (paneList) {
            paneList.classList.add('hidden');
            paneList.classList.remove('flex');
        }
        if (paneChat) {
            paneChat.classList.remove('hidden');
            paneChat.classList.add('flex');
        }
    }
}

function showMobileList() {
    mobileActivePane = 'list';
    if (window.innerWidth < 768) {
        const paneList = document.getElementById('pane-conversations');
        const paneChat = document.getElementById('pane-chat');
        if (paneList) {
            paneList.classList.remove('hidden');
            paneList.classList.add('flex');
        }
        if (paneChat) {
            paneChat.classList.add('hidden');
            paneChat.classList.remove('flex');
        }
    }
}

window.addEventListener('resize', () => {
    const isDesktop = window.innerWidth >= 768;
    if (isDesktop === lastViewportIsDesktop) {
        // Ignore vertical resizes on mobile caused by virtual keyboard opening/closing
        return;
    }
    lastViewportIsDesktop = isDesktop;

    const paneList = document.getElementById('pane-conversations');
    const paneChat = document.getElementById('pane-chat');
    if (isDesktop) {
        if (paneList) {
            paneList.classList.remove('hidden');
            paneList.classList.add('flex');
        }
        if (paneChat) {
            paneChat.classList.remove('hidden');
            paneChat.classList.add('flex');
        }
    } else {
        if (mobileActivePane === 'chat' && currentPhone) {
            if (paneList) { paneList.classList.add('hidden'); paneList.classList.remove('flex'); }
            if (paneChat) { paneChat.classList.remove('hidden'); paneChat.classList.add('flex'); }
        } else {
            mobileActivePane = 'list';
            if (paneList) { paneList.classList.remove('hidden'); paneList.classList.add('flex'); }
            if (paneChat) { paneChat.classList.add('hidden'); paneChat.classList.remove('flex'); }
        }
    }
});

// ====================================================================
// CHAT HEADER ACTION DROPDOWN MENU HELPERS (MOBILE & COMPACT VIEW)
// ====================================================================
function toggleChatActionsMenu(e) {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    const dropdown = document.getElementById('chat-actions-dropdown');
    if (dropdown) {
        dropdown.classList.toggle('hidden');
    }
}

function closeChatActionsMenu() {
    const dropdown = document.getElementById('chat-actions-dropdown');
    if (dropdown) {
        dropdown.classList.add('hidden');
    }
}

// Close dropdown on outside click
document.addEventListener('click', (e) => {
    const wrapper = document.getElementById('chat-menu-wrapper');
    if (wrapper && !wrapper.contains(e.target)) {
        closeChatActionsMenu();
    }
});

function triggerAiReplyFromMenu() {
    closeChatActionsMenu();
    triggerAiReplyForCurrent();
}

function toggleSelectModeFromMenu() {
    closeChatActionsMenu();
    toggleSelectMode(true);
}

function openBookingFromMenu() {
    closeChatActionsMenu();
    openBookCurrentContactModal();
}

function deleteChatFromMenu() {
    closeChatActionsMenu();
    deleteCurrentChat();
}

        let currentPhone = null;
        let currentContactName = 'Customer';
        let allConversations = [];
        let allTemplates = [];
        let allLeads = [];
        let localTypingPhone = null;
        let activeTab = 'chats';

        document.getElementById('webhook-full-url').innerText = window.location.origin + '/api/webhook';

        function switchTab(tab) {
            activeTab = tab;
            ['chats', 'analytics', 'testai', 'templates', 'bookings', 'webhooks', 'broadcast'].forEach(t => {
                const view = document.getElementById('view-' + t);
                const btn = document.getElementById('tab-btn-' + t);
                if (view) {
                    if (t === tab) {
                        view.classList.remove('hidden');
                        view.scrollTop = 0;
                    } else {
                        view.classList.add('hidden');
                    }
                }
                if (btn) {
                    if (t === tab) {
                        btn.className = 'px-3.5 py-2 rounded-lg bg-white text-emerald-700 font-bold shadow-sm transition flex items-center space-x-1.5 flex-shrink-0';
                    } else {
                        btn.className = 'px-3.5 py-2 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-white/60 transition flex items-center space-x-1.5 flex-shrink-0';
                    }
                }
            });

            if (tab === 'analytics') refreshGraphAndSecurityPanels();
            if (tab === 'templates') fetchTemplates();
            if (tab === 'bookings') fetchBookings();
            if (tab === 'webhooks') fetchWebhooks();
            if (tab === 'broadcast') {
                if (typeof initCampaignDefaults === 'function') initCampaignDefaults();
                populateBroadcastTemplateDropdown();
                loadLeadsTable();
                updateBroadcastContactsCount();
            }
        }

        async function fetchData(manual = false) {
            const refreshIcon = document.getElementById('refresh-icon');
            if (!isAuthenticated) {
                if (refreshIcon) refreshIcon.classList.remove('fa-spin');
                return;
            }
            if (manual && refreshIcon) refreshIcon.classList.add('fa-spin');
            if (manual && typeof refreshBillingUI === 'function') refreshBillingUI();

            try {
                // Fetch stats and conversations in PARALLEL for ultra-fast loading
                const [statsRes, convsRes] = await Promise.all([
                    fetch('/api/dashboard/stats'),
                    fetch('/api/dashboard/conversations')
                ]);

                if (statsRes && statsRes.ok) {
                    const stats = await statsRes.json();
                    const totalMsg = stats.total_messages || 0;
                    const inMsg = stats.inbound_messages || 0;
                    const outMsg = stats.outbound_messages || 0;

                    const totalEl = document.getElementById('stat-total-messages');
                    const inEl = document.getElementById('stat-inbound');
                    const outEl = document.getElementById('stat-outbound');
                    const contactsEl = document.getElementById('stat-contacts');
                    const bookingsEl = document.getElementById('stat-bookings');
                    const navBookingsEl = document.getElementById('nav-bookings-count');
                    const engineEl = document.getElementById('stat-engine-badge');

                    if (totalEl) totalEl.innerText = totalMsg;
                    if (inEl) inEl.innerText = inMsg;
                    if (outEl) outEl.innerText = outMsg;
                    if (contactsEl) contactsEl.innerText = stats.total_contacts || 0;
                    if (bookingsEl) bookingsEl.innerText = stats.total_bookings || 0;
                    if (navBookingsEl) navBookingsEl.innerText = stats.total_bookings || 0;
                    if (engineEl) engineEl.innerText = stats.deepseek_configured ? stats.deepseek_model : (stats.groq_configured ? stats.groq_model : 'Growhaz AI');

                    // Update traffic balance ratio bar
                    if (totalMsg > 0) {
                        const inPct = Math.round((inMsg / totalMsg) * 100);
                        const outPct = 100 - inPct;
                        const barIn = document.getElementById('stat-bar-inbound');
                        const barOut = document.getElementById('stat-bar-outbound');
                        const pctIn = document.getElementById('stat-pct-inbound');
                        const pctOut = document.getElementById('stat-pct-outbound');
                        if (barIn) barIn.style.width = inPct + '%';
                        if (barOut) barOut.style.width = outPct + '%';
                        if (pctIn) pctIn.innerText = inPct + '%';
                        if (pctOut) pctOut.innerText = outPct + '%';
                    }
                }

                if (convsRes && convsRes.ok) {
                    const data = await convsRes.json();
                    allConversations = data.conversations || [];
                    document.getElementById('chat-count').innerText = allConversations.length;

                    // Update 24-Hour Free Promotional Window Badges & Counts
                    const freeCount = allConversations.filter(c => c.free_window_active === true).length;
                    const freeBadge = document.getElementById('badge-free-window-count');
                    const allBadge = document.getElementById('badge-all-chats-count');
                    const bannerCount = document.getElementById('free-promo-banner-count');
                    if (freeBadge) freeBadge.innerText = freeCount;
                    if (allBadge) allBadge.innerText = `(${allConversations.length})`;
                    if (bannerCount) bannerCount.innerText = freeCount;

                    filterConversations();

                    // Update active conversation free window UI
                    if (currentPhone) {
                        const activeConv = allConversations.find(c => c.phone_number === currentPhone);
                        updateActiveFreeWindowUI(activeConv);
                    }

                    // On desktop, auto-select first conversation. On mobile, let user see inbox first.
                    if (!currentPhone && allConversations.length > 0 && window.innerWidth >= 768) {
                        selectChat(allConversations[0].phone_number, allConversations[0].sender_name, allConversations[0].last_channel);
                    } else if (currentPhone) {
                        await loadMessages(false);
                    }
                }

                // Templates rarely change: fetch only once on boot or manual refresh
                if (allTemplates.length === 0 || manual) {
                    await fetchTemplates();
                }

                if (activeTab === 'bookings') fetchBookings();
                if (activeTab === 'webhooks') fetchWebhooks();

            } catch (err) {
                console.error("Fetch error:", err);
            } finally {
                if (manual) setTimeout(() => refreshIcon.classList.remove('fa-spin'), 400);
            }
        }

        function renderConversations(list) {
            const container = document.getElementById('conversations-container');
            if (!list || list.length === 0) {
                container.innerHTML = `
                    <div class="p-8 text-center text-slate-400 text-xs">
                        <i class="far fa-comments text-2xl mb-2 text-slate-300 block"></i>
                        No conversations yet.<br/>
                        <button onclick="openSimulateModal()" class="mt-2 text-emerald-600 font-bold hover:underline">Simulate customer message</button>
                    </div>
                `;
                return;
            }

            container.innerHTML = list.map(c => {
                const isActive = c.phone_number === currentPhone;
                const activeClass = isActive ? 'bg-emerald-50/80 border-l-4 border-emerald-600' : 'hover:bg-slate-100/70';
                const isOutbound = c.last_direction === 'outbound' || c.last_message_direction === 'outbound';
                const dirIcon = isOutbound ? '<i class="fas fa-check-double text-emerald-600 mr-1 text-[10px]"></i>' : '';
                const avatarBg = getAvatarColor(c.phone_number);
                const isBotActive = c.bot_enabled !== 0 && c.bot_enabled !== false;
                const botBadge = isBotActive
                    ? '<span class="text-[9px] bg-emerald-100 text-emerald-700 font-bold px-1.5 py-0.2 rounded" title="AI Bot is auto-replying">AI</span>'
                    : '<span class="text-[9px] bg-amber-100 text-amber-800 font-bold px-1.5 py-0.2 rounded" title="Human Agent (AI paused)">Agent</span>';

                const realName = pickRealDisplayName(c.sender_name, c.phone_number);
                const displayName = realName || (c.phone_number ? (c.phone_number.startsWith('+') ? c.phone_number : `+${c.phone_number}`) : 'Customer');
                const safeTime = formatTime(c.last_time || c.last_message_time || '');
                const safeChannel = (c.last_channel && c.last_channel !== 'undefined' && c.last_channel !== 'null') ? c.last_channel : (c.channel || 'whatsapp');
                const totalMsgs = c.total_messages !== undefined ? c.total_messages : 1;
                const isFreeActive = !!(c.free_window_active || c.is_free_window_active);
                const freeSeconds = c.free_window_remaining_seconds || c.free_window_seconds_left || 0;

                return `
                    <div onclick="selectChat('${c.phone_number}', '${escapeHtml(displayName)}', '${safeChannel}')" 
                         class="group p-3.5 cursor-pointer transition flex items-center space-x-3 ${activeClass}">
                        <div class="w-10 h-10 rounded-full ${avatarBg} flex items-center justify-center text-white font-bold text-xs flex-shrink-0 shadow-sm">
                            ${getInitials(displayName)}
                        </div>
                        <div class="flex-1 min-w-0">
                            <div class="flex items-center justify-between">
                                <div class="flex items-center space-x-1.5 truncate">
                                    <h4 class="text-xs font-bold text-slate-900 truncate">${escapeHtml(displayName)}</h4>
                                    ${botBadge}
                                </div>
                                <span class="text-[10px] text-slate-400 font-mono">${safeTime}</span>
                            </div>
                            <div class="flex items-center justify-between mt-0.5 gap-2">
                                <p class="text-xs text-slate-500 truncate flex-1 min-w-0 pr-1">
                                    ${c.is_typing
                                        ? '<span class="text-emerald-600 font-bold italic"><i class="fas fa-ellipsis fa-fade mr-1"></i>typing...</span>'
                                        : `${dirIcon}${escapeHtml(c.last_message || '')}`}
                                </p>
                                <div class="flex items-center space-x-1 flex-shrink-0">
                                    <span class="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-200/80 text-slate-600 font-mono font-bold">${totalMsgs}</span>
                                    <button onclick="event.stopPropagation(); deleteChatByPhone('${c.phone_number}', '${escapeHtml(displayName)}')" title="Delete conversation" class="opacity-70 md:opacity-0 md:group-hover:opacity-100 hover:text-red-600 p-1 rounded hover:bg-red-50 text-slate-400 transition ml-1">
                                        <i class="fas fa-trash text-[11px]"></i>
                                    </button>
                                </div>
                            </div>
                            <!-- 24-Hour Free Promotional Window Tracker Badge -->
                            <div class="mt-1.5 flex flex-wrap items-center justify-between gap-1 text-[10px]">
                                ${isFreeActive ? `
                                    <span class="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-extrabold border border-emerald-300">
                                        <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                                        <span>Free Window (${formatFreeWindowCountdown(freeSeconds)})</span>
                                    </span>
                                    <span class="text-[9px] font-extrabold text-emerald-600 uppercase tracking-wider">₹0 Free Promo</span>
                                ` : `
                                    <span class="inline-flex items-center space-x-1 px-1.5 py-0.2 rounded-full bg-slate-100 text-slate-400 font-semibold border border-slate-200">
                                        <span>🔴 Window Expired</span>
                                    </span>
                                `}
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        }

        async function selectChat(phone, name, channel) {
            currentPhone = phone;
            const realName = pickRealDisplayName(name, phone);
            currentContactName = realName || (phone ? (phone.startsWith('+') ? phone : `+${phone}`) : 'Customer');
            toggleSelectMode(false);
            document.getElementById('active-name').innerText = currentContactName;
            document.getElementById('active-phone').innerText = phone;
            document.getElementById('active-avatar').innerHTML = getInitials(currentContactName);
            document.getElementById('active-avatar').className = `w-9 h-9 md:w-10 md:h-10 rounded-full ${getAvatarColor(phone)} flex items-center justify-center text-white font-bold shadow-sm text-xs md:text-sm flex-shrink-0`;
            
            const badge = document.getElementById('active-channel-badge');
            badge.classList.remove('hidden');
            const safeChannel = (channel && channel !== 'undefined' && channel !== 'null') ? channel : 'WHATSAPP';
            badge.innerText = safeChannel.toUpperCase().replace('_', ' ');

            // Update 24-Hour Free Window UI for Active Contact
            const activeConv = (allConversations || []).find(c => c.phone_number === phone);
            updateActiveFreeWindowUI(activeConv);

            const menuBtn = document.getElementById('chat-actions-menu-btn');
            if (menuBtn) menuBtn.classList.remove('hidden');

            renderConversations(allConversations);
            showMobileChat();
            
            // Show instant loading feedback in messages pane
            const msgBox = document.getElementById('messages-container');
            if (msgBox && msgBox.children.length === 0) {
                msgBox.innerHTML = `
                    <div class="h-full flex flex-col items-center justify-center text-center p-6 text-slate-400">
                        <i class="fas fa-circle-notch fa-spin text-2xl text-emerald-500 mb-2"></i>
                        <p class="text-xs">Loading conversation...</p>
                    </div>
                `;
            }
            await loadMessages(true);
        }

        function updateActiveCustomerProfileUI(profile, isTyping) {
            const typingBadge = document.getElementById('active-typing-badge');
            if (typingBadge) {
                typingBadge.classList.toggle('hidden', !isTyping);
            }
            const profileBadge = document.getElementById('active-profile-badge');
            if (profileBadge) {
                const bits = [];
                if (profile && profile.business_name) bits.push(profile.business_name);
                if (profile && profile.business_category) bits.push(profile.business_category);
                if (profile && profile.area) bits.push(profile.area);
                if (bits.length > 0) {
                    profileBadge.innerText = `🏢 ${bits.join(' • ')}`;
                    profileBadge.title = profile.website_url
                        ? `${bits.join(' • ')} | Site: ${profile.website_url}`
                        : (profile.has_website ? `${bits.join(' • ')} | Website: ${profile.has_website}` : bits.join(' • '));
                    profileBadge.classList.remove('hidden');
                } else {
                    profileBadge.classList.add('hidden');
                }
            }
        }

        function renderTypingBubbleHtml() {
            return `
                <div id="live-typing-bubble" class="flex items-center justify-end animate-pulse">
                    <div class="bg-[#d9fdd3] text-slate-800 border border-emerald-200/70 rounded-2xl rounded-tr-sm px-3.5 py-2.5 shadow-xs space-y-1">
                        <div class="flex items-center space-x-2">
                            <span class="text-[10px] font-extrabold text-emerald-700">Support Agent (AI)</span>
                        </div>
                        <div class="flex items-center space-x-1.5 py-0.5">
                            <span class="w-2 h-2 rounded-full bg-emerald-600 animate-bounce" style="animation-delay: 0ms;"></span>
                            <span class="w-2 h-2 rounded-full bg-emerald-600 animate-bounce" style="animation-delay: 150ms;"></span>
                            <span class="w-2 h-2 rounded-full bg-emerald-600 animate-bounce" style="animation-delay: 300ms;"></span>
                            <span class="text-[11px] font-bold text-emerald-800 italic ml-1">typing...</span>
                        </div>
                    </div>
                </div>
            `;
        }

        function appendOptimisticChatTyping(customerMessageText) {
            const container = document.getElementById('messages-container');
            if (!container) return;
            localTypingPhone = currentPhone;
            updateActiveCustomerProfileUI(null, true);
            if (customerMessageText) {
                const msgHtml = `
                    <div class="flex items-center justify-start">
                        <div class="bg-white text-slate-900 border border-slate-200/80 rounded-2xl rounded-tl-sm text-xs px-3.5 py-2.5 max-w-[85%] md:max-w-[75%] shadow-sm break-words space-y-1">
                            <div class="flex items-center justify-between">
                                <span class="text-[11px] font-extrabold text-slate-700">${escapeHtml(currentContactName || 'Customer')}</span>
                            </div>
                            <div class="whitespace-pre-wrap leading-relaxed text-[13px]">${escapeHtml(customerMessageText)}</div>
                            <div class="flex items-center justify-end space-x-1.5 pt-0.5 text-[10px] text-slate-500"><span>Just now</span></div>
                        </div>
                    </div>
                `;
                if (lastRenderedCount === 0) container.innerHTML = msgHtml;
                else container.insertAdjacentHTML('beforeend', msgHtml);
            }
            const existingTyping = document.getElementById('live-typing-bubble');
            if (existingTyping) existingTyping.remove();
            container.insertAdjacentHTML('beforeend', renderTypingBubbleHtml());
            setTimeout(() => scrollChatToBottom(true), 15);
        }

        async function loadMessages(shouldScroll = true) {
            if (!currentPhone) return;
            const reqPhone = currentPhone;
            try {
                const res = await fetch(`/api/dashboard/messages?phone=${encodeURIComponent(reqPhone)}`);
                if (res.ok && reqPhone === currentPhone) {
                    const data = await res.json();
                    const isBotActive = data.bot_enabled !== false;
                    updateBotStatusPill(isBotActive);
                    if (!isBotActive) {
                        const agentRadio = document.getElementById('role-agent');
                        if (agentRadio) agentRadio.checked = true;
                    }
                    const isTyping = Boolean(data.is_typing || (localTypingPhone && localTypingPhone === reqPhone));
                    updateActiveCustomerProfileUI(data.customer_profile || null, isTyping);
                    renderMessages(data.messages || [], shouldScroll, isTyping);
                }
            } catch (e) {
                console.error("Message load error:", e);
            }
        }

        let isUserScrolledUp = false;
        let lastRenderedCount = 0;

        function scrollChatToBottom(smooth = true) {
            const container = document.getElementById('messages-container');
            if (!container) return;
            if (smooth) {
                container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
            } else {
                container.scrollTop = container.scrollHeight;
            }
            isUserScrolledUp = false;
            const btn = document.getElementById('scroll-bottom-btn');
            const unreadBadge = document.getElementById('scroll-unread-badge');
            if (btn) {
                btn.classList.add('hidden');
                btn.classList.remove('flex');
            }
            if (unreadBadge) unreadBadge.classList.add('hidden');
        }

        function setupScrollListener() {
            const container = document.getElementById('messages-container');
            if (!container || container.dataset.scrollBound) return;
            container.dataset.scrollBound = "true";
            container.addEventListener('scroll', () => {
                const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
                isUserScrolledUp = distanceFromBottom > 90;
                const btn = document.getElementById('scroll-bottom-btn');
                if (btn) {
                    if (isUserScrolledUp && container.scrollHeight > container.clientHeight) {
                        btn.classList.remove('hidden');
                        btn.classList.add('flex');
                    } else {
                        btn.classList.add('hidden');
                        btn.classList.remove('flex');
                        const unreadBadge = document.getElementById('scroll-unread-badge');
                        if (unreadBadge) unreadBadge.classList.add('hidden');
                    }
                }
            });
        }

        function renderMessages(messages, shouldScroll = true, isTyping = false) {
            const container = document.getElementById('messages-container');
            setupScrollListener();
            if (messages.length === 0 && !isTyping) {
                container.innerHTML = `<div class="h-full flex items-center justify-center text-slate-500 text-xs">No messages in this chat yet.</div>`;
                lastRenderedCount = 0;
                return;
            }

            const countChanged = messages.length !== lastRenderedCount;
            const wasScrolledUp = isUserScrolledUp;
            lastRenderedCount = messages.length;

            let html = messages.map(m => {
                const isOutbound = m.direction === 'outbound';
                const alignment = isOutbound ? 'justify-end' : 'justify-start';
                const bubbleBg = isOutbound ? 'bg-[#d9fdd3] text-slate-900 border border-emerald-200/50 rounded-tr-sm' : 'bg-white text-slate-900 border border-slate-200/80 rounded-tl-sm';
                const senderLabel = isOutbound ? (m.sender_name || 'Support Agent') : escapeHtml(m.sender_name || 'Customer');
                const engineTag = m.ai_model ? `<span class="text-[9px] px-1.5 py-0.2 bg-emerald-100 text-emerald-800 rounded font-bold mr-1"><i class="fas fa-robot mr-1"></i>${escapeHtml(m.ai_model)}</span>` : '';
                const triggerBtn = !isOutbound ? `<button onclick="triggerAiReplyForPrompt(decodeURIComponent('${encodeURIComponent(m.message || '')}'))" title="Generate AI Reply to this" class="ml-2 text-[10px] text-emerald-600 hover:text-emerald-800 font-bold underline"><i class="fas fa-wand-magic-sparkles mr-0.5"></i>AI Reply</button>` : '';

                const isChecked = selectedMessageIds.has(m.id);
                const selectCheckbox = isSelectMode ? `
                    <div class="flex items-center self-center ${isOutbound ? 'order-2 pl-2.5' : 'order-1 pr-2.5'}">
                        <input type="checkbox" class="msg-select-cb w-4 h-4 rounded text-emerald-600 focus:ring-0 cursor-pointer" data-id="${m.id}" ${isChecked ? 'checked' : ''} onchange="handleMessageSelectToggle(${m.id})">
                    </div>
                ` : '';

                const singleDeleteBtn = !isSelectMode ? `
                    <button onclick="deleteSingleMessage(${m.id})" title="Delete message" class="opacity-60 md:opacity-0 md:group-hover:opacity-100 text-slate-300 hover:text-red-500 transition text-[11px] ml-1.5 p-0.5">
                        <i class="fas fa-trash"></i>
                    </button>
                ` : '';

                let mediaBlock = '';
                if (m.media_type === 'image' && m.media_url) {
                    mediaBlock = `
                        <div class="mb-1.5 overflow-hidden rounded-xl border border-slate-200/60 max-w-full sm:max-w-[280px]">
                            <a href="${m.media_url}" target="_blank" title="Click to view full image">
                                <img src="${m.media_url}" class="w-full h-auto max-h-64 object-cover hover:opacity-95 transition rounded-xl" loading="lazy" />
                            </a>
                        </div>
                    `;
                } else if (m.media_type === 'document' && m.media_url) {
                    const docName = escapeHtml(m.media_filename || 'Document.pdf');
                    mediaBlock = `
                        <div class="mb-1.5 p-2.5 bg-white/95 rounded-xl border border-slate-200/80 flex items-center justify-between space-x-3 max-w-full sm:max-w-[280px] shadow-xs">
                            <div class="flex items-center space-x-2.5 min-w-0">
                                <div class="w-9 h-9 rounded-lg bg-red-50 text-red-600 flex items-center justify-center font-bold text-sm flex-shrink-0 border border-red-100">
                                    <i class="fas fa-file-pdf"></i>
                                </div>
                                <div class="min-w-0">
                                    <p class="text-xs font-bold text-slate-800 truncate">${docName}</p>
                                    <span class="text-[10px] text-slate-400 font-medium">Document attachment</span>
                                </div>
                            </div>
                            <a href="${m.media_url}" target="_blank" download="${docName}" class="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-slate-100 rounded-lg transition" title="Download Document">
                                <i class="fas fa-download text-xs"></i>
                            </a>
                        </div>
                    `;
                }

                return `
                    <div class="flex items-center ${alignment} group">
                        ${selectCheckbox}
                        <div class="${bubbleBg} ${isOutbound && isSelectMode ? 'order-1' : ''} text-xs px-3.5 py-2.5 rounded-2xl max-w-[85%] md:max-w-[75%] shadow-sm break-words space-y-1 relative transition" ${isSelectMode ? `onclick="handleMessageSelectToggle(${m.id})" style="cursor: pointer"` : ''}>
                            <div class="flex items-center justify-between gap-2 flex-wrap">
                                <span class="text-[11px] font-extrabold ${isOutbound ? 'text-emerald-700' : 'text-slate-700'}">${senderLabel}</span>
                                <div class="flex items-center">
                                    ${triggerBtn}
                                    ${singleDeleteBtn}
                                </div>
                            </div>
                            ${mediaBlock}
                            ${m.message ? `<div class="whitespace-pre-wrap break-words [overflow-wrap:anywhere] leading-relaxed text-[13px]">${escapeHtml(m.message)}</div>` : ''}
                            <div class="flex items-center justify-end space-x-1.5 pt-0.5 text-[10px] text-slate-500">
                                ${engineTag}
                                <span>${formatTime(m.created_at)}</span>
                                ${isOutbound ? '<i class="fas fa-check-double text-emerald-600 text-[10px]"></i>' : ''}
                            </div>
                        </div>
                    </div>
                `;
            }).join('');

            if (isTyping) {
                html += renderTypingBubbleHtml();
            }
            container.innerHTML = html;

            // Smart scrolling:
            // 1. If explicit scroll requested (shouldScroll == true, e.g. chat clicked or message sent): scroll to bottom
            // 2. If already at bottom and new messages arrived or typing started: auto-scroll to bottom
            // 3. If user scrolled up reading history: preserve their scroll position & show badge on down button
            if (shouldScroll || (!wasScrolledUp && (countChanged || isTyping))) {
                setTimeout(() => scrollChatToBottom(false), 20);
            } else if (wasScrolledUp && countChanged) {
                const unreadBadge = document.getElementById('scroll-unread-badge');
                if (unreadBadge) unreadBadge.classList.remove('hidden');
            }
        }

        async function triggerAiReplyForCurrent() {
            if (!currentPhone) {
                alert("Please select a conversation first.");
                return;
            }
            appendOptimisticChatTyping('');
            try {
                await fetch('/api/dashboard/trigger-ai-reply', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phone: currentPhone })
                });
            } finally {
                localTypingPhone = null;
            }
            await fetchData(true);
        }

        async function triggerAiReplyForPrompt(prompt) {
            if (!currentPhone) return;
            appendOptimisticChatTyping('');
            try {
                await fetch('/api/dashboard/trigger-ai-reply', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phone: currentPhone, prompt: prompt })
                });
            } finally {
                localTypingPhone = null;
            }
            await fetchData(true);
        }

        async function handleRoleChange(role) {
            if (!currentPhone) return;
            if (role === 'agent') {
                // When agent mode is selected, pause AI bot immediately so customer responses aren't auto-answered by bot!
                updateBotStatusPill(false);
                await toggleContactBot(false, false);
                document.getElementById('send-meta-cloud').checked = true;
            } else if (role === 'customer') {
                // Test customer mode: re-enable AI bot
                updateBotStatusPill(true);
                await toggleContactBot(true, false);
            }
        }

        async function toggleContactBot(enabled, syncRadio = true) {
            if (!currentPhone) return;
            updateBotStatusPill(enabled);
            if (syncRadio) {
                const agentRadio = document.getElementById('role-agent');
                const custRadio = document.getElementById('role-customer');
                if (!enabled && agentRadio) agentRadio.checked = true;
                if (enabled && custRadio) custRadio.checked = true;
            }
            try {
                await fetch('/api/dashboard/contact/bot-toggle', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phone: currentPhone, enabled: enabled })
                });
                await fetchData(false);
            } catch (e) {
                console.error("Failed to toggle bot:", e);
            }
        }

        function updateBotStatusPill(enabled) {
            const pill = document.getElementById('bot-status-pill');
            const checkbox = document.getElementById('contact-bot-checkbox');
            const menuCheckbox = document.getElementById('menu-contact-bot-checkbox');
            const menuSub = document.getElementById('menu-bot-status-sub');

            if (checkbox) checkbox.checked = !!enabled;
            if (menuCheckbox) menuCheckbox.checked = !!enabled;

            if (pill) {
                if (enabled) {
                    pill.className = "text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 flex items-center";
                    pill.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1 animate-pulse"></span> AI Active`;
                } else {
                    pill.className = "text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 flex items-center";
                    pill.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-amber-500 mr-1"></span> AI Paused (Human Agent)`;
                }
            }

            if (menuSub) {
                if (enabled) {
                    menuSub.className = "text-[10px] text-emerald-600 font-semibold";
                    menuSub.innerText = "Bot is Active";
                } else {
                    menuSub.className = "text-[10px] text-amber-600 font-semibold";
                    menuSub.innerText = "Paused for Agent";
                }
            }
        }

        async function sendReply(e) {
            e.preventDefault();
            if (!currentPhone) {
                alert("Please select a conversation or simulate a message first.");
                return;
            }

            const input = document.getElementById('reply-input');
            const msg = input.value.trim();
            if (!msg) return;

            const role = document.querySelector('input[name="reply_role"]:checked').value;
            const sendViaMeta = document.getElementById('send-meta-cloud').checked;
            const btn = document.getElementById('send-reply-btn');

            if (role === 'agent') {
                updateBotStatusPill(false);
            }

            input.disabled = true;
            btn.disabled = true;
            if (role === 'customer' || role === 'ai') {
                appendOptimisticChatTyping(role === 'customer' ? msg : '');
            }

            try {
                const res = await fetch('/api/dashboard/send', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        phone: currentPhone,
                        name: currentContactName,
                        message: msg,
                        role: role,
                        send_via_meta: sendViaMeta
                    })
                });

                if (res.ok) {
                    input.value = '';
                } else {
                    const err = await res.json();
                    alert("Error: " + (err.error || 'Failed to send message'));
                }
            } catch (err) {
                alert("Network error: " + err.message);
            } finally {
                localTypingPhone = null;
                document.getElementById('active-typing-badge')?.classList.add('hidden');
                input.disabled = false;
                btn.disabled = false;
                input.focus();
                await fetchData(true);
            }
        }

        // AI Sandbox Testing
        async function runAiSandboxTest(promptText) {
            if (!promptText) return;
            document.getElementById('sandbox-prompt').value = promptText;
            const output = document.getElementById('sandbox-output');
            const meta = document.getElementById('sandbox-meta');
            const btn = document.getElementById('sandbox-btn');

            btn.disabled = true;
            output.innerHTML = `<span class="text-slate-400 italic"><i class="fas fa-spinner fa-spin mr-1"></i> Generating AI Bot reply...</span>`;
            meta.innerText = "Engine: Generating...";

            try {
                const res = await fetch('/api/dashboard/test-ai', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ prompt: promptText })
                });
                if (res.ok) {
                    const data = await res.json();
                    output.innerText = data.reply;
                    meta.innerHTML = `<span class="text-emerald-600 font-bold">${data.engine}</span> • <span class="text-slate-500">${data.latency_ms} ms</span>`;
                } else {
                    output.innerText = "Error generating AI response.";
                }
            } catch (err) {
                output.innerText = "Network Error: " + err.message;
            } finally {
                btn.disabled = false;
            }
        }

        // Templates System
        async function fetchTemplates() {
            try {
                const res = await fetch('/api/dashboard/templates');
                if (res.ok) {
                    const data = await res.json();
                    allTemplates = data.templates || [];
                    renderQuickTemplates();
                    renderTemplatesGrid();
                    renderTemplatePicker();
                }
            } catch (e) {
                console.error("Templates fetch error:", e);
            }
        }

        function pickRealDisplayName(explicitName, phone = '') {
            const val = String(explicitName || '').trim();
            if (!val) return '';
            const low = val.toLowerCase();
            const digits = String(phone || '').replace(/\D/g, '');
            if (['customer', 'lead', 'user', 'unknown', 'business', 'business lead', 'valued business', 'there', 'campaign outreach', 'support agent', 'support broadcast', 'support agent (ai)', 'printingtask support', 'undefined', 'null'].includes(low)) return '';
            if (/^(lead|business|unnamed lead|contact)\s*#?\d+$/.test(low)) return '';
            if (/^\d+$/.test(val) || (digits && val === digits)) return '';
            return val;
        }

        function resolveTemplateClientSide(rawContent, recipient = {}) {
            const raw = String(rawContent || '');
            const phone = String(recipient.phone || currentPhone || '').replace(/\D/g, '');
            const realName = pickRealDisplayName(recipient.name || currentContactName || '', phone) || 'there';
            const business = pickRealDisplayName(recipient.business_name || recipient.name || '', phone) || (realName !== 'there' ? realName : 'your business');
            const area = (recipient.area || '').trim() || 'your area';
            const category = (recipient.category || '').trim() || 'business';

            return raw
                .replace(/\{\{\s*(?:name|customer_name|user_name)\s*\}\}/gi, () => realName)
                .replace(/\{\{\s*(?:business|business_name|company|company_name)\s*\}\}/gi, () => business)
                .replace(/\{\{\s*(?:area|city|locality|location)\s*\}\}/gi, () => area)
                .replace(/\{\{\s*(?:category|business_category|industry)\s*\}\}/gi, () => category)
                .replace(/\{\{\s*phone\s*\}\}/gi, () => phone)
                .replace(/\{\{\s*(?:date_time|datetime|date)\s*\}\}/gi, () => 'Tomorrow at 2:00 PM')
                .replace(/\{\{\s*service\s*\}\}/gi, () => 'Website, App & WhatsApp Automation');
        }

        function applyTemplateById(id) {
            const tpl = (allTemplates || []).find(t => t.id == id);
            if (tpl) applyTemplate(tpl.content || '');
        }

        function renderQuickTemplates() {
            const bar = document.getElementById('quick-templates-bar');
            if (!bar) return;
            bar.innerHTML = allTemplates.slice(0, 4).map(t => `
                <button type="button" onclick="applyTemplateById(${t.id})" class="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-medium border border-slate-200 flex-shrink-0 transition truncate max-w-[160px]">
                    ${escapeHtml(t.title)}
                </button>
            `).join('');
        }

        function renderTemplatesGrid() {
            const grid = document.getElementById('templates-grid');
            if (!allTemplates.length) {
                grid.innerHTML = `<div class="p-8 text-center text-slate-400 col-span-full">No templates created yet.</div>`;
                return;
            }
            grid.innerHTML = allTemplates.map(t => `
                <div class="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 sm:p-4 flex flex-col justify-between space-y-3 hover:shadow-sm transition min-w-0">
                    <div class="min-w-0">
                        <div class="flex items-start justify-between gap-2">
                            <h4 class="font-bold text-slate-900 text-sm min-w-0 break-words">${escapeHtml(t.title)}</h4>
                            <span class="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-[10px] font-bold flex-shrink-0">${escapeHtml(t.category)}</span>
                        </div>
                        <p class="text-xs text-slate-600 whitespace-pre-wrap break-words [overflow-wrap:anywhere] mt-2.5 leading-relaxed bg-white p-3 rounded-xl border border-slate-200">${escapeHtml(t.content)}</p>
                    </div>
                    <div class="flex items-center justify-between pt-2 border-t border-slate-200/80">
                        <button onclick="openTemplateBulkModal(${t.id})" class="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition flex items-center gap-1.5">
                            <i class="fas fa-paper-plane"></i> Use Template
                        </button>
                        <button onclick="deleteTemplate(${t.id})" class="text-slate-400 hover:text-red-500 p-1.5 transition"><i class="fas fa-trash"></i></button>
                    </div>
                </div>
            `).join('');
        }

        function renderTemplatePicker() {
            const list = document.getElementById('template-picker-list');
            if (!list) return;
            list.innerHTML = allTemplates.map(t => `
                <div onclick="applyTemplateById(${t.id}); closeTemplateSelectorModal();" class="p-3.5 bg-slate-50 hover:bg-emerald-50 rounded-2xl border border-slate-200 cursor-pointer transition">
                    <div class="flex items-center justify-between">
                        <h4 class="font-bold text-slate-900">${escapeHtml(t.title)}</h4>
                        <span class="text-[10px] font-bold text-slate-500">${escapeHtml(t.category)}</span>
                    </div>
                    <p class="text-xs text-slate-600 mt-1.5 truncate">${escapeHtml(t.content)}</p>
                </div>
            `).join('');
        }

        function applyTemplate(rawContent) {
            const replaced = resolveTemplateClientSide(rawContent, {
                phone: currentPhone,
                name: currentContactName
            });
            const agentRadio = document.getElementById('role-agent');
            if (agentRadio) agentRadio.checked = true;
            const replyInput = document.getElementById('reply-input');
            if (replyInput) {
                replyInput.value = replaced;
                replyInput.focus();
            }
        }

        function openCreateTemplateModal() { document.getElementById('template-create-modal').classList.remove('hidden'); }
        function closeCreateTemplateModal() { document.getElementById('template-create-modal').classList.add('hidden'); }

        async function handleCreateTemplateSubmit(e) {
            e.preventDefault();
            const title = document.getElementById('tpl-title').value.trim();
            const category = document.getElementById('tpl-category').value;
            const content = document.getElementById('tpl-content').value.trim();

            await fetch('/api/dashboard/templates', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title, category, content })
            });

            closeCreateTemplateModal();
            fetchTemplates();
        }

        async function deleteTemplate(id) {
            if (!confirm("Delete this template?")) return;
            await fetch(`/api/dashboard/templates?id=${id}`, { method: 'DELETE' });
            fetchTemplates();
        }

        function openTemplateSelectorModal() { document.getElementById('template-picker-modal').classList.remove('hidden'); }
        function closeTemplateSelectorModal() { document.getElementById('template-picker-modal').classList.add('hidden'); }

        // ==================== TEMPLATE MULTI-USER BULK SEND ====================
        let tplBulkSelectedPhones = new Set();
        let currentBulkTemplateTitle = '';
        let currentBulkTemplateId = null;

        function getMergedTemplateBulkDirectory() {
            const map = new Map();
            (allConversations || []).forEach(c => {
                const digits = normalizePhoneDigits(String(c.phone_number || '').replace(/\D/g, ''), false);
                if (!digits || digits.length < 10) return;
                map.set(digits, {
                    phone: digits,
                    name: pickRealDisplayName(c.sender_name, digits) || '',
                    last_message: c.last_message || '',
                    last_time: c.last_time || '',
                    free_window_active: c.free_window_active === true,
                    area: '',
                    category: ''
                });
            });
            (allLeads || []).forEach(l => {
                const digits = normalizePhoneDigits(String(l.phone_number || '').replace(/\D/g, ''), false);
                if (!digits || digits.length < 10) return;
                const notes = String(l.notes || '');
                const noteParts = notes.includes('•') ? notes.split('•').map(s => s.trim()) : [];
                const existing = map.get(digits);
                const leadRealName = pickRealDisplayName(l.name, digits);
                if (existing) {
                    if (!existing.name && leadRealName) existing.name = leadRealName;
                    if (noteParts[0] && !existing.category) existing.category = noteParts[0];
                    if (noteParts[1] && !existing.area) existing.area = noteParts[1];
                } else {
                    map.set(digits, {
                        phone: digits,
                        name: leadRealName || '',
                        last_message: notes ? `CRM Lead: ${notes}` : 'CRM Lead',
                        last_time: l.created_at || '',
                        free_window_active: false,
                        category: noteParts[0] || '',
                        area: noteParts[1] || ''
                    });
                }
            });
            return Array.from(map.values());
        }

        function openTemplateBulkModal(templateIdOrTitle, rawContent) {
            let title = 'Message Template';
            let content = '';

            if (typeof templateIdOrTitle === 'number' || (typeof templateIdOrTitle === 'string' && /^\d+$/.test(templateIdOrTitle))) {
                const found = (allTemplates || []).find(t => t.id == templateIdOrTitle);
                if (found) {
                    currentBulkTemplateId = found.id;
                    title = found.title;
                    content = found.content;
                }
            } else if (typeof templateIdOrTitle === 'string') {
                title = templateIdOrTitle || 'Message Template';
                content = rawContent || '';
            }

            currentBulkTemplateTitle = title;

            const modalTitleEl = document.getElementById('tpl-bulk-modal-title');
            if (modalTitleEl) modalTitleEl.innerText = `Send Template: ${title}`;

            const contentEl = document.getElementById('tpl-bulk-content');
            if (contentEl) {
                contentEl.value = content;
                contentEl.oninput = () => {
                    const countEl = document.getElementById('tpl-bulk-char-count');
                    if (countEl) countEl.innerText = `${contentEl.value.length} chars`;
                    updateTemplateBulkCount();
                };
            }
            const countEl = document.getElementById('tpl-bulk-char-count');
            if (countEl) countEl.innerText = `${content.length} chars`;

            // Reset search & custom inputs
            const searchInput = document.getElementById('tpl-bulk-search');
            if (searchInput) searchInput.value = '';

            const customInput = document.getElementById('tpl-bulk-custom-numbers');
            if (customInput) customInput.value = '';

            // Reset progress
            const progBox = document.getElementById('tpl-bulk-progress-box');
            if (progBox) progBox.classList.add('hidden');
            const logBox = document.getElementById('tpl-bulk-result-log');
            if (logBox) logBox.innerHTML = '';

            // Reset selected contacts
            tplBulkSelectedPhones.clear();
            if (currentPhone) {
                const normCur = normalizePhoneDigits(String(currentPhone).replace(/\D/g, ''), false) || currentPhone;
                tplBulkSelectedPhones.add(normCur);
            }

            if (allLeads.length === 0 && typeof loadLeadsTable === 'function') {
                loadLeadsTable().then(() => {
                    populateTemplateBulkContacts(document.getElementById('tpl-bulk-search')?.value || '');
                    updateTemplateBulkCount();
                });
            }

            populateTemplateBulkContacts('');
            updateTemplateBulkCount();

            const modal = document.getElementById('template-bulk-modal');
            if (modal) modal.classList.remove('hidden');
        }

        function closeTemplateBulkModal() {
            const modal = document.getElementById('template-bulk-modal');
            if (modal) modal.classList.add('hidden');
        }

        function populateTemplateBulkContacts(filter = '') {
            const listEl = document.getElementById('tpl-bulk-contacts-list');
            if (!listEl) return;

            const filterLower = (filter || '').toLowerCase().trim();
            const directory = getMergedTemplateBulkDirectory();
            const convs = directory.filter(c => {
                if (!filterLower) return true;
                const name = (c.name || '').toLowerCase();
                const phone = (c.phone || '').toLowerCase();
                return name.includes(filterLower) || phone.includes(filterLower);
            });

            if (convs.length === 0) {
                if (directory.length === 0) {
                    listEl.innerHTML = `
                        <div class="p-6 text-center text-slate-400">
                            <i class="fas fa-address-book text-2xl mb-2 opacity-50"></i>
                            <p class="font-medium text-xs">No active chat contacts or CRM leads found.</p>
                            <p class="text-[11px] text-slate-400 mt-1">You can add numbers below (supports <code>Name, Phone</code> or plain numbers).</p>
                        </div>
                    `;
                } else {
                    listEl.innerHTML = `
                        <div class="p-6 text-center text-slate-400 text-xs">
                            No contacts match "${escapeHtml(filter)}".
                        </div>
                    `;
                }
                return;
            }

            listEl.innerHTML = convs.map(c => {
                const isSelected = tplBulkSelectedPhones.has(c.phone);
                const safeName = escapeHtml(c.name || `+${c.phone}`);
                const safePhone = escapeHtml(c.phone || '');
                const previewMsg = escapeHtml(c.last_message || 'No prior message');
                const isFreeWindow = c.free_window_active === true;

                return `
                    <div class="flex items-center justify-between gap-2 p-2.5 rounded-xl hover:bg-emerald-50/60 cursor-pointer transition select-none ${isSelected ? 'bg-emerald-50/80 border border-emerald-200' : 'bg-white border border-slate-100'}"
                         onclick="tplBulkToggleContact('${safePhone}', event)">
                        <div class="flex items-center space-x-2.5 sm:space-x-3 min-w-0 flex-1 overflow-hidden">
                            <input type="checkbox"
                                   id="tpl-contact-check-${safePhone}"
                                   ${isSelected ? 'checked' : ''}
                                   onclick="event.stopPropagation(); tplBulkToggleContact('${safePhone}')"
                                   class="rounded text-emerald-600 focus:ring-emerald-500 w-4 h-4 cursor-pointer flex-shrink-0">
                            <div class="w-8 h-8 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center font-bold text-xs flex-shrink-0">
                                ${safeName.charAt(0).toUpperCase()}
                            </div>
                            <div class="min-w-0 flex-1">
                                <div class="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                                    <span class="font-bold text-slate-900 truncate max-w-full">${safeName}</span>
                                    <span class="text-[11px] font-mono text-slate-500">(+${safePhone})</span>
                                    ${isFreeWindow ? '<span class="text-[9px] font-bold px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-700">24h Free</span>' : ''}
                                </div>
                                <p class="text-[11px] text-slate-500 truncate">${previewMsg}</p>
                            </div>
                        </div>
                        <span class="hidden sm:inline text-[10px] text-slate-400 font-medium whitespace-nowrap pl-2 flex-shrink-0">
                            ${c.last_time ? escapeHtml(c.last_time) : ''}
                        </span>
                    </div>
                `;
            }).join('');
        }

        function tplBulkToggleContact(phone, event) {
            if (!phone) return;
            if (tplBulkSelectedPhones.has(phone)) {
                tplBulkSelectedPhones.delete(phone);
            } else {
                tplBulkSelectedPhones.add(phone);
            }

            const searchInput = document.getElementById('tpl-bulk-search');
            populateTemplateBulkContacts(searchInput ? searchInput.value : '');
            updateTemplateBulkCount();
        }

        function tplBulkSelectAll() {
            const searchInput = document.getElementById('tpl-bulk-search');
            const filterLower = (searchInput?.value || '').toLowerCase().trim();
            getMergedTemplateBulkDirectory().forEach(c => {
                if (!filterLower ||
                    (c.name || '').toLowerCase().includes(filterLower) ||
                    (c.phone || '').toLowerCase().includes(filterLower)) {
                    if (c.phone) tplBulkSelectedPhones.add(c.phone);
                }
            });
            populateTemplateBulkContacts(filterLower);
            updateTemplateBulkCount();
        }

        function tplBulkClearAll() {
            tplBulkSelectedPhones.clear();
            const searchInput = document.getElementById('tpl-bulk-search');
            populateTemplateBulkContacts(searchInput ? searchInput.value : '');
            updateTemplateBulkCount();
        }

        function filterTemplateBulkContacts() {
            const searchInput = document.getElementById('tpl-bulk-search');
            populateTemplateBulkContacts(searchInput ? searchInput.value : '');
        }

        function getTemplateBulkAllRecipients() {
            const recipientMap = new Map();
            const dirByPhone = new Map();
            getMergedTemplateBulkDirectory().forEach(d => dirByPhone.set(d.phone, d));

            tplBulkSelectedPhones.forEach(p => {
                const digits = normalizePhoneDigits(String(p || '').replace(/\D/g, ''), false) || String(p || '').replace(/\D/g, '');
                if (digits && digits.length >= 10) {
                    const meta = dirByPhone.get(digits) || {};
                    recipientMap.set(digits, {
                        phone: digits,
                        name: meta.name || '',
                        business_name: meta.name || '',
                        area: meta.area || '',
                        category: meta.category || ''
                    });
                }
            });

            const customArea = document.getElementById('tpl-bulk-custom-numbers');
            if (customArea && customArea.value) {
                const lines = customArea.value.split(/[\n;]+/);
                for (const rawLine of lines) {
                    const line = rawLine.trim();
                    if (!line) continue;
                    // Support either "Name, Phone" on a line or multiple numbers separated by commas
                    const commaParts = line.split(',');
                    if (commaParts.length === 2 && !extractPhoneNumber(commaParts[0], { strict: true }) && extractPhoneNumber(commaParts[1], { strict: false })) {
                        const phone = extractPhoneNumber(commaParts[1], { strict: false });
                        const customName = commaParts[0].trim();
                        if (phone && !recipientMap.has(phone)) {
                            recipientMap.set(phone, { phone, name: customName, business_name: customName, area: '', category: '' });
                        }
                    } else {
                        for (const tok of commaParts) {
                            const phone = extractPhoneNumber(tok, { strict: false });
                            if (phone && !recipientMap.has(phone)) {
                                const meta = dirByPhone.get(phone) || {};
                                recipientMap.set(phone, {
                                    phone,
                                    name: meta.name || '',
                                    business_name: meta.name || '',
                                    area: meta.area || '',
                                    category: meta.category || ''
                                });
                            }
                        }
                    }
                }
            }

            return Array.from(recipientMap.values());
        }

        function updateTemplateBulkCount() {
            const recipients = getTemplateBulkAllRecipients();
            const badge = document.getElementById('tpl-bulk-selected-badge');
            if (badge) {
                badge.innerText = `${recipients.length} selected`;
                if (recipients.length > 0) {
                    badge.className = 'text-[11px] font-extrabold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full';
                } else {
                    badge.className = 'text-[11px] font-extrabold text-slate-500 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full';
                }
            }

            const sendLabel = document.getElementById('tpl-bulk-send-label');
            if (sendLabel) {
                sendLabel.innerText = `Send to Selected (${recipients.length})`;
            }

            const sendBtn = document.getElementById('tpl-bulk-send-btn');
            if (sendBtn) {
                sendBtn.disabled = recipients.length === 0;
            }

            // Live resolved preview (eliminates literal {{name}})
            const previewEl = document.getElementById('tpl-bulk-live-preview');
            const contentEl = document.getElementById('tpl-bulk-content');
            if (previewEl && contentEl) {
                const sampleRecip = recipients[0] || { phone: currentPhone || '', name: currentContactName || '' };
                const resolved = resolveTemplateClientSide(contentEl.value || '', sampleRecip);
                const who = pickRealDisplayName(sampleRecip.name, sampleRecip.phone) || (sampleRecip.phone ? `+${sampleRecip.phone}` : 'recipient');
                previewEl.innerHTML = `<span class="font-bold text-emerald-800">Preview (${escapeHtml(who)}):</span> ${escapeHtml(resolved || '...')}`;
            }
        }

        function tplBulkSendToActiveChatOnly() {
            const contentEl = document.getElementById('tpl-bulk-content');
            const message = contentEl ? contentEl.value : '';
            if (!message.trim()) {
                alert('Please enter template message content first.');
                return;
            }
            closeTemplateBulkModal();
            applyTemplate(message);
            switchTab('chats');
        }

        async function executeTemplateBulkSend() {
            const recipients = getTemplateBulkAllRecipients();
            const contentEl = document.getElementById('tpl-bulk-content');
            const message = (contentEl?.value || '').trim();
            const sendMeta = document.getElementById('tpl-bulk-meta-api')?.checked ?? true;
            const saveLeads = document.getElementById('tpl-bulk-save-leads')?.checked ?? true;

            if (recipients.length === 0) {
                alert('Please select at least one recipient or enter custom phone numbers.');
                return;
            }
            if (!message) {
                alert('Please enter template message content.');
                return;
            }

            const confirmMsg = `Send personalized template to ${recipients.length} contact(s)${sendMeta ? ' via official Meta WhatsApp' : ' (simulated)'}?`;
            const okToProceed = await confirmWithBillingEstimate(recipients.map(r => r.phone), confirmMsg);
            if (!okToProceed) return;

            const sendBtn = document.getElementById('tpl-bulk-send-btn');
            const progBox = document.getElementById('tpl-bulk-progress-box');
            const progText = document.getElementById('tpl-bulk-progress-text');
            const progPct = document.getElementById('tpl-bulk-progress-pct');
            const progBar = document.getElementById('tpl-bulk-progress-bar');
            const logBox = document.getElementById('tpl-bulk-result-log');

            if (sendBtn) sendBtn.disabled = true;
            if (progBox) progBox.classList.remove('hidden');
            if (progText) progText.innerHTML = `<i class="fas fa-spinner fa-spin mr-1"></i> Sending to ${recipients.length} recipients...`;
            if (progBar) progBar.style.width = '5%';
            if (progPct) progPct.innerText = '5%';
            if (logBox) logBox.innerHTML = `<div>🚀 Starting personalized template dispatch to ${recipients.length} recipient(s)...</div>`;

            let totalSent = 0;
            let totalFailed = 0;
            const CHUNK_SIZE = 5;

            try {
                for (let i = 0; i < recipients.length; i += CHUNK_SIZE) {
                    const chunk = recipients.slice(i, i + CHUNK_SIZE);
                    const pct = Math.round((i / recipients.length) * 100);
                    if (progBar) progBar.style.width = `${Math.max(5, pct)}%`;
                    if (progPct) progPct.innerText = `${pct}%`;

                    const payload = {
                        personalized_messages: chunk.map(r => ({
                            phone: r.phone,
                            name: r.name || '',
                            category: r.category || '',
                            area: r.area || '',
                            message: resolveTemplateClientSide(message, r)
                        })),
                        send_via_meta: sendMeta,
                        add_as_leads: saveLeads,
                        lead_source: `Template: ${currentBulkTemplateTitle || 'Direct Send'}`
                    };

                    const res = await fetch('/api/dashboard/broadcast', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });

                    const data = await res.json();
                    if (!res.ok || data.error) {
                        throw new Error(data.error || 'Failed to dispatch template batch');
                    }

                    totalSent += (data.sent || 0);
                    totalFailed += (data.failed || 0);
                    if (logBox && Array.isArray(data.results)) {
                        data.results.forEach(r => {
                            const ok = r.status === 'sent' || r.status === 'simulated';
                            logBox.innerHTML += `<div class="${ok ? 'text-emerald-700' : 'text-rose-600'}">${ok ? '✅' : '❌'} ${escapeHtml(r.name || r.phone)}: ${escapeHtml(r.status)} ${r.error ? `(${escapeHtml(r.error)})` : ''}</div>`;
                        });
                        logBox.scrollTop = logBox.scrollHeight;
                    }
                }

                if (progBar) progBar.style.width = '100%';
                if (progPct) progPct.innerText = '100%';
                if (progText) progText.innerHTML = `<i class="fas fa-check-circle text-emerald-600 mr-1"></i> Completed!`;
                if (logBox) {
                    logBox.innerHTML += `<div class="text-emerald-700 font-bold mt-1">🏁 Finished: ${totalSent} sent, ${totalFailed} failed (Total: ${recipients.length})</div>`;
                }

                if (typeof fetchData === 'function') fetchData();
                if (typeof loadLeadsTable === 'function') loadLeadsTable();

                setTimeout(() => {
                    alert(`Template successfully dispatched: ${totalSent} sent, ${totalFailed} failed!`);
                    closeTemplateBulkModal();
                }, 800);
            } catch (err) {
                console.error('Template bulk send error:', err);
                if (progText) progText.innerHTML = `<i class="fas fa-circle-exclamation text-rose-600 mr-1"></i> Send failed`;
                if (logBox) {
                    logBox.innerHTML += `<div class="text-rose-600 font-bold mt-1">❌ Error: ${escapeHtml(err.message)}</div>`;
                }
                alert('Template send failed: ' + err.message);
            } finally {
                if (sendBtn) sendBtn.disabled = false;
            }
        }

        // Bookings
        async function fetchBookings() {
            try {
                const res = await fetch('/api/dashboard/bookings');
                if (res.ok) {
                    const data = await res.json();
                    const list = data.bookings || [];
                    const tbody = document.getElementById('bookings-tbody');
                    if (list.length === 0) {
                        tbody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-slate-400">No bookings recorded yet. Inbound customer booking messages appear here automatically!</td></tr>`;
                        return;
                    }

                    tbody.innerHTML = list.map(b => {
                        const statusColors = {
                            confirmed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
                            pending: 'bg-amber-50 text-amber-700 border-amber-200',
                            completed: 'bg-blue-50 text-blue-700 border-blue-200',
                            cancelled: 'bg-red-50 text-red-700 border-red-200'
                        };
                        const badgeClass = statusColors[b.status] || statusColors.pending;

                        return `
                            <tr class="hover:bg-slate-50 transition">
                                <td class="p-3.5 font-bold text-slate-900">${escapeHtml(b.customer_name)}</td>
                                <td class="p-3.5 font-mono font-medium text-emerald-700">${b.phone_number}</td>
                                <td class="p-3.5 text-slate-800 font-medium">${escapeHtml(b.service_requested)}</td>
                                <td class="p-3.5 text-slate-600">${escapeHtml(b.booking_date_time)}</td>
                                <td class="p-3.5">
                                    <select onchange="updateBookingStatus(${b.id}, this.value)" class="px-2.5 py-1 rounded-lg text-xs font-bold border ${badgeClass} bg-white focus:outline-none">
                                        <option value="confirmed" ${b.status === 'confirmed' ? 'selected' : ''}>Confirmed</option>
                                        <option value="pending" ${b.status === 'pending' ? 'selected' : ''}>Pending</option>
                                        <option value="completed" ${b.status === 'completed' ? 'selected' : ''}>Completed</option>
                                        <option value="cancelled" ${b.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
                                    </select>
                                </td>
                                <td class="p-3.5 text-slate-500 truncate max-w-xs">${escapeHtml(b.notes || '')}</td>
                                <td class="p-3.5 text-right">
                                    <button onclick="selectChat('${b.phone_number}', '${escapeHtml(b.customer_name)}'); switchTab('chats');" class="px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 font-bold hover:bg-emerald-600 hover:text-white transition">
                                        <i class="fas fa-comment mr-1"></i> Chat
                                    </button>
                                </td>
                            </tr>
                        `;
                    }).join('');
                }
            } catch (e) {
                console.error("Bookings error:", e);
            }
        }

        async function updateBookingStatus(id, status) {
            await fetch('/api/dashboard/bookings/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, status })
            });
            fetchData();
        }

        function openAddBookingModal() {
            document.getElementById('book-phone').value = currentPhone || '+14155550199';
            document.getElementById('book-name').value = currentContactName || 'Customer';
            document.getElementById('booking-modal').classList.remove('hidden');
        }
        function openBookCurrentContactModal() { openAddBookingModal(); }
        function closeBookingModal() { document.getElementById('booking-modal').classList.add('hidden'); }

        async function handleAddBookingSubmit(e) {
            e.preventDefault();
            const phone = document.getElementById('book-phone').value.trim();
            const name = document.getElementById('book-name').value.trim();
            const service = document.getElementById('book-service').value.trim();
            const dateTime = document.getElementById('book-time').value.trim();
            const status = document.getElementById('book-status').value;

            await fetch('/api/dashboard/bookings/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone, name, service, date_time: dateTime, status })
            });

            closeBookingModal();
            fetchData(true);
        }

        // Webhooks
        async function fetchWebhooks() {
            try {
                const res = await fetch('/api/dashboard/webhooks');
                if (res.ok) {
                    const data = await res.json();
                    const container = document.getElementById('webhook-logs-container');
                    const logs = data.logs || [];
                    if (logs.length === 0) {
                        container.innerHTML = `<div class="p-8 text-center text-slate-400">No webhook logs yet. Send a message to /api/webhook to test.</div>`;
                        return;
                    }
                    container.innerHTML = logs.map(l => `
                        <div class="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 sm:p-4 space-y-1.5">
                            <div class="flex flex-wrap items-center justify-between gap-1.5 font-mono text-xs">
                                <div class="flex items-center space-x-2 min-w-0">
                                    <span class="px-2 py-0.5 rounded-lg ${l.method === 'POST' ? 'bg-blue-100 text-blue-800' : 'bg-emerald-100 text-emerald-800'} font-bold flex-shrink-0">${l.method}</span>
                                    <span class="text-slate-800 font-bold break-all">${l.endpoint}</span>
                                </div>
                                <span class="text-slate-400 text-[11px] flex-shrink-0">${l.created_at}</span>
                            </div>
                            <pre class="bg-white p-3 rounded-xl border border-slate-200 text-xs text-slate-700 overflow-x-auto font-mono max-h-36">${escapeHtml(l.payload || '')}</pre>
                        </div>
                    `).join('');
                }
            } catch (e) {
                console.error("Webhook logs error:", e);
            }
        }

        // Media Attachment Modal
        function openMediaModal() {
            if (!currentPhone) {
                alert("Please select a conversation first.");
                return;
            }
            document.getElementById('media-modal').classList.remove('hidden');
        }

        function closeMediaModal() {
            document.getElementById('media-modal').classList.add('hidden');
            document.getElementById('media-upload-form').reset();
            updateMediaFileInput();
        }

        function updateMediaFileInput() {
            const mediaType = document.querySelector('input[name="modal_media_type"]:checked').value;
            const fileInput = document.getElementById('media-file-input');
            if (mediaType === 'image') {
                fileInput.accept = "image/jpeg,image/png,image/webp";
            } else {
                fileInput.accept = "application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain";
            }
        }

        async function submitMediaUpload(e) {
            e.preventDefault();
            if (!currentPhone) return;

            const fileInput = document.getElementById('media-file-input');
            const file = fileInput.files[0];
            if (!file) {
                alert("Please select a file to send.");
                return;
            }

            const mediaType = document.querySelector('input[name="modal_media_type"]:checked').value;
            const caption = document.getElementById('media-caption-input').value.trim();
            const sendViaMeta = document.getElementById('media-send-meta').checked;
            const btn = document.getElementById('media-submit-btn');

            btn.disabled = true;
            btn.innerHTML = `<i class="fas fa-spinner fa-spin mr-1"></i> Uploading & Sending...`;

            try {
                const formData = new FormData();
                formData.append('phone', currentPhone);
                formData.append('caption', caption);
                formData.append('media_type', mediaType);
                formData.append('send_via_meta', sendViaMeta);
                formData.append('file', file);

                const res = await fetch('/api/dashboard/send-media', {
                    method: 'POST',
                    body: formData
                });

                if (res.ok) {
                    closeMediaModal();
                    await fetchData(true);
                } else {
                    const err = await res.json();
                    alert("Failed to send attachment: " + (err.error || 'Server error'));
                }
            } catch (err) {
                alert("Upload error: " + err.message);
            } finally {
                btn.disabled = false;
                btn.innerHTML = `<i class="fas fa-paper-plane text-xs"></i> <span>Send Attachment</span>`;
            }
        }

        // Simulate Modal
        function openSimulateModal() { document.getElementById('simulate-modal').classList.remove('hidden'); }
        function closeSimulateModal() { document.getElementById('simulate-modal').classList.add('hidden'); }

        async function handleSimulateSubmit(e) {
            e.preventDefault();
            const phone = document.getElementById('sim-phone').value.trim();
            const name = document.getElementById('sim-name').value.trim();
            const msg = document.getElementById('sim-message').value.trim();
            const autoReply = document.getElementById('sim-auto-reply').checked;
            const btn = document.getElementById('sim-submit-btn');

            btn.disabled = true;
            btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Sending...`;

            try {
                if (autoReply) {
                    closeSimulateModal();
                    currentPhone = phone;
                    currentContactName = name || 'Customer';
                    appendOptimisticChatTyping(msg);
                }

                const res = await fetch('/api/dashboard/simulate-inbound', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phone, name, message: msg, auto_reply: autoReply })
                });

                if (res.ok) {
                    closeSimulateModal();
                    currentPhone = phone;
                    currentContactName = name || 'Customer';
                }
            } catch (err) {
                alert("Simulation error: " + err.message);
            } finally {
                localTypingPhone = null;
                document.getElementById('active-typing-badge')?.classList.add('hidden');
                btn.disabled = false;
                btn.innerHTML = `<i class="fas fa-paper-plane"></i> <span>Send & Reply</span>`;
                await fetchData(true);
            }
        }

        function copyTenantWebhookUrl() {
            const el = document.getElementById('set-webhook-url-box');
            if (!el) return;
            navigator.clipboard.writeText(el.value).then(() => {
                alert('Webhook callback URL copied: ' + el.value);
            }).catch(() => {
                el.select();
                document.execCommand('copy');
            });
        }

        // Settings Modal
        async function openSettingsModal() {
            document.getElementById('settings-modal').classList.remove('hidden');
            const res = await fetch('/api/dashboard/settings');
            if (res.ok) {
                const s = await res.json();
                const bnEl = document.getElementById('set-business-name');
                const cpEl = document.getElementById('set-custom-prompt');
                const whEl = document.getElementById('set-webhook-url-box');
                if (bnEl) bnEl.value = s.business_name || '';
                if (cpEl) cpEl.value = s.custom_system_prompt || '';
                if (whEl) whEl.value = s.webhook_url || `${window.location.origin}/api/webhook`;

                if (s.deepseek_api_key_set && document.getElementById('set-deepseek-key')) {
                    document.getElementById('set-deepseek-key').placeholder = `Configured: ${s.deepseek_api_key_masked}`;
                }
                if (document.getElementById('set-deepseek-model')) {
                    document.getElementById('set-deepseek-model').value = s.deepseek_model || 'deepseek-chat';
                }
                if (s.groq_api_key_set) document.getElementById('set-groq-key').placeholder = `Configured: ${s.groq_api_key_masked}`;
                document.getElementById('set-groq-model').value = s.groq_model || 'llama-3.3-70b-versatile';
                if (s.whatsapp_token_set) document.getElementById('set-meta-token').placeholder = `Configured: ${s.whatsapp_token_masked}`;
                document.getElementById('set-meta-phone-id').value = s.whatsapp_phone_number_id || '';
                document.getElementById('set-meta-verify-token').value = s.whatsapp_verify_token || '';
                const appSecEl = document.getElementById('set-meta-app-secret');
                if (appSecEl && s.meta_app_secret_set) {
                    appSecEl.placeholder = `Configured: ${s.meta_app_secret_masked}`;
                }
                const whTokLbl = document.getElementById('webhook-token-label');
                if (whTokLbl) whTokLbl.innerText = s.whatsapp_verify_token || '(configured in Settings)';

                const orSec = document.getElementById('set-openrouter-section');
                if (orSec) {
                    if (s.is_admin) {
                        orSec.classList.remove('hidden');
                        const st = document.getElementById('set-openrouter-status');
                        const kEl = document.getElementById('set-openrouter-key');
                        const mEl = document.getElementById('set-openrouter-model');
                        if (st) st.textContent = s.openrouter_guard_set ? 'Active Shield' : 'Key Required';
                        if (kEl && s.openrouter_guard_masked) kEl.placeholder = `Configured: ${s.openrouter_guard_masked}`;
                        if (mEl && s.openrouter_guard_model) mEl.value = s.openrouter_guard_model;
                    } else {
                        orSec.classList.add('hidden');
                    }
                }
            }
        }

        function closeSettingsModal() { document.getElementById('settings-modal').classList.add('hidden'); }

        async function handleSettingsSubmit(e) {
            e.preventDefault();
            const businessName = (document.getElementById('set-business-name')?.value || '').trim();
            const customPrompt = (document.getElementById('set-custom-prompt')?.value || '').trim();
            const deepseekKeyEl = document.getElementById('set-deepseek-key');
            const deepseekModelEl = document.getElementById('set-deepseek-model');
            const deepseekKey = deepseekKeyEl ? deepseekKeyEl.value.trim() : '';
            const deepseekModel = deepseekModelEl ? deepseekModelEl.value : 'deepseek-chat';

            const groqKey = document.getElementById('set-groq-key').value.trim();
            const groqModel = document.getElementById('set-groq-model').value;
            const metaToken = document.getElementById('set-meta-token').value.trim();
            const phoneId = document.getElementById('set-meta-phone-id').value.trim();
            const verifyToken = document.getElementById('set-meta-verify-token').value.trim();
            const metaAppSecret = (document.getElementById('set-meta-app-secret')?.value || '').trim();
            const orSec = document.getElementById('set-openrouter-section');
            const orKey = (orSec && !orSec.classList.contains('hidden')) ? (document.getElementById('set-openrouter-key')?.value || '').trim() : '';
            const orModel = (orSec && !orSec.classList.contains('hidden')) ? (document.getElementById('set-openrouter-model')?.value || '') : '';
            const btn = document.getElementById('save-settings-btn');

            btn.disabled = true;
            btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Saving...`;

            const bodyPayload = {
                business_name: businessName,
                custom_system_prompt: customPrompt,
                deepseek_api_key: deepseekKey,
                deepseek_model: deepseekModel,
                groq_api_key: groqKey,
                groq_model: groqModel,
                whatsapp_token: metaToken,
                whatsapp_phone_number_id: phoneId,
                whatsapp_verify_token: verifyToken
            };
            if (metaAppSecret) bodyPayload.meta_app_secret = metaAppSecret;
            if (orKey) bodyPayload.openrouter_api_key = orKey;
            if (orModel) bodyPayload.openrouter_guard_model = orModel;

            try {
                const res = await fetch('/api/dashboard/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(bodyPayload)
                });
                if (res.ok) {
                    if (currentUser && businessName) {
                        currentUser.business_name = businessName;
                        const brandTitle = document.getElementById('header-brand-title');
                        if (brandTitle) brandTitle.textContent = `${businessName} Desk`;
                    }
                    closeSettingsModal();
                    alert("Settings saved & synced to cloud!");
                    refreshBillingUI();
                    fetchData(true);
                }
            } catch (err) {
                alert("Error saving settings: " + err.message);
            } finally {
                btn.disabled = false;
                btn.innerHTML = `<i class="fas fa-save"></i> <span>Save Settings</span>`;
            }
        }

        let isSelectMode = false;
        let selectedMessageIds = new Set();

        function toggleSelectMode(forceState) {
            if (forceState !== undefined) {
                isSelectMode = forceState;
            } else {
                isSelectMode = !isSelectMode;
            }

            selectedMessageIds.clear();
            updateSelectionBar();

            const selectionBar = document.getElementById('selection-bar');

            if (isSelectMode) {
                if (selectionBar) selectionBar.classList.remove('hidden');
            } else {
                if (selectionBar) selectionBar.classList.add('hidden');
            }

            loadMessages(false);
        }

        function handleMessageSelectToggle(msgId) {
            msgId = parseInt(msgId);
            if (selectedMessageIds.has(msgId)) {
                selectedMessageIds.delete(msgId);
            } else {
                selectedMessageIds.add(msgId);
            }
            updateSelectionBar();
            const cb = document.querySelector(`.msg-select-cb[data-id="${msgId}"]`);
            if (cb) cb.checked = selectedMessageIds.has(msgId);
        }

        function selectAllMessages() {
            const allCbs = document.querySelectorAll('.msg-select-cb');
            if (selectedMessageIds.size === allCbs.length && allCbs.length > 0) {
                selectedMessageIds.clear();
                allCbs.forEach(cb => cb.checked = false);
            } else {
                allCbs.forEach(cb => {
                    const id = parseInt(cb.dataset.id);
                    selectedMessageIds.add(id);
                    cb.checked = true;
                });
            }
            updateSelectionBar();
        }

        function updateSelectionBar() {
            const label = document.getElementById('selected-count-label');
            const delBtn = document.getElementById('delete-selected-btn');
            if (label) label.innerText = `${selectedMessageIds.size} selected`;
            if (delBtn) delBtn.disabled = selectedMessageIds.size === 0;
        }

        async function deleteSelectedMessages() {
            if (selectedMessageIds.size === 0) return;
            const count = selectedMessageIds.size;
            if (!confirm(`Delete ${count} selected message(s)? This cannot be undone.`)) return;

            const ids = Array.from(selectedMessageIds);
            const btn = document.getElementById('delete-selected-btn');
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = `<i class="fas fa-spinner fa-spin text-xs"></i> Deleting...`;
            }

            try {
                const res = await fetch('/api/dashboard/messages', {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ids: ids })
                });

                if (res.ok) {
                    selectedMessageIds.clear();
                    toggleSelectMode(false);
                    await fetchData(true);
                } else {
                    alert("Failed to delete messages");
                }
            } catch (err) {
                alert("Error deleting messages: " + err.message);
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = `<i class="fas fa-trash text-[10px]"></i> <span>Delete</span>`;
                }
            }
        }

        async function deleteSingleMessage(msgId) {
            if (!confirm("Delete this message?")) return;
            try {
                const res = await fetch('/api/dashboard/messages', {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ids: [msgId] })
                });
                if (res.ok) {
                    await fetchData(true);
                } else {
                    alert("Failed to delete message");
                }
            } catch (e) {
                alert("Error: " + e.message);
            }
        }

        async function deleteCurrentChat() {
            if (!currentPhone) return;
            await deleteChatByPhone(currentPhone, currentContactName);
        }

        async function deleteChatByPhone(phone, name) {
            if (!confirm(`Delete all messages and chat history for ${name || phone}? This cannot be undone.`)) return;
            try {
                const res = await fetch(`/api/dashboard/conversation?phone=${encodeURIComponent(phone)}`, {
                    method: 'DELETE'
                });
                if (res.ok) {
                    if (currentPhone === phone) {
                        currentPhone = null;
                        document.getElementById('messages-container').innerHTML = `
                            <div class="h-full flex flex-col items-center justify-center text-center p-6 text-slate-400">
                                <div class="w-14 h-14 rounded-2xl bg-white flex items-center justify-center text-emerald-500 text-2xl mb-2.5 shadow-sm border border-slate-200">
                                    <i class="fab fa-whatsapp"></i>
                                </div>
                                <h3 class="text-sm font-bold text-slate-700">Growhaz Support Inbox</h3>
                                <p class="text-xs text-slate-500 max-w-sm mt-1">Select a customer or type below to test chatting with the AI Support Bot.</p>
                            </div>
                        `;
                        const menuBtn = document.getElementById('chat-actions-menu-btn');
                        if (menuBtn) menuBtn.classList.add('hidden');
                        closeChatActionsMenu();
                        showMobileList();
                    }
                    await fetchData(true);
                } else {
                    alert("Failed to delete conversation");
                }
            } catch (e) {
                alert("Error: " + e.message);
            }
        }

        async function clearAllData() {
            if (!confirm("Clear ALL chat history and logs?")) return;
            await fetch('/api/dashboard/clear', { method: 'DELETE' });
            currentPhone = null;
            fetchData(true);
        }

        let currentInboxFilter = 'all'; // 'all' or 'free_window'

        function setInboxFilter(filter) {
            currentInboxFilter = filter;
            const btnAll = document.getElementById('filter-btn-all');
            const btnFree = document.getElementById('filter-btn-free-window');
            const banner = document.getElementById('free-promo-filter-banner');

            if (filter === 'free_window') {
                if (btnFree) btnFree.className = 'flex-1 py-1.5 px-2 rounded-xl bg-emerald-600 text-white font-extrabold border border-emerald-600 text-center transition flex items-center justify-center space-x-1.5 shadow-xs';
                if (btnAll) btnAll.className = 'flex-1 py-1.5 px-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold border border-slate-200 text-center transition flex items-center justify-center space-x-1';
                banner?.classList.remove('hidden');
            } else {
                if (btnAll) btnAll.className = 'flex-1 py-1.5 px-2 rounded-xl bg-emerald-50 text-emerald-800 font-extrabold border border-emerald-200 text-center transition flex items-center justify-center space-x-1 shadow-xs';
                if (btnFree) btnFree.className = 'flex-1 py-1.5 px-2 rounded-xl bg-slate-100 hover:bg-emerald-50 text-slate-600 hover:text-emerald-700 font-bold border border-slate-200 text-center transition flex items-center justify-center space-x-1.5';
                banner?.classList.add('hidden');
            }
            filterConversations();
        }

        function filterConversations() {
            const q = (document.getElementById('search-input')?.value || '').toLowerCase();
            let filtered = allConversations || [];
            
            // Filter by 24-Hour Free Window if selected
            if (currentInboxFilter === 'free_window') {
                filtered = filtered.filter(c => c.free_window_active === true);
            }

            if (q) {
                filtered = filtered.filter(c => 
                    (c.phone_number && c.phone_number.toLowerCase().includes(q)) ||
                    (c.sender_name && c.sender_name.toLowerCase().includes(q)) ||
                    (c.last_message && c.last_message.toLowerCase().includes(q))
                );
            }
            renderConversations(filtered);
        }

        function formatFreeWindowCountdown(seconds) {
            if (!seconds || seconds <= 0) return 'Expired';
            const h = Math.floor(seconds / 3600);
            const m = Math.floor((seconds % 3600) / 60);
            const s = Math.floor(seconds % 60);
            if (h > 0) {
                return `${h}h ${m}m left`;
            }
            return `${m}m ${s}s left`;
        }

        function updateActiveFreeWindowUI(conv) {
            const banner = document.getElementById('chat-free-window-banner');
            const timerText = document.getElementById('banner-countdown-timer');
            const badge = document.getElementById('active-free-window-badge');
            const promoBtn = document.getElementById('active-promo-btn');

            if (conv && conv.free_window_active && conv.free_window_remaining_seconds > 0) {
                const timeLeft = formatFreeWindowCountdown(conv.free_window_remaining_seconds);
                if (banner) banner.classList.remove('hidden');
                if (timerText) timerText.innerText = timeLeft;
                if (badge) {
                    badge.classList.remove('hidden');
                    badge.className = 'text-[10px] px-2 py-0.5 rounded-full font-extrabold flex items-center space-x-1 border bg-emerald-100 text-emerald-800 border-emerald-300';
                    badge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse mr-1"></span>Free Window (${timeLeft}) • ₹0 Free`;
                }
                if (promoBtn) promoBtn.classList.remove('hidden');
            } else if (conv) {
                if (banner) banner.classList.add('hidden');
                if (badge) {
                    badge.classList.remove('hidden');
                    badge.className = 'text-[10px] px-2 py-0.5 rounded-full font-semibold flex items-center space-x-1 border bg-slate-100 text-slate-500 border-slate-200';
                    badge.innerHTML = `<span>🔴 Window Expired</span>`;
                }
                if (promoBtn) promoBtn.classList.add('hidden');
            } else {
                if (banner) banner.classList.add('hidden');
                if (badge) badge.classList.add('hidden');
                if (promoBtn) promoBtn.classList.add('hidden');
            }
        }

        function blastPromoToAllFreeWindows() {
            const activeEligible = (allConversations || []).filter(c => c.free_window_active && c.phone_number);
            if (activeEligible.length === 0) {
                alert('No customers currently have an active 24-hour free window.');
                return;
            }
            // Switch to bulk broadcast tab & Quick Static mode so numbers input is visible
            switchTab('broadcast');
            if (typeof switchCampaignMode === 'function') switchCampaignMode('static');
            // Put numbers in textarea
            const input = document.getElementById('broadcast-numbers-input');
            if (input) {
                input.value = activeEligible.map(c => c.phone_number).join('\n');
                handleBroadcastNumbersInput();
            }
            // Pre-fill a high-converting promo message
            const msgInput = document.getElementById('broadcast-message-input');
            if (msgInput && !msgInput.value.trim()) {
                msgInput.value = "Hi there! 👋 Special update from Growhaz: As a valued customer, you get an exclusive 20% discount on our Alpha G5 Advanced Website Security Vulnerability Scan. Reply to this message to claim your audit slot today! 🛡️";
            }
        }

        function formatTime(isoStr) {
            if (!isoStr || isoStr === 'undefined' || isoStr === 'null' || typeof isoStr !== 'string') return '';
            try {
                const clean = isoStr.trim().replace(' ', 'T');
                const d = new Date(clean.includes('Z') || clean.includes('+') ? clean : clean + 'Z');
                return isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            } catch { return ''; }
        }

        function getInitials(name) {
            if (!name) return 'WA';
            const parts = name.trim().split(/[\s+]+/);
            if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
            return name.slice(0, 2).toUpperCase();
        }

        const colors = ['bg-emerald-600', 'bg-blue-600', 'bg-indigo-600', 'bg-purple-600', 'bg-teal-600', 'bg-amber-600', 'bg-rose-600'];
        function getAvatarColor(str) {
            if (!str) return colors[0];
            let hash = 0;
            for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
            return colors[Math.abs(hash) % colors.length];
        }

        function escapeHtml(str) {
            if (!str) return '';
            return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
        }

        // ==================== AI PERSONALIZED CAMPAIGN ENGINE ====================
        let currentCampaignMode = 'ai';
        let campaignLeads = [];
        let campaignRawTable = null;

        const CAMPAIGN_PRESET_GOALS = {
            security: "Offer an exclusive 20% discount on Growhaz Alpha G5 Advanced Website Security Vulnerability Scan and modern custom app development to protect their online business.",
            booking: "Introduce the Growhaz 24/7 automated WhatsApp customer booking assistant and auto-reply bot that captures leads and schedules bookings without manual typing.",
            bakery: "Offer an automated WhatsApp menu catalog and festive cake ordering assistant so customers can place orders and inquiries 24/7 directly on WhatsApp.",
            salon: "Introduce a 24/7 WhatsApp appointment scheduling assistant so clients can view available time slots and book haircuts or salon packages instantly.",
            custom: ""
        };

        function switchCampaignMode(mode) {
            currentCampaignMode = mode;
            const tabAi = document.getElementById('campaign-tab-ai');
            const tabStatic = document.getElementById('campaign-tab-static');
            const panelAi = document.getElementById('panel-campaign-ai');
            const panelStatic = document.getElementById('panel-campaign-static');

            if (mode === 'ai') {
                if (tabAi) {
                    tabAi.className = 'px-2.5 sm:px-3.5 py-2 sm:py-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-emerald-600 text-white shadow-xs transition flex items-center justify-center text-center space-x-1.5 sm:space-x-2';
                }
                if (tabStatic) {
                    tabStatic.className = 'px-2.5 sm:px-3.5 py-2 sm:py-1.5 rounded-xl text-slate-600 hover:text-slate-900 transition flex items-center justify-center text-center space-x-1.5';
                }
                if (panelAi) panelAi.classList.remove('hidden');
                if (panelStatic) panelStatic.classList.add('hidden');
            } else {
                if (tabAi) {
                    tabAi.className = 'px-2.5 sm:px-3.5 py-2 sm:py-1.5 rounded-xl text-slate-600 hover:text-slate-900 transition flex items-center justify-center text-center space-x-1.5 sm:space-x-2';
                }
                if (tabStatic) {
                    tabStatic.className = 'px-2.5 sm:px-3.5 py-2 sm:py-1.5 rounded-xl bg-slate-800 text-white shadow-xs transition flex items-center justify-center text-center space-x-1.5';
                }
                if (panelAi) panelAi.classList.add('hidden');
                if (panelStatic) panelStatic.classList.remove('hidden');
            }
        }

        function initCampaignDefaults() {
            const goalInput = document.getElementById('campaign-goal-input');
            const presetSelect = document.getElementById('campaign-preset-select');
            if (goalInput && !goalInput.value.trim()) {
                const val = presetSelect ? presetSelect.value : 'security';
                goalInput.value = CAMPAIGN_PRESET_GOALS[val] || CAMPAIGN_PRESET_GOALS.security;
            }
        }

        function handleCampaignPresetChange() {
            const presetSelect = document.getElementById('campaign-preset-select');
            const goalInput = document.getElementById('campaign-goal-input');
            if (!presetSelect || !goalInput) return;
            const val = presetSelect.value;
            if (val === 'custom') {
                goalInput.value = '';
                goalInput.placeholder = 'Type your custom campaign pitch, offer details, and value proposition here...';
                goalInput.focus();
            } else {
                goalInput.value = CAMPAIGN_PRESET_GOALS[val] || '';
            }
        }

        function toggleCampaignPasteBox() {
            const el = document.getElementById('campaign-paste-container');
            if (el) el.classList.toggle('hidden');
        }

        const EXCLUDED_PHONE_HEADERS = new Set([
            'leadid', 'id', 'srno', 'sno', 'serialno', 'serialnumber',
            'pincode', 'pin', 'zip', 'zipcode', 'postalcode',
            'gst', 'gstno', 'gstin', 'gstnumber', 'pan', 'panno',
            'rating', 'ratings', 'reviews', 'reviewcount',
            'lat', 'lng', 'latitude', 'longitude',
            'date', 'createdat', 'updatedat', 'price', 'amount',
            'outreachstatus', 'verificationstatus', 'status', 'source',
            'orderid', 'invoice', 'invoiceno', 'rollno', 'regno'
        ]);

        function cleanRawPhoneString(rawValue) {
            if (rawValue === null || rawValue === undefined) return '';
            return String(rawValue)
                .replace(/[\u200B-\u200F\u202A-\u202E\uFEFF]/g, '')
                .replace(/\u00A0/g, ' ')
                .replace(/[\u0966-\u096F]/g, ch => String(ch.charCodeAt(0) - 0x0966))
                .trim();
        }

        function hasTruncatedScientificPhone(rawValue) {
            const s = cleanRawPhoneString(rawValue);
            const m = s.match(/^\+?(\d+)(?:\.(\d+))?[eE]\+?(\d+)$/);
            if (!m) return false;
            const exp = parseInt(m[3], 10);
            if (exp < 9 || exp > 14) return false;
            const sigDigits = (m[1] + (m[2] || '')).replace(/^0+/, '').length;
            return sigDigits < 10;
        }

        function normalizePhoneDigits(digits, strict = false, explicitIntl = false) {
            if (!digits || /^0+$/.test(digits)) return '';
            let d = digits;
            if (d.startsWith('00') && d.length >= 12 && d.length <= 17) {
                d = d.slice(2);
            }
            if (d.length === 13 && d.startsWith('091') && /^[6-9]/.test(d[3])) {
                return d.slice(1);
            }
            if (d.length === 11 && d.startsWith('0') && /^[6-9]/.test(d[1])) {
                return '91' + d.slice(1);
            }
            if (d.length === 10) {
                if (/^[6-9]/.test(d)) return '91' + d;
                return !strict ? ('91' + d) : '';
            }
            if (d.length === 12 && d.startsWith('91') && /^[6-9]/.test(d[2])) {
                return d;
            }
            if (d.length >= 11 && d.length <= 15) {
                if (!strict || explicitIntl) return d;
                return '';
            }
            return '';
        }

        function extractPhoneNumber(rawValue, options = {}) {
            const strict = Boolean(options.strict);
            let s = cleanRawPhoneString(rawValue);
            if (!s) return '';

            // Skip ISO dates (YYYY-MM-DD / YYYY/MM/DD)
            if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:[T\s].*)?$/.test(s)) return '';

            // Strip trailing decimal zeros from Excel/pandas floats (e.g. 9826112345.0)
            if (/^\+?\d+\.0+$/.test(s)) {
                s = s.replace(/\.0+$/, '');
            }

            // Handle scientific notation (e.g. 9.18815081605E+11 vs truncated 9.18815E+11)
            const sciMatch = s.match(/^\+?(\d+)(?:\.(\d+))?[eE]\+?(\d+)$/);
            if (sciMatch) {
                if (hasTruncatedScientificPhone(s)) return '';
                const exp = parseInt(sciMatch[3], 10);
                if (exp >= 9 && exp <= 14) {
                    const numDigits = String(Math.round(Number(s)));
                    return normalizePhoneDigits(numDigits, strict, s.startsWith('+'));
                }
                return '';
            }

            // Check WhatsApp / tel URLs first
            const urlPatterns = [
                /wa\.me\/(\+?\d{10,15})/i,
                /[?&]phone=(\+?\d{10,15})/i,
                /tel:(\+?[\d\s\-().]{10,20})/i
            ];
            for (const pat of urlPatterns) {
                const m = s.match(pat);
                if (m && m[1]) {
                    const rawUrlPhone = m[1].trim();
                    const urlDigits = rawUrlPhone.replace(/[^0-9]/g, '');
                    const normUrl = normalizePhoneDigits(urlDigits, false, rawUrlPhone.startsWith('+') || rawUrlPhone.startsWith('00'));
                    if (normUrl) return normUrl;
                }
            }

            const candidates = [];
            const addCandidate = (rawMatch) => {
                if (!rawMatch) return;
                const trimmed = rawMatch.trim();
                const explicitIntl = trimmed.startsWith('+') || trimmed.startsWith('00');
                const digits = trimmed.replace(/[^0-9]/g, '');
                const normalized = normalizePhoneDigits(digits, strict, explicitIntl);
                if (!normalized) return;

                const isStdLandlinePattern = /^0\d{2,4}[\s\-.]\d{6,8}$/.test(trimmed);
                const isIndianMobile = /^91[6-9]\d{9}$/.test(normalized);
                let score = 2;
                if (isIndianMobile && !isStdLandlinePattern && !trimmed.startsWith('0')) {
                    score = 4;
                } else if (isIndianMobile && !isStdLandlinePattern) {
                    score = 3;
                } else if (isStdLandlinePattern) {
                    score = 1;
                }
                candidates.push({ normalized, score });
            };

            if (!strict) {
                const segments = s.split(/[/,;|&\n]+|\bor\b/i);
                for (let seg of segments) {
                    seg = seg.trim();
                    if (!seg) continue;
                    if (/^\+?\d+\.0+$/.test(seg)) seg = seg.replace(/\.0+$/, '');

                    const phoneRegex = /(?:\(?\+?\d{1,3}\)?[\s\-.]?)?(?:\(0?\d{2,5}\)[\s\-.]?|0)?\d(?:[\s\-().]?\d){8,14}/g;
                    let foundInSeg = false;
                    let m;
                    while ((m = phoneRegex.exec(seg)) !== null) {
                        foundInSeg = true;
                        addCandidate(m[0]);
                    }

                    if (!foundInSeg) {
                        const strippedLabels = seg.replace(/\b(?:ph|phone|mob|mobile|tel|wa|whatsapp|call|no|num|ext|fax|office|shop|home)\b/gi, '');
                        if (!/[a-zA-Z]/.test(strippedLabels)) {
                            const segDigits = seg.replace(/[^0-9]/g, '');
                            if (segDigits.length >= 10 && segDigits.length <= 15) {
                                addCandidate(seg);
                            }
                        }
                    }
                }
            } else {
                const strictIndianRegex = /(?:^|[^0-9A-Za-z])((?:\(?\+?91\)?[\s\-.]*|0091[\s\-.]*|0)?[6-9](?:[\s\-.]?\d){9})(?![0-9A-Za-z])/g;
                let m;
                while ((m = strictIndianRegex.exec(s)) !== null) {
                    addCandidate(m[1]);
                }

                const strictIntlRegex = /(?:^|[^0-9A-Za-z])(\+[1-9]\d{0,2}[\s\-().]?\d(?:[\s\-().]?\d){8,13})(?![0-9A-Za-z])/g;
                while ((m = strictIntlRegex.exec(s)) !== null) {
                    addCandidate(m[1]);
                }
            }

            if (candidates.length === 0) return '';
            candidates.sort((a, b) => b.score - a.score);
            return candidates[0].normalized;
        }

        function normalizeCsvHeader(h) {
            return String(h || '').replace(/^\uFEFF/, '').toLowerCase().replace(/[^a-z0-9]/g, '');
        }

        function isExcludedPhoneHeader(norm) {
            if (!norm) return false;
            if (EXCLUDED_PHONE_HEADERS.has(norm)) return true;
            return norm.includes('aadhaar') || norm.includes('aadhar') || norm.includes('gstin') || norm.includes('pincode') || norm.includes('zipcode');
        }

        function getPhoneHeaderScore(norm) {
            if (!norm || isExcludedPhoneHeader(norm)) return norm ? -100 : 0;
            const strongKeywords = ['whatsapp', 'wano', 'wanumber', 'phone', 'mobile', 'contactnumber', 'contactno', 'contactnum', 'telephone', 'cell', 'phno', 'mobno', 'phnum', 'mobnum', 'phonenum', 'mobilenum', 'phoneno', 'mobileno'];
            if (norm === 'mob' || norm === 'ph' || norm === 'tel' || strongKeywords.some(k => norm.includes(k))) {
                return 100;
            }
            if (norm.includes('contact') && !norm.includes('person') && !norm.includes('name') && !norm.includes('email') && !norm.includes('status') && !norm.includes('date')) {
                return 70;
            }
            if (norm.includes('number') || norm === 'num' || norm.includes('call')) {
                return 70;
            }
            if (norm.endsWith('no') && norm.length >= 4) {
                return 60;
            }
            return 0;
        }

        function isKnownCsvHeaderRow(cells) {
            if (!cells || cells.length === 0) return false;
            if (cells.some(c => extractPhoneNumber(c, { strict: true }))) return false;
            const knownTokens = ['business', 'name', 'company', 'client', 'shop', 'store', 'category', 'industry', 'type', 'area', 'locality', 'city', 'address', 'location', 'phone', 'mobile', 'contact', 'whatsapp', 'tel', 'mob', 'number', 'email', 'source', 'status', 'leadid', 'srno', 'website', 'firm', 'merchant', 'outlet'];
            let hits = 0;
            for (const c of cells) {
                const norm = normalizeCsvHeader(c);
                if (norm && norm.length <= 30 && knownTokens.some(t => norm.includes(t))) {
                    hits++;
                }
            }
            return hits >= 2;
        }

        function detectCampaignColumns(rawHeaders, dataRows) {
            const normHeaders = rawHeaders.map(normalizeCsvHeader);
            const colCount = rawHeaders.length;
            const sampleRows = dataRows.slice(0, 100);
            const headerPhoneScores = normHeaders.map(getPhoneHeaderScore);
            const phoneCounts = new Array(colCount).fill(0);
            let scientificWarningCount = 0;

            for (let colIdx = 0; colIdx < colCount; colIdx++) {
                if (headerPhoneScores[colIdx] < 0) continue;
                const isHeaderPhone = headerPhoneScores[colIdx] >= 60;
                const strictScan = !isHeaderPhone;
                let hasWhatsappLink = false;

                for (const row of sampleRows) {
                    const cell = row[colIdx] || '';
                    if (!cell) continue;
                    const lowerCell = String(cell).toLowerCase();
                    if (lowerCell.includes('wa.me/') || lowerCell.includes('whatsapp.com/')) {
                        hasWhatsappLink = true;
                    }
                    if (hasTruncatedScientificPhone(cell)) {
                        const rawCleaned = cleanRawPhoneString(cell);
                        if (isHeaderPhone || /^\+?9\.1/.test(rawCleaned)) {
                            scientificWarningCount++;
                        }
                    }
                    if (extractPhoneNumber(cell, { strict: strictScan })) {
                        phoneCounts[colIdx]++;
                    }
                }

                if (hasWhatsappLink) {
                    headerPhoneScores[colIdx] += 30;
                }
            }

            // Pick best Phone column using header score + actual valid-phone data voting
            let phoneIdx = -1;
            let bestPhoneScore = 0;
            for (let colIdx = 0; colIdx < colCount; colIdx++) {
                if (headerPhoneScores[colIdx] < 0) continue;
                const dataScore = phoneCounts[colIdx] > 0 ? (1000 + phoneCounts[colIdx] * 10) : 0;
                const totalScore = headerPhoneScores[colIdx] + dataScore;
                if (totalScore > bestPhoneScore) {
                    bestPhoneScore = totalScore;
                    phoneIdx = colIdx;
                }
            }

            const findHeaderByKeywords = (orderedKeywords, rejectSubstrings = []) => {
                for (const kw of orderedKeywords) {
                    const idx = normHeaders.findIndex((h, i) =>
                        h && i !== phoneIdx && h.includes(kw) && !rejectSubstrings.some(r => h.includes(r))
                    );
                    if (idx !== -1) return idx;
                }
                return -1;
            };

            let nameIdx = findHeaderByKeywords(
                ['businessname', 'shopname', 'storename', 'companyname', 'clientname', 'customername', 'outletname', 'firmname', 'organization', 'merchant', 'title', 'business', 'company', 'client', 'fullname', 'ownername', 'owner', 'name'],
                ['filename', 'username', 'columnname', 'categoryname', 'areaname', 'cityname']
            );
            if (nameIdx === -1) {
                nameIdx = normHeaders.findIndex((h, colIdx) => {
                    if (colIdx === phoneIdx || isExcludedPhoneHeader(h)) return false;
                    return sampleRows.some(r => {
                        const v = (r[colIdx] || '').trim();
                        return v && !/^\d+$/.test(v) && !extractPhoneNumber(v, { strict: true });
                    });
                });
            }

            const categoryIdx = findHeaderByKeywords(
                ['businesscategory', 'category', 'industry', 'businesstype', 'segment', 'niche', 'sector', 'subcategory', 'vertical', 'profession', 'service', 'type']
            );
            const areaIdx = findHeaderByKeywords(
                ['areaorlocality', 'locality', 'area', 'fulladdress', 'address', 'location', 'city', 'town', 'place', 'market', 'ward', 'district', 'state', 'region', 'street', 'neighborhood', 'neighbourhood']
            );
            const websiteIdx = findHeaderByKeywords(
                ['websiteorsociallink', 'website', 'websiteurl', 'url', 'site', 'sociallink', 'domain', 'weblink']
            );

            return {
                mapping: {
                    phone: phoneIdx >= 0 ? phoneIdx : 'auto',
                    name: nameIdx,
                    category: categoryIdx,
                    area: areaIdx,
                    website: websiteIdx
                },
                phoneCounts,
                headerPhoneScores,
                scientificWarningCount
            };
        }

        function buildCampaignLeadsFromRawTable(rawTable, preserveMessages = false) {
            if (!rawTable || !Array.isArray(rawTable.rows)) return [];
            const { mapping, rows, phoneCounts, headerPhoneScores } = rawTable;
            const prevById = new Map();
            if (preserveMessages && Array.isArray(campaignLeads)) {
                campaignLeads.forEach(l => prevById.set(l.id, l));
            }

            const populatedPhoneCols = [];
            for (let c = 0; c < rawTable.headers.length; c++) {
                if (c === mapping.phone) continue;
                if ((phoneCounts && phoneCounts[c] > 0) || (headerPhoneScores && headerPhoneScores[c] >= 60)) {
                    populatedPhoneCols.push(c);
                }
            }

            return rows.map((row, idx) => {
                const rowNum = idx + 1;
                const rawName = (mapping.name >= 0 ? row[mapping.name] : '') || '';
                const rawCategory = (mapping.category >= 0 ? row[mapping.category] : '') || '';
                const rawArea = (mapping.area >= 0 ? row[mapping.area] : '') || '';
                const rawWebsite = (typeof mapping.website === 'number' && mapping.website >= 0 ? row[mapping.website] : '') || '';

                let phone = '';
                if (mapping.phone !== 'auto' && typeof mapping.phone === 'number' && mapping.phone >= 0) {
                    phone = extractPhoneNumber(row[mapping.phone] || '', { strict: false });
                }
                if (!phone) {
                    for (const colIdx of populatedPhoneCols) {
                        const isExplicitPhoneCol = headerPhoneScores && headerPhoneScores[colIdx] >= 60;
                        phone = extractPhoneNumber(row[colIdx] || '', { strict: !isExplicitPhoneCol });
                        if (phone) break;
                    }
                }
                if (!phone) {
                    for (let colIdx = 0; colIdx < row.length; colIdx++) {
                        if (colIdx === mapping.phone || isExcludedPhoneHeader(normalizeCsvHeader(rawTable.headers[colIdx]))) continue;
                        phone = extractPhoneNumber(row[colIdx] || '', { strict: true });
                        if (phone) break;
                    }
                }

                const prev = prevById.get(rowNum);
                return {
                    id: rowNum,
                    business_name: rawName.trim(),
                    category: rawCategory.trim() || 'Business',
                    area: rawArea.trim(),
                    website: rawWebsite.trim(),
                    phone: phone,
                    personalized_message: prev ? prev.personalized_message : '',
                    selected: prev ? prev.selected : true,
                    status: prev ? prev.status : 'ready'
                };
            });
        }

        function parseCSVToObjects(text, sourceName = 'CSV') {
            campaignRawTable = null;
            if (!text || !text.trim()) return [];
            const cleanText = String(text).replace(/^\uFEFF/, '');

            const lines = [];
            let curLine = '';
            let inQuotes = false;
            for (let i = 0; i < cleanText.length; i++) {
                const char = cleanText[i];
                if (char === '"') {
                    inQuotes = !inQuotes;
                    curLine += char;
                } else if ((char === '\n' || char === '\r') && !inQuotes) {
                    if (char === '\r' && cleanText[i + 1] === '\n') i++;
                    if (curLine.trim()) lines.push(curLine);
                    curLine = '';
                } else {
                    curLine += char;
                }
            }
            if (curLine.trim()) lines.push(curLine);
            if (lines.length === 0) return [];

            // Auto-detect delimiter across first 5 non-empty lines (outside quotes)
            const sampleLines = lines.slice(0, Math.min(5, lines.length));
            let commaCount = 0;
            let semiCount = 0;
            let tabCount = 0;
            for (const line of sampleLines) {
                let inside = false;
                for (let i = 0; i < line.length; i++) {
                    const c = line[i];
                    if (c === '"') inside = !inside;
                    else if (!inside) {
                        if (c === ',') commaCount++;
                        else if (c === ';') semiCount++;
                        else if (c === '\t') tabCount++;
                    }
                }
            }
            let delimiter = ',';
            if (tabCount > 0 && tabCount >= commaCount && tabCount >= semiCount) {
                delimiter = '\t';
            } else if (semiCount > 0 && semiCount > commaCount && semiCount >= sampleLines.length) {
                delimiter = ';';
            }

            function parseCSVLine(line, sep) {
                const cells = [];
                let curCell = '';
                let inside = false;
                for (let i = 0; i < line.length; i++) {
                    const c = line[i];
                    if (c === '"') {
                        if (inside && line[i + 1] === '"') {
                            curCell += '"';
                            i++;
                        } else {
                            inside = !inside;
                        }
                    } else if (c === sep && !inside) {
                        cells.push(curCell.trim());
                        curCell = '';
                    } else {
                        curCell += c;
                    }
                }
                cells.push(curCell.trim());
                return cells;
            }

            const parsedGrid = lines
                .map(l => parseCSVLine(l, delimiter))
                .filter(cells => cells && cells.some(c => c !== ''));
            if (parsedGrid.length === 0) return [];

            // Detect header row vs banner row vs headerless table
            let headerIdx = 0;
            let isHeaderless = false;
            const row0IsHeader = isKnownCsvHeaderRow(parsedGrid[0]);
            const row0NonEmpty = parsedGrid[0].filter(Boolean).length;

            if (!row0IsHeader || row0NonEmpty <= 1) {
                let foundHeaderIdx = -1;
                for (let i = 1; i < Math.min(4, parsedGrid.length); i++) {
                    if (isKnownCsvHeaderRow(parsedGrid[i])) {
                        foundHeaderIdx = i;
                        break;
                    }
                }
                if (foundHeaderIdx !== -1) {
                    headerIdx = foundHeaderIdx;
                } else if (!row0IsHeader && parsedGrid[0].some(c => extractPhoneNumber(c, { strict: true }))) {
                    isHeaderless = true;
                }
            }

            let rawHeaders;
            let dataRows;
            if (isHeaderless) {
                const maxCols = parsedGrid.reduce((m, r) => Math.max(m, r.length), 0);
                rawHeaders = Array.from({ length: maxCols }, (_, i) => `Column ${i + 1}`);
                dataRows = parsedGrid;
            } else {
                if (parsedGrid.length <= headerIdx + 1) return [];
                rawHeaders = [...parsedGrid[headerIdx]];
                dataRows = parsedGrid.slice(headerIdx + 1);
                const maxCols = dataRows.reduce((m, r) => Math.max(m, r.length), rawHeaders.length);
                while (rawHeaders.length < maxCols) {
                    rawHeaders.push(`Column ${rawHeaders.length + 1}`);
                }
            }

            const detected = detectCampaignColumns(rawHeaders, dataRows);
            campaignRawTable = {
                headers: rawHeaders,
                rows: dataRows,
                mapping: detected.mapping,
                phoneCounts: detected.phoneCounts,
                headerPhoneScores: detected.headerPhoneScores,
                scientificWarningCount: detected.scientificWarningCount,
                sourceName: sourceName
            };

            return buildCampaignLeadsFromRawTable(campaignRawTable, false);
        }

        function renderCampaignCsvMapper() {
            const box = document.getElementById('campaign-csv-mapper');
            if (!box) return;
            if (!campaignRawTable || !campaignRawTable.headers || campaignRawTable.headers.length === 0) {
                box.classList.add('hidden');
                return;
            }

            box.classList.remove('hidden');
            const summaryEl = document.getElementById('campaign-csv-summary');
            const validCount = campaignLeads.filter(l => l.phone && l.phone.length >= 10).length;
            const totalCount = campaignLeads.length;

            if (summaryEl) {
                if (validCount > 0) {
                    summaryEl.className = 'text-[11px] font-bold px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 flex items-center gap-1.5';
                    summaryEl.innerHTML = `<i class="fas fa-check-circle text-emerald-600"></i> <span>Detected <b>${validCount}</b> of <b>${totalCount}</b> valid phone numbers</span>`;
                } else {
                    summaryEl.className = 'text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-amber-50 text-amber-900 border border-amber-200 flex items-start gap-1.5';
                    if (campaignRawTable.scientificWarningCount > 0) {
                        summaryEl.innerHTML = `<i class="fas fa-triangle-exclamation text-amber-600 mt-0.5"></i> <span>0 valid numbers: detected ${campaignRawTable.scientificWarningCount} Excel-truncated number(s) like <code>9.18815E+11</code> (last digits lost). Format Phone column as Text/Number in Excel and re-export CSV.</span>`;
                    } else {
                        summaryEl.innerHTML = `<i class="fas fa-triangle-exclamation text-amber-600 mt-0.5"></i> <span>0 phone numbers found in CSV columns. Select the right <b>Phone Column</b> below or click <b>Quick-Fill Test Phone</b>.</span>`;
                    }
                }
            }

            const fillSelect = (id, selectedVal, includeAutoOption) => {
                const sel = document.getElementById(id);
                if (!sel) return;
                let opts = '';
                if (includeAutoOption) {
                    opts += `<option value="auto">Auto-Scan All Columns</option>`;
                } else {
                    opts += `<option value="-1">(None / Default)</option>`;
                }
                campaignRawTable.headers.forEach((h, idx) => {
                    const count = campaignRawTable.phoneCounts ? (campaignRawTable.phoneCounts[idx] || 0) : 0;
                    const countTag = (id === 'campaign-map-phone' && count > 0) ? ` (${count} phones)` : '';
                    opts += `<option value="${idx}">${escapeHtml(h || `Column ${idx + 1}`)}${countTag}</option>`;
                });
                sel.innerHTML = opts;
                sel.value = String(selectedVal);
            };

            fillSelect('campaign-map-phone', campaignRawTable.mapping.phone, true);
            fillSelect('campaign-map-name', campaignRawTable.mapping.name, false);
            fillSelect('campaign-map-category', campaignRawTable.mapping.category, false);
            fillSelect('campaign-map-area', campaignRawTable.mapping.area, false);
        }

        function applyCampaignColumnMapping() {
            if (!campaignRawTable) return;
            const phoneVal = document.getElementById('campaign-map-phone')?.value;
            const nameVal = document.getElementById('campaign-map-name')?.value;
            const catVal = document.getElementById('campaign-map-category')?.value;
            const areaVal = document.getElementById('campaign-map-area')?.value;

            campaignRawTable.mapping = {
                phone: phoneVal === 'auto' ? 'auto' : parseInt(phoneVal, 10),
                name: nameVal !== undefined ? parseInt(nameVal, 10) : campaignRawTable.mapping.name,
                category: catVal !== undefined ? parseInt(catVal, 10) : campaignRawTable.mapping.category,
                area: areaVal !== undefined ? parseInt(areaVal, 10) : campaignRawTable.mapping.area,
                website: campaignRawTable.mapping.website ?? -1
            };

            campaignLeads = buildCampaignLeadsFromRawTable(campaignRawTable, true);
            renderCampaignCsvMapper();
            renderCampaignLeadsTable();
        }

        async function loadSampleBetulLeads() {
            try {
                const res = await fetch('/static/sample_leads.csv');
                if (!res.ok) throw new Error('Sample CSV file not found on server');
                const text = await res.text();
                const parsed = parseCSVToObjects(text, 'sample_leads.csv');
                if (parsed.length === 0) throw new Error('Failed to parse sample CSV');
                campaignLeads = parsed;
                renderCampaignCsvMapper();
                renderCampaignLeadsTable();
                alert(`Loaded ${parsed.length} Betul businesses successfully! Next, review or edit the campaign goal and click "Generate AI Personalized Messages".`);
            } catch (err) {
                console.error("Error loading sample leads:", err);
                alert("Error loading sample CSV: " + err.message);
            }
        }

        function handleCampaignFileUpload(event) {
            const file = event?.target?.files?.[0] || (event instanceof File ? event : null);
            if (!file) return;
            if (event && event.target && 'value' in event.target) {
                event.target.value = '';
            }
            const reader = new FileReader();
            reader.onload = function(e) {
                try {
                    const text = e.target.result || '';
                    if (text.startsWith('PK\x03\x04')) {
                        alert('Excel (.xlsx) binary files cannot be read directly. Please use "Save As -> CSV (Comma delimited)" in Excel and upload the .csv file.');
                        return;
                    }
                    const parsed = parseCSVToObjects(text, file.name);
                    if (parsed.length === 0) {
                        alert('Could not find business rows in the file. Make sure your file is a valid CSV/TSV with columns like Business_Name, Category, Area, Phone.');
                        return;
                    }
                    campaignLeads = parsed;
                    renderCampaignCsvMapper();
                    renderCampaignLeadsTable();
                    const phoneCount = parsed.filter(l => l.phone && l.phone.length >= 10).length;
                    const missingCount = parsed.length - phoneCount;
                    if (phoneCount > 0) {
                        alert(`Loaded ${parsed.length} businesses from ${file.name}! Detected ${phoneCount} valid phone numbers (${missingCount} missing).`);
                    } else if (campaignRawTable && campaignRawTable.scientificWarningCount > 0) {
                        alert(`Loaded ${parsed.length} businesses from ${file.name}, but Excel truncated the phone numbers to scientific notation (e.g. 9.18815E+11). Please format the column as Text in Excel and re-export CSV.`);
                    } else {
                        alert(`Loaded ${parsed.length} businesses from ${file.name}, but 0 valid phone numbers were detected. Check the "CSV Column Mapping" dropdown above the table or click "Quick-Fill Test Phone".`);
                    }
                } catch (err) {
                    alert('Error parsing CSV file: ' + err.message);
                }
            };
            reader.readAsText(file);
        }

        function handleCampaignFileDrop(event) {
            event.preventDefault();
            const dropzone = document.getElementById('campaign-dropzone');
            if (dropzone) dropzone.classList.remove('border-emerald-500', 'bg-emerald-50/50');
            const file = event?.dataTransfer?.files?.[0];
            if (file) {
                handleCampaignFileUpload({ target: { files: [file] } });
            }
        }

        function handleCampaignPasteData() {
            const input = document.getElementById('campaign-paste-input');
            if (!input || !input.value.trim()) return;
            const parsed = parseCSVToObjects(input.value, 'Pasted Table');
            if (parsed.length === 0) {
                alert('Could not parse table data. Ensure rows contain columns like Business_Name, Category, Area, Phone.');
                return;
            }
            campaignLeads = parsed;
            renderCampaignCsvMapper();
            renderCampaignLeadsTable();
            toggleCampaignPasteBox();
            const phoneCount = parsed.filter(l => l.phone && l.phone.length >= 10).length;
            alert(`Parsed ${parsed.length} businesses from pasted data! Detected ${phoneCount} valid phone numbers.`);
        }

        function renderCampaignLeadsTable() {
            const tbody = document.getElementById('campaign-leads-tbody');
            const mobileBox = document.getElementById('campaign-leads-mobile');
            const badge = document.getElementById('campaign-leads-badge');
            const search = (document.getElementById('campaign-search-input')?.value || '').toLowerCase().trim();

            if (badge) badge.innerText = `${campaignLeads.length} leads loaded`;
            updateCampaignSelectionStats();

            if (!tbody && !mobileBox) return;

            if (campaignLeads.length === 0) {
                if (tbody) {
                    tbody.innerHTML = `
                        <tr>
                            <td colspan="6" class="p-12 text-center text-slate-400">
                                <i class="fas fa-file-csv text-3xl mb-2 opacity-50 block"></i>
                                <p class="font-bold text-xs">No businesses loaded yet.</p>
                                <p class="text-[11px] text-slate-400 mt-1">Upload a CSV or click <button type="button" onclick="loadSampleBetulLeads()" class="text-indigo-600 font-bold hover:underline">"Load Sample Betul Directory"</button> above to start.</p>
                            </td>
                        </tr>
                    `;
                }
                if (mobileBox) {
                    mobileBox.innerHTML = `
                        <div class="p-8 text-center text-slate-400 bg-white rounded-xl border border-slate-200">
                            <i class="fas fa-file-csv text-3xl mb-2 opacity-50 block"></i>
                            <p class="font-bold text-xs">No businesses loaded yet.</p>
                            <p class="text-[11px] text-slate-400 mt-1">Upload a CSV or click <button type="button" onclick="loadSampleBetulLeads()" class="text-indigo-600 font-bold hover:underline">"Load Sample Betul Directory"</button> above to start.</p>
                        </div>
                    `;
                }
                return;
            }

            const filtered = campaignLeads.filter(l => {
                if (!search) return true;
                return (l.business_name || '').toLowerCase().includes(search) ||
                       (l.category || '').toLowerCase().includes(search) ||
                       (l.area || '').toLowerCase().includes(search) ||
                       (l.phone || '').includes(search);
            });

            if (filtered.length === 0) {
                if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-slate-400 text-xs">No businesses match "${escapeHtml(search)}".</td></tr>`;
                if (mobileBox) mobileBox.innerHTML = `<div class="p-6 text-center text-slate-400 text-xs bg-white rounded-xl border border-slate-200">No businesses match "${escapeHtml(search)}".</div>`;
                return;
            }

            const statusBadges = {
                ready: '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200 whitespace-nowrap">Ready</span>',
                generating: '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700 animate-pulse whitespace-nowrap">Writing...</span>',
                sent: '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 whitespace-nowrap">✅ Sent</span>',
                failed: '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-300 whitespace-nowrap">❌ Failed</span>'
            };

            if (tbody) {
                tbody.innerHTML = filtered.map(lead => {
                    const isValidPhone = lead.phone && lead.phone.length >= 10;
                    const statusBadge = statusBadges[lead.status] || statusBadges.ready;

                    return `
                        <tr class="hover:bg-slate-50/70 transition border-b border-slate-100 ${lead.selected ? '' : 'opacity-60 bg-slate-50/40'}">
                            <td class="p-3 text-center">
                                <input type="checkbox" ${lead.selected ? 'checked' : ''} onchange="toggleCampaignLeadSelect(${lead.id}, this.checked)" class="rounded text-emerald-600 cursor-pointer">
                            </td>
                            <td class="p-3">
                                ${lead.business_name
                                    ? `<span class="font-extrabold text-slate-900 block leading-tight text-xs">${escapeHtml(lead.business_name)}</span>`
                                    : `<span class="font-bold text-slate-400 italic block leading-tight text-xs">Unnamed Lead #${lead.id}</span>`}
                                <span class="inline-block mt-0.5 px-2 py-0.2 rounded-full text-[9px] font-bold bg-blue-50 text-blue-700 border border-blue-200">${escapeHtml(lead.category || 'Business')}</span>
                            </td>
                            <td class="p-3 text-slate-600 text-xs font-medium">
                                ${lead.area
                                    ? `<i class="fas fa-location-dot text-slate-400 mr-1 text-[10px]"></i>${escapeHtml(lead.area)}`
                                    : `<span class="text-slate-400 italic text-[11px]">Not specified</span>`}
                            </td>
                            <td class="p-3">
                                <div class="relative">
                                    <input type="text"
                                           value="${escapeHtml(lead.phone || '')}"
                                           placeholder="Enter 10-digit phone"
                                           onchange="updateCampaignLeadPhone(${lead.id}, this.value)"
                                           class="w-full font-mono text-[11px] px-2.5 py-1 rounded-lg border ${isValidPhone ? 'border-emerald-300 bg-emerald-50/40 text-emerald-900' : 'border-amber-300 bg-amber-50/40 text-amber-900'} focus:outline-none focus:ring-1 focus:ring-indigo-500">
                                    ${!isValidPhone ? '<span class="text-[9px] text-amber-700 font-semibold block mt-0.5">⚠️ Missing phone</span>' : ''}
                                </div>
                            </td>
                            <td class="p-3">
                                <div class="space-y-1">
                                    <textarea rows="2"
                                              placeholder="Click 'Generate AI Messages' or type custom message..."
                                              onchange="updateCampaignLeadMessage(${lead.id}, this.value)"
                                              class="w-full text-xs p-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white font-sans resize-y leading-relaxed">${escapeHtml(lead.personalized_message || '')}</textarea>
                                    <div class="flex items-center justify-between text-[10px] text-slate-400">
                                        <span>${(lead.personalized_message || '').length} chars</span>
                                        <button type="button" onclick="regenerateSingleLeadMessage(${lead.id})" title="Regenerate this specific message with AI" class="text-indigo-600 hover:text-indigo-800 font-bold flex items-center space-x-1">
                                            <i class="fas fa-rotate"></i><span>AI Rewrite</span>
                                        </button>
                                    </div>
                                </div>
                            </td>
                            <td class="p-3 text-right">
                                ${statusBadge}
                            </td>
                        </tr>
                    `;
                }).join('');
            }

            if (mobileBox) {
                mobileBox.innerHTML = filtered.map(lead => {
                    const isValidPhone = lead.phone && lead.phone.length >= 10;
                    const statusBadge = statusBadges[lead.status] || statusBadges.ready;

                    return `
                        <div class="bg-white rounded-xl border border-slate-200 p-3 space-y-2.5 shadow-xs ${lead.selected ? '' : 'opacity-65 bg-slate-50/70'}">
                            <div class="flex items-start justify-between gap-2">
                                <div class="flex items-start space-x-2.5 min-w-0">
                                    <input type="checkbox" ${lead.selected ? 'checked' : ''} onchange="toggleCampaignLeadSelect(${lead.id}, this.checked)" class="mt-0.5 rounded text-emerald-600 cursor-pointer w-4 h-4 flex-shrink-0">
                                    <div class="min-w-0">
                                        ${lead.business_name
                                            ? `<span class="font-extrabold text-slate-900 block leading-tight text-xs break-words">${escapeHtml(lead.business_name)}</span>`
                                            : `<span class="font-bold text-slate-400 italic block leading-tight text-xs">Unnamed Lead #${lead.id}</span>`}
                                        <div class="flex flex-wrap items-center gap-1.5 mt-1">
                                            <span class="inline-block px-2 py-0.5 rounded-full text-[9px] font-bold bg-blue-50 text-blue-700 border border-blue-200">${escapeHtml(lead.category || 'Business')}</span>
                                            ${lead.area
                                                ? `<span class="text-[11px] text-slate-500 font-medium truncate max-w-full"><i class="fas fa-location-dot text-slate-400 mr-1 text-[10px]"></i>${escapeHtml(lead.area)}</span>`
                                                : `<span class="text-[11px] text-slate-400 italic">No locality</span>`}
                                        </div>
                                    </div>
                                </div>
                                <div class="flex-shrink-0">${statusBadge}</div>
                            </div>

                            <div>
                                <input type="text"
                                       value="${escapeHtml(lead.phone || '')}"
                                       placeholder="Enter 10-digit WhatsApp phone"
                                       onchange="updateCampaignLeadPhone(${lead.id}, this.value)"
                                       class="w-full font-mono text-xs px-3 py-2 rounded-lg border ${isValidPhone ? 'border-emerald-300 bg-emerald-50/40 text-emerald-900' : 'border-amber-300 bg-amber-50/40 text-amber-900'} focus:outline-none focus:ring-1 focus:ring-indigo-500">
                                ${!isValidPhone ? '<span class="text-[10px] text-amber-700 font-semibold block mt-1">⚠️ Missing valid 10+ digit phone</span>' : ''}
                            </div>

                            <div class="space-y-1.5">
                                <textarea rows="3"
                                          placeholder="Tap 'Generate AI Messages' or type custom message..."
                                          onchange="updateCampaignLeadMessage(${lead.id}, this.value)"
                                          class="w-full text-xs p-2.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-slate-50/60 font-sans resize-y leading-relaxed">${escapeHtml(lead.personalized_message || '')}</textarea>
                                <div class="flex items-center justify-between text-[11px] text-slate-500">
                                    <span>${(lead.personalized_message || '').length} chars</span>
                                    <button type="button" onclick="regenerateSingleLeadMessage(${lead.id})" class="px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold flex items-center space-x-1 transition">
                                        <i class="fas fa-rotate"></i><span>AI Rewrite</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('');
            }
        }

        function toggleCampaignLeadSelect(id, checked) {
            const lead = campaignLeads.find(l => l.id === id);
            if (lead) lead.selected = checked;
            updateCampaignSelectionStats();
        }

        function campaignSelectAll(state) {
            campaignLeads.forEach(l => l.selected = state);
            const headerCheck = document.getElementById('campaign-header-check');
            if (headerCheck) headerCheck.checked = state;
            renderCampaignLeadsTable();
        }

        function campaignSelectWithPhoneOnly() {
            let count = 0;
            campaignLeads.forEach(l => {
                const ok = Boolean(l.phone && l.phone.length >= 10);
                l.selected = ok;
                if (ok) count++;
            });
            const headerCheck = document.getElementById('campaign-header-check');
            if (headerCheck) headerCheck.checked = count > 0 && count === campaignLeads.length;
            renderCampaignLeadsTable();
            if (count === 0) {
                alert('No leads currently have valid 10+ digit phone numbers.');
            }
        }

        function toggleCampaignHeaderCheck(checked) {
            campaignSelectAll(checked);
        }

        function updateCampaignLeadPhone(id, val) {
            const lead = campaignLeads.find(l => l.id === id);
            if (lead) {
                const extracted = extractPhoneNumber(val, { strict: false });
                if (extracted) {
                    lead.phone = extracted;
                } else {
                    let digits = String(val || '').replace(/[^0-9]/g, '');
                    if (digits.length === 10) digits = '91' + digits;
                    lead.phone = digits;
                }
            }
            renderCampaignCsvMapper();
            renderCampaignLeadsTable();
        }

        function updateCampaignLeadMessage(id, val) {
            const lead = campaignLeads.find(l => l.id === id);
            if (lead) lead.personalized_message = val.trim();
        }

        function filterCampaignTable() {
            renderCampaignLeadsTable();
        }

        function clearCampaignLeads() {
            if (campaignLeads.length === 0) return;
            if (!confirm('Clear all loaded campaign leads?')) return;
            campaignLeads = [];
            campaignRawTable = null;
            renderCampaignCsvMapper();
            renderCampaignLeadsTable();
        }

        function updateCampaignSelectionStats() {
            const selected = campaignLeads.filter(l => l.selected);
            const valid = selected.filter(l => l.phone && l.phone.length >= 10);
            const genTargetCount = selected.length > 0 ? selected.length : campaignLeads.length;
            const badge = document.getElementById('campaign-selected-count-badge');
            const validBadge = document.getElementById('campaign-valid-phone-count');
            const sendLabel = document.getElementById('campaign-send-label');
            const sendBtn = document.getElementById('campaign-send-btn');
            const genBtn = document.getElementById('campaign-generate-btn');
            const genLabel = document.getElementById('campaign-generate-label');

            if (badge) badge.innerText = `${selected.length} of ${campaignLeads.length} selected`;
            if (validBadge) validBadge.innerText = valid.length;
            if (sendLabel) sendLabel.innerText = `Send Personalized Messages (${valid.length} Businesses)`;
            if (sendBtn) sendBtn.disabled = valid.length === 0;
            if (genLabel) {
                genLabel.innerText = selected.length > 0 && selected.length < campaignLeads.length
                    ? `Generate AI Personalized Messages (${selected.length} Selected)`
                    : `Generate AI Personalized Messages for All (${genTargetCount} Businesses)`;
            }
            if (genBtn) genBtn.disabled = campaignLeads.length === 0;
        }

        function quickFillTestPhone() {
            const selected = campaignLeads.filter(l => l.selected);
            if (selected.length === 0) {
                alert('Please select at least one business in the table first.');
                return;
            }

            const defaultNum = '918815081605';
            const input = prompt(`Enter WhatsApp Phone Number to assign to ${selected.length} selected businesses:\n(e.g., 918815081605 or 10-digit number)`, defaultNum);
            if (!input) return;

            let digits = input.replace(/[^0-9]/g, '');
            if (digits.length === 10) digits = '91' + digits;
            if (digits.length < 10) {
                alert('Invalid phone number. Please enter at least 10 digits.');
                return;
            }

            selected.forEach(lead => {
                lead.phone = digits;
            });

            renderCampaignCsvMapper();
            renderCampaignLeadsTable();
            alert(`✅ Filled phone ${digits} across ${selected.length} selected businesses!`);
        }

        async function generateAllPersonalizedMessages(customTargetLeads = null) {
            if (campaignLeads.length === 0) {
                alert('Please upload or load businesses first.');
                return;
            }

            const isAutoTriggered = Array.isArray(customTargetLeads);
            const targetLeads = isAutoTriggered
                ? customTargetLeads
                : (campaignLeads.filter(l => l.selected).length > 0 ? campaignLeads.filter(l => l.selected) : campaignLeads);

            if (targetLeads.length === 0) {
                if (!isAutoTriggered) alert('Please select at least one business first.');
                return;
            }

            const goal = (document.getElementById('campaign-goal-input')?.value || '').trim();
            const tone = document.getElementById('campaign-tone-select')?.value || 'friendly_warm';
            const genBtn = document.getElementById('campaign-generate-btn');
            const genLabel = document.getElementById('campaign-generate-label');

            if (genBtn) genBtn.disabled = true;

            const CHUNK_SIZE = 5;
            let totalUpdated = 0;
            let failedChunks = 0;
            let lastEngine = 'Growhaz AI Engine';

            try {
                for (let i = 0; i < targetLeads.length; i += CHUNK_SIZE) {
                    const chunk = targetLeads.slice(i, i + CHUNK_SIZE);
                    chunk.forEach(l => { l.status = 'generating'; });
                    renderCampaignLeadsTable();

                    const processed = Math.min(i + CHUNK_SIZE, targetLeads.length);
                    if (genLabel) {
                        genLabel.innerHTML = `<i class="fas fa-spinner fa-spin mr-1"></i> Generating All Pitches (${processed}/${targetLeads.length})...`;
                    }

                    try {
                        const res = await fetch('/api/dashboard/ai-personalize-campaign', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                leads: chunk,
                                campaign_goal: goal,
                                tone: tone
                            })
                        });

                        const data = await res.json();
                        if (res.ok && data.leads) {
                            if (data.engine_used) lastEngine = data.engine_used;
                            data.leads.forEach(item => {
                                const found = campaignLeads.find(l => l.id === item.id);
                                if (found) {
                                    found.personalized_message = item.personalized_message;
                                    found.status = 'ready';
                                    totalUpdated++;
                                }
                            });
                        } else {
                            failedChunks++;
                            chunk.forEach(l => { l.status = 'ready'; });
                        }
                    } catch (chunkErr) {
                        failedChunks++;
                        chunk.forEach(l => { l.status = 'ready'; });
                        console.warn("Chunk AI generation warning:", chunkErr);
                    }

                    renderCampaignLeadsTable();
                }

                if (!isAutoTriggered) {
                    const warn = failedChunks > 0 ? ` (${failedChunks} batch error(s) occurred)` : '';
                    alert(`✨ 1-Click Generation Complete: customized messages written for ${totalUpdated} businesses using ${lastEngine}${warn}! Review or click Send whenever ready.`);
                }
            } catch (err) {
                console.error("AI campaign generation error:", err);
                targetLeads.forEach(l => { if (l.status === 'generating') l.status = 'ready'; });
                if (!isAutoTriggered) alert("AI generation encountered an issue: " + err.message);
            } finally {
                if (genBtn) genBtn.disabled = false;
                updateCampaignSelectionStats();
                renderCampaignLeadsTable();
            }
        }

        async function regenerateSingleLeadMessage(leadId) {
            const lead = campaignLeads.find(l => l.id === leadId);
            if (!lead) return;

            const goal = (document.getElementById('campaign-goal-input')?.value || '').trim();
            const tone = document.getElementById('campaign-tone-select')?.value || 'friendly_warm';
            lead.status = 'generating';
            renderCampaignLeadsTable();

            try {
                const res = await fetch('/api/dashboard/ai-personalize-campaign', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        leads: [lead],
                        campaign_goal: goal,
                        tone: tone
                    })
                });
                const data = await res.json();
                if (res.ok && data.leads && data.leads.length > 0) {
                    lead.personalized_message = data.leads[0].personalized_message;
                }
            } catch (err) {
                console.error("Single lead rewrite error:", err);
            } finally {
                lead.status = 'ready';
                renderCampaignLeadsTable();
            }
        }

        async function executeCampaignSend() {
            const selected = campaignLeads.filter(l => l.selected);
            const withValidPhone = selected.filter(l => l.phone && l.phone.length >= 10);

            if (withValidPhone.length === 0) {
                alert('No valid leads ready to send. Ensure leads are selected and have valid 10+ digit phone numbers.');
                return;
            }

            const missingMsgLeads = withValidPhone.filter(l => !(l.personalized_message || '').trim());
            if (missingMsgLeads.length > 0) {
                if (!confirm(`${missingMsgLeads.length} selected business(es) don't have customized messages yet. Generate personalized AI messages in 1 click now and proceed to send?`)) {
                    return;
                }
                await generateAllPersonalizedMessages(missingMsgLeads);
            }

            const valid = selected.filter(l => l.phone && l.phone.length >= 10 && (l.personalized_message || '').trim());
            if (valid.length === 0) {
                alert('Unable to generate messages for selected leads. Please verify lead details and try again.');
                return;
            }

            const sendMeta = document.getElementById('campaign-send-meta')?.checked ?? true;
            const saveLeads = document.getElementById('campaign-save-leads')?.checked ?? true;
            const presetSelect = document.getElementById('campaign-preset-select');
            const campaignTitle = presetSelect ? presetSelect.options[presetSelect.selectedIndex].text : 'AI Campaign';

            const confirmMsg = `Send tailored WhatsApp messages to ${valid.length} businesses via ${sendMeta ? 'official Meta WhatsApp Cloud API' : 'simulated WhatsApp'} in safe batches?`;
            const okToProceed = await confirmWithBillingEstimate(valid.map(v => v.phone), confirmMsg);
            if (!okToProceed) return;

            const sendBtn = document.getElementById('campaign-send-btn');
            const progBox = document.getElementById('campaign-progress-box');
            const progText = document.getElementById('campaign-progress-text');
            const progPct = document.getElementById('campaign-progress-pct');
            const progBar = document.getElementById('campaign-progress-bar');
            const logBox = document.getElementById('campaign-log-box');

            if (sendBtn) sendBtn.disabled = true;
            if (progBox) progBox.classList.remove('hidden');
            if (progText) progText.innerHTML = `<i class="fas fa-spinner fa-spin mr-1"></i> Initializing campaign for ${valid.length} businesses...`;
            if (progBar) progBar.style.width = '5%';
            if (progPct) progPct.innerText = '5%';
            if (logBox) logBox.innerHTML = `<div>🚀 Starting AI Personalized WhatsApp Campaign (${valid.length} recipients, batch size: 5)...</div>`;

            let totalSent = 0;
            let totalFailed = 0;
            const SEND_CHUNK_SIZE = 5;
            const totalValid = valid.length;

            try {
                for (let i = 0; i < totalValid; i += SEND_CHUNK_SIZE) {
                    const chunk = valid.slice(i, i + SEND_CHUNK_SIZE);
                    const batchNum = Math.floor(i / SEND_CHUNK_SIZE) + 1;
                    const totalBatches = Math.ceil(totalValid / SEND_CHUNK_SIZE);

                    const pct = Math.round((i / totalValid) * 100);
                    if (progBar) progBar.style.width = `${pct}%`;
                    if (progPct) progPct.innerText = `${pct}%`;
                    if (progText) progText.innerHTML = `<i class="fas fa-spinner fa-spin mr-1"></i> Sending batch ${batchNum}/${totalBatches} (${i}/${totalValid} dispatched)...`;

                    try {
                        const payload = {
                            personalized_messages: chunk.map(l => ({
                                phone: l.phone,
                                name: l.business_name,
                                message: l.personalized_message,
                                category: l.category,
                                area: l.area,
                                website: l.website || ''
                            })),
                            send_via_meta: sendMeta,
                            add_as_leads: saveLeads,
                            lead_source: `Campaign: ${campaignTitle}`
                        };

                        const res = await fetch('/api/dashboard/broadcast', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(payload)
                        });

                        const data = await res.json();
                        if (!res.ok || data.error) {
                            throw new Error(data.error || `HTTP ${res.status} on batch ${batchNum}`);
                        }

                        totalSent += (data.sent || 0);
                        totalFailed += (data.failed || 0);

                        if (data.results && Array.isArray(data.results)) {
                            data.results.forEach(r => {
                                const lead = campaignLeads.find(l => l.phone === r.phone || (l.business_name && l.business_name === r.name));
                                if (lead) {
                                    lead.status = (r.status === 'sent' || r.status === 'simulated') ? 'sent' : 'failed';
                                }
                                if (logBox) {
                                    const isSuccess = (r.status === 'sent' || r.status === 'simulated');
                                    const icon = isSuccess ? '✅' : '❌';
                                    const color = isSuccess ? 'text-emerald-700' : 'text-rose-600';
                                    logBox.innerHTML += `<div class="${color}">${icon} [${r.status.toUpperCase()}] ${escapeHtml(r.name || r.phone)}: ${escapeHtml(r.status)} ${r.error ? `(${escapeHtml(r.error)})` : ''}</div>`;
                                }
                            });
                        }
                    } catch (batchErr) {
                        console.error(`Batch ${batchNum} error:`, batchErr);
                        chunk.forEach(l => {
                            l.status = 'failed';
                            if (logBox) {
                                logBox.innerHTML += `<div class="text-rose-600 font-bold">❌ [FAILED] ${escapeHtml(l.business_name || l.phone)}: ${escapeHtml(batchErr.message)}</div>`;
                            }
                        });
                        totalFailed += chunk.length;
                    }

                    if (logBox) logBox.scrollTop = logBox.scrollHeight;
                    renderCampaignLeadsTable();
                    // Short pause between batches for smooth network and browser performance
                    await new Promise(r => setTimeout(r, 250));
                }

                if (progBar) progBar.style.width = '100%';
                if (progPct) progPct.innerText = '100%';
                if (progText) progText.innerHTML = `<i class="fas fa-check-circle text-emerald-600 mr-1"></i> Campaign Finished!`;
                if (logBox) {
                    logBox.innerHTML += `<div class="text-emerald-700 font-bold border-t border-slate-200 pt-1 mt-1">🏁 Campaign Complete: ${totalSent} delivered, ${totalFailed} failed.</div>`;
                    logBox.scrollTop = logBox.scrollHeight;
                }

                renderCampaignLeadsTable();
                if (typeof fetchData === 'function') fetchData();
                if (typeof loadLeadsTable === 'function') loadLeadsTable();

                alert(`🎉 Campaign completed! ${totalSent} messages dispatched successfully, ${totalFailed} failed. All conversations and leads have been updated in your CRM.`);
            } catch (err) {
                console.error("Campaign send fatal error:", err);
                if (progText) progText.innerHTML = `<i class="fas fa-circle-exclamation text-rose-600 mr-1"></i> Dispatch encountered an issue`;
                if (logBox) logBox.innerHTML += `<div class="text-rose-600 font-bold">❌ Error: ${escapeHtml(err.message)}</div>`;
                alert("Campaign send encountered an issue: " + err.message);
            } finally {
                if (sendBtn) sendBtn.disabled = false;
            }
        }

        // ==================== BULK BROADCAST & LEADS CRM ====================

        function parseBroadcastNumbers(rawText) {
            if (!rawText) return [];
            const tokens = rawText.split(/[\n,;]+/);
            const valid = [];
            const seen = new Set();
            for (let t of tokens) {
                let digits = t.replace(/[^0-9]/g, '');
                if (digits.length === 10) {
                    digits = '91' + digits;
                }
                if (digits.length >= 10 && !seen.has(digits)) {
                    seen.add(digits);
                    valid.push(digits);
                }
            }
            return valid;
        }

        function handleBroadcastNumbersInput() {
            const input = document.getElementById('broadcast-numbers-input');
            const badge = document.getElementById('broadcast-number-badge');
            if (!input || !badge) return;
            const valid = parseBroadcastNumbers(input.value);
            badge.innerText = `${valid.length} valid number${valid.length === 1 ? '' : 's'}`;
            if (valid.length > 0) {
                badge.className = 'px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800';
            } else {
                badge.className = 'px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-200 text-slate-700';
            }
        }

        function clearBroadcastNumbers() {
            const input = document.getElementById('broadcast-numbers-input');
            if (input) input.value = '';
            handleBroadcastNumbersInput();
        }

        function handleBroadcastFileUpload(event) {
            const file = event.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = function(e) {
                const content = e.target.result;
                const input = document.getElementById('broadcast-numbers-input');
                if (input) {
                    input.value = (input.value ? input.value + '\n' : '') + content;
                    handleBroadcastNumbersInput();
                }
            };
            reader.readAsText(file);
        }

        function updateBroadcastContactsCount() {
            const el = document.getElementById('broadcast-contacts-count');
            if (el && allConversations) {
                el.innerText = allConversations.length;
            }
        }

        function loadExistingContactsToBroadcast() {
            if (!allConversations || allConversations.length === 0) {
                alert('No existing conversations found to import.');
                return;
            }
            const existingNumbers = allConversations.map(c => c.phone_number).filter(Boolean);
            const input = document.getElementById('broadcast-numbers-input');
            if (input) {
                const current = input.value ? input.value + '\n' : '';
                input.value = current + existingNumbers.join('\n');
                handleBroadcastNumbersInput();
            }
        }

        function populateBroadcastTemplateDropdown() {
            const select = document.getElementById('broadcast-template-select');
            if (!select) return;
            select.innerHTML = '<option value="">-- Choose Template --</option>' +
                allTemplates.map(t => `<option value="${escapeHtml(t.content)}">${escapeHtml(t.title)}</option>`).join('');
        }

        function insertBroadcastTemplate() {
            const select = document.getElementById('broadcast-template-select');
            const input = document.getElementById('broadcast-message-input');
            if (select && input && select.value) {
                input.value = select.value;
            }
        }

        async function startBulkBroadcast() {
            const numInput = document.getElementById('broadcast-numbers-input');
            const msgInput = document.getElementById('broadcast-message-input');
            const sendMeta = document.getElementById('broadcast-send-meta').checked;
            const saveLeads = document.getElementById('broadcast-save-leads').checked;
            const btn = document.getElementById('broadcast-send-btn');
            const statusBadge = document.getElementById('broadcast-status-badge');
            const progressBar = document.getElementById('broadcast-progress-bar');
            const statTotal = document.getElementById('broadcast-stat-total');
            const statSent = document.getElementById('broadcast-stat-sent');
            const statFailed = document.getElementById('broadcast-stat-failed');
            const logBox = document.getElementById('broadcast-log-box');

            const validNumbers = parseBroadcastNumbers(numInput.value);
            const message = (msgInput.value || '').trim();

            if (validNumbers.length === 0) {
                alert('Please enter at least one valid 10+ digit phone number.');
                return;
            }
            if (!message) {
                alert('Please write a message before broadcasting.');
                return;
            }

            const confirmMsg = `Are you sure you want to send this message to ${validNumbers.length} recipients${sendMeta ? ' via official Meta WhatsApp' : ' (simulated)'}?`;
            const okToProceed = await confirmWithBillingEstimate(validNumbers, confirmMsg);
            if (!okToProceed) return;

            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Sending Broadcast...';
            statusBadge.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800';
            statusBadge.innerText = 'Broadcasting...';
            progressBar.style.width = '20%';
            logBox.innerHTML = `<div class="text-indigo-600 font-bold">🚀 Starting broadcast to ${validNumbers.length} recipients...</div>`;

            try {
                const directoryNames = {};
                getMergedTemplateBulkDirectory().forEach(d => {
                    if (d.phone && d.name) directoryNames[d.phone] = d.name;
                });

                const res = await fetch('/api/dashboard/broadcast', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        phone_numbers: validNumbers,
                        recipient_names: directoryNames,
                        message: message,
                        send_via_meta: sendMeta,
                        add_as_leads: saveLeads,
                        lead_source: 'Bulk Broadcast'
                    })
                });

                const data = await res.json();
                if (!res.ok || data.error) {
                    throw new Error(data.error || 'Failed to complete broadcast');
                }

                statTotal.innerText = data.total;
                statSent.innerText = data.sent;
                statFailed.innerText = data.failed;
                progressBar.style.width = '100%';

                if (data.failed > 0) {
                    statusBadge.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800';
                    statusBadge.innerText = `Completed with ${data.failed} fails`;
                } else {
                    statusBadge.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800';
                    statusBadge.innerText = 'All Sent Successfully!';
                }

                let logsHtml = `<div class="text-emerald-600 font-bold">✅ Completed: ${data.sent} sent, ${data.failed} failed.</div>`;
                data.results.forEach(r => {
                    const icon = r.status === 'sent' || r.status === 'simulated' ? '✅' : '❌';
                    const color = r.status === 'sent' || r.status === 'simulated' ? 'text-slate-700' : 'text-rose-600 font-bold';
                    logsHtml += `<div class="${color}">${icon} +${r.phone}: ${r.status}${r.error ? ` (${r.error})` : ''}</div>`;
                });
                logBox.innerHTML = logsHtml;

                // Refresh Leads and Conversations
                loadLeadsTable();
                fetchData(true);

            } catch (err) {
                statusBadge.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800';
                statusBadge.innerText = 'Error';
                logBox.innerHTML += `<div class="text-rose-600 font-bold">❌ Error: ${err.message}</div>`;
                alert('Broadcast failed: ' + err.message);
            } finally {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-paper-plane mr-2"></i> Send Bulk Broadcast';
            }
        }

        async function loadLeadsTable() {
            const tbody = document.getElementById('leads-table-body');
            const badge = document.getElementById('leads-count-badge');

            try {
                const res = await fetch('/api/dashboard/leads');
                const data = await res.json();
                const leads = data.leads || [];
                allLeads = leads;

                if (badge) badge.innerText = `${leads.length} Lead${leads.length === 1 ? '' : 's'}`;
                if (!tbody) return;

                if (leads.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="3" class="p-4 text-center text-slate-400 italic">No leads recorded yet.</td></tr>';
                    return;
                }

                tbody.innerHTML = leads.map(l => `
                    <tr class="hover:bg-slate-50 transition">
                        <td class="p-2 font-mono font-bold text-slate-800">+${escapeHtml(l.phone_number)}</td>
                        <td class="p-2">
                            <span class="px-1.5 py-0.5 rounded text-[10px] font-bold ${l.status === 'Contacted' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-700'}">${escapeHtml(l.status || 'New')}</span>
                        </td>
                        <td class="p-2 text-right space-x-1">
                            <button onclick="selectChat('${l.phone_number}', '${escapeHtml(l.name || 'Lead')}'); switchTab('chats');" class="px-2 py-1 rounded bg-emerald-50 text-emerald-700 font-bold hover:bg-emerald-600 hover:text-white transition text-[10px]" title="Open Chat">
                                <i class="fas fa-comment"></i>
                            </button>
                            <button onclick="deleteLeadItem(${l.id})" class="text-slate-300 hover:text-rose-500 p-1 transition text-[10px]" title="Delete Lead">
                                <i class="fas fa-trash"></i>
                            </button>
                        </td>
                    </tr>
                `).join('');
            } catch (err) {
                console.error('Error loading leads:', err);
            }
        }

        async function deleteLeadItem(id) {
            if (!confirm('Delete this lead?')) return;
            try {
                const res = await fetch(`/api/dashboard/leads/${id}`, { method: 'DELETE' });
                if (res.ok) loadLeadsTable();
            } catch (e) {
                console.error(e);
            }
        }

        // ==================== ONE-CLICK PROMOTIONAL SENDER ====================

        const promoPresets = {
            security: "Hi there! 👋 Exclusive offer from Growhaz: Protect your website with a 20% discount on our Alpha G5 Advanced Security Vulnerability Scan. Reply here to claim your discounted audit slot today! 🛡️",
            appify: "Hi! 🚀 Ready to launch your own mobile app? With Growhaz Appify, we turn your website into native Android & iOS mobile apps with push notifications and offline mode. Reply here to get a free mobile app preview!",
            webdev: "Hi there! 💻 Is your website running fast and fully secure? Growhaz is offering a free Lighthouse SEO & security speed audit for your site. Reply with your website URL to get your free report!",
            blockchain: "Hi! 🔗 Eliminate document forgery with Growhaz Blockchain Document Verification. We provide cryptographic tamper-proof issuance for certificates and contracts. Reply to book a quick demo!"
        };

        function openPromoModalForCurrent() {
            if (!currentPhone) {
                alert('Please select a customer chat first.');
                return;
            }
            const modal = document.getElementById('promo-modal');
            const recipientLabel = document.getElementById('promo-modal-recipient');
            const timerBadge = document.getElementById('promo-modal-timer-badge');
            const msgArea = document.getElementById('promo-modal-message');

            const conv = (allConversations || []).find(c => c.phone_number === currentPhone);
            const name = currentContactName || currentPhone;

            if (recipientLabel) recipientLabel.innerText = `${name} (+${currentPhone})`;
            if (timerBadge && conv && conv.free_window_active) {
                timerBadge.innerText = `${formatFreeWindowCountdown(conv.free_window_remaining_seconds)}`;
                timerBadge.className = 'px-2.5 py-1 rounded-full text-xs font-extrabold bg-emerald-100 text-emerald-800 border border-emerald-300';
            } else if (timerBadge) {
                timerBadge.innerText = 'Window Expired';
                timerBadge.className = 'px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-500 border border-slate-200';
            }

            if (msgArea && !msgArea.value.trim()) {
                applyPromoPreset('security');
            }

            modal?.classList.remove('hidden');
        }

        function closePromoModal() {
            document.getElementById('promo-modal')?.classList.add('hidden');
        }

        function applyPromoPreset(presetKey) {
            const msgArea = document.getElementById('promo-modal-message');
            if (msgArea && promoPresets[presetKey]) {
                msgArea.value = promoPresets[presetKey];
            }
        }

        async function sendPromoModalMessage() {
            const msgArea = document.getElementById('promo-modal-message');
            const btn = document.getElementById('promo-send-btn');
            const message = (msgArea?.value || '').trim();

            if (!currentPhone) {
                alert('No active recipient selected.');
                return;
            }
            if (!message) {
                alert('Please enter a promotional message to send.');
                return;
            }

            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Sending Promo...';

            try {
                const res = await fetch('/api/dashboard/send', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        phone: currentPhone,
                        message: message,
                        role: 'agent',
                        send_via_meta: true
                    })
                });

                const data = await res.json();
                if (res.ok) {
                    closePromoModal();
                    await loadMessages(true);
                    fetchData(true);
                } else {
                    alert('Error sending promo: ' + (data.error || 'Failed to send message'));
                }
            } catch (err) {
                alert('Failed to send promo: ' + err.message);
            } finally {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-paper-plane mr-1"></i> Send Free Promo Now (₹0)';
            }
        }

        // Live 1-second countdown ticker for free window remaining time
        setInterval(() => {
            if (allConversations && allConversations.length > 0) {
                allConversations.forEach(c => {
                    if (c.free_window_remaining_seconds > 0) {
                        c.free_window_remaining_seconds -= 1;
                        if (c.free_window_remaining_seconds <= 0) {
                            c.free_window_active = false;
                        }
                    }
                });
            }
            if (currentPhone && allConversations) {
                const activeConv = allConversations.find(c => c.phone_number === currentPhone);
                if (activeConv) updateActiveFreeWindowUI(activeConv);
            }
        }, 1000);

        // Initialize & Auto Poll every 3 seconds when authenticated
        bootstrapAuthAndDashboard();
        setInterval(() => {
            if (isAuthenticated) fetchData(false);
        }, 3000);
