(function(){
  if (window.XzdeskChatWidgetLoaded) return;
  window.XzdeskChatWidgetLoaded = true;
  var script = document.currentScript || Array.prototype.slice.call(document.scripts).pop();
  var dataset = script && script.dataset ? script.dataset : {};
  var apiBase = new URL(script && script.src ? script.src : window.location.href).origin;
  var shop = dataset.shop || decodeURIComponent("__DEFAULT_SHOP__") || window.Shopify && window.Shopify.shop || window.location.hostname;
  var tenantId = String(dataset.tenantId || "").trim();
  var defaultTitle = "Chat with us";
  var defaultLauncherLabel = "Chat";
  var defaultWelcomeText = "Hi, message us with any questions. We're happy to help!";
  var configuredLanguage = dataset.language || "auto";
  var configuredGreeting = dataset.greetingMessage || defaultWelcomeText;
  var storefrontLoginURL = dataset.storefrontLoginUrl || "/account/login";
  var featuredProductsEnabled = String(dataset.featuredProductsEnabled || "false") === "true";
  var featuredProducts = readFeaturedProducts(dataset.featuredProductsId);
  var chatBackgroundColor = validColor(dataset.chatBackgroundColor, "#FFFFFF");
  var chatFontColor = validColor(dataset.chatFontColor, "#000000");
  var launcherBackgroundColor = validColor(dataset.launcherBackgroundColor, "#000000");
  var launcherTextColor = validColor(dataset.launcherTextColor, "#FFFFFF");
  var launcherIcon = normalizeChoice(dataset.launcherIcon, ["chat_bubble", "email", "question", "smile", "team", "wave", "none"], "chat_bubble");
  var launcherLabelKey = normalizeChoice(dataset.launcherLabel, ["chat", "ask_anything", "assistance", "contact", "help", "support", "live_chat", "message_us", "need_help", "none"], "chat");
  var horizontalPosition = normalizeChoice(dataset.horizontalPosition, ["left", "center", "right"], "right");
  var verticalPosition = normalizeChoice(dataset.verticalPosition, ["lowest", "higher", "highest"], "higher");
  var inheritFont = String(dataset.inheritFont || "true") === "true";
  var borderRadius = clampInt(dataset.borderRadius, 16, 0, 28);
  var translations = {
    en: {
      title: defaultTitle,
      launcher: defaultLauncherLabel,
      welcome: configuredGreeting,
      close: "Close",
      writeMessage: "Write message",
      send: "Send",
      support: "Support",
      supportTeam: "Support Team",
      you: "You",
      automated: "Automated",
      instantAnswers: "Instant answers",
      trackOrder: "Track my order",
      orderHelp: "Enter the order number and email used at checkout.",
      orderNumber: "Order number",
      emailAddress: "Email address",
      checkOrder: "Check order status",
      checkingOrder: "Checking order...",
      cancelOrder: "Cancel order lookup",
      orderError: "Could not check this order. Verify the order number and email, then try again.",
	  sendError: "Could not send your message. Please try again.",
	  sending: "Sending...",
	  retrySend: "Send failed - click to retry",
      greetingTitle: "Hi there!",
      featuredProducts: "Featured products",
      privacy: "Messages are shared with this store so its team can help you.",
      signedIn: "Signed in",
      signIn: "Sign in",
      signInTitle: "Sign in to view and continue your chats",
      signInSubtitle: "Use your Shop account or email to access your conversations.",
      supportSignInTitle: "Don't miss a reply",
      supportSignInSubtitle: "Sign in to chat with our support team. We'll email you if you leave the chat.",
      orderFollowupTitle: "Need more help?",
      orderFollowupText: "Try the lookup again or contact our support team.",
      orderTryAgain: "Try again",
      orderSignIn: "Contact support",
      contactSupportMessage: "I need help with my order.",
      signInWithShop: "Sign in with Shop",
      signInOr: "OR",
      signInEmail: "Email",
      signInDisclosure: "By continuing, Shop will share your name and email with this store.",
      terms: "terms",
      privacyPolicy: "privacy policy",
      backToChat: "Back to chat",
      available: "We usually reply as soon as possible.",
      expand: "Expand",
      minimize: "Minimize",
      openProduct: "Open product",
      attachFile: "Add image or file",
      removeAttachment: "Remove attachment",
      attachmentTooLarge: "Files must be 8 MB or smaller.",
      attachmentUnsupported: "Use an image, PDF, text, CSV, Word, Excel, or PowerPoint file.",
      attachmentError: "Could not send this attachment. Please try again.",
      downloadFile: "Download file"
    }
  };
  var launcherLabels = {
    chat: "Chat",
    ask_anything: "Ask anything",
    assistance: "Assistance",
    contact: "Contact",
    help: "Help",
    support: "Support",
    live_chat: "Live chat",
    message_us: "Message us",
    need_help: "Need help?",
    none: ""
  };
  function normalizeChoice(value, allowed, fallback){
    var normalized = String(value || "").toLowerCase().replace(/-/g, "_");
    return allowed.indexOf(normalized) >= 0 ? normalized : fallback;
  }
  function validColor(value, fallback){
    var normalized = String(value || "").trim();
    return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : fallback;
  }
  function metaContent(selectors){
    for (var index = 0; index < selectors.length; index += 1) {
      var element = document.querySelector(selectors[index]);
      var content = String(element && (element.content || element.getAttribute("content")) || "").trim();
      if (content) return content;
    }
    return "";
  }
  function currentPageContext(){
    var productMatch = window.location.pathname.match(/\/products\/([^\/?#]+)/i);
    var productHandle = productMatch ? decodeURIComponent(productMatch[1]) : "";
    var context = {
      pageTitle: document.title || "",
      pageUrl: window.location.href,
      productHandle: productHandle
    };
    if (!productHandle) return context;
    var rawImageURL = metaContent(['meta[property="og:image:secure_url"]', 'meta[property="og:image"]', 'meta[name="twitter:image"]']);
    var productImageURL = "";
    try {
      productImageURL = rawImageURL ? safeHTTPURL(new URL(rawImageURL, window.location.href).toString()) : "";
    } catch (_) {}
    context.productTitle = metaContent(['meta[property="og:title"]', 'meta[name="twitter:title"]']) || document.title || productHandle;
    context.productImageUrl = productImageURL;
    context.productPrice = metaContent(['meta[property="product:price:amount"]', 'meta[property="og:price:amount"]', 'meta[itemprop="price"]']);
    context.productCurrencyCode = metaContent(['meta[property="product:price:currency"]', 'meta[property="og:price:currency"]', 'meta[itemprop="priceCurrency"]']);
    return context;
  }
  function clampInt(value, fallback, min, max){
    var parsed = parseInt(value, 10);
    if (!isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
  }
  function readFeaturedProducts(elementId){
    if (!elementId) return [];
    var element = document.getElementById(elementId);
    if (!element) return [];
    try {
      var parsed = JSON.parse(element.textContent || "[]");
      if (!Array.isArray(parsed)) return [];
      return parsed.slice(0, 3).map(function(item){
        return {
          title: String(item && item.title || "").trim(),
          url: safeHTTPURL(item && item.url ? new URL(item.url, window.location.origin).toString() : ""),
          price: String(item && item.price || "").trim(),
          imageUrl: safeHTTPURL(item && item.imageUrl ? new URL(item.imageUrl, window.location.origin).toString() : "")
        };
      }).filter(function(item){ return item.title && item.url; });
    } catch (_) {
      return [];
    }
  }
  function languageFromCode(value){
    var normalized = String(value || "").toLowerCase();
    if (!normalized) return "";
    if (translations[normalized]) return normalized;
    var base = normalized.split("-")[0];
    return translations[base] ? base : "";
  }
  function resolveLanguage(value){
    var normalized = String(value || "auto").toLowerCase();
    if (normalized !== "auto") return languageFromCode(normalized) || "en";
    var languages = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ""];
    for (var index = 0; index < languages.length; index += 1) {
      var matched = languageFromCode(languages[index]);
      if (matched) return matched;
    }
    return "en";
  }
  function browserLanguageCode(){
    var languages = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ""];
    var value = String(languages[0] || "").trim().replace(/_/g, "-").toLowerCase();
    return /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(value) ? value : "en";
  }
  var activeLanguage = resolveLanguage(configuredLanguage);
  function t(key){
    return (translations[activeLanguage] && translations[activeLanguage][key]) || translations.en[key] || key;
  }
  function displayTitle(){ return t("title"); }
  function displayLauncher(){
    return Object.prototype.hasOwnProperty.call(launcherLabels, launcherLabelKey) ? launcherLabels[launcherLabelKey] : t("launcher");
  }
  function displayWelcome(){ return t("welcome"); }
  function launcherOffset(){
    if (verticalPosition === "lowest") return 22;
    if (verticalPosition === "highest") return 150;
    return 84;
  }
  function iconSvg(name){
    var attrs = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"';
    if (name === "none") return "";
    if (name === "email") return '<svg ' + attrs + '><rect x="3.5" y="5.5" width="17" height="13" rx="3"/><path d="m5.5 8.2 6.5 4.6 6.5-4.6"/></svg>';
    if (name === "question") return '<svg ' + attrs + '><circle cx="12" cy="12" r="9"/><path d="M9.7 9.3a2.8 2.8 0 0 1 5.3 1.3c0 1.9-2 2.3-2.6 3.5"/><path d="M12 17.6h.01"/></svg>';
    if (name === "smile") return '<svg ' + attrs + '><circle cx="12" cy="12" r="9"/><path d="M8.7 10h.01"/><path d="M15.3 10h.01"/><path d="M8.8 14.3c.8 1.4 1.9 2.1 3.2 2.1s2.4-.7 3.2-2.1"/></svg>';
    if (name === "team") return '<svg ' + attrs + '><path d="M8.6 11.1a3.1 3.1 0 1 0 0-6.2 3.1 3.1 0 0 0 0 6.2Z"/><path d="M2.9 19.1c.7-3.2 2.8-5 5.7-5s5 1.8 5.7 5"/><path d="M16 11.7a2.8 2.8 0 1 0-1.1-5.4"/><path d="M16.2 14.4c2.4.5 4 2.2 4.6 4.7"/></svg>';
    if (name === "wave") return '<svg ' + attrs + '><path d="M7.4 12.7V5.8a1.45 1.45 0 0 1 2.9 0V12"/><path d="M10.3 11.8V4.7a1.45 1.45 0 0 1 2.9 0V12"/><path d="M13.2 12V6.4a1.45 1.45 0 0 1 2.9 0v6.3"/><path d="M16.1 12.8v-2a1.45 1.45 0 0 1 2.9 0v3.4c0 4.1-2.7 6.8-6.8 6.8h-.7c-2.8 0-4.8-1.4-6-3.8l-1.2-2.5a1.4 1.4 0 0 1 2.4-1.4l1.4 2"/><path d="M5.1 4.8A5 5 0 0 0 3.7 8"/><path d="M2.4 3A8 8 0 0 0 1 8.1"/></svg>';
    return '<svg ' + attrs + '><path d="M5.2 5h13.6a2.7 2.7 0 0 1 2.7 2.7v6.8a2.7 2.7 0 0 1-2.7 2.7h-5.2l-4.2 3.1a.9.9 0 0 1-1.4-.7v-2.4H5.2a2.7 2.7 0 0 1-2.7-2.7V7.7A2.7 2.7 0 0 1 5.2 5Z"/><path d="M8.4 11.3h.01"/><path d="M12 11.3h.01"/><path d="M15.6 11.3h.01"/></svg>';
  }
  var visitorKey = "xzdesk_chat_visitor_" + shop;
  var conversationKey = "xzdesk_chat_conversation_" + shop;
  var lastSeenKey = "xzdesk_chat_last_seen_" + shop;
  var outboxKey = "xzdesk_chat_outbox_" + shop;
  var reopenAfterLoginKey = "xzdesk_chat_reopen_after_login_" + shop;
  var supportAfterLoginKey = "xzdesk_chat_support_after_login_" + shop;
  var authCompleteKey = "xzdesk_chat_auth_complete_" + shop;
  var isCustomerLoginPopup = window.name === "xzdesk-shop-login";
  var persistentChatStorageAllowed = false;
  var chatInteractionStarted = false;
  var chatStorageKeys = [visitorKey, conversationKey, lastSeenKey, outboxKey];
  function storageGet(storage, key){
    try { return storage.getItem(key); } catch (_) { return null; }
  }
  function storageSet(storage, key, value){
    try { storage.setItem(key, value); return true; } catch (_) { return false; }
  }
  function storageRemove(storage, key){
    try { storage.removeItem(key); } catch (_) {}
  }
  function chatStorageGet(key){
    return storageGet(persistentChatStorageAllowed ? localStorage : sessionStorage, key);
  }
  function chatStorageSet(key, value){
    return storageSet(persistentChatStorageAllowed ? localStorage : sessionStorage, key, value);
  }
  function chatStorageRemove(key){
    storageRemove(localStorage, key);
    storageRemove(sessionStorage, key);
  }
  function preferencesProcessingAllowed(){
    try {
      return !!(window.Shopify && window.Shopify.customerPrivacy && window.Shopify.customerPrivacy.preferencesProcessingAllowed());
    } catch (_) {
      return false;
    }
  }
  function applyPreferencesProcessingPermission(allowed){
    allowed = !!allowed;
    if (allowed && persistentChatStorageAllowed) return;
    if (allowed) {
      chatStorageKeys.forEach(function(key){
        var transientValue = storageGet(sessionStorage, key);
        var existingValue = storageGet(localStorage, key);
        var nextValue = !chatInteractionStarted && existingValue !== null ? existingValue : transientValue;
        if (nextValue !== null) storageSet(localStorage, key, nextValue);
        storageRemove(sessionStorage, key);
      });
      persistentChatStorageAllowed = true;
      visitorId = chatStorageGet(visitorKey) || visitorId;
      conversationId = chatStorageGet(conversationKey) || conversationId;
      return;
    }
    chatStorageKeys.forEach(function(key){
      var value = storageGet(localStorage, key);
      if (storageGet(sessionStorage, key) === null && value !== null) storageSet(sessionStorage, key, value);
      storageRemove(localStorage, key);
    });
    persistentChatStorageAllowed = false;
    visitorId = storageGet(sessionStorage, visitorKey) || visitorId;
    conversationId = storageGet(sessionStorage, conversationKey) || conversationId;
  }
  function refreshPreferencesProcessingPermission(){
    applyPreferencesProcessingPermission(preferencesProcessingAllowed());
  }
  persistentChatStorageAllowed = preferencesProcessingAllowed();
  if (!persistentChatStorageAllowed) applyPreferencesProcessingPermission(false);
  document.addEventListener("visitorConsentCollected", refreshPreferencesProcessingPermission);
  try {
    if (window.Shopify && typeof window.Shopify.loadFeatures === "function") {
      window.Shopify.loadFeatures([{name: "consent-tracking-api", version: "0.1"}], function(error){
        if (!error) refreshPreferencesProcessingPermission();
      });
    }
  } catch (_) {}
  var visitorId = chatStorageGet(visitorKey);
  if (!visitorId) {
    visitorId = "visitor_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    chatStorageSet(visitorKey, visitorId);
  }
  var conversationId = chatStorageGet(conversationKey) || "";
  var socket = null;
  var socketReconnectTimer = null;
	var socketReconnectAttempt = 0;
  var socketHeartbeatTimer = null;
  var outboxFlushing = false;
	var attachmentOutbox = null;
  var open = false;
  var expanded = false;
  var unreadCount = 0;
  var messages = [];
  var selfServiceMessages = [];
  var instantAnswers = [];
  var customerSession = "";
  var customerAuthenticated = false;
  var customerName = "";
  var customerEmail = "";
  var customerSessionLoaded = false;
  var customerLoginRequired = true;
  var shopName = "";
  var authViewOpen = false;
  var authPopup = null;
  var style = document.createElement("style");
  style.textContent = ".xzdesk-chat-button{position:fixed!important;right:22px!important;bottom:84px!important;z-index:2147483000!important;border:0!important;border-radius:var(--xzdesk-radius,16px)!important;background:var(--xzdesk-launcher-bg,#000)!important;color:var(--xzdesk-launcher-fg,#fff)!important;min-width:0!important;width:auto!important;height:56px!important;padding:0 13px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;gap:6px!important;box-shadow:0 12px 34px rgba(0,0,0,.22)!important;font-family:var(--xzdesk-font-family,system-ui,sans-serif)!important;font-size:23px!important;font-weight:600!important;line-height:1!important;cursor:pointer!important;box-sizing:border-box!important;margin:0!important}.xzdesk-chat-button svg{width:24px!important;height:24px!important;flex:0 0 auto!important;display:block!important}.xzdesk-chat-panel{position:fixed!important;right:22px!important;bottom:156px!important;width:min(365px,calc(100vw - 32px))!important;max-height:min(560px,calc(100vh - 120px))!important;z-index:2147483000!important;background:#fff;border:1px solid rgba(127,127,127,.22);border-radius:14px;box-shadow:0 18px 60px rgba(0,0,0,.24);display:none;overflow:hidden;font-family:var(--xzdesk-font-family,system-ui,sans-serif);font-size:14px;color:#111827;box-sizing:border-box!important;margin:0!important}.xzdesk-chat-panel.open{display:flex!important;flex-direction:column}.xzdesk-chat-head{padding:18px;background:#111;color:#fff;display:flex;justify-content:space-between}.xzdesk-chat-head strong{font-size:17px}.xzdesk-chat-head p{margin:4px 0 0}.xzdesk-chat-close{border:0;background:transparent;color:#fff;font-size:24px;cursor:pointer}.xzdesk-chat-messages{flex:1;overflow:auto;padding:14px;background:#fff;min-height:120px}.xzdesk-chat-bubble{max-width:84%;margin:0 0 10px;padding:10px 12px;border-radius:14px;background:#edf0f5;color:#172033;white-space:pre-wrap;word-break:break-word}.xzdesk-chat-bubble.customer{background:#1769aa;color:#fff;margin-left:auto}.xzdesk-chat-bubble small{display:block;opacity:.7;font-size:11px;margin-bottom:4px}.xzdesk-chat-empty{background:#edf0f5;border-radius:14px;padding:12px;max-width:260px}.xzdesk-chat-form,.xzdesk-chat-workflow,.xzdesk-chat-instant{border-top:1px solid #e3e8ef;padding:10px;background:#fff}.xzdesk-chat-fields{display:flex;gap:8px;margin-bottom:8px}.xzdesk-chat-fields[hidden],.xzdesk-chat-workflow[hidden]{display:none}.xzdesk-chat-fields input,.xzdesk-chat-workflow input{min-width:0;flex:1;border:1px solid #cfd7e3;border-radius:8px;padding:9px;font:inherit}.xzdesk-chat-row{display:flex;border:1px solid #cfd7e3;border-radius:10px;overflow:hidden}.xzdesk-chat-row textarea{flex:1;border:0;padding:10px;min-height:42px}.xzdesk-chat-row button,.xzdesk-chat-workflow button{border:0;background:#1769aa;color:#fff;padding:0 14px;cursor:pointer}.xzdesk-chat-instant button{width:100%;border:1px solid #cfd7e3;background:#fff;border-radius:9px;padding:10px;text-align:left;font-weight:700;cursor:pointer}.xzdesk-chat-error{border-top:1px solid #fecaca;background:#fff7f7;color:#b42318;font-size:12px;line-height:1.4;padding:8px 10px}.xzdesk-chat-error.saved{border-top-color:#a7d7c5;background:#f0faf6;color:#176448}.xzdesk-chat-error.retry{cursor:pointer;text-decoration:underline}.xzdesk-chat-error[hidden]{display:none!important}";
  style.textContent += ".xzdesk-chat-bubble.pending{opacity:.72}.xzdesk-chat-bubble.failed{background:#fff1f1!important;color:#8f1d1d!important;border:1px solid #f3b8b8}.xzdesk-chat-send-state{margin-top:6px!important;margin-bottom:0!important}.xzdesk-chat-send-retry{display:block;border:0;background:transparent;color:inherit;padding:0;margin-top:6px;font:inherit;font-size:12px;text-decoration:underline;cursor:pointer}";
  document.head.appendChild(style);
  var stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = apiBase + "/chat/widget.css";
  document.head.appendChild(stylesheet);
  var panel = document.createElement("section");
  panel.className = "xzdesk-chat-panel";
  panel.innerHTML = '<div class="xzdesk-chat-head"><div><strong></strong><p></p></div><div class="xzdesk-chat-head-actions"><button class="xzdesk-chat-signin" type="button"></button><button class="xzdesk-chat-expand" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/></svg></button><button class="xzdesk-chat-close" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M6 12h12"/></svg></button></div></div><div class="xzdesk-chat-messages"></div><form class="xzdesk-chat-workflow" hidden><div class="xzdesk-chat-workflow-head"><strong>Track my order</strong><button class="xzdesk-chat-workflow-cancel" type="button" aria-label="Cancel order lookup">x</button></div><p>Enter the order number and email used at checkout.</p><label><span class="xzdesk-chat-order-number-label">Order number</span><input name="orderNumber" autocomplete="off" required></label><label><span class="xzdesk-chat-order-email-label">Email address</span><input name="workflowEmail" autocomplete="email" type="email" required></label><button type="submit">Check order status</button></form><div class="xzdesk-chat-error" role="alert" hidden></div><section class="xzdesk-chat-order-followup" hidden><strong></strong><p></p><div><button class="xzdesk-chat-order-retry" type="button"></button><button class="xzdesk-chat-order-signin" type="button"></button></div></section><div class="xzdesk-chat-instant" hidden><strong>Instant answers</strong><div class="xzdesk-chat-instant-list"></div></div><form class="xzdesk-chat-form"><div class="xzdesk-chat-pending" hidden><span></span><button type="button">x</button></div><div class="xzdesk-chat-row"><button class="xzdesk-chat-attach" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.4 11.6-8.9 8.9a6 6 0 0 1-8.5-8.5l9.6-9.6a4 4 0 0 1 5.7 5.7l-9.6 9.6a2 2 0 0 1-2.8-2.8l8.9-8.9"/></svg></button><input class="xzdesk-chat-file-input" type="file" accept="image/jpeg,image/png,image/gif,image/webp,.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx"><textarea name="body" placeholder="Write message"></textarea><button type="submit" aria-label="Send"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg></button></div></form>';
  panel.querySelector("strong").textContent = displayTitle();
  panel.querySelector(".xzdesk-chat-head p").textContent = displayWelcome();
  var button = document.createElement("button");
  button.className = "xzdesk-chat-button";
  button.type = "button";
  document.body.appendChild(panel);
  document.body.appendChild(button);
  var list = panel.querySelector(".xzdesk-chat-messages");
  var expandButton = panel.querySelector(".xzdesk-chat-expand");
  var signInButton = panel.querySelector(".xzdesk-chat-signin");
  var form = panel.querySelector(".xzdesk-chat-form");
  var errorEl = panel.querySelector(".xzdesk-chat-error");
  var orderFollowup = panel.querySelector(".xzdesk-chat-order-followup");
  var orderRetryButton = panel.querySelector(".xzdesk-chat-order-retry");
  var orderSignInButton = panel.querySelector(".xzdesk-chat-order-signin");
  var instantBox = panel.querySelector(".xzdesk-chat-instant");
  var instantList = panel.querySelector(".xzdesk-chat-instant-list");
  var workflowForm = panel.querySelector(".xzdesk-chat-workflow");
  var bodyInput = form.querySelector('[name="body"]');
  var attachmentButton = form.querySelector(".xzdesk-chat-attach");
  var attachmentInput = form.querySelector(".xzdesk-chat-file-input");
  var pendingAttachment = form.querySelector(".xzdesk-chat-pending");
  var pendingAttachmentName = pendingAttachment.querySelector("span");
  var pendingAttachmentRemove = pendingAttachment.querySelector("button");
  var orderNumberInput = workflowForm.querySelector('[name="orderNumber"]');
  var workflowEmailInput = workflowForm.querySelector('[name="workflowEmail"]');
  var workflowCancel = workflowForm.querySelector(".xzdesk-chat-workflow-cancel");
  var activeWorkflow = null;
  var authPurpose = "general";
  var supportRequestInFlight = false;
  var supportAfterLogin = false;
  var selectedAttachment = null;
  var orderTrackingPollVersion = 0;
  function updateUnread(){
    var badge = button.querySelector(".xzdesk-chat-unread");
    if (!unreadCount) {
      if (badge) badge.remove();
      button.classList.remove("has-unread");
      return;
    }
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "xzdesk-chat-unread";
      badge.setAttribute("aria-hidden", "true");
      button.appendChild(badge);
    }
    badge.textContent = "";
    button.classList.add("has-unread");
  }
  function isNotifiableMessage(message){
    return !!message && (message.direction === "agent" || message.direction === "system");
  }
  function latestNotifiableMessage(){
    for (var index = messages.length - 1; index >= 0; index -= 1) {
      if (isNotifiableMessage(messages[index])) return messages[index];
    }
    return null;
  }
  function saveLastSeenMessage(message){
    if (!conversationId || !message || !message.id) return;
    try {
      chatStorageSet(lastSeenKey, JSON.stringify({conversationId: conversationId, messageId: message.id}));
    } catch (_) {}
  }
  function readLastSeenMessage(){
    try {
      var stored = JSON.parse(chatStorageGet(lastSeenKey) || "null");
      return stored && typeof stored.conversationId === "string" && typeof stored.messageId === "string" ? stored : null;
    } catch (_) {
      return null;
    }
  }
  function markMessagesSeen(){
    unreadCount = 0;
    saveLastSeenMessage(latestNotifiableMessage());
    updateUnread();
  }
  function restoreUnreadFromMessages(){
    var latest = latestNotifiableMessage();
    if (!latest) {
      unreadCount = 0;
      updateUnread();
      return;
    }
    var seen = readLastSeenMessage();
    if (!seen || seen.conversationId !== conversationId) {
      saveLastSeenMessage(latest);
      unreadCount = 0;
      updateUnread();
      return;
    }
    var seenIndex = messages.findIndex(function(message){ return message.id === seen.messageId; });
    unreadCount = seenIndex < 0
      ? Number(latest.id !== seen.messageId)
      : Number(messages.slice(seenIndex + 1).some(isNotifiableMessage));
    updateUnread();
  }
  function applyTheme(){
    var bottom = launcherOffset();
    var compact = window.matchMedia && window.matchMedia("(max-width: 600px)").matches;
    var gutter = compact ? 12 : 22;
    var horizontal = horizontalPosition;
    button.style.setProperty("position", "fixed", "important");
    button.style.setProperty("z-index", "2147483000", "important");
    panel.style.setProperty("position", "fixed", "important");
    panel.style.setProperty("z-index", "2147483000", "important");
    button.style.setProperty("--xzdesk-launcher-bg", launcherBackgroundColor);
    button.style.setProperty("--xzdesk-launcher-fg", launcherTextColor);
    button.style.setProperty("--xzdesk-radius", borderRadius + "px");
    panel.style.setProperty("--xzdesk-chat-bg", chatBackgroundColor);
    panel.style.setProperty("--xzdesk-chat-fg", chatFontColor);
    panel.style.setProperty("--xzdesk-panel-bottom", bottom + 72 + "px");
    panel.style.setProperty("bottom", bottom + 72 + "px", "important");
    button.style.setProperty("bottom", bottom + "px", "important");
    if (horizontal === "left") {
      button.style.setProperty("left", gutter + "px", "important");
      button.style.setProperty("right", "auto", "important");
      button.style.setProperty("transform", "none", "important");
      panel.style.setProperty("left", gutter + "px", "important");
      panel.style.setProperty("right", "auto", "important");
      panel.style.setProperty("transform", "none", "important");
    } else if (horizontal === "center") {
      button.style.setProperty("left", "50%", "important");
      button.style.setProperty("right", "auto", "important");
      button.style.setProperty("transform", "translateX(-50%)", "important");
      panel.style.setProperty("left", "50%", "important");
      panel.style.setProperty("right", "auto", "important");
      panel.style.setProperty("transform", "translateX(-50%)", "important");
    } else {
      button.style.setProperty("left", "auto", "important");
      button.style.setProperty("right", gutter + "px", "important");
      button.style.setProperty("transform", "none", "important");
      panel.style.setProperty("left", "auto", "important");
      panel.style.setProperty("right", gutter + "px", "important");
      panel.style.setProperty("transform", "none", "important");
    }
    var fontFamily = inheritFont ? "inherit" : "system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif";
    button.style.setProperty("--xzdesk-font-family", fontFamily);
    panel.style.setProperty("--xzdesk-font-family", fontFamily);
    if (compact) {
      panel.style.setProperty("left", "8px", "important");
      panel.style.setProperty("right", "8px", "important");
      panel.style.setProperty("top", "8px", "important");
      panel.style.setProperty("bottom", "8px", "important");
      panel.style.setProperty("transform", "none", "important");
    } else {
      panel.style.removeProperty("top");
    }
    if (expanded && !compact) {
      panel.style.setProperty("left", "auto", "important");
      panel.style.setProperty("right", "22px", "important");
      panel.style.setProperty("bottom", "22px", "important");
      panel.style.setProperty("transform", "none", "important");
    }
  }
  function applyStaticText(){
    panel.querySelector("strong").textContent = shopName || displayTitle();
    panel.querySelector(".xzdesk-chat-head p").textContent = t("available");
    panel.querySelector(".xzdesk-chat-close").setAttribute("aria-label", t("close"));
    expandButton.setAttribute("aria-label", expanded ? t("minimize") : t("expand"));
    signInButton.textContent = customerAuthenticated ? customerAccountLabel() : t("signIn");
    signInButton.title = customerAuthenticated ? customerAccountLabel() : t("signIn");
    signInButton.hidden = !messages.length;
    var launcherText = displayLauncher();
    button.innerHTML = iconSvg(launcherIcon) + '<span></span>';
    var buttonLabel = button.querySelector("span");
    if (buttonLabel) buttonLabel.textContent = launcherText;
    button.classList.toggle("icon-only", !launcherText);
    button.classList.toggle("text-only", launcherIcon === "none");
    button.setAttribute("aria-label", launcherText || defaultLauncherLabel);
    updateUnread();
    bodyInput.placeholder = t("writeMessage");
    attachmentButton.setAttribute("aria-label", t("attachFile"));
    attachmentButton.setAttribute("title", t("attachFile"));
    pendingAttachmentRemove.setAttribute("aria-label", t("removeAttachment"));
    form.querySelector('button[type="submit"]').setAttribute("aria-label", t("send"));
    workflowForm.querySelector(".xzdesk-chat-workflow-head strong").textContent = t("trackOrder");
    workflowForm.querySelector("p").textContent = t("orderHelp");
    workflowForm.querySelector(".xzdesk-chat-order-number-label").textContent = t("orderNumber");
    workflowForm.querySelector(".xzdesk-chat-order-email-label").textContent = t("emailAddress");
    workflowForm.querySelector('button[type="submit"]').textContent = t("checkOrder");
    workflowCancel.setAttribute("aria-label", t("cancelOrder"));
    var instantTitle = panel.querySelector(".xzdesk-chat-instant strong");
    if (instantTitle) instantTitle.textContent = t("instantAnswers");
    renderInstantAnswers();
    applyTheme();
    render();
  }
  function parseInstantAnswers(metadata){
    if (!metadata || metadata.instantAnswersEnabled !== "true") return [];
    try {
      var parsed = JSON.parse(metadata.instantAnswersJson || "[]");
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map(function(item, index){
          var mode = item && item.mode === "order_tracking" ? "order_tracking" : "text";
          return {
            id: String(item && item.id || "answer_" + index),
            title: mode === "order_tracking" ? t("trackOrder") : String(item && item.title || "").trim(),
            answer: mode === "order_tracking" ? t("orderHelp") : String(item && item.answer || "").trim(),
            mode: mode,
            enabled: !item || item.enabled !== false,
            sort: Number.isFinite(Number(item && item.sort)) ? Number(item.sort) : index
          };
        })
        .filter(function(item){ return item.enabled && item.title && item.answer; })
        .sort(function(a, b){ return a.sort - b.sort; });
    } catch (error) {
      return [];
    }
  }
  function renderInstantAnswers(){
    if (!instantBox || !instantList) return;
    instantList.innerHTML = "";
    var availableAnswers = instantAnswers;
    if (!customerSessionLoaded || authViewOpen || !availableAnswers.length || activeWorkflow) {
      instantBox.hidden = true;
      return;
    }
    instantBox.hidden = false;
    availableAnswers.forEach(function(answer, index){
      var item = document.createElement("button");
      item.type = "button";
      item.textContent = answer.title;
      item.setAttribute("data-xzdesk-instant-id", answer.id);
      if (index > 0) item.style.marginTop = "8px";
      instantList.appendChild(item);
    });
  }
  function pendingOrderFollowup(){
    if (activeWorkflow || authViewOpen) return null;
    for (var index = messages.length - 1; index >= 0; index -= 1) {
      var metadata = messages[index] && messages[index].metadata || {};
      if (metadata.workflow !== "order_tracking") continue;
      return metadata.workflowStatus === "not_found" || metadata.workflowStatus === "unavailable"
        ? metadata
        : null;
    }
    return null;
  }
  function renderOrderFollowup(){
    var state = pendingOrderFollowup();
    orderFollowup.hidden = !state;
    if (!state) return;
    orderFollowup.querySelector("strong").textContent = t("orderFollowupTitle");
    orderFollowup.querySelector("p").textContent = t("orderFollowupText");
    orderRetryButton.textContent = t("orderTryAgain");
    orderSignInButton.textContent = t("orderSignIn");
    orderFollowup.setAttribute("data-answer-id", state.instantAnswerId || "");
  }
  function safeHTTPURL(value){
    if (!value) return "";
    try {
      var parsed = new URL(value);
      return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : "";
    } catch (_) {
      return "";
    }
  }
  function formatFileSize(value){
    var size = Number(value || 0);
    if (!isFinite(size) || size <= 0) return "";
    if (size < 1024) return size + " B";
    if (size < 1024 * 1024) return Math.round(size / 102.4) / 10 + " KB";
    return Math.round(size / 104857.6) / 10 + " MB";
  }
  function updateAttachmentPreview(){
    pendingAttachment.hidden = !selectedAttachment;
    pendingAttachmentName.textContent = selectedAttachment ? selectedAttachment.name + " - " + formatFileSize(selectedAttachment.size) : "";
  }
  function supportedAttachment(file){
    if (!file || file.size <= 0 || file.size > 8 * 1024 * 1024) return false;
    return /\.(jpe?g|png|gif|webp|pdf|txt|csv|docx?|xlsx?|pptx?)$/i.test(file.name || "");
  }
  function customerLoginURL(email){
    var returnTo = window.location.pathname + window.location.search + window.location.hash;
    try {
      var loginURL = new URL(storefrontLoginURL, window.location.origin);
      loginURL.searchParams.set("return_to", returnTo);
      if (email) loginURL.searchParams.set("login_hint", email);
      return loginURL.toString();
    } catch (_) {
      return "/account/login?return_url=" + encodeURIComponent(returnTo);
    }
  }
  function finishCustomerLogin(){
	authViewOpen = false;
    try { sessionStorage.removeItem(reopenAfterLoginKey); } catch (_) {}
    try {
      supportAfterLogin = supportAfterLogin || sessionStorage.getItem(supportAfterLoginKey) === "1";
      sessionStorage.removeItem(supportAfterLoginKey);
    } catch (_) {}
    if (authPopup && !authPopup.closed) {
      try { authPopup.close(); } catch (_) {}
    }
    authPopup = null;
    authPurpose = "general";
    renderInstantAnswers();
    render();
    if (conversationId) loadMessages();
    connect();
    if (supportAfterLogin) {
      supportAfterLogin = false;
      requestHumanSupport();
    }
  }
  async function refreshCustomerLogin(){
    var authenticated = await loadCustomerSession();
    if (authenticated) {
      finishCustomerLogin();
      return;
    }
	if (authPopup && authPopup.closed) {
	  authPopup = null;
	}
  }
  function startCustomerLogin(email){
    try { sessionStorage.setItem(reopenAfterLoginKey, "1"); } catch (_) {}
    var loginURL = customerLoginURL(email);
    authPopup = window.open(loginURL, "xzdesk-shop-login", "popup=yes,width=480,height=720,resizable=yes,scrollbars=yes");
    if (!authPopup) {
      window.location.assign(loginURL);
      return;
    }
  }
  function customerAccountLabel(){
    return customerEmail || customerName || t("signedIn");
  }
  function openAuthView(purpose){
    if (customerAuthenticated) return;
    authPurpose = purpose === "support" ? "support" : "general";
    authViewOpen = true;
    showError("");
    renderInstantAnswers();
    render();
  }
  function closeAuthView(){
    authViewOpen = false;
    authPurpose = "general";
    supportAfterLogin = false;
    try { sessionStorage.removeItem(supportAfterLoginKey); } catch (_) {}
    renderInstantAnswers();
    render();
  }
  function renderAuthView(){
    var authView = document.createElement("section");
    authView.className = "xzdesk-chat-login-view";
    var back = document.createElement("button");
    back.type = "button";
    back.className = "xzdesk-chat-login-back";
    back.setAttribute("aria-label", t("backToChat"));
    back.textContent = "\u2190";
    back.addEventListener("click", closeAuthView);
    var heading = document.createElement("div");
    heading.className = "xzdesk-chat-login-heading";
    var title = document.createElement("h2");
    title.textContent = t(authPurpose === "support" ? "supportSignInTitle" : "signInTitle");
    var subtitle = document.createElement("p");
    subtitle.textContent = t(authPurpose === "support" ? "supportSignInSubtitle" : "signInSubtitle");
    heading.appendChild(title);
    heading.appendChild(subtitle);
    var card = document.createElement("div");
    card.className = "xzdesk-chat-login-card";
    var shopButton = document.createElement("button");
    shopButton.type = "button";
    shopButton.className = "xzdesk-chat-shop-login";
    shopButton.textContent = t("signInWithShop");
    shopButton.addEventListener("click", function(){ startCustomerLogin(""); });
    var divider = document.createElement("div");
    divider.className = "xzdesk-chat-login-divider";
    divider.innerHTML = "<span></span><b></b><span></span>";
    divider.querySelector("b").textContent = t("signInOr");
    var emailForm = document.createElement("form");
    emailForm.className = "xzdesk-chat-login-email";
    var authEmailInput = document.createElement("input");
    authEmailInput.type = "email";
    authEmailInput.autocomplete = "email";
    authEmailInput.required = true;
    authEmailInput.placeholder = t("signInEmail");
    var emailSubmit = document.createElement("button");
    emailSubmit.type = "submit";
    emailSubmit.setAttribute("aria-label", t("signIn"));
    emailSubmit.textContent = "\u2192";
    emailForm.appendChild(authEmailInput);
    emailForm.appendChild(emailSubmit);
    emailForm.addEventListener("submit", function(event){
      event.preventDefault();
      startCustomerLogin(authEmailInput.value.trim());
    });
    var disclosure = document.createElement("p");
    disclosure.className = "xzdesk-chat-login-disclosure";
    disclosure.appendChild(document.createTextNode(t("signInDisclosure") + " "));
    var terms = document.createElement("a");
    terms.href = "/policies/terms-of-service";
    terms.target = "_blank";
    terms.rel = "noreferrer";
    terms.textContent = t("terms");
    var privacy = document.createElement("a");
    privacy.href = "/policies/privacy-policy";
    privacy.target = "_blank";
    privacy.rel = "noreferrer";
    privacy.textContent = t("privacyPolicy");
    disclosure.appendChild(terms);
    disclosure.appendChild(document.createTextNode(" / "));
    disclosure.appendChild(privacy);
    card.appendChild(shopButton);
    card.appendChild(divider);
    card.appendChild(emailForm);
    card.appendChild(disclosure);
    authView.appendChild(back);
    authView.appendChild(heading);
    authView.appendChild(card);
    list.appendChild(authView);
  }
  function render(){
    list.innerHTML = "";
	var pendingOutbox = readOutbox();
    var loginGate = customerLoginRequired && customerSessionLoaded && !customerAuthenticated;
    form.hidden = !customerSessionLoaded || loginGate;
    workflowForm.hidden = !activeWorkflow;
    signInButton.textContent = customerAuthenticated ? customerAccountLabel() : t("signIn");
    signInButton.title = customerAuthenticated ? customerAccountLabel() : t("signIn");
    signInButton.hidden = !messages.length;
    renderOrderFollowup();
    if (authViewOpen && customerSessionLoaded && !customerAuthenticated) {
      form.hidden = true;
      workflowForm.hidden = true;
      instantBox.hidden = true;
      renderAuthView();
      return;
    }
    if (!messages.length && !pendingOutbox.length && !attachmentOutbox) {
      var welcome = document.createElement("section");
      welcome.className = "xzdesk-chat-welcome";
      var welcomeTop = document.createElement("div");
      welcomeTop.className = "xzdesk-chat-welcome-top";
      var welcomeCopy = document.createElement("div");
      var welcomeTitle = document.createElement("h2");
      welcomeTitle.textContent = t("greetingTitle");
      var welcomeText = document.createElement("p");
      welcomeText.textContent = displayWelcome();
      welcomeCopy.appendChild(welcomeTitle);
      welcomeCopy.appendChild(welcomeText);
      var auth = document.createElement("a");
      auth.className = "xzdesk-chat-auth" + (customerAuthenticated ? " signed-in" : "");
      auth.textContent = customerAuthenticated ? customerAccountLabel() : t("signIn");
      auth.title = customerAuthenticated ? customerAccountLabel() : t("signIn");
      auth.href = "#";
      auth.addEventListener("click", function(event){
        event.preventDefault();
        if (customerAuthenticated) {
          return;
        }
        openAuthView("general");
      });
      welcomeTop.appendChild(welcomeCopy);
      welcomeTop.appendChild(auth);
      welcome.appendChild(welcomeTop);
      if (featuredProductsEnabled && featuredProducts.length) {
        var featured = document.createElement("div");
        featured.className = "xzdesk-chat-featured";
        var featuredTitle = document.createElement("strong");
        featuredTitle.textContent = t("featuredProducts");
        var featuredList = document.createElement("div");
        featuredList.className = "xzdesk-chat-featured-list";
        featuredProducts.forEach(function(product){
          var link = document.createElement("a");
          link.className = "xzdesk-chat-featured-item";
          link.href = product.url;
          link.setAttribute("aria-label", t("openProduct") + ": " + product.title);
          if (product.imageUrl) {
            var image = document.createElement("img");
            image.src = product.imageUrl;
            image.alt = product.title;
            image.loading = "lazy";
            link.appendChild(image);
          } else {
            var imagePlaceholder = document.createElement("div");
            imagePlaceholder.className = "xzdesk-chat-featured-placeholder";
            imagePlaceholder.textContent = "Product";
            link.appendChild(imagePlaceholder);
          }
          var title = document.createElement("span");
          title.textContent = product.title;
          link.appendChild(title);
          if (product.price) {
            var price = document.createElement("b");
            price.textContent = product.price;
            link.appendChild(price);
          }
          featuredList.appendChild(link);
        });
        featured.appendChild(featuredTitle);
        featured.appendChild(featuredList);
        welcome.appendChild(featured);
      }
      var privacy = document.createElement("p");
      privacy.className = "xzdesk-chat-privacy";
      privacy.textContent = t("privacy");
      welcome.appendChild(privacy);
      list.appendChild(welcome);
      return;
    }
    messages.forEach(function(message){
      var item = document.createElement("div");
      item.className = "xzdesk-chat-bubble " + (message.direction === "agent" ? "agent" : message.direction === "system" ? "system" : "customer");
      var meta = document.createElement("small");
      meta.textContent = (message.direction === "agent" ? t("supportTeam") : message.direction === "system" ? t("automated") : t("you")) + " - " + new Date(message.createdAt).toLocaleString();
      item.appendChild(meta);
      var messageType = message.type || "text";
      var metadata = message.metadata || {};
      if (messageType === "image" && metadata.url) {
        var imageLink = document.createElement("a");
        imageLink.href = new URL(metadata.url, apiBase + "/").toString();
        imageLink.target = "_blank";
        imageLink.rel = "noreferrer";
        var image = document.createElement("img");
        image.src = imageLink.href;
        image.alt = metadata.fileName || "Chat image";
        imageLink.appendChild(image);
        item.appendChild(imageLink);
        if (message.body && message.body !== metadata.fileName) {
          var caption = document.createElement("div");
          caption.textContent = message.body;
          item.appendChild(caption);
        }
      } else if (messageType === "file" && metadata.url) {
        var fileLink = document.createElement("a");
        fileLink.className = "xzdesk-chat-file";
        var attachmentURL = new URL(metadata.url, apiBase + "/");
        if (metadata.fileName) attachmentURL.searchParams.set("name", metadata.fileName);
        fileLink.href = attachmentURL.toString();
        fileLink.target = "_blank";
        fileLink.rel = "noreferrer";
        fileLink.setAttribute("download", metadata.fileName || "");
        fileLink.setAttribute("aria-label", t("downloadFile") + ": " + (metadata.fileName || message.body || "File"));
        fileLink.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M8 14h8M8 18h5"/></svg>';
        var fileInfo = document.createElement("span");
        var fileNameLabel = document.createElement("strong");
        fileNameLabel.textContent = metadata.fileName || message.body || "File";
        var fileMeta = document.createElement("small");
        fileMeta.textContent = [metadata.mimeType || "", formatFileSize(metadata.fileSize)].filter(Boolean).join(" - ");
        fileInfo.appendChild(fileNameLabel);
        fileInfo.appendChild(fileMeta);
        fileLink.appendChild(fileInfo);
        item.appendChild(fileLink);
        if (message.body && message.body !== metadata.fileName) {
          var fileCaption = document.createElement("div");
          fileCaption.textContent = message.body;
          item.appendChild(fileCaption);
        }
      } else if (messageType === "product") {
        var product = document.createElement("article");
        product.className = "xzdesk-chat-product";
        var productImageURL = safeHTTPURL(metadata.imageUrl);
        if (productImageURL) {
          var productImage = document.createElement("img");
          productImage.src = productImageURL;
          productImage.alt = metadata.productTitle || "Product";
          product.appendChild(productImage);
        } else {
          var placeholder = document.createElement("div");
          placeholder.className = "xzdesk-chat-product-placeholder";
          placeholder.textContent = "Product";
          product.appendChild(placeholder);
        }
        var productInfo = document.createElement("div");
        var productTitle = document.createElement("strong");
        productTitle.textContent = metadata.productTitle || message.body || "Product";
        productInfo.appendChild(productTitle);
        if (metadata.variantTitle && metadata.variantTitle !== "Default Title") {
          var variantTitle = document.createElement("span");
          variantTitle.textContent = metadata.variantTitle;
          productInfo.appendChild(variantTitle);
        }
        var price = document.createElement("b");
        price.textContent = [metadata.currencyCode, metadata.price].filter(Boolean).join(" ");
        productInfo.appendChild(price);
        product.appendChild(productInfo);
        var onlineStoreURL = safeHTTPURL(metadata.onlineStoreUrl);
        if (onlineStoreURL) {
          var productLink = document.createElement("a");
          productLink.href = onlineStoreURL;
          productLink.target = "_blank";
          productLink.rel = "noreferrer";
          productLink.setAttribute("aria-label", "Open product");
          productLink.textContent = ">";
          product.appendChild(productLink);
        }
        item.appendChild(product);
        var productFallbackBody = [metadata.productTitle || "", metadata.variantTitle && metadata.variantTitle !== "Default Title" ? metadata.variantTitle : ""].filter(Boolean).join(" - ");
        if (message.body && message.body !== metadata.productTitle && message.body !== productFallbackBody) {
          var productCaption = document.createElement("div");
          productCaption.textContent = message.body;
          item.appendChild(productCaption);
        }
      } else {
        var body = document.createElement("div");
        body.textContent = message.body || "";
        item.appendChild(body);
      }
      list.appendChild(item);
    });
	pendingOutbox.forEach(function(pending){
	  var item = document.createElement("div");
	  item.className = "xzdesk-chat-bubble customer " + (pending.status === "failed" ? "failed" : "pending");
	  var meta = document.createElement("small");
	  meta.textContent = t("you") + " - " + new Date(pending.createdAt || Date.now()).toLocaleString();
	  item.appendChild(meta);
	  var body = document.createElement("div");
	  body.textContent = pending.body;
	  item.appendChild(body);
	  if (pending.status === "failed") {
		var retry = document.createElement("button");
		retry.type = "button";
		retry.className = "xzdesk-chat-send-retry";
		retry.textContent = t("retrySend");
		retry.addEventListener("click", function(){ retryOutboxItem(pending.id); });
		item.appendChild(retry);
	  } else {
		var state = document.createElement("small");
		state.className = "xzdesk-chat-send-state";
		state.textContent = t("sending");
		item.appendChild(state);
	  }
	  list.appendChild(item);
	});
	if (attachmentOutbox) {
	  var attachmentItem = document.createElement("div");
	  attachmentItem.className = "xzdesk-chat-bubble customer " + (attachmentOutbox.status === "failed" ? "failed" : "pending");
	  var attachmentMeta = document.createElement("small");
	  attachmentMeta.textContent = t("you") + " - " + new Date(attachmentOutbox.createdAt).toLocaleString();
	  attachmentItem.appendChild(attachmentMeta);
	  var attachmentBody = document.createElement("div");
	  attachmentBody.textContent = attachmentOutbox.caption || attachmentOutbox.file.name;
	  attachmentItem.appendChild(attachmentBody);
	  if (attachmentOutbox.status === "failed") {
		var attachmentRetry = document.createElement("button");
		attachmentRetry.type = "button";
		attachmentRetry.className = "xzdesk-chat-send-retry";
		attachmentRetry.textContent = t("retrySend");
		attachmentRetry.addEventListener("click", function(){ retryAttachmentUpload(); });
		attachmentItem.appendChild(attachmentRetry);
	  } else {
		var attachmentState = document.createElement("small");
		attachmentState.className = "xzdesk-chat-send-state";
		attachmentState.textContent = t("sending");
		attachmentItem.appendChild(attachmentState);
	  }
	  list.appendChild(attachmentItem);
	}
    list.scrollTop = list.scrollHeight;
  }
  function showError(message, kind){
	errorEl.hidden = !message;
	errorEl.textContent = message || "";
	errorEl.classList.toggle("saved", kind === "saved");
	errorEl.classList.toggle("retry", kind === "retry");
  }
  function appendMessages(nextMessages){
    var changed = false;
    var addedNotifiable = false;
    (nextMessages || []).forEach(function(message){
      if (!message || !message.id) return;
      if (!messages.some(function(item){ return item.id === message.id; })) {
        messages.push(message);
        if (isNotifiableMessage(message)) {
          addedNotifiable = true;
          if (!open) unreadCount = 1;
        }
        changed = true;
      }
    });
    if (changed) {
      if (open && addedNotifiable) markMessagesSeen();
      else updateUnread();
      render();
    }
  }
  function appendSelfServiceMessages(nextMessages){
    (nextMessages || []).forEach(function(message){
      if (!message || !message.id) return;
      if (!selfServiceMessages.some(function(item){ return item.id === message.id; })) {
        selfServiceMessages.push(message);
      }
    });
    appendMessages(nextMessages);
  }
  function replacePendingOrderTrackingMessage(nextMessages){
    var pendingIds = selfServiceMessages.filter(function(message){
      var metadata = message && message.metadata || {};
      return metadata.workflow === "order_tracking" && metadata.workflowPending === "true";
    }).map(function(message){ return message.id; });
    if (pendingIds.length) {
      selfServiceMessages = selfServiceMessages.filter(function(message){ return pendingIds.indexOf(message.id) < 0; });
      messages = messages.filter(function(message){ return pendingIds.indexOf(message.id) < 0; });
    }
    appendSelfServiceMessages((nextMessages || []).filter(function(message){
      return message && message.direction === "system";
    }));
  }
  function messagesWithSelfService(persistedMessages){
    var combined = (persistedMessages || []).slice();
    selfServiceMessages.forEach(function(message){
      if (!combined.some(function(item){ return item.id === message.id; })) combined.push(message);
    });
    return combined;
  }
  async function request(path, options){
    var response = await fetch(publicServiceURL(path), Object.assign({headers: {"Content-Type": "application/json"}}, options || {}));
    var text = await response.text();
    var payload = text ? JSON.parse(text) : null;
    if (!response.ok) throw new Error(payload && payload.error || response.status + " " + response.statusText);
    return payload;
  }
  async function requestFormData(path, body){
    var response = await fetch(publicServiceURL(path), {method: "POST", body: body});
    var text = await response.text();
    var payload = text ? JSON.parse(text) : null;
    if (!response.ok) throw new Error(payload && payload.error || response.status + " " + response.statusText);
    return payload;
  }
  function publicServiceURL(path){
    var target = new URL(path, apiBase + "/");
    if (tenantId) target.searchParams.set("tenant", tenantId);
    return target.toString();
  }
  function newClientMessageId(){
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return "msg_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 14);
  }
  function readOutbox(){
    try {
      var parsed = JSON.parse(chatStorageGet(outboxKey) || "[]");
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(function(item){
        return item && /^[A-Za-z0-9_-]{1,128}$/.test(String(item.id || "")) &&
          typeof item.body === "string" && !!item.body.trim();
      }).slice(0, 50).map(function(item){
        return {
          id: String(item.id),
          body: item.body.trim(),
          conversationId: String(item.conversationId || ""),
		  pageContext: item.pageContext && typeof item.pageContext === "object" ? item.pageContext : {},
		  createdAt: String(item.createdAt || ""),
		  status: item.status === "failed" || Number(item.attempts || 0) > 0 ? "failed" : "pending"
        };
      });
    } catch (_) {
      return [];
    }
  }
  function writeOutbox(items){
    try {
      return chatStorageSet(outboxKey, JSON.stringify(items));
    } catch (_) {
      return false;
    }
  }
  function enqueueTextMessage(body){
    var items = readOutbox();
    if (items.length >= 50) return false;
    items.push({
      id: newClientMessageId(),
      body: body,
      conversationId: conversationId,
	  pageContext: currentPageContext(),
	  createdAt: new Date().toISOString(),
	  status: "pending"
    });
    if (!writeOutbox(items)) return false;
	if (navigator.onLine === false) {
	  items[items.length - 1].status = "failed";
	  writeOutbox(items);
	}
	render();
    flushOutbox();
    return true;
  }
  function removeOutboxItem(id){
    return writeOutbox(readOutbox().filter(function(item){ return item.id !== id; }));
  }
  function bindOutboxConversation(nextConversationId){
    var items = readOutbox();
    items.forEach(function(item){
      if (!item.conversationId) item.conversationId = nextConversationId;
    });
    writeOutbox(items);
  }
  function retryOutboxItem(id){
	var items = readOutbox();
	var item = items.find(function(candidate){ return candidate.id === id; });
	if (!item) return;
	if (navigator.onLine === false) {
	  item.status = "failed";
	  writeOutbox(items);
	  render();
	  return;
	}
	item.status = "pending";
	if (!writeOutbox(items)) return;
	render();
	flushOutbox();
  }
  async function sendOutboxItem(item){
    var targetConversationId = item.conversationId || conversationId;
    var payload = Object.assign({
      shop: shop,
      conversationId: targetConversationId,
      body: item.body,
      visitorId: visitorId,
      customerSession: customerSession,
      clientMessageId: item.id
    }, item.pageContext || {});
    if (!targetConversationId) {
      var created = await request("/api/v1/public/chat/conversations", {method: "POST", body: JSON.stringify(payload)});
      conversationId = created.conversation.id;
      chatStorageSet(conversationKey, conversationId);
      bindOutboxConversation(conversationId);
      messages = selfServiceMessages.slice();
      appendMessages(created.messages || []);
      connect();
      return;
    }
    var messagePayload = Object.assign({
      body: item.body,
      visitorId: visitorId,
      customerSession: customerSession,
      clientMessageId: item.id
    }, item.pageContext || {});
    var message = await request("/api/v1/public/chat/conversations/" + encodeURIComponent(targetConversationId) + "/messages", {method: "POST", body: JSON.stringify(messagePayload)});
    conversationId = targetConversationId;
    chatStorageSet(conversationKey, conversationId);
    appendMessages([message]);
  }
  async function flushOutbox(){
    if (outboxFlushing || navigator.onLine === false || !customerSessionLoaded) return;
    if (customerLoginRequired && !customerAuthenticated) return;
    outboxFlushing = true;
    try {
	  while (true) {
		var items = readOutbox();
		var item = items.find(function(candidate){ return candidate.status !== "failed"; });
		if (!item) break;
		try {
		  await sendOutboxItem(item);
		  if (!removeOutboxItem(item.id)) throw new Error("Could not update the message outbox.");
		} catch (_) {
		  var failedItems = readOutbox();
		  var failedItem = failedItems.find(function(candidate){ return candidate.id === item.id; });
		  if (failedItem) {
			failedItem.status = "failed";
			writeOutbox(failedItems);
		  }
		}
		render();
	  }
    } finally {
      outboxFlushing = false;
    }
  }
  async function loadConfig(){
    try {
      var browserLanguage = browserLanguageCode();
      var config = await request("/api/v1/public/chat/config?shop=" + encodeURIComponent(shop) + "&language=" + encodeURIComponent(browserLanguage));
      request("/api/v1/public/chat/heartbeat", {
        method: "POST",
        body: JSON.stringify({shop: shop})
      }).catch(function(){ return null; });
      var metadata = config && config.source && config.source.metadata || {};
      shopName = config && config.shop && config.shop.displayName || "";
      configuredLanguage = metadata.visitorLanguage || configuredLanguage;
      if (config && config.localization) {
        translations[browserLanguage] = Object.assign({}, translations.en, config.localization);
      }
      activeLanguage = resolveLanguage(configuredLanguage === "auto" ? browserLanguage : configuredLanguage);
      instantAnswers = parseInstantAnswers(metadata);
      customerLoginRequired = metadata.customerLoginRequired !== "false";
      applyStaticText();
    } catch (error) {}
  }
  async function loadCustomerSession(){
    try {
      var sessionURL = new URL("/apps/xzdesk/chat/session", window.location.origin);
      if (tenantId) sessionURL.searchParams.set("tenant", tenantId);
      var response = await fetch(sessionURL.toString(), {cache: "no-store", headers: {"Accept": "application/json", "Cache-Control": "no-cache"}});
      if (!response.ok) return false;
      var payload = await response.json();
      customerAuthenticated = payload && payload.authenticated === true && !!payload.token;
      customerSession = customerAuthenticated ? String(payload.token) : "";
      customerName = customerAuthenticated ? String(payload.customerName || "").trim() : "";
      customerEmail = customerAuthenticated ? String(payload.customerEmail || "").trim() : "";
    } catch (error) {
      customerAuthenticated = false;
      customerSession = "";
      customerName = "";
      customerEmail = "";
    } finally {
      customerSessionLoaded = true;
      renderInstantAnswers();
      render();
    }
    return customerAuthenticated;
  }
  function customerSessionSuffix(){
    return customerSession ? "?customerSession=" + encodeURIComponent(customerSession) : "";
  }
  async function loadMessages(){
    if (!conversationId) return;
    if (customerLoginRequired && customerSessionLoaded && !customerAuthenticated) return;
    try {
      messages = messagesWithSelfService(await request("/api/v1/public/chat/conversations/" + encodeURIComponent(conversationId) + "/messages" + customerSessionSuffix()));
      if (open) markMessagesSeen();
      else restoreUnreadFromMessages();
      render();
      connect();
    } catch (error) {
      conversationId = "";
      chatStorageRemove(conversationKey);
    }
  }
  async function syncMessages(expectedConversationId){
    if (!expectedConversationId || conversationId !== expectedConversationId) return;
    try {
      var nextMessages = await request("/api/v1/public/chat/conversations/" + encodeURIComponent(expectedConversationId) + "/messages" + customerSessionSuffix());
      if (conversationId === expectedConversationId) appendMessages(nextMessages);
    } catch (error) {}
  }
  function clearSocketHeartbeat(){
    if (!socketHeartbeatTimer) return;
    window.clearInterval(socketHeartbeatTimer);
    socketHeartbeatTimer = null;
  }
  function scheduleSocketReconnect(){
	if (!conversationId || socketReconnectTimer) return;
	if (document.hidden || navigator.onLine === false) return;
	var delays = [1000, 2000, 4000, 8000, 15000, 30000];
	var baseDelay = delays[Math.min(socketReconnectAttempt, delays.length - 1)];
	socketReconnectAttempt += 1;
	var delay = Math.max(250, Math.round(baseDelay * (0.8 + Math.random() * 0.4)));
	socketReconnectTimer = window.setTimeout(function(){
	  socketReconnectTimer = null;
	  connect();
	}, delay);
  }
  function connect(){
	if (!conversationId || socket && socket.readyState < 2) return;
	if (document.hidden || navigator.onLine === false) return;
    if (customerLoginRequired && customerSessionLoaded && !customerAuthenticated) return;
    if (socketReconnectTimer) {
      window.clearTimeout(socketReconnectTimer);
      socketReconnectTimer = null;
    }
    var expectedConversationId = conversationId;
    var socketUrl = new URL(apiBase + "/ws/chat");
    socketUrl.protocol = socketUrl.protocol === "https:" ? "wss:" : "ws:";
    socketUrl.searchParams.set("conversationId", expectedConversationId);
    if (tenantId) socketUrl.searchParams.set("tenant", tenantId);
    if (customerSession) socketUrl.searchParams.set("customerSession", customerSession);
    var nextSocket = new WebSocket(socketUrl.toString());
    socket = nextSocket;
    nextSocket.onopen = function(){
	  if (socket !== nextSocket || conversationId !== expectedConversationId) return;
	  socketReconnectAttempt = 0;
      clearSocketHeartbeat();
      socketHeartbeatTimer = window.setInterval(function(){
        if (socket !== nextSocket || nextSocket.readyState !== WebSocket.OPEN) return;
        try {
          nextSocket.send("ping");
        } catch (error) {
          nextSocket.close();
        }
      }, 25000);
      syncMessages(expectedConversationId);
      flushOutbox();
    };
    nextSocket.onmessage = function(event){
      try {
        var payload = JSON.parse(event.data);
        if (payload.type === "message.created" && payload.payload && payload.payload.conversationId === expectedConversationId && conversationId === expectedConversationId) {
          appendMessages([payload.payload]);
        }
      } catch (error) {}
    };
    nextSocket.onerror = function(){
      if (socket === nextSocket) nextSocket.close();
    };
    nextSocket.onclose = function(){
      if (socket !== nextSocket) return;
      socket = null;
      clearSocketHeartbeat();
      scheduleSocketReconnect();
    };
  }
  async function send(body){
    if (!enqueueTextMessage(body)) throw new Error("Could not save the message before sending.");
  }
  async function sendAttachment(file, caption, clientMessageId){
    var pageContext = currentPageContext();
    var body = new FormData();
    body.append("file", file);
    body.append("shop", shop);
    body.append("conversationId", conversationId);
    body.append("visitorId", visitorId);
    body.append("caption", caption);
    body.append("pageTitle", pageContext.pageTitle || "");
    body.append("pageUrl", pageContext.pageUrl || "");
    body.append("productHandle", pageContext.productHandle || "");
    body.append("productTitle", pageContext.productTitle || "");
    body.append("productImageUrl", pageContext.productImageUrl || "");
    body.append("productPrice", pageContext.productPrice || "");
    body.append("productCurrencyCode", pageContext.productCurrencyCode || "");
    body.append("customerSession", customerSession);
	body.append("clientMessageId", clientMessageId || newClientMessageId());
    var created = await requestFormData("/api/v1/public/chat/attachments", body);
    conversationId = created.conversation.id;
    chatStorageSet(conversationKey, conversationId);
    appendMessages(created.messages || []);
    if (!customerLoginRequired || customerAuthenticated) connect();
  }
	async function retryAttachmentUpload(){
	  if (!attachmentOutbox || attachmentOutbox.status === "sending") return;
	  attachmentOutbox.status = "sending";
	  render();
	  try {
		await sendAttachment(attachmentOutbox.file, attachmentOutbox.caption, attachmentOutbox.id);
		attachmentOutbox = null;
		selectedAttachment = null;
		attachmentInput.value = "";
		updateAttachmentPreview();
		render();
	  } catch (_) {
		if (attachmentOutbox) attachmentOutbox.status = "failed";
		render();
	  }
	}
  async function sendInstantAnswer(answer){
    var payload = Object.assign({shop: shop, answerId: answer.id, visitorId: visitorId, customerSession: customerSession, language: browserLanguageCode()}, currentPageContext());
    var created = await request("/api/v1/public/chat/instant-answer", {method: "POST", body: JSON.stringify(payload)});
    appendSelfServiceMessages(created.messages || []);
  }
  async function runOrderTrackingLookup(payload, initial, attempt, pollVersion){
    var created = await request("/api/v1/public/chat/workflows/order-tracking", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    if (pollVersion !== orderTrackingPollVersion) return created;
    if (initial) appendSelfServiceMessages(created.messages || []);
    else replacePendingOrderTrackingMessage(created.messages || []);
    if (created.pending === true && attempt < 12) {
      window.setTimeout(function(){
        if (pollVersion !== orderTrackingPollVersion) return;
        runOrderTrackingLookup(payload, false, attempt + 1, pollVersion).catch(function(){});
	  }, 5000);
    }
    return created;
  }
  async function trackSignedInOrder(answer){
    orderTrackingPollVersion += 1;
    var payload = Object.assign({
      shop: shop,
      answerId: answer.id,
      customerSession: customerSession,
      visitorId: visitorId,
      language: browserLanguageCode()
    }, currentPageContext());
    return runOrderTrackingLookup(payload, true, 0, orderTrackingPollVersion);
  }
  function clearOrderFollowup(){
    selfServiceMessages.forEach(function(message){
      var metadata = message && message.metadata || {};
      if (metadata.workflow === "order_tracking") metadata.workflowStatus = "";
    });
  }
  async function requestHumanSupport(){
    if (supportRequestInFlight) return;
    if (customerLoginRequired && !customerAuthenticated) {
      supportAfterLogin = true;
      try { sessionStorage.setItem(supportAfterLoginKey, "1"); } catch (_) {}
      openAuthView("support");
      return;
    }
    supportRequestInFlight = true;
    orderSignInButton.disabled = true;
    showError("");
    try {
      await send(t("contactSupportMessage"));
      clearOrderFollowup();
      render();
    } catch (error) {
      showError(t("sendError"));
    } finally {
      supportRequestInFlight = false;
      orderSignInButton.disabled = false;
    }
  }
  button.addEventListener("click", function(){
    chatInteractionStarted = true;
    open = !open;
    panel.classList.toggle("open", open);
    if (open) {
      markMessagesSeen();
      if (!customerLoginRequired || customerAuthenticated) loadMessages();
    }
  });
  signInButton.addEventListener("click", function(){ openAuthView("general"); });
  orderRetryButton.addEventListener("click", function(){
    var answerId = orderFollowup.getAttribute("data-answer-id") || "";
    var answer = instantAnswers.find(function(item){
      return item.mode === "order_tracking" && (!answerId || item.id === answerId);
    });
    if (!answer) return;
    activeWorkflow = answer;
    orderNumberInput.value = "";
    workflowEmailInput.value = "";
    showError("");
    renderInstantAnswers();
    render();
    orderNumberInput.focus();
  });
  orderSignInButton.addEventListener("click", requestHumanSupport);
  expandButton.addEventListener("click", function(){
    expanded = !expanded;
    panel.classList.toggle("expanded", expanded);
    expandButton.setAttribute("aria-label", expanded ? t("minimize") : t("expand"));
    applyTheme();
  });
  panel.querySelector(".xzdesk-chat-close").addEventListener("click", function(){
    open = false;
    panel.classList.remove("open");
  });
  workflowCancel.addEventListener("click", function(){
    showError("");
    activeWorkflow = null;
    orderNumberInput.value = "";
    renderInstantAnswers();
    render();
  });
  instantList.addEventListener("click", async function(event){
    var target = event.target && event.target.closest ? event.target.closest("[data-xzdesk-instant-id]") : null;
    if (!target) return;
    var answerId = target.getAttribute("data-xzdesk-instant-id") || "";
    var answer = instantAnswers.find(function(item){ return item.id === answerId; });
    if (!answer) return;
    if (target.disabled) return;
    showError("");
    target.disabled = true;
    try {
      if (answer.mode === "order_tracking" && customerSession) {
        try {
          await trackSignedInOrder(answer);
          bodyInput.value = "";
          return;
        } catch (error) {
          customerSession = "";
          customerAuthenticated = false;
          render();
        }
      }
      await sendInstantAnswer(answer);
      bodyInput.value = "";
      if (answer.mode === "order_tracking") {
        activeWorkflow = answer;
        workflowEmailInput.value = "";
        renderInstantAnswers();
        render();
        orderNumberInput.focus();
      }
    } catch (error) {
      showError(t("sendError"));
    } finally {
      target.disabled = false;
    }
  });
  workflowForm.addEventListener("submit", async function(event){
    event.preventDefault();
    if (!activeWorkflow) return;
    showError("");
    var submitButton = workflowForm.querySelector('button[type="submit"]');
    if (submitButton.disabled) return;
    submitButton.disabled = true;
    submitButton.textContent = t("checkingOrder");
    try {
      orderTrackingPollVersion += 1;
      var trackingPayload = Object.assign({shop: shop, answerId: activeWorkflow.id, orderNumber: orderNumberInput.value.trim(), customerEmail: workflowEmailInput.value.trim(), customerSession: customerSession, visitorId: visitorId, language: browserLanguageCode()}, currentPageContext());
      await runOrderTrackingLookup(trackingPayload, true, 0, orderTrackingPollVersion);
      activeWorkflow = null;
      orderNumberInput.value = "";
      renderInstantAnswers();
      render();
    } catch (error) { showError(t("orderError")); }
    finally {
      submitButton.disabled = false;
      submitButton.textContent = t("checkOrder");
    }
  });
  attachmentButton.addEventListener("click", function(){
    attachmentInput.click();
  });
  attachmentInput.addEventListener("change", function(){
    showError("");
    var file = attachmentInput.files && attachmentInput.files[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      selectedAttachment = null;
      attachmentInput.value = "";
      updateAttachmentPreview();
      showError(t("attachmentTooLarge"));
      return;
    }
    if (!supportedAttachment(file)) {
      selectedAttachment = null;
      attachmentInput.value = "";
      updateAttachmentPreview();
      showError(t("attachmentUnsupported"));
      return;
    }
    selectedAttachment = file;
    updateAttachmentPreview();
  });
  pendingAttachmentRemove.addEventListener("click", function(){
    selectedAttachment = null;
    attachmentInput.value = "";
    updateAttachmentPreview();
  });
  bodyInput.addEventListener("keydown", function(event){
    if (event.key !== "Enter" || event.shiftKey || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    form.requestSubmit();
  });
  form.addEventListener("submit", async function(event){
    event.preventDefault();
    showError("");
    var body = bodyInput.value.trim();
    if (!body && !selectedAttachment) return;
    var submitButton = form.querySelector('button[type="submit"]');
    if (submitButton.disabled) return;
    submitButton.disabled = true;
    attachmentButton.disabled = true;
    try {
      if (selectedAttachment) {
		if (!attachmentOutbox) {
		  attachmentOutbox = {id: newClientMessageId(), file: selectedAttachment, caption: body, createdAt: new Date().toISOString(), status: "failed"};
		}
		await retryAttachmentUpload();
      } else {
        await send(body);
      }
      bodyInput.value = "";
    } catch (error) {
      if (!selectedAttachment) showError(t("sendError"));
    } finally {
      submitButton.disabled = false;
      attachmentButton.disabled = false;
    }
  });
  window.addEventListener("resize", applyTheme);
  window.addEventListener("online", function(){
    connect();
    syncMessages(conversationId);
    flushOutbox();
  });
  window.addEventListener("focus", function(){
    if (authPopup || authViewOpen) refreshCustomerLogin();
  });
  window.addEventListener("storage", function(event){
    if (event.key === authCompleteKey) refreshCustomerLogin();
    if (persistentChatStorageAllowed && event.key === conversationKey && event.newValue) conversationId = event.newValue;
    if (persistentChatStorageAllowed && (event.key === outboxKey || event.key === conversationKey)) flushOutbox();
  });
  window.addEventListener("message", function(event){
    if (event.origin === window.location.origin && event.data && event.data.type === "xzdesk-customer-login-complete" && event.data.shop === shop) {
      refreshCustomerLogin();
    }
  });
  document.addEventListener("visibilitychange", function(){
	if (document.hidden) {
	  if (socket && socket.readyState < 2) socket.close(1000, "page hidden");
	  return;
	}
    connect();
    syncMessages(conversationId);
    flushOutbox();
  });
  applyStaticText();
  var reopenAfterCustomerLogin = false;
  try {
    if (sessionStorage.getItem(reopenAfterLoginKey) === "1") {
      reopenAfterCustomerLogin = true;
    }
  } catch (_) {}
  try {
    if (sessionStorage.getItem(supportAfterLoginKey) === "1") {
      supportAfterLogin = true;
    }
  } catch (_) {}
  Promise.all([loadConfig(), loadCustomerSession()]).then(function(){
    if (isCustomerLoginPopup && customerAuthenticated) {
      try { localStorage.setItem(authCompleteKey, String(Date.now())); } catch (_) {}
      try {
        if (window.opener) window.opener.postMessage({type: "xzdesk-customer-login-complete", shop: shop}, window.location.origin);
      } catch (_) {}
      try { sessionStorage.removeItem(reopenAfterLoginKey); } catch (_) {}
      window.close();
      return;
    }
    if (reopenAfterCustomerLogin) {
      try { sessionStorage.removeItem(reopenAfterLoginKey); } catch (_) {}
      open = true;
      panel.classList.add("open");
    }
    render();
    if (conversationId && (!customerLoginRequired || customerAuthenticated)) loadMessages();
    flushOutbox();
    if (customerAuthenticated && supportAfterLogin) {
      supportAfterLogin = false;
      try { sessionStorage.removeItem(supportAfterLoginKey); } catch (_) {}
      requestHumanSupport();
    }
  });
})();
