import { createHash, randomUUID } from "node:crypto";
import { decryptSecret, encryptSecret, safeText } from "./security.mjs";
import {
  PaymentError,
  authenticateCustomer,
  authenticatePlatform,
  requireCustomerCsrf,
  requirePlatformCsrf,
  requireStoreAccess,
  storeBySlug
} from "./payments.mjs";

const SUPPORT_CHAT_APPS = new WeakSet();
const THREAD_STATUSES = new Set(["open", "waiting_customer", "resolved", "closed"]);
const ALLOWED_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "text/plain"
]);
const MAX_ATTACHMENT_BYTES = 4_000_000;
const SUPPORT_BODY_LIMIT = 6 * 1024 * 1024;

function text(value, maxLength = 3000) {
  return safeText(value, maxLength);
}

function requiredText(value, field, maxLength = 3000) {
  const result = text(value, maxLength);
  if (!result) throw new PaymentError(422, "missing_field", `الحقل ${field} مطلوب`);
  return result;
}

function fileName(value) {
  const normalized = text(value, 180)
    .replace(/[\\/\0]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || "attachment";
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function signatureMatches(mime, bytes) {
  if (mime === "image/png") {
    return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  if (mime === "image/jpeg") {
    return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
  }
  if (mime === "image/webp") {
    return bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  }
  if (mime === "application/pdf") return bytes.length >= 5 && bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  if (mime === "text/plain") {
    if (bytes.includes(0)) return false;
    const decoded = bytes.toString("utf8");
    return Buffer.from(decoded, "utf8").equals(bytes);
  }
  return false;
}

function parseAttachment(value) {
  if (!value) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PaymentError(422, "invalid_attachment", "بيانات المرفق غير صالحة");
  }
  const mime = text(value.mimeType, 100).toLowerCase();
  if (!ALLOWED_MIMES.has(mime)) {
    throw new PaymentError(422, "unsupported_attachment", "المرفق يجب أن يكون صورة JPG/PNG/WebP أو PDF أو TXT");
  }
  const raw = String(value.data || "");
  const prefix = `data:${mime};base64,`;
  if (!raw.startsWith(prefix)) throw new PaymentError(422, "invalid_attachment", "صيغة المرفق غير صالحة");
  const encoded = raw.slice(prefix.length);
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
    throw new PaymentError(422, "invalid_attachment", "بيانات المرفق غير صالحة");
  }
  const bytes = Buffer.from(encoded, "base64");
  if (!bytes.length || bytes.length > MAX_ATTACHMENT_BYTES) {
    throw new PaymentError(422, "attachment_too_large", "حجم المرفق يجب ألا يتجاوز 4MB");
  }
  if (!signatureMatches(mime, bytes)) {
    throw new PaymentError(422, "attachment_content_mismatch", "محتوى الملف لا يطابق نوعه");
  }
  return { name: fileName(value.fileName), mime, bytes, hash: digest(bytes) };
}

function attachmentDto(row, downloadUrl) {
  return {
    id: row.id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    createdAt: row.created_at,
    downloadUrl
  };
}

function threadDto(row) {
  return {
    id: row.id,
    subject: row.subject,
    status: row.status,
    priority: row.priority,
    unreadCount: Number(row.unread_count || 0),
    customer: row.customer_id
      ? { id: row.customer_id, displayName: row.customer_name || null, email: row.customer_email || null }
      : undefined,
    lastMessageAt: row.last_message_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function messageDto(row, attachments) {
  return {
    id: row.id,
    authorType: row.author_type,
    authorName: row.author_customer_name || row.author_user_name || (row.author_type === "customer" ? "العميل" : "فريق الدعم"),
    message: row.message,
    createdAt: row.created_at,
    attachments
  };
}

async function customerThread(db, store, customer, threadId) {
  const row = (await db.query(
    `SELECT * FROM support_threads
     WHERE id=$1 AND tenant_id=$2 AND store_id=$3 AND customer_id=$4`,
    [threadId, store.tenant_id, store.id, customer.id]
  )).rows[0];
  if (!row) throw new PaymentError(404, "support_thread_not_found", "محادثة الدعم غير موجودة");
  return row;
}

async function adminThread(db, store, threadId) {
  const row = (await db.query(
    `SELECT st.*, c.display_name AS customer_name, c.email AS customer_email
     FROM support_threads st
     JOIN store_customers c ON c.id=st.customer_id
     WHERE st.id=$1 AND st.tenant_id=$2 AND st.store_id=$3`,
    [threadId, store.tenant_id, store.id]
  )).rows[0];
  if (!row) throw new PaymentError(404, "support_thread_not_found", "محادثة الدعم غير موجودة");
  return row;
}

async function insertAttachment(client, config, { store, threadId, messageId, uploaderType, customerId = null, userId = null, attachment }) {
  if (!attachment) return null;
  const id = randomUUID();
  await client.query(
    `INSERT INTO support_attachments (
       id, tenant_id, store_id, thread_id, message_id, uploader_type,
       uploader_customer_id, uploader_user_id, file_name, mime_type,
       content_ciphertext, content_hash, size_bytes
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      id,
      store.tenant_id,
      store.id,
      threadId,
      messageId,
      uploaderType,
      customerId,
      userId,
      attachment.name,
      attachment.mime,
      encryptSecret(attachment.bytes.toString("base64"), config.encryptionKey),
      attachment.hash,
      attachment.bytes.length
    ]
  );
  return id;
}

async function messagesForThread(db, store, threadId, downloadPrefix) {
  const [messages, attachments] = await Promise.all([
    db.query(
      `SELECT sm.*, c.display_name AS author_customer_name, u.display_name AS author_user_name
       FROM support_messages sm
       LEFT JOIN store_customers c ON c.id=sm.author_customer_id
       LEFT JOIN platform_users u ON u.id=sm.author_user_id
       WHERE sm.thread_id=$1 AND sm.tenant_id=$2 AND sm.store_id=$3
       ORDER BY sm.created_at, sm.id`,
      [threadId, store.tenant_id, store.id]
    ),
    db.query(
      `SELECT id, message_id, file_name, mime_type, size_bytes, created_at
       FROM support_attachments
       WHERE thread_id=$1 AND tenant_id=$2 AND store_id=$3
       ORDER BY created_at, id`,
      [threadId, store.tenant_id, store.id]
    )
  ]);
  const grouped = new Map();
  for (const row of attachments.rows) {
    const list = grouped.get(row.message_id) || [];
    list.push(attachmentDto(row, `${downloadPrefix}/${encodeURIComponent(row.id)}`));
    grouped.set(row.message_id, list);
  }
  return messages.rows.map((row) => messageDto(row, grouped.get(row.id) || []));
}

async function sendCustomerMessage(db, config, request, store, customer, thread, body) {
  if (thread.status === "closed") throw new PaymentError(409, "support_thread_closed", "هذه المحادثة مغلقة");
  const attachment = parseAttachment(body?.attachment);
  const message = text(body?.message, 3000);
  if (!message && !attachment) throw new PaymentError(422, "empty_support_message", "اكتب رسالة أو أرفق ملفًا");
  const messageId = randomUUID();
  await db.transaction(async (client) => {
    await client.query(
      `INSERT INTO support_messages (
         id, tenant_id, store_id, thread_id, author_type, author_customer_id, message
       ) VALUES ($1,$2,$3,$4,'customer',$5,$6)`,
      [messageId, store.tenant_id, store.id, thread.id, customer.id, message || `مرفق: ${attachment.name}`]
    );
    await insertAttachment(client, config, {
      store,
      threadId: thread.id,
      messageId,
      uploaderType: "customer",
      customerId: customer.id,
      attachment
    });
    await client.query(
      `UPDATE support_threads
       SET status=CASE WHEN status='resolved' THEN 'open' ELSE status END,
           last_message_at=NOW(), customer_last_read_at=NOW(), updated_at=NOW()
       WHERE id=$1 AND tenant_id=$2 AND store_id=$3`,
      [thread.id, store.tenant_id, store.id]
    );
  }, store.tenant_id);
  return messageId;
}

async function sendStaffMessage(db, config, request, store, user, thread, body) {
  if (thread.status === "closed") throw new PaymentError(409, "support_thread_closed", "أعد فتح المحادثة قبل الرد");
  const attachment = parseAttachment(body?.attachment);
  const message = text(body?.message, 3000);
  if (!message && !attachment) throw new PaymentError(422, "empty_support_message", "اكتب ردًا أو أرفق ملفًا");
  const messageId = randomUUID();
  await db.transaction(async (client) => {
    await client.query(
      `INSERT INTO support_messages (
         id, tenant_id, store_id, thread_id, author_type, author_user_id, message
       ) VALUES ($1,$2,$3,$4,'staff',$5,$6)`,
      [messageId, store.tenant_id, store.id, thread.id, user.id, message || `مرفق: ${attachment.name}`]
    );
    await insertAttachment(client, config, {
      store,
      threadId: thread.id,
      messageId,
      uploaderType: "staff",
      userId: user.id,
      attachment
    });
    await client.query(
      `UPDATE support_threads
       SET status='waiting_customer', last_message_at=NOW(), staff_last_read_at=NOW(), updated_at=NOW()
       WHERE id=$1 AND tenant_id=$2 AND store_id=$3`,
      [thread.id, store.tenant_id, store.id]
    );
  }, store.tenant_id);
  return messageId;
}

async function attachmentRow(db, store, attachmentId) {
  const row = (await db.query(
    `SELECT sa.* FROM support_attachments sa
     JOIN support_threads st ON st.id=sa.thread_id
     WHERE sa.id=$1 AND sa.tenant_id=$2 AND sa.store_id=$3
       AND st.tenant_id=$2 AND st.store_id=$3`,
    [attachmentId, store.tenant_id, store.id]
  )).rows[0];
  if (!row) throw new PaymentError(404, "support_attachment_not_found", "المرفق غير موجود");
  return row;
}

function sendAttachment(reply, row, config) {
  const bytes = Buffer.from(decryptSecret(row.content_ciphertext, config.encryptionKey), "base64");
  if (bytes.length !== Number(row.size_bytes) || digest(bytes) !== row.content_hash) {
    throw new PaymentError(500, "support_attachment_corrupt", "تعذر التحقق من سلامة المرفق");
  }
  const disposition = row.mime_type.startsWith("image/") || row.mime_type === "application/pdf" ? "inline" : "attachment";
  reply.header("content-type", row.mime_type);
  reply.header("content-length", String(bytes.length));
  reply.header("cache-control", "private, no-store");
  reply.header("x-content-type-options", "nosniff");
  reply.header("content-disposition", `${disposition}; filename*=UTF-8''${encodeURIComponent(row.file_name)}`);
  return reply.send(bytes);
}

export function installSupportChatV2(app, { db, config }) {
  if (SUPPORT_CHAT_APPS.has(app)) return false;
  SUPPORT_CHAT_APPS.add(app);

  app.get("/store/:slug/support-chat", async (_request, reply) => reply.sendFile("support.html"));
  app.get("/admin/:storeId/support-chat", async (_request, reply) => reply.sendFile("support-admin.html"));

  app.get("/api/public/stores/:slug/support-v2", async (request) => {
    const store = await storeBySlug(db, request.params.slug);
    const customer = await authenticateCustomer(db, request, store);
    const rows = await db.query(
      `SELECT st.*,
              (SELECT COUNT(*)::int FROM support_messages sm
               WHERE sm.thread_id=st.id AND sm.author_type='staff'
                 AND sm.created_at > COALESCE(st.customer_last_read_at, 'epoch'::timestamptz)) AS unread_count
       FROM support_threads st
       WHERE st.tenant_id=$1 AND st.store_id=$2 AND st.customer_id=$3
       ORDER BY st.last_message_at DESC LIMIT 50`,
      [store.tenant_id, store.id, customer.id]
    );
    return { threads: rows.rows.map(threadDto) };
  });

  app.post("/api/public/stores/:slug/support-v2", { bodyLimit: SUPPORT_BODY_LIMIT }, async (request, reply) => {
    const store = await storeBySlug(db, request.params.slug);
    const customer = await authenticateCustomer(db, request, store);
    requireCustomerCsrf(request, customer);
    const subject = requiredText(request.body?.subject, "موضوع المحادثة", 160);
    const priority = request.body?.priority === "urgent" ? "urgent" : "normal";
    const attachment = parseAttachment(request.body?.attachment);
    const message = text(request.body?.message, 3000);
    if (!message && !attachment) throw new PaymentError(422, "empty_support_message", "اكتب رسالة أو أرفق ملفًا");
    const threadId = randomUUID();
    const messageId = randomUUID();
    await db.transaction(async (client) => {
      await client.query(
        `INSERT INTO support_threads (
           id, tenant_id, store_id, customer_id, subject, status, priority,
           customer_last_read_at, staff_last_read_at
         ) VALUES ($1,$2,$3,$4,$5,'open',$6,NOW(),NULL)`,
        [threadId, store.tenant_id, store.id, customer.id, subject, priority]
      );
      await client.query(
        `INSERT INTO support_messages (
           id, tenant_id, store_id, thread_id, author_type, author_customer_id, message
         ) VALUES ($1,$2,$3,$4,'customer',$5,$6)`,
        [messageId, store.tenant_id, store.id, threadId, customer.id, message || `مرفق: ${attachment.name}`]
      );
      await insertAttachment(client, config, {
        store,
        threadId,
        messageId,
        uploaderType: "customer",
        customerId: customer.id,
        attachment
      });
    }, store.tenant_id);
    reply.code(201);
    return { thread: { id: threadId, subject, status: "open", priority, unreadCount: 0, lastMessageAt: new Date().toISOString() } };
  });

  app.get("/api/public/stores/:slug/support-v2/:threadId/messages", async (request) => {
    const store = await storeBySlug(db, request.params.slug);
    const customer = await authenticateCustomer(db, request, store);
    const thread = await customerThread(db, store, customer, request.params.threadId);
    await db.query(
      `UPDATE support_threads SET customer_last_read_at=NOW(), updated_at=updated_at
       WHERE id=$1 AND tenant_id=$2 AND store_id=$3 AND customer_id=$4`,
      [thread.id, store.tenant_id, store.id, customer.id]
    );
    const messages = await messagesForThread(
      db,
      store,
      thread.id,
      `/api/public/stores/${encodeURIComponent(request.params.slug)}/support-v2/attachments`
    );
    return { thread: { ...threadDto(thread), unreadCount: 0 }, messages };
  });

  app.post("/api/public/stores/:slug/support-v2/:threadId/messages", { bodyLimit: SUPPORT_BODY_LIMIT }, async (request, reply) => {
    const store = await storeBySlug(db, request.params.slug);
    const customer = await authenticateCustomer(db, request, store);
    requireCustomerCsrf(request, customer);
    const thread = await customerThread(db, store, customer, request.params.threadId);
    const id = await sendCustomerMessage(db, config, request, store, customer, thread, request.body || {});
    reply.code(201);
    return { messageId: id };
  });

  app.post("/api/public/stores/:slug/support-v2/:threadId/read", async (request) => {
    const store = await storeBySlug(db, request.params.slug);
    const customer = await authenticateCustomer(db, request, store);
    requireCustomerCsrf(request, customer);
    const thread = await customerThread(db, store, customer, request.params.threadId);
    await db.query(
      `UPDATE support_threads SET customer_last_read_at=NOW()
       WHERE id=$1 AND tenant_id=$2 AND store_id=$3 AND customer_id=$4`,
      [thread.id, store.tenant_id, store.id, customer.id]
    );
    return { ok: true };
  });

  app.get("/api/public/stores/:slug/support-v2/attachments/:attachmentId", async (request, reply) => {
    const store = await storeBySlug(db, request.params.slug);
    const customer = await authenticateCustomer(db, request, store);
    const row = await attachmentRow(db, store, request.params.attachmentId);
    const thread = await customerThread(db, store, customer, row.thread_id);
    if (!thread) throw new PaymentError(404, "support_attachment_not_found", "المرفق غير موجود");
    return sendAttachment(reply, row, config);
  });

  app.get("/api/stores/:storeId/support-v2", async (request) => {
    const user = await authenticatePlatform(db, request);
    const store = await requireStoreAccess(db, user, request.params.storeId);
    const status = text(request.query?.status, 30) || "open";
    if (status !== "all" && !THREAD_STATUSES.has(status)) throw new PaymentError(422, "invalid_support_status", "حالة المحادثة غير صالحة");
    const values = [store.tenant_id, store.id];
    const statusSql = status === "all" ? "" : ` AND st.status=$${values.push(status)}`;
    const rows = await db.query(
      `SELECT st.*, c.display_name AS customer_name, c.email AS customer_email,
              (SELECT COUNT(*)::int FROM support_messages sm
               WHERE sm.thread_id=st.id AND sm.author_type='customer'
                 AND sm.created_at > COALESCE(st.staff_last_read_at, 'epoch'::timestamptz)) AS unread_count
       FROM support_threads st
       JOIN store_customers c ON c.id=st.customer_id
       WHERE st.tenant_id=$1 AND st.store_id=$2${statusSql}
       ORDER BY (CASE WHEN st.priority='urgent' THEN 0 ELSE 1 END), st.last_message_at DESC
       LIMIT 100`,
      values
    );
    return { threads: rows.rows.map(threadDto) };
  });

  app.get("/api/stores/:storeId/support-v2/:threadId/messages", async (request) => {
    const user = await authenticatePlatform(db, request);
    const store = await requireStoreAccess(db, user, request.params.storeId);
    const thread = await adminThread(db, store, request.params.threadId);
    await db.query(
      `UPDATE support_threads SET staff_last_read_at=NOW(), updated_at=updated_at
       WHERE id=$1 AND tenant_id=$2 AND store_id=$3`,
      [thread.id, store.tenant_id, store.id]
    );
    const messages = await messagesForThread(
      db,
      store,
      thread.id,
      `/api/stores/${encodeURIComponent(store.id)}/support-v2/attachments`
    );
    return { thread: { ...threadDto(thread), unreadCount: 0 }, messages };
  });

  app.post("/api/stores/:storeId/support-v2/:threadId/messages", { bodyLimit: SUPPORT_BODY_LIMIT }, async (request, reply) => {
    const user = await authenticatePlatform(db, request);
    requirePlatformCsrf(request, user);
    const store = await requireStoreAccess(db, user, request.params.storeId);
    const thread = await adminThread(db, store, request.params.threadId);
    const id = await sendStaffMessage(db, config, request, store, user, thread, request.body || {});
    reply.code(201);
    return { messageId: id };
  });

  app.post("/api/stores/:storeId/support-v2/:threadId/read", async (request) => {
    const user = await authenticatePlatform(db, request);
    requirePlatformCsrf(request, user);
    const store = await requireStoreAccess(db, user, request.params.storeId);
    const thread = await adminThread(db, store, request.params.threadId);
    await db.query(
      `UPDATE support_threads SET staff_last_read_at=NOW()
       WHERE id=$1 AND tenant_id=$2 AND store_id=$3`,
      [thread.id, store.tenant_id, store.id]
    );
    return { ok: true };
  });

  app.put("/api/stores/:storeId/support-v2/:threadId/status", async (request) => {
    const user = await authenticatePlatform(db, request);
    requirePlatformCsrf(request, user);
    const store = await requireStoreAccess(db, user, request.params.storeId);
    await adminThread(db, store, request.params.threadId);
    const status = text(request.body?.status, 30);
    if (!THREAD_STATUSES.has(status)) throw new PaymentError(422, "invalid_support_status", "حالة المحادثة غير صالحة");
    const row = (await db.query(
      `UPDATE support_threads SET status=$4, updated_at=NOW()
       WHERE id=$1 AND tenant_id=$2 AND store_id=$3 RETURNING *`,
      [request.params.threadId, store.tenant_id, store.id, status]
    )).rows[0];
    return { thread: threadDto(row) };
  });

  app.get("/api/stores/:storeId/support-v2/attachments/:attachmentId", async (request, reply) => {
    const user = await authenticatePlatform(db, request);
    const store = await requireStoreAccess(db, user, request.params.storeId);
    const row = await attachmentRow(db, store, request.params.attachmentId);
    await adminThread(db, store, row.thread_id);
    return sendAttachment(reply, row, config);
  });

  return true;
}
