(() => {
  "use strict";

  const mode = document.body.dataset.supportMode;
  const parts = location.pathname.split("/").filter(Boolean);
  const resourceId = decodeURIComponent(parts[1] || "");
  const customerMode = mode === "customer";
  const customerCsrfKeys = [
    `uchihaCustomerCsrf:${resourceId}`,
    `uchiha:customer-csrf:${resourceId}`
  ];
  let csrfToken = customerMode
    ? customerCsrfKeys.map((key) => sessionStorage.getItem(key) || "").find(Boolean) || ""
    : sessionStorage.getItem("uchihaBuilderCsrf") || "";
  let activeThread = null;
  let threads = [];
  let refreshInProgress = false;

  const ALLOWED_ATTACHMENT_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/pdf",
    "text/plain"
  ]);
  const MAX_ATTACHMENT_BYTES = 4_000_000;

  const notice = document.querySelector("#supportNotice");
  const workspace = document.querySelector("#supportWorkspace");
  const authPanel = document.querySelector("#supportAuth");
  const threadList = document.querySelector("#supportThreads");
  const empty = document.querySelector("#supportEmpty");
  const activeConversation = document.querySelector("#supportActiveConversation");
  const messagesContainer = document.querySelector("#supportMessages");

  function element(tag, options = {}, children = []) {
    const node = document.createElement(tag);
    if (options.className) node.className = options.className;
    if (options.text !== undefined) node.textContent = options.text;
    if (options.type) node.type = options.type;
    if (options.attributes) {
      for (const [name, value] of Object.entries(options.attributes)) {
        if (value !== null && value !== undefined) node.setAttribute(name, String(value));
      }
    }
    for (const child of children) if (child) node.append(child);
    return node;
  }

  function showNotice(message, type = "error") {
    notice.textContent = message;
    notice.className = `notice ${type}`;
    notice.hidden = false;
  }

  function hideNotice() {
    notice.hidden = true;
  }

  function saveCsrf(value) {
    csrfToken = value;
    if (customerMode) {
      for (const key of customerCsrfKeys) sessionStorage.setItem(key, value);
    } else {
      sessionStorage.setItem("uchihaBuilderCsrf", value);
    }
  }

  async function api(path, options = {}) {
    const method = options.method || "GET";
    const headers = { accept: "application/json", ...(options.headers || {}) };
    if (options.body !== undefined) headers["content-type"] = "application/json";
    if (!["GET", "HEAD", "OPTIONS"].includes(method) && csrfToken) {
      headers[customerMode ? "x-customer-csrf-token" : "x-csrf-token"] = csrfToken;
    }
    const response = await fetch(path, {
      ...options,
      method,
      headers,
      credentials: "same-origin",
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.message || "تعذر إكمال العملية");
      error.status = response.status;
      error.code = data.code || "request_failed";
      throw error;
    }
    if (data.csrfToken) saveCsrf(data.csrfToken);
    return data;
  }

  function statusLabel(status) {
    return {
      open: "تحتاج ردًا",
      waiting_customer: "بانتظار العميل",
      resolved: "تم الحل",
      closed: "مغلقة"
    }[status] || status;
  }

  function formatTime(value) {
    if (!value) return "";
    return new Intl.DateTimeFormat("ar", {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(value));
  }

  function formatBytes(value) {
    const bytes = Number(value || 0);
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function routes() {
    if (customerMode) {
      const prefix = `/api/public/stores/${encodeURIComponent(resourceId)}/support-v2`;
      return {
        list: prefix,
        messages: (threadId) => `${prefix}/${encodeURIComponent(threadId)}/messages`,
        create: prefix,
        read: (threadId) => `${prefix}/${encodeURIComponent(threadId)}/read`
      };
    }
    const prefix = `/api/stores/${encodeURIComponent(resourceId)}/support-v2`;
    return {
      list: `${prefix}?status=${encodeURIComponent(document.querySelector("#supportStatusFilter")?.value || "open")}`,
      messages: (threadId) => `${prefix}/${encodeURIComponent(threadId)}/messages`,
      status: (threadId) => `${prefix}/${encodeURIComponent(threadId)}/status`,
      read: (threadId) => `${prefix}/${encodeURIComponent(threadId)}/read`
    };
  }

  async function attachmentPayload(file) {
    if (!file) return null;
    if (!ALLOWED_ATTACHMENT_TYPES.has(file.type)) {
      throw new Error("اختر صورة JPG/PNG/WebP أو ملف PDF/TXT فقط.");
    }
    if (!file.size || file.size > MAX_ATTACHMENT_BYTES) {
      throw new Error("حجم المرفق يجب ألا يتجاوز 4MB.");
    }
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("تعذر قراءة الملف من الجهاز."));
      reader.readAsDataURL(file);
    });
    return { fileName: file.name || "attachment", mimeType: file.type, data };
  }

  function renderThreads() {
    threadList.replaceChildren();
    if (!threads.length) {
      threadList.append(
        element("div", { className: "support-list-empty" }, [
          element("span", { text: "◇" }),
          element("strong", { text: customerMode ? "لا توجد محادثات بعد" : "لا توجد محادثات بهذه الحالة" }),
          element("p", {
            text: customerMode
              ? "ابدأ محادثة عندما تحتاج مساعدة."
              : "غيّر مرشح الحالة أو حدّث القائمة."
          })
        ])
      );
      return;
    }
    for (const thread of threads) {
      const unread = Number(thread.unreadCount || 0);
      const button = element("button", {
        type: "button",
        className: activeThread?.id === thread.id ? "active" : ""
      }, [
        element("span", { className: `support-thread-priority ${thread.priority}`, text: thread.priority === "urgent" ? "عاجل" : statusLabel(thread.status) }),
        unread > 0 ? element("span", { className: "support-thread-unread", text: unread > 99 ? "99+" : String(unread) }) : null,
        element("strong", { text: thread.subject }),
        customerMode
          ? null
          : element("small", { text: `${thread.customer?.displayName || "عميل"} — ${thread.customer?.email || ""}` }),
        element("time", { text: formatTime(thread.lastMessageAt) })
      ]);
      button.addEventListener("click", () => openThread(thread.id));
      threadList.append(button);
    }
  }

  function attachmentNode(attachment) {
    const href = attachment.downloadUrl;
    const meta = element("span", { className: "support-attachment-meta" }, [
      element("strong", { text: attachment.fileName || "مرفق" }),
      element("small", { text: `${attachment.mimeType || "ملف"} • ${formatBytes(attachment.sizeBytes)}` })
    ]);
    const link = element("a", {
      className: "support-attachment",
      attributes: { href, target: "_blank", rel: "noopener" }
    });
    if (String(attachment.mimeType || "").startsWith("image/")) {
      const image = element("img", {
        className: "support-attachment-preview",
        attributes: { src: href, alt: attachment.fileName || "صورة مرفقة", loading: "lazy" }
      });
      link.append(image, meta);
    } else {
      link.append(element("span", { text: attachment.mimeType === "application/pdf" ? "PDF" : "FILE" }), meta);
    }
    return link;
  }

  function renderMessages(messages) {
    messagesContainer.replaceChildren();
    for (const message of messages) {
      const mine = customerMode
        ? message.authorType === "customer"
        : message.authorType === "staff";
      const children = [
        element("div", {}, [
          element("strong", {
            text:
              message.authorName ||
              (message.authorType === "customer" ? "العميل" : "فريق الدعم")
          }),
          element("time", { text: formatTime(message.createdAt) })
        ]),
        element("p", { text: message.message || "" })
      ];
      if (Array.isArray(message.attachments) && message.attachments.length) {
        children.push(
          element("div", { className: "support-message-attachments" }, message.attachments.map(attachmentNode))
        );
      }
      messagesContainer.append(element("article", { className: mine ? "mine" : "theirs" }, children));
    }
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  async function openThread(threadId) {
    hideNotice();
    try {
      const data = await api(routes().messages(threadId));
      activeThread = data.thread;
      threads = threads.map((thread) =>
        thread.id === threadId ? { ...thread, ...data.thread, unreadCount: 0 } : thread
      );
      renderThreads();
      empty.hidden = true;
      activeConversation.hidden = false;
      document.querySelector("#activeThreadSubject").textContent = activeThread.subject;
      if (customerMode) {
        const status = document.querySelector("#activeThreadStatus");
        status.textContent = statusLabel(activeThread.status);
        status.className = `status-badge ${activeThread.status === "resolved" ? "active" : ""}`;
      } else {
        document.querySelector("#activeThreadCustomer").textContent =
          `${activeThread.customer?.displayName || "عميل"} — ${activeThread.customer?.email || ""}`;
        document.querySelector("#activeThreadStatus").value = activeThread.status;
      }
      renderMessages(data.messages || []);
    } catch (error) {
      showNotice(error.message);
    }
  }

  async function loadThreads({ preserveSelection = true } = {}) {
    hideNotice();
    const data = await api(routes().list);
    threads = data.threads || [];
    if (!preserveSelection || !threads.some((thread) => thread.id === activeThread?.id)) {
      activeThread = null;
      empty.hidden = false;
      activeConversation.hidden = true;
    }
    renderThreads();
    if (activeThread) await openThread(activeThread.id);
  }

  const refreshTimer = window.setInterval(async () => {
    if (document.hidden || workspace?.hidden || refreshInProgress) return;
    refreshInProgress = true;
    try {
      await loadThreads();
    } catch {
      // Keep the conversation usable during a short connectivity interruption.
    } finally {
      refreshInProgress = false;
    }
  }, 15_000);
  window.addEventListener("pagehide", () => window.clearInterval(refreshTimer), { once: true });

  document.querySelector("#supportReplyForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!activeThread) return;
    const textarea = event.currentTarget.elements.message;
    const fileInput = event.currentTarget.elements.attachment;
    const message = textarea.value.trim();
    const file = fileInput?.files?.[0] || null;
    if (!message && !file) {
      showNotice("اكتب رسالة أو اختر صورة/ملفًا لإرساله.");
      return;
    }
    const button = event.currentTarget.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      const attachment = await attachmentPayload(file);
      await api(routes().messages(activeThread.id), {
        method: "POST",
        body: { message, attachment }
      });
      textarea.value = "";
      if (fileInput) fileInput.value = "";
      await openThread(activeThread.id);
      await loadThreads();
    } catch (error) {
      showNotice(error.message);
    } finally {
      button.disabled = false;
    }
  });

  if (customerMode) {
    const storeUrl = `/store/${encodeURIComponent(resourceId)}`;
    document.querySelector("#supportStoreLink").href = storeUrl;
    document.querySelector("#supportBackLink").href = storeUrl;
    document.querySelector("#supportCreateAccount").href =
      `/store/${encodeURIComponent(resourceId)}/wallet`;

    document.querySelector("#supportLoginForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      hideNotice();
      const values = Object.fromEntries(new FormData(event.currentTarget));
      try {
        await api(`/api/public/stores/${encodeURIComponent(resourceId)}/customers/login`, {
          method: "POST",
          body: values
        });
        authPanel.hidden = true;
        workspace.hidden = false;
        await api(`/api/public/stores/${encodeURIComponent(resourceId)}/customer/me`);
        await loadThreads();
      } catch (error) {
        showNotice(error.message);
      }
    });

    const newThreadForm = document.querySelector("#newThreadForm");
    document.querySelector("#newThreadTrigger").addEventListener("click", () => {
      newThreadForm.hidden = false;
      newThreadForm.elements.subject.focus();
    });
    document.querySelector("#cancelNewThread").addEventListener("click", () => {
      newThreadForm.hidden = true;
      newThreadForm.reset();
    });
    newThreadForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(event.currentTarget));
      const file = event.currentTarget.elements.attachment?.files?.[0] || null;
      const message = String(values.message || "").trim();
      if (!message && !file) {
        showNotice("اكتب تفاصيل المحادثة أو اختر صورة/ملفًا.");
        return;
      }
      const button = event.currentTarget.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        const attachment = await attachmentPayload(file);
        const data = await api(routes().create, {
          method: "POST",
          body: {
            subject: values.subject,
            message,
            attachment,
            priority: values.priority === "urgent" ? "urgent" : "normal"
          }
        });
        event.currentTarget.reset();
        event.currentTarget.hidden = true;
        await loadThreads({ preserveSelection: false });
        await openThread(data.thread.id);
        showNotice("تم بدء المحادثة وسيظهر رد المتجر هنا.", "success");
      } catch (error) {
        showNotice(error.message);
      } finally {
        button.disabled = false;
      }
    });
  } else {
    document.querySelector("#supportBackLink").href =
      `/admin/${encodeURIComponent(resourceId)}`;
    document.querySelector("#supportStatusFilter").addEventListener("change", () => {
      loadThreads({ preserveSelection: false }).catch((error) => showNotice(error.message));
    });
    document.querySelector("#refreshSupport").addEventListener("click", () => {
      loadThreads().catch((error) => showNotice(error.message));
    });
    document.querySelector("#activeThreadStatus").addEventListener("change", async (event) => {
      if (!activeThread) return;
      try {
        const data = await api(routes().status(activeThread.id), {
          method: "PUT",
          body: { status: event.target.value }
        });
        activeThread = { ...activeThread, ...data.thread };
        await loadThreads();
        showNotice("تم تحديث حالة المحادثة.", "success");
      } catch (error) {
        showNotice(error.message);
      }
    });
  }

  async function start() {
    try {
      if (customerMode) {
        const store = await api(
          `/api/storefront/${encodeURIComponent(resourceId)}?catalogOnly=1&limit=1`
        );
        document.title = `مركز المحادثة — ${store.store.name}`;
        document.querySelector("#supportStoreName").textContent = store.store.name;
        try {
          await api(`/api/public/stores/${encodeURIComponent(resourceId)}/customer/me`);
        } catch (error) {
          if (error.status === 401) {
            authPanel.hidden = false;
            workspace.hidden = true;
            return;
          }
          throw error;
        }
      } else {
        await api("/api/me");
      }
      if (authPanel) authPanel.hidden = true;
      workspace.hidden = false;
      await loadThreads();
    } catch (error) {
      showNotice(error.message);
    }
  }

  start();
})();
