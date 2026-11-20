
// ====================================================================
// MOBILE RESPONSIVENESS HELPERS
// ====================================================================
function showMobileChat() {
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
    const paneList = document.getElementById('pane-conversations');
    const paneChat = document.getElementById('pane-chat');
    if (window.innerWidth >= 768) {
        if (paneList) {
            paneList.classList.remove('hidden');
            paneList.classList.add('flex');
        }
        if (paneChat) {
            paneChat.classList.remove('hidden');
            paneChat.classList.add('flex');
        }
    } else {
        if (currentPhone) {
            if (paneList) { paneList.classList.add('hidden'); paneList.classList.remove('flex'); }
            if (paneChat) { paneChat.classList.remove('hidden'); paneChat.classList.add('flex'); }
        } else {
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
        let activeTab = 'chats';

        document.getElementById('webhook-full-url').innerText = window.location.origin + '/api/webhook';

        function switchTab(tab) {
            activeTab = tab;
            ['chats', 'analytics', 'testai', 'templates', 'bookings', 'webhooks'].forEach(t => {
                const view = document.getElementById('view-' + t);
                const btn = document.getElementById('tab-btn-' + t);
                if (view && btn) {
                    if (t === tab) {
                        view.classList.remove('hidden');
                        btn.className = 'px-3.5 py-2 rounded-lg bg-white text-emerald-700 font-bold shadow-sm transition flex items-center space-x-1.5 flex-shrink-0';
                    } else {
                        view.classList.add('hidden');
                        btn.className = 'px-3.5 py-2 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-white/60 transition flex items-center space-x-1.5 flex-shrink-0';
                    }
                }
            });

            if (tab === 'templates') fetchTemplates();
            if (tab === 'bookings') fetchBookings();
            if (tab === 'webhooks') fetchWebhooks();
        }

        async function fetchData(manual = false) {
            const refreshIcon = document.getElementById('refresh-icon');
            if (manual) refreshIcon.classList.add('fa-spin');

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
                    if (engineEl) engineEl.innerText = stats.groq_configured ? stats.groq_model : 'printingtask AI';

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

                    // Update 24h Free Window filter counts & badges
                    const countAllEl = document.getElementById('count-filter-all');
                    const countActiveEl = document.getElementById('count-filter-active');
                    const countExpiredEl = document.getElementById('count-filter-expired');
                    const activeCount = allConversations.filter(c => c.is_free_window_active).length;
                    if (countAllEl) countAllEl.innerText = allConversations.length;
                    if (countActiveEl) countActiveEl.innerText = activeCount;
                    if (countExpiredEl) countExpiredEl.innerText = allConversations.length - activeCount;

                    const statActiveWinsEl = document.getElementById('stat-active-windows');
                    if (statActiveWinsEl) statActiveWinsEl.innerText = activeCount;

                    const promoActiveCountLabel = document.getElementById('promo-active-count-label');
                    if (promoActiveCountLabel) promoActiveCountLabel.innerText = activeCount;

                    filterConversations();

                    // Update current chat window badge if chat is open
                    if (currentPhone) {
                        const activeConv = allConversations.find(c => c.phone_number === currentPhone);
                        updateChatWindowBadge(activeConv);
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

        function formatWindowTime(seconds) {
            if (!seconds || seconds <= 0) return 'Expired';
            const hrs = Math.floor(seconds / 3600);
            const mins = Math.floor((seconds % 3600) / 60);
            if (hrs > 0) return `${hrs}h ${mins}m`;
            return `${mins}m`;
        }

        let activeMetaConv = null;

        function updateChatWindowBadge(conv, metaConv) {
            const badgeEl = document.getElementById('chat-window-badge');
            const bannerEl = document.getElementById('chat-context-window-banner');
            const hintEl = document.getElementById('composer-window-hint');

            const info = metaConv || conv || {};
            const isActive = Boolean(info.is_free_window_active && info.free_window_seconds_left > 0);
            const hasInbound = Boolean((info.inbound_count && info.inbound_count > 0) || info.last_inbound_time);
            const secsLeft = Number(info.free_window_seconds_left || 0);
            const remainingTime = formatWindowTime(secsLeft);
            const category = (info.pricing_category || 'service').toUpperCase();
            const isFreeTier = !info.is_billable;
            const metaConvId = info.meta_conversation_id || (conv && conv.meta_conversation_id);

            // 1. Header Badge
            if (badgeEl) {
                if (isActive) {
                    badgeEl.classList.remove('hidden');
                    badgeEl.innerHTML = `
                        <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200" title="24h Free Context Window Active: You can send promotional offers, quotes, or replies for ₹0!">
                            <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5 animate-pulse"></span>
                            <span>🟢 24h Free Window: <strong class="ml-1">${remainingTime}</strong></span>
                            <span class="ml-1 text-emerald-600 font-normal hidden sm:inline">(₹0 Meta Fee)</span>
                        </span>
                    `;
                } else if (hasInbound) {
                    badgeEl.classList.remove('hidden');
                    badgeEl.innerHTML = `
                        <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-500 border border-slate-200" title="24-hour service window expired. Sending messages requires an approved Meta template.">
                            <i class="fas fa-clock mr-1 text-slate-400 text-[9px]"></i>
                            <span>24h Window Expired</span>
                        </span>
                    `;
                } else {
                    badgeEl.classList.add('hidden');
                    badgeEl.innerHTML = '';
                }
            }

            // 2. Chat Context Window Banner (Directly under header)
            if (bannerEl) {
                if (isActive) {
                    bannerEl.classList.remove('hidden');
                    const convIdDisplay = metaConvId ? `<span class="text-[10px] text-emerald-800 font-mono ml-2 hidden sm:inline" title="Meta Conversation ID: ${escapeHtml(metaConvId)}">Meta ID: ${escapeHtml(metaConvId.substring(0, 16))}...</span>` : '';
                    bannerEl.innerHTML = `
                        <div class="px-3.5 py-2 bg-gradient-to-r from-emerald-50 via-teal-50 to-emerald-50 border-b border-emerald-200 text-xs flex items-center justify-between shadow-xs">
                            <div class="flex items-center space-x-2.5 min-w-0">
                                <div class="w-7 h-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center font-bold text-xs flex-shrink-0 shadow-xs">
                                    <i class="fas fa-lock-open text-[11px]"></i>
                                </div>
                                <div class="min-w-0">
                                    <div class="flex items-center space-x-1.5 flex-wrap">
                                        <span class="font-extrabold text-emerald-950 text-xs">24-Hour Free Context Window OPEN</span>
                                        <span class="px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-emerald-200 text-emerald-900 uppercase tracking-tight">${isFreeTier ? '₹0 Free Tier' : category}</span>
                                        ${convIdDisplay}
                                    </div>
                                    <p class="text-[11px] text-emerald-800 mt-0.5 truncate">
                                        Free-form replies allowed • Time remaining: <strong class="font-mono font-extrabold text-emerald-950 ml-1" id="banner-countdown">${remainingTime}</strong>
                                    </p>
                                </div>
                            </div>
                            <div class="flex items-center space-x-1.5 flex-shrink-0 ml-2">
                                <button type="button" onclick="openPromoModal('current')" class="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[11px] font-bold shadow-xs transition flex items-center space-x-1" title="Send a free promotional offer or quote inside this 24h window">
                                    <i class="fas fa-bullhorn text-[10px]"></i>
                                    <span class="hidden sm:inline">Send Promo (₹0)</span>
                                </button>
                            </div>
                        </div>
                    `;
                } else if (hasInbound) {
                    bannerEl.classList.remove('hidden');
                    bannerEl.innerHTML = `
                        <div class="px-3.5 py-2 bg-slate-100/90 border-b border-slate-200 text-xs flex items-center justify-between shadow-xs">
                            <div class="flex items-center space-x-2.5 min-w-0">
                                <div class="w-7 h-7 rounded-lg bg-slate-300 text-slate-700 flex items-center justify-center font-bold text-xs flex-shrink-0">
                                    <i class="fas fa-lock text-[11px]"></i>
                                </div>
                                <div class="min-w-0">
                                    <div class="flex items-center space-x-1.5 flex-wrap">
                                        <span class="font-extrabold text-slate-800 text-xs">24-Hour Free Context Window EXPIRED</span>
                                        <span class="px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-amber-100 text-amber-800 uppercase">Template Required</span>
                                    </div>
                                    <p class="text-[11px] text-slate-500 mt-0.5 truncate">
                                        Meta restricts free-form messages outside 24h. Send an approved template or wait for customer to message.
                                    </p>
                                </div>
                            </div>
                            <div class="flex items-center space-x-1.5 flex-shrink-0 ml-2">
                                <button type="button" onclick="openTemplateSelectorModal()" class="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[11px] font-bold shadow-xs transition flex items-center space-x-1" title="Select Meta-approved template">
                                    <i class="fas fa-layer-group text-[10px]"></i>
                                    <span>Send Template</span>
                                </button>
                            </div>
                        </div>
                    `;
                } else {
                    bannerEl.classList.add('hidden');
                    bannerEl.innerHTML = '';
                }
            }

            // 3. Composer Window Hint (Above Reply Input Box)
            if (hintEl) {
                if (isActive) {
                    hintEl.classList.remove('hidden');
                    hintEl.className = 'mb-1.5 px-2.5 py-1 rounded-xl text-[11px] font-semibold flex items-center justify-between bg-emerald-50 text-emerald-800 border border-emerald-200';
                    hintEl.innerHTML = `
                        <div class="flex items-center space-x-1.5 truncate">
                            <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                            <span class="truncate"><strong>24h Free Window Active:</strong> Free-form replies permitted at ₹0 Meta fees</span>
                        </div>
                        <span class="font-mono font-bold text-[10px] text-emerald-700 ml-2 flex-shrink-0">${remainingTime} left</span>
                    `;
                } else if (hasInbound) {
                    hintEl.classList.remove('hidden');
                    hintEl.className = 'mb-1.5 px-2.5 py-1 rounded-xl text-[11px] font-semibold flex items-center justify-between bg-amber-50 text-amber-800 border border-amber-200';
                    hintEl.innerHTML = `
                        <div class="flex items-center space-x-1.5 truncate">
                            <i class="fas fa-triangle-exclamation text-amber-600 text-[10px]"></i>
                            <span class="truncate"><strong>Window Expired:</strong> Meta charges for outbound templates outside 24h window</span>
                        </div>
                        <button type="button" onclick="openTemplateSelectorModal()" class="underline font-bold text-[10px] ml-2 flex-shrink-0 text-amber-800 hover:text-amber-900">Use Template</button>
                    `;
                } else {
                    hintEl.classList.add('hidden');
                    hintEl.innerHTML = '';
                }
            }
        }

        function renderConversations(list) {
            const container = document.getElementById('conversations-container');
            if (!list || list.length === 0) {
                container.innerHTML = `
                    <div class="p-8 text-center text-slate-400 text-xs">
                        <i class="far fa-comments text-2xl mb-2 text-slate-300 block"></i>
                        No conversations found in this filter.<br/>
                        <button onclick="setWindowFilter('all')" class="mt-2 text-emerald-600 font-bold hover:underline">View all conversations</button>
                    </div>
                `;
                return;
            }

            container.innerHTML = list.map(c => {
                const isActive = c.phone_number === currentPhone;
                const activeClass = isActive ? 'bg-emerald-50/80 border-l-4 border-emerald-600' : 'hover:bg-slate-100/70';
                const isOutbound = c.last_direction === 'outbound';
                const dirIcon = isOutbound ? '<i class="fas fa-check-double text-emerald-600 mr-1 text-[10px]"></i>' : '';
                const avatarBg = getAvatarColor(c.phone_number);
                const isBotActive = c.bot_enabled !== 0 && c.bot_enabled !== false;
                const botBadge = isBotActive
                    ? '<span class="text-[9px] bg-emerald-100 text-emerald-700 font-bold px-1.5 py-0.2 rounded" title="AI Bot is auto-replying">AI</span>'
                    : '<span class="text-[9px] bg-amber-100 text-amber-800 font-bold px-1.5 py-0.2 rounded" title="Human Agent (AI paused)">Agent</span>';

                const isFreeActive = c.is_free_window_active && c.free_window_seconds_left > 0;
                const windowBadge = isFreeActive
                    ? `<span class="inline-flex items-center text-[9px] bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold px-1.5 py-0.2 rounded-full" title="24h Free Customer Service Window Active - Free to send promotional offers for ₹0"><span class="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1 animate-pulse"></span>24h Free: ${formatWindowTime(c.free_window_seconds_left)}</span>`
                    : (c.inbound_count > 0
                        ? `<span class="inline-flex items-center text-[9px] bg-slate-100 text-slate-400 font-medium px-1.5 py-0.2 rounded" title="24h window expired - Meta requires paid template"><i class="fas fa-clock mr-0.5 text-[8px]"></i>Expired</span>`
                        : '');

                return `
                    <div onclick="selectChat('${c.phone_number}', '${escapeHtml(c.sender_name)}', '${c.last_channel}')" 
                         class="group p-3.5 cursor-pointer transition flex items-center space-x-3 ${activeClass}">
                        <div onclick="event.stopPropagation(); openContactProfileModal('${c.phone_number}')" 
                             class="w-10 h-10 rounded-full ${avatarBg} flex items-center justify-center text-white font-bold text-xs flex-shrink-0 shadow-sm cursor-pointer hover:ring-2 hover:ring-emerald-400 hover:scale-105 transition"
                             title="Click icon to view customer info & photos">
                            ${getInitials(c.sender_name || c.phone_number)}
                        </div>
                        <div class="flex-1 min-w-0">
                            <div class="flex items-center justify-between">
                                <div class="flex items-center space-x-1.5 truncate">
                                    <h4 class="text-xs font-bold text-slate-900 truncate">${escapeHtml(c.sender_name || c.phone_number)}</h4>
                                    ${botBadge}
                                    ${windowBadge}
                                </div>
                                <span class="text-[10px] text-slate-400 font-mono">${formatTime(c.last_time)}</span>
                            </div>
                            <div class="flex items-center justify-between mt-0.5">
                                <p class="text-xs text-slate-500 truncate max-w-[170px]">
                                    ${dirIcon}${escapeHtml(c.last_message || '')}
                                </p>
                                <div class="flex items-center space-x-1 flex-shrink-0">
                                    <span class="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-200/80 text-slate-600 font-mono font-bold">${c.total_messages}</span>
                                    <button onclick="event.stopPropagation(); deleteChatByPhone('${c.phone_number}', '${escapeHtml(c.sender_name || c.phone_number)}')" title="Delete conversation" class="opacity-0 group-hover:opacity-100 hover:text-red-600 p-0.5 rounded hover:bg-red-50 text-slate-400 transition ml-1">
                                        <i class="fas fa-trash text-[11px]"></i>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        }

        async function selectChat(phone, name, channel) {
            currentPhone = phone;
            currentContactName = name || phone;
            toggleSelectMode(false);
            document.getElementById('active-name').innerText = currentContactName;
            document.getElementById('active-phone').innerText = phone;
            document.getElementById('active-avatar').innerHTML = getInitials(name || phone);
            document.getElementById('active-avatar').className = `w-10 h-10 rounded-full ${getAvatarColor(phone)} flex items-center justify-center text-white font-bold shadow-sm text-sm`;
            
            const badge = document.getElementById('active-channel-badge');
            badge.classList.remove('hidden');
            badge.innerText = (channel || 'WHATSAPP').toUpperCase().replace('_', ' ');

            document.getElementById('select-mode-btn')?.classList.remove('hidden');
            document.getElementById('delete-chat-btn')?.classList.remove('hidden');
            document.getElementById('book-lead-btn')?.classList.remove('hidden');
            document.getElementById('send-promo-btn')?.classList.remove('hidden');
            document.getElementById('bot-toggle-container')?.classList.remove('hidden');
            document.getElementById('ai-reply-btn')?.classList.remove('hidden');

            const menuBtn = document.getElementById('chat-actions-menu-btn');
            if (menuBtn) menuBtn.classList.remove('hidden');

            // Update chat header 24h free window badge
            const conv = allConversations.find(x => x.phone_number === phone);
            updateChatWindowBadge(conv);

            filterConversations();
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

        async function loadMessages(shouldScroll = true) {
            if (!currentPhone) return;
            try {
                const res = await fetch(`/api/dashboard/messages?phone=${encodeURIComponent(currentPhone)}`);
                if (res.ok) {
                    const data = await res.json();
                    const isBotActive = data.bot_enabled !== false;
                    updateBotStatusPill(isBotActive);
                    if (!isBotActive) {
                        const agentRadio = document.getElementById('role-agent');
                        if (agentRadio) agentRadio.checked = true;
                    }
                    if (data.meta_conversation) {
                        activeMetaConv = data.meta_conversation;
                        const activeConv = allConversations.find(c => c.phone_number === currentPhone);
                        updateChatWindowBadge(activeConv, data.meta_conversation);
                    }
                    renderMessages(data.messages || [], shouldScroll);
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

        function renderMessages(messages, shouldScroll = true) {
            const container = document.getElementById('messages-container');
            setupScrollListener();
            if (messages.length === 0) {
                container.innerHTML = `<div class="h-full flex items-center justify-center text-slate-500 text-xs">No messages in this chat yet.</div>`;
                lastRenderedCount = 0;
                return;
            }

            const countChanged = messages.length !== lastRenderedCount;
            const wasScrolledUp = isUserScrolledUp;
            lastRenderedCount = messages.length;

            container.innerHTML = messages.map(m => {
                const isOutbound = m.direction === 'outbound';
                const isLatestInbound = !isOutbound && Boolean(m.is_latest_inbound);
                const alignment = isOutbound ? 'justify-end' : 'justify-start';
                const bubbleBg = isOutbound 
                    ? 'bg-[#d9fdd3] text-slate-900 border border-emerald-200/50 rounded-tr-sm' 
                    : (isLatestInbound 
                        ? 'bg-gradient-to-br from-white via-emerald-50/60 to-white text-slate-900 border-2 border-emerald-500 shadow-md shadow-emerald-500/10 ring-2 ring-emerald-400/25 rounded-tl-sm' 
                        : 'bg-white text-slate-900 border border-slate-200/80 rounded-tl-sm');
                const senderLabel = isOutbound ? (m.sender_name || 'Support Agent') : escapeHtml(m.sender_name || 'Customer');
                const engineTag = m.ai_model ? `<span class="text-[9px] px-1.5 py-0.2 bg-emerald-100 text-emerald-800 rounded font-bold mr-1"><i class="fas fa-robot mr-1"></i>${escapeHtml(m.ai_model)}</span>` : '';
                const triggerBtn = !isOutbound ? `<button onclick="triggerAiReplyForPrompt('${escapeHtml(m.message)}')" title="Generate AI Reply to this" class="ml-2 text-[10px] text-emerald-600 hover:text-emerald-800 font-bold underline"><i class="fas fa-wand-magic-sparkles mr-0.5"></i>AI Reply</button>` : '';

                const windowRenewalBanner = isLatestInbound ? `
                    <div class="flex items-center space-x-1.5 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-950 text-[10px] font-extrabold w-fit mb-1 border border-emerald-300 shadow-xs">
                        <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                        <span>🟢 24h Free Context Window Renewed</span>
                        <span class="text-emerald-700 font-semibold text-[9px] hidden sm:inline">• Free-Form Active (₹0 Fee)</span>
                    </div>
                ` : '';

                const isChecked = selectedMessageIds.has(m.id);
                const selectCheckbox = isSelectMode ? `
                    <div class="flex items-center self-center ${isOutbound ? 'order-2 pl-2.5' : 'order-1 pr-2.5'}">
                        <input type="checkbox" class="msg-select-cb w-4 h-4 rounded text-emerald-600 focus:ring-0 cursor-pointer" data-id="${m.id}" ${isChecked ? 'checked' : ''} onchange="handleMessageSelectToggle(${m.id})">
                    </div>
                ` : '';

                const singleDeleteBtn = !isSelectMode ? `
                    <button onclick="deleteSingleMessage(${m.id})" title="Delete message" class="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-500 transition text-[11px] ml-1.5 p-0.5">
                        <i class="fas fa-trash"></i>
                    </button>
                ` : '';

                let mediaBlock = '';
                if (m.media_type === 'image' && m.media_url) {
                    mediaBlock = `
                        <div class="mb-1.5 overflow-hidden rounded-xl border border-slate-200/60 max-w-[280px]">
                            <a href="${m.media_url}" target="_blank" title="Click to view full image">
                                <img src="${m.media_url}" class="w-full h-auto max-h-64 object-cover hover:opacity-95 transition rounded-xl" loading="lazy" />
                            </a>
                        </div>
                    `;
                } else if (m.media_type === 'document' && m.media_url) {
                    const docName = escapeHtml(m.media_filename || 'Document.pdf');
                    mediaBlock = `
                        <div class="mb-1.5 p-2.5 bg-white/95 rounded-xl border border-slate-200/80 flex items-center justify-between space-x-3 max-w-[280px] shadow-xs">
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
                            <div class="flex items-center justify-between">
                                <span class="text-[11px] font-extrabold ${isOutbound ? 'text-emerald-700' : 'text-slate-700'}">${senderLabel}</span>
                                <div class="flex items-center">
                                    ${triggerBtn}
                                    ${singleDeleteBtn}
                                </div>
                            </div>
                            ${windowRenewalBanner}
                            ${mediaBlock}
                            ${m.message ? `<div class="whitespace-pre-wrap leading-relaxed text-[13px]">${escapeHtml(m.message)}</div>` : ''}
                            <div class="flex items-center justify-end space-x-1.5 pt-0.5 text-[10px] text-slate-500">
                                ${engineTag}
                                <span>${formatTime(m.created_at)}</span>
                                ${isOutbound ? '<i class="fas fa-check-double text-emerald-600 text-[10px]"></i>' : ''}
                            </div>
                        </div>
                    </div>
                `;
            }).join('');

            // Smart scrolling:
            // 1. If explicit scroll requested (shouldScroll == true, e.g. chat clicked or message sent): scroll to bottom
            // 2. If already at bottom and new messages arrived: auto-scroll to bottom
            // 3. If user scrolled up reading history: preserve their scroll position & show badge on down button
            if (shouldScroll || (!wasScrolledUp && countChanged)) {
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
            await fetch('/api/dashboard/trigger-ai-reply', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: currentPhone })
            });
            fetchData(true);
        }

        async function triggerAiReplyForPrompt(prompt) {
            if (!currentPhone) return;
            await fetch('/api/dashboard/trigger-ai-reply', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: currentPhone, prompt: prompt })
            });
            fetchData(true);
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
                    await fetchData(true);
                } else {
                    const err = await res.json();
                    alert("Error: " + (err.error || 'Failed to send message'));
                }
            } catch (err) {
                alert("Network error: " + err.message);
            } finally {
                input.disabled = false;
                btn.disabled = false;
                input.focus();
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

        function renderQuickTemplates() {
            const bar = document.getElementById('quick-templates-bar');
            bar.innerHTML = allTemplates.slice(0, 4).map(t => `
                <button onclick="applyTemplate('${escapeHtml(t.content)}')" class="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-medium border border-slate-200 flex-shrink-0 transition truncate max-w-[160px]">
                    ${escapeHtml(t.title)}
                </button>
            `).join('');
        }

        function renderTemplatesGrid() {
            const grid = document.getElementById('templates-grid');
            if (!allTemplates.length) {
                grid.innerHTML = `<div class="p-8 text-center text-slate-400 col-span-3">No templates created yet.</div>`;
                return;
            }
            grid.innerHTML = allTemplates.map(t => `
                <div class="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex flex-col justify-between space-y-3 hover:shadow-sm transition">
                    <div>
                        <div class="flex items-center justify-between">
                            <h4 class="font-bold text-slate-900 text-sm">${escapeHtml(t.title)}</h4>
                            <span class="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-[10px] font-bold">${escapeHtml(t.category)}</span>
                        </div>
                        <p class="text-xs text-slate-600 whitespace-pre-wrap mt-2.5 leading-relaxed bg-white p-3 rounded-xl border border-slate-200">${escapeHtml(t.content)}</p>
                    </div>
                    <div class="flex items-center justify-between pt-2 border-t border-slate-200/80">
                        <button onclick="applyTemplate('${escapeHtml(t.content)}'); switchTab('chats');" class="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition">
                            <i class="fas fa-paper-plane mr-1"></i> Use Template
                        </button>
                        <button onclick="deleteTemplate(${t.id})" class="text-slate-400 hover:text-red-500 p-1 transition"><i class="fas fa-trash"></i></button>
                    </div>
                </div>
            `).join('');
        }

        function renderTemplatePicker() {
            const list = document.getElementById('template-picker-list');
            list.innerHTML = allTemplates.map(t => `
                <div onclick="applyTemplate('${escapeHtml(t.content)}'); closeTemplateSelectorModal();" class="p-3.5 bg-slate-50 hover:bg-emerald-50 rounded-2xl border border-slate-200 cursor-pointer transition">
                    <div class="flex items-center justify-between">
                        <h4 class="font-bold text-slate-900">${escapeHtml(t.title)}</h4>
                        <span class="text-[10px] font-bold text-slate-500">${escapeHtml(t.category)}</span>
                    </div>
                    <p class="text-xs text-slate-600 mt-1.5 truncate">${escapeHtml(t.content)}</p>
                </div>
            `).join('');
        }

        function applyTemplate(rawContent) {
            let replaced = rawContent
                .replace(/\{\{name\}\}/g, currentContactName || 'Customer')
                .replace(/\{\{phone\}\}/g, currentPhone || '')
                .replace(/\{\{date_time\}\}/g, 'Tomorrow at 2:00 PM')
                .replace(/\{\{service\}\}/g, 'Printing & Task Service');
            
            document.getElementById('role-agent').checked = true;
            document.getElementById('reply-input').value = replaced;
            document.getElementById('reply-input').focus();
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
                        <div class="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-1.5">
                            <div class="flex items-center justify-between font-mono text-xs">
                                <div class="flex items-center space-x-2">
                                    <span class="px-2 py-0.5 rounded-lg ${l.method === 'POST' ? 'bg-blue-100 text-blue-800' : 'bg-emerald-100 text-emerald-800'} font-bold">${l.method}</span>
                                    <span class="text-slate-800 font-bold">${l.endpoint}</span>
                                </div>
                                <span class="text-slate-400 text-[11px]">${l.created_at}</span>
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
                const res = await fetch('/api/dashboard/simulate-inbound', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phone, name, message: msg, auto_reply: autoReply })
                });

                if (res.ok) {
                    closeSimulateModal();
                    currentPhone = phone;
                    currentContactName = name;
                    await fetchData(true);
                }
            } catch (err) {
                alert("Simulation error: " + err.message);
            } finally {
                btn.disabled = false;
                btn.innerHTML = `<i class="fas fa-paper-plane"></i> <span>Send & Reply</span>`;
            }
        }

        // Settings Modal
        async function openSettingsModal() {
            document.getElementById('settings-modal').classList.remove('hidden');
            const res = await fetch('/api/dashboard/settings');
            if (res.ok) {
                const s = await res.json();
                if (s.groq_api_key_set) document.getElementById('set-groq-key').placeholder = `Configured: ${s.groq_api_key_masked}`;
                document.getElementById('set-groq-model').value = s.groq_model || 'llama-3.3-70b-versatile';
                if (s.whatsapp_token_set) document.getElementById('set-meta-token').placeholder = `Configured: ${s.whatsapp_token_masked}`;
                document.getElementById('set-meta-phone-id').value = s.whatsapp_phone_number_id || '';
                document.getElementById('set-meta-verify-token').value = s.whatsapp_verify_token || 'whatsapp_groq_bot_secret_123';
                document.getElementById('webhook-token-label').innerText = s.whatsapp_verify_token || 'whatsapp_groq_bot_secret_123';
            }
        }

        function closeSettingsModal() { document.getElementById('settings-modal').classList.add('hidden'); }

        async function handleSettingsSubmit(e) {
            e.preventDefault();
            const groqKey = document.getElementById('set-groq-key').value.trim();
            const groqModel = document.getElementById('set-groq-model').value;
            const metaToken = document.getElementById('set-meta-token').value.trim();
            const phoneId = document.getElementById('set-meta-phone-id').value.trim();
            const verifyToken = document.getElementById('set-meta-verify-token').value.trim();
            const btn = document.getElementById('save-settings-btn');

            btn.disabled = true;
            btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Saving...`;

            try {
                const res = await fetch('/api/dashboard/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        groq_api_key: groqKey,
                        groq_model: groqModel,
                        whatsapp_token: metaToken,
                        whatsapp_phone_number_id: phoneId,
                        whatsapp_verify_token: verifyToken
                    })
                });
                if (res.ok) {
                    closeSettingsModal();
                    alert("Settings saved successfully!");
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

            const selectBtn = document.getElementById('select-mode-btn');
            const selectionBar = document.getElementById('selection-bar');

            if (isSelectMode) {
                if (selectionBar) selectionBar.classList.remove('hidden');
                if (selectBtn) selectBtn.classList.add('bg-emerald-100', 'text-emerald-800', 'border-emerald-300');
            } else {
                if (selectionBar) selectionBar.classList.add('hidden');
                if (selectBtn) selectBtn.classList.remove('bg-emerald-100', 'text-emerald-800', 'border-emerald-300');
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
                                <h3 class="text-sm font-bold text-slate-700">printingtask Support Inbox</h3>
                                <p class="text-xs text-slate-500 max-w-sm mt-1">Select a customer or type below to test chatting with the AI Support Bot.</p>
                            </div>
                        `;
                        document.getElementById('select-mode-btn')?.classList.add('hidden');
                        document.getElementById('delete-chat-btn')?.classList.add('hidden');
                        document.getElementById('book-lead-btn')?.classList.add('hidden');
                        document.getElementById('send-promo-btn')?.classList.add('hidden');
                        document.getElementById('bot-toggle-container')?.classList.add('hidden');
                        document.getElementById('ai-reply-btn')?.classList.add('hidden');
                        const headerBadge = document.getElementById('chat-window-badge');
                        if (headerBadge) { headerBadge.classList.add('hidden'); headerBadge.innerHTML = ''; }
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

        let currentWindowFilter = 'all'; // 'all', 'active', 'expired'

        function setWindowFilter(filter) {
            currentWindowFilter = filter;
            const btnAll = document.getElementById('filter-btn-all');
            const btnActive = document.getElementById('filter-btn-active');
            const btnExpired = document.getElementById('filter-btn-expired');

            const activeClass = 'flex-1 py-1 px-1.5 rounded-lg bg-emerald-600 text-white font-bold text-center transition';
            const inactiveClass = 'flex-1 py-1 px-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-center transition';

            if (btnAll) btnAll.className = filter === 'all' ? activeClass : inactiveClass;
            if (btnActive) btnActive.className = filter === 'active' ? activeClass : (inactiveClass + ' flex items-center justify-center space-x-1');
            if (btnExpired) btnExpired.className = filter === 'expired' ? activeClass : inactiveClass;

            filterConversations();
        }

        function filterConversations() {
            const searchEl = document.getElementById('search-input');
            const q = searchEl ? searchEl.value.toLowerCase().trim() : '';

            const filtered = allConversations.filter(c => {
                if (currentWindowFilter === 'active' && !c.is_free_window_active) return false;
                if (currentWindowFilter === 'expired' && c.is_free_window_active) return false;

                if (!q) return true;
                return (c.phone_number && c.phone_number.toLowerCase().includes(q)) ||
                       (c.sender_name && c.sender_name.toLowerCase().includes(q)) ||
                       (c.last_message && c.last_message.toLowerCase().includes(q));
            });
            renderConversations(filtered);
        }

        // ====================================================================
        // PROMOTIONAL OFFER & FREE WINDOW BROADCAST MODAL
        // ====================================================================
        function openPromoModal(targetMode = 'current') {
            const modal = document.getElementById('promo-broadcast-modal');
            if (!modal) return;
            modal.classList.remove('hidden');

            const currentRadio = document.getElementById('promo-target-current');
            const allRadio = document.getElementById('promo-target-all');
            const currentLabel = document.getElementById('promo-current-name-label');
            const activeCountLabel = document.getElementById('promo-active-count-label');

            const activeConvs = allConversations.filter(c => c.is_free_window_active);
            if (activeCountLabel) activeCountLabel.innerText = activeConvs.length;

            if (currentLabel) {
                currentLabel.innerText = currentContactName ? `${currentContactName} (${currentPhone || ''})` : 'No customer selected';
            }

            if (targetMode === 'broadcast' || !currentPhone) {
                if (allRadio) allRadio.checked = true;
            } else {
                if (currentRadio) currentRadio.checked = true;
            }

            const input = document.getElementById('promo-message-input');
            if (input && !input.value.trim()) {
                applyPromoTemplate('discount');
            }
        }

        function closePromoModal() {
            const modal = document.getElementById('promo-broadcast-modal');
            if (modal) modal.classList.add('hidden');
        }

        const promoTemplates = {
            discount: "Hello {{name}}! 🎉 As our valued customer, enjoy an exclusive 20% OFF on all your printing & binding orders with printingtask this week! Reply 'CLAIM' to avail this special offer today.",
            cards: "Hi {{name}}! ⚡ Flash Deal today at printingtask: Get 1,000 Premium Matte Visiting Cards starting at just ₹499/- with free design check & express delivery. Reply here to place your order!",
            flyers: "Hi {{name}}! 📄 Need high-impact marketing prints? We offer wholesale rates on HD Flyers, Booklets, Brochures, and Roll-up Standees. Reply with your quantities for an instant quote!"
        };

        function applyPromoTemplate(type) {
            const tpl = promoTemplates[type];
            const input = document.getElementById('promo-message-input');
            if (tpl && input) {
                input.value = tpl;
                input.focus();
            }
        }

        async function handleSendPromoSubmit(e) {
            e.preventDefault();
            const input = document.getElementById('promo-message-input');
            const msg = input ? input.value.trim() : '';
            if (!msg) {
                alert("Please enter a promotional message to send.");
                return;
            }

            const targetVal = document.querySelector('input[name="promo_target"]:checked')?.value || 'current';
            const submitBtn = document.getElementById('promo-submit-btn');

            if (targetVal === 'current') {
                if (!currentPhone) {
                    alert("Please select a customer first or choose 'All 24h Free Windows'.");
                    return;
                }
                const personalizedMsg = msg.replace(/\{\{name\}\}/g, currentContactName || 'Customer');

                if (submitBtn) {
                    submitBtn.disabled = true;
                    submitBtn.innerHTML = `<i class="fas fa-spinner fa-spin mr-1"></i> Sending Promo...`;
                }

                try {
                    const res = await fetch('/api/dashboard/send', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            phone: currentPhone,
                            name: currentContactName,
                            message: personalizedMsg,
                            role: 'agent',
                            send_via_meta: true
                        })
                    });

                    if (res.ok) {
                        closePromoModal();
                        alert(`🎉 Promotional offer sent to ${currentContactName || currentPhone} for ₹0!`);
                        await fetchData(true);
                    } else {
                        const err = await res.json();
                        alert("Error sending promo: " + (err.error || 'Server error'));
                    }
                } catch (err) {
                    alert("Network error: " + err.message);
                } finally {
                    if (submitBtn) {
                        submitBtn.disabled = false;
                        submitBtn.innerHTML = `<i class="fas fa-paper-plane text-xs"></i> <span>Send Promo Now</span>`;
                    }
                }
            } else {
                const activeConvs = allConversations.filter(c => c.is_free_window_active);
                if (activeConvs.length === 0) {
                    alert("No customers with an active 24-hour free window right now. Customers must message you first to activate the free window.");
                    return;
                }

                if (!confirm(`Broadcast this promotional offer to ${activeConvs.length} customer(s) in their 24h free window for ₹0 Meta fees?`)) {
                    return;
                }

                if (submitBtn) {
                    submitBtn.disabled = true;
                    submitBtn.innerHTML = `<i class="fas fa-spinner fa-spin mr-1"></i> Broadcasting (${activeConvs.length})...`;
                }

                try {
                    const res = await fetch('/api/dashboard/broadcast-promo', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            message: msg,
                            phones: "all_active",
                            send_via_meta: true
                        })
                    });

                    const data = await res.json();
                    if (res.ok && data.success) {
                        closePromoModal();
                        const moneySaved = (data.sent_count * 0.80).toFixed(2);
                        alert(`🚀 Broadcast complete! Sent offer to ${data.sent_count} active customers.\n💰 Meta Fee Saved: ~₹${moneySaved} (100% Free)`);
                        await fetchData(true);
                    } else {
                        alert("Broadcast error: " + (data.error || 'Failed to send broadcast'));
                    }
                } catch (err) {
                    alert("Network error: " + err.message);
                } finally {
                    if (submitBtn) {
                        submitBtn.disabled = false;
                        submitBtn.innerHTML = `<i class="fas fa-paper-plane text-xs"></i> <span>Send Promo Now</span>`;
                    }
                }
            }
        }

        function formatTime(isoStr) {
            if (!isoStr) return '';
            try {
                const d = new Date(isoStr.replace(' ', 'T') + 'Z');
                return isNaN(d.getTime()) ? isoStr : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            } catch { return isoStr; }
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

        // ====================================================================
        // CUSTOMER PROFILE & INFORMATION MODAL
        // ====================================================================
        let activeProfilePhone = null;

        async function openContactProfileModal(phone) {
            phone = phone || currentPhone;
            if (!phone) {
                alert("Please select a customer first.");
                return;
            }
            activeProfilePhone = phone;

            const modal = document.getElementById('contact-profile-modal');
            if (modal) modal.classList.remove('hidden');

            const localConv = allConversations.find(c => c.phone_number === phone);
            const nameEl = document.getElementById('prof-name');
            const phoneEl = document.getElementById('prof-phone');
            const avatarEl = document.getElementById('prof-avatar');
            const channelBadge = document.getElementById('prof-channel-badge');
            const waLink = document.getElementById('prof-wa-link');

            const initName = (localConv ? localConv.sender_name : currentContactName) || 'Customer';
            if (nameEl) nameEl.innerText = initName;
            if (phoneEl) phoneEl.innerText = phone;
            if (avatarEl) {
                avatarEl.className = `w-12 h-12 rounded-2xl ${getAvatarColor(phone)} text-white font-extrabold flex items-center justify-center text-lg shadow-md flex-shrink-0`;
                avatarEl.innerHTML = getInitials(initName || phone);
            }
            if (channelBadge) {
                channelBadge.innerText = (localConv?.last_channel || 'WHATSAPP').toUpperCase().replace('_', ' ');
            }
            const cleanDigits = phone.replace(/[^0-9]/g, '');
            if (waLink) waLink.href = `https://wa.me/${cleanDigits}`;

            try {
                const res = await fetch(`/api/dashboard/contact/profile?phone=${encodeURIComponent(phone)}`);
                if (!res.ok) return;
                const p = await res.json();

                if (nameEl) nameEl.innerText = p.sender_name || phone;
                if (avatarEl) avatarEl.innerHTML = getInitials(p.sender_name || phone);
                if (channelBadge) channelBadge.innerText = (p.channel || 'WHATSAPP').toUpperCase().replace('_', ' ');

                // 24h Free Context Window & Meta Pricing Details
                const winBox = document.getElementById('prof-window-box');
                if (winBox) {
                    const meta = p.meta_conversation || {};
                    const isMetaFree = !meta.is_billable;
                    const cat = (meta.pricing_category || 'service').toUpperCase();
                    const metaIdStr = meta.id ? `<span class="text-[10px] text-slate-500 font-mono block mt-0.5">Meta Conv ID: ${escapeHtml(meta.id)}</span>` : '';

                    if (p.is_free_window_active && p.free_window_seconds_left > 0) {
                        winBox.className = "p-3 rounded-2xl border border-emerald-200 bg-emerald-50/80 flex items-center justify-between";
                        winBox.innerHTML = `
                            <div class="flex items-center space-x-2.5 min-w-0">
                                <span class="w-3 h-3 rounded-full bg-emerald-500 animate-pulse flex-shrink-0"></span>
                                <div class="min-w-0">
                                    <div class="flex items-center space-x-1.5 flex-wrap">
                                        <span class="font-extrabold text-emerald-950 block text-xs">24h Free Context Window Active</span>
                                        <span class="px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-emerald-200 text-emerald-900">${isMetaFree ? '₹0 Free Tier' : cat}</span>
                                    </div>
                                    <span class="text-[10px] text-emerald-700 block mt-0.5">Expires in <strong>${formatWindowTime(p.free_window_seconds_left)}</strong> • Unlimited Free-form replies</span>
                                    ${metaIdStr}
                                </div>
                            </div>
                            <button type="button" onclick="openPromoModal('current'); closeContactProfileModal();" class="px-2.5 py-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] transition shadow-xs flex-shrink-0 ml-2">
                                Send Promo
                            </button>
                        `;
                    } else {
                        winBox.className = "p-3 rounded-2xl border border-slate-200 bg-slate-50 flex items-center justify-between";
                        winBox.innerHTML = `
                            <div class="flex items-center space-x-2.5 min-w-0">
                                <i class="fas fa-clock text-slate-400 text-sm flex-shrink-0"></i>
                                <div class="min-w-0">
                                    <span class="font-bold text-slate-700 block text-xs">24-Hour Context Window Expired</span>
                                    <span class="text-[10px] text-slate-500 block">Wait for customer to reply or send approved Meta template</span>
                                    ${metaIdStr}
                                </div>
                            </div>
                            <span class="px-2 py-0.5 rounded-full bg-slate-200 text-slate-600 text-[10px] font-bold flex-shrink-0 ml-2">Closed</span>
                        `;
                    }
                }

                // Bot toggle
                const botToggle = document.getElementById('prof-bot-toggle');
                if (botToggle) botToggle.checked = !!p.bot_enabled;

                // Stats
                const stats = p.stats || {};
                const stTotal = document.getElementById('prof-stat-total');
                const stIn = document.getElementById('prof-stat-in');
                const stOut = document.getElementById('prof-stat-out');
                const stFirst = document.getElementById('prof-stat-first');
                const stLast = document.getElementById('prof-stat-last');

                if (stTotal) stTotal.innerText = stats.total_messages || 0;
                if (stIn) stIn.innerText = stats.inbound_messages || 0;
                if (stOut) stOut.innerText = stats.outbound_messages || 0;
                if (stFirst) stFirst.innerText = formatTime(stats.first_seen) || 'Recently';
                if (stLast) stLast.innerText = formatTime(stats.last_seen) || 'Just now';

                // Media Gallery
                const mediaGallery = document.getElementById('prof-media-gallery');
                const mediaCountEl = document.getElementById('prof-media-count');
                const mediaList = p.media || [];
                if (mediaCountEl) mediaCountEl.innerText = mediaList.length;

                if (mediaGallery) {
                    if (mediaList.length === 0) {
                        mediaGallery.innerHTML = `<div class="col-span-4 p-4 text-center text-slate-400 text-xs italic bg-slate-50 rounded-xl border border-slate-100">No photos or documents exchanged yet.</div>`;
                    } else {
                        mediaGallery.innerHTML = mediaList.map(m => {
                            if (m.media_type === 'image' && m.media_url) {
                                return `
                                    <a href="${m.media_url}" target="_blank" class="block aspect-square rounded-xl overflow-hidden border border-slate-200 hover:opacity-90 hover:ring-2 hover:ring-emerald-400 transition group relative shadow-xs" title="Click to view full image">
                                        <img src="${m.media_url}" class="w-full h-full object-cover group-hover:scale-105 transition duration-200" loading="lazy"/>
                                    </a>
                                `;
                            } else {
                                const filename = escapeHtml(m.media_filename || 'Document.pdf');
                                return `
                                    <a href="${m.media_url}" target="_blank" download="${filename}" class="aspect-square rounded-xl bg-slate-50 border border-slate-200 p-2 flex flex-col items-center justify-center text-center hover:bg-slate-100 transition shadow-xs" title="Download ${filename}">
                                        <i class="fas fa-file-pdf text-red-500 text-xl mb-1"></i>
                                        <span class="text-[9px] font-bold text-slate-700 truncate max-w-full">${filename}</span>
                                    </a>
                                `;
                            }
                        }).join('');
                    }
                }

                // Bookings
                const bookingsList = document.getElementById('prof-bookings-list');
                const bookingsCountEl = document.getElementById('prof-bookings-count');
                const bList = p.bookings || [];
                if (bookingsCountEl) bookingsCountEl.innerText = bList.length;

                if (bookingsList) {
                    if (bList.length === 0) {
                        bookingsList.innerHTML = `<div class="p-3 text-center text-slate-400 text-xs italic bg-slate-50 rounded-xl border border-slate-100">No bookings recorded for this customer.</div>`;
                    } else {
                        bookingsList.innerHTML = bList.map(b => `
                            <div class="p-2.5 rounded-xl bg-amber-50/60 border border-amber-200/80 flex items-center justify-between">
                                <div>
                                    <span class="font-bold text-slate-800 text-xs block">${escapeHtml(b.service_requested || 'Service Task')}</span>
                                    <span class="text-[10px] text-amber-800 font-medium">${escapeHtml(b.booking_date_time || '')}</span>
                                </div>
                                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${b.status === 'confirmed' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}">${escapeHtml(b.status || 'pending')}</span>
                            </div>
                        `).join('');
                    }
                }

                // Notes & Tags
                const tagsInput = document.getElementById('prof-tags-input');
                const notesInput = document.getElementById('prof-notes-input');
                if (tagsInput) tagsInput.value = p.tags || '';
                if (notesInput) notesInput.value = p.notes || '';
                const saveStatus = document.getElementById('prof-save-status');
                if (saveStatus) saveStatus.classList.add('hidden');

            } catch (err) {
                console.error("Error fetching contact profile:", err);
            }
        }

        function closeContactProfileModal() {
            const modal = document.getElementById('contact-profile-modal');
            if (modal) modal.classList.add('hidden');
        }

        function copyContactPhone() {
            if (!activeProfilePhone) return;
            navigator.clipboard.writeText(activeProfilePhone).then(() => {
                alert(`Copied ${activeProfilePhone} to clipboard!`);
            });
        }

        async function toggleContactBotFromProfile(enabled) {
            if (!activeProfilePhone) return;
            await toggleContactBot(enabled);
            const desc = document.getElementById('prof-bot-desc');
            if (desc) {
                desc.innerText = enabled ? 'AI automatically replies to incoming questions from this customer' : 'AI bot is paused. Human agent will handle messages manually.';
            }
        }

        function openAddBookingModalForContact() {
            closeContactProfileModal();
            if (typeof openBookCurrentContactModal === 'function') {
                openBookCurrentContactModal();
            }
        }

        async function saveContactProfileNotes() {
            if (!activeProfilePhone) return;
            const tags = document.getElementById('prof-tags-input')?.value.trim() || '';
            const notes = document.getElementById('prof-notes-input')?.value.trim() || '';
            const saveBtn = document.getElementById('prof-save-btn');
            const saveStatus = document.getElementById('prof-save-status');

            if (saveBtn) {
                saveBtn.disabled = true;
                saveBtn.innerHTML = `<i class="fas fa-spinner fa-spin mr-1"></i> Saving...`;
            }

            try {
                const res = await fetch('/api/dashboard/contact/profile', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        phone: activeProfilePhone,
                        tags: tags,
                        notes: notes
                    })
                });

                if (res.ok) {
                    if (saveStatus) {
                        saveStatus.classList.remove('hidden');
                        setTimeout(() => saveStatus.classList.add('hidden'), 3000);
                    }
                } else {
                    alert("Failed to save notes.");
                }
            } catch (e) {
                alert("Error saving notes: " + e.message);
            } finally {
                if (saveBtn) {
                    saveBtn.disabled = false;
                    saveBtn.innerHTML = `<span>Save Notes</span>`;
                }
            }
        }

        // Initialize & Auto Poll every 3 seconds
        fetchData();
        setInterval(() => fetchData(false), 3000);
