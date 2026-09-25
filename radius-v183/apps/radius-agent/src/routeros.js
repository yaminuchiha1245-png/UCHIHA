import fs from "node:fs";
import net from "node:net";
import tls from "node:tls";
import { once } from "node:events";

const MAX_WORD_BYTES = 1_048_576;
const MAX_SENTENCE_WORDS = 256;

export function encodeLength(length) {
  if (!Number.isInteger(length) || length < 0 || length > 0xffffffff) throw new Error("invalid RouterOS word length");
  if (length < 0x80) return Buffer.from([length]);
  if (length < 0x4000) {
    const output = Buffer.alloc(2);
    output.writeUInt16BE(length | 0x8000);
    return output;
  }
  if (length < 0x200000) return Buffer.from([(length >> 16) | 0xc0, (length >> 8) & 0xff, length & 0xff]);
  if (length < 0x10000000) return Buffer.from([(length >> 24) | 0xe0, (length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff]);
  const output = Buffer.alloc(5);
  output[0] = 0xf0;
  output.writeUInt32BE(length, 1);
  return output;
}

export function encodeSentence(words) {
  const chunks = [];
  for (const value of words) {
    const word = Buffer.from(String(value), "utf8");
    if (word.length > MAX_WORD_BYTES) throw new Error("RouterOS word is too large");
    chunks.push(encodeLength(word.length), word);
  }
  chunks.push(Buffer.from([0]));
  return Buffer.concat(chunks);
}

export class SentenceReader {
  constructor(stream) {
    this.iterator = stream[Symbol.asyncIterator]();
    this.buffer = Buffer.alloc(0);
  }

  async readExact(size) {
    while (this.buffer.length < size) {
      const next = await this.iterator.next();
      if (next.done) throw new Error("RouterOS closed the connection");
      this.buffer = this.buffer.length ? Buffer.concat([this.buffer, next.value]) : Buffer.from(next.value);
    }
    const result = this.buffer.subarray(0, size);
    this.buffer = this.buffer.subarray(size);
    return result;
  }

  async readLength() {
    const first = (await this.readExact(1))[0];
    if ((first & 0x80) === 0) return first;
    if ((first & 0xc0) === 0x80) return ((first & 0x3f) << 8) | (await this.readExact(1))[0];
    if ((first & 0xe0) === 0xc0) {
      const tail = await this.readExact(2);
      return ((first & 0x1f) << 16) | (tail[0] << 8) | tail[1];
    }
    if ((first & 0xf0) === 0xe0) {
      const tail = await this.readExact(3);
      return ((first & 0x0f) * 0x1000000) + (tail[0] << 16) + (tail[1] << 8) + tail[2];
    }
    if (first === 0xf0) return (await this.readExact(4)).readUInt32BE(0);
    throw new Error("unsupported RouterOS length prefix");
  }

  async readSentence() {
    const words = [];
    while (words.length < MAX_SENTENCE_WORDS) {
      const length = await this.readLength();
      if (length === 0) return words;
      if (length > MAX_WORD_BYTES) throw new Error("RouterOS response word is too large");
      words.push((await this.readExact(length)).toString("utf8"));
    }
    throw new Error("RouterOS response has too many words");
  }
}

function sentenceAttributes(words) {
  const attributes = {};
  for (const word of words.slice(1)) {
    if (!word.startsWith("=")) continue;
    const separator = word.indexOf("=", 1);
    if (separator > 1) attributes[word.slice(1, separator)] = word.slice(separator + 1);
  }
  return attributes;
}

export class RouterOsApi {
  constructor({ host, port = 8729, username, password, caFile = null, caPem = null, serverName = null, timeoutMs = 8_000 }) {
    this.options = { host, port, username, password, caFile, caPem, serverName, timeoutMs };
    this.socket = null;
    this.reader = null;
  }

  async connect() {
    const options = {
      host: this.options.host,
      port: this.options.port,
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
      ...(this.options.caPem ? { ca: this.options.caPem } :
        this.options.caFile ? { ca: fs.readFileSync(this.options.caFile) } : {}),
      ...((this.options.serverName && !net.isIP(this.options.serverName))
        ? { servername: this.options.serverName } :
        (!net.isIP(this.options.host) ? { servername: this.options.host } : {})),
      checkServerIdentity: (_host, cert) =>
        tls.checkServerIdentity(this.options.serverName || this.options.host, cert)
    };
    this.socket = tls.connect(options);
    this.socket.setTimeout(this.options.timeoutMs, () => {
      const error = new Error("RouterOS request timed out");
      error.code = "ETIMEDOUT";
      this.socket.destroy(error);
    });
    await once(this.socket, "secureConnect");
    this.reader = new SentenceReader(this.socket);
    await this.talk(["/login", `=name=${this.options.username}`, `=password=${this.options.password}`]);
  }

  async talk(words) {
    if (!this.socket || !this.reader) throw new Error("RouterOS connection is not open");
    if (!this.socket.write(encodeSentence(words))) await once(this.socket, "drain");
    const rows = [];
    for (let index = 0; index < 10_000; index += 1) {
      const sentence = await this.reader.readSentence();
      const type = sentence[0];
      const attributes = sentenceAttributes(sentence);
      if (type === "!re") rows.push(attributes);
      else if (type === "!trap" || type === "!fatal") throw new Error(`RouterOS rejected the command: ${attributes.message ?? attributes.category ?? "unknown error"}`);
      else if (type === "!done") return rows;
    }
    throw new Error("RouterOS response limit exceeded");
  }

  close() {
    this.socket?.destroy();
    this.socket = null;
    this.reader = null;
  }
}

function yes(value) {
  return ["yes", "true", "1"].includes(String(value ?? "").toLowerCase());
}

// Safe, coarse local diagnostics: never log a RouterOS password, token,
 // raw TLS exception, or server-provided detail.
export function routerProbeErrorCode(error) {
 const code=String(error?.code ?? "").toUpperCase();
 if(["ENOTFOUND","EAI_AGAIN"].includes(code))return "DNS_LOOKUP_FAILED";
 if(["ETIMEDOUT","ESOCKETTIMEDOUT"].includes(code))return "CONNECT_TIMEOUT";
 if(["ENETUNREACH","EHOSTUNREACH","EADDRNOTAVAIL"].includes(code))return "NO_NETWORK_ROUTE";
 if(code==="ECONNREFUSED")return "API_SSL_UNAVAILABLE";
 if(["ECONNRESET","EPIPE","ERR_SSL_WRONG_VERSION_NUMBER"].includes(code))return "TLS_HANDSHAKE_FAILED";
 if(code.startsWith("ERR_TLS_")||code.includes("CERT")||code.includes("VERIFY"))
  return "TLS_CERTIFICATE_FAILED";
 if(String(error?.message??"").startsWith("RouterOS rejected the command"))
  return "ROUTEROS_LOGIN_OR_PERMISSION";
 if(String(error?.message??"")==="RouterOS identity not returned")return "ROUTER_IDENTITY_FAILED";
 return "ROUTER_UNREACHABLE";
}

export class RouterOsCommandExecutor {
  constructor({ routers, clientFactory = (router) => new RouterOsApi(router) }) {
    this.routers = routers;
    this.clientFactory = clientFactory;
  }

  // A real TLS handshake + successful authenticated RouterOS command is
  // required before the central UI may show a router as online.
  async probeRouters({diagnostics=false}={}) {
    const results = [];
    for (let index = 0; index < this.routers.length; index += 8) {
      const batch = await Promise.all(this.routers.slice(index, index + 8).map(async (router) => {
        const client = this.clientFactory(router);
        try {
          await client.connect();
          const identity = await client.talk(["/system/identity/print", "=.proplist=name"]);
          if (!Array.isArray(identity) || !identity.some(row => typeof row.name === "string" && row.name.length > 0)) {
            throw new Error("RouterOS identity not returned");
          }
          return { deviceId: router.id, host: router.host, port: router.port, status: "online" };
        } catch(error) {
          // Only the explicit local CLI gets a safe error CODE. Heartbeats
          // remain free of raw errors and RouterOS credentials.
          const status={ deviceId: router.id, host: router.host, port: router.port, status: "offline" };
          return diagnostics?{...status,errorCode:routerProbeErrorCode(error)}:status;
        } finally {
          client.close();
        }
      }));
      results.push(...batch);
    }
    return results;
  }

  routersFor(topic, payload) {
    if (topic === "radius.subscriber.sync") return this.routers;
    if (payload.deviceId) {
      const matched = this.routers.filter((router) => router.id === payload.deviceId);
      if (matched.length) return matched;
    }
    if (payload.nasIp) {
      const matched = this.routers.filter((router) => router.nasIps.includes(payload.nasIp));
      if (matched.length) return matched;
    }
    if (this.routers.length === 1) return this.routers;
    throw new Error("لا يوجد RouterOS مطابق للجلسة في ملف إعداد الوكيل");
  }

  async execute(command) {
    if (!["radius.subscriber.sync", "radius.session.disconnect"].includes(command.topic)) throw new Error("أمر RADIUS غير مدعوم");
    const routers = this.routersFor(command.topic, command.payload);
    const results = [];
    const failures = [];
    for (const router of routers) {
      const client = this.clientFactory(router);
      try {
        await client.connect();
        results.push(command.topic === "radius.subscriber.sync"
          ? await this.syncSubscriber(client, router, command.payload)
          : await this.disconnectSession(client, router, command.payload));
      } catch (error) {
        failures.push({ routerId: router.id, message: String(error?.message ?? error).slice(0, 180) });
      } finally {
        client.close();
      }
    }
    if (failures.length) {
      throw new Error(`تعذر تنفيذ الأمر على ${failures.map((item) => `${item.routerId}: ${item.message}`).join("، ")}`);
    }
    if (command.topic === "radius.subscriber.sync" && !results.some((item) => item.matched)) {
      throw new Error("لم يُعثر على حساب PPP في أي RouterOS مُعد");
    }
    return results;
  }

  async syncSubscriber(client, router, payload) {
    const rows = await client.talk(["/ppp/secret/print", "=.proplist=.id,name,disabled", `?name=${payload.username}`]);
    if (!rows.length) return { routerId: router.id, matched: false };
    if (rows.length !== 1) throw new Error(`أكثر من حساب PPP يحمل الاسم نفسه على ${router.id}`);
    const desiredDisabled = payload.status !== "active";
    if (yes(rows[0].disabled) !== desiredDisabled) {
      await client.talk(["/ppp/secret/set", `=.id=${rows[0][".id"]}`, `=disabled=${desiredDisabled ? "yes" : "no"}`]);
    }
    return { routerId: router.id, matched: true, changed: yes(rows[0].disabled) !== desiredDisabled, disabled: desiredDisabled };
  }

  async disconnectSession(client, router, payload) {
    const rows = await client.talk(["/ppp/active/print", "=.proplist=.id,name,address,session-id", `?name=${payload.username}`]);
    if (!rows.length) return { routerId: router.id, matched: false, alreadyDisconnected: true };
    let candidates = rows;
    if (payload.externalSessionId) {
      const exact = rows.filter((row) => row["session-id"] === payload.externalSessionId);
      if (exact.length) candidates = exact;
    }
    if (candidates.length > 1 && payload.framedIp) {
      const exact = candidates.filter((row) => row.address === payload.framedIp);
      if (exact.length) candidates = exact;
    }
    if (candidates.length !== 1) throw new Error(`تعذر تحديد جلسة PPP واحدة بأمان على ${router.id}`);
    await client.talk(["/ppp/active/remove", `=.id=${candidates[0][".id"]}`]);
    return { routerId: router.id, matched: true, disconnected: true };
  }
}
