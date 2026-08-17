FROM node:24-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# CI-equivalent verification is part of the production image build itself.
# This keeps VPS deploys fail-closed even when external GitHub Actions runners
# are unavailable: a syntax, lint, unit-test, or build failure stops docker build
# before migrations or live containers can be replaced.
FROM dependencies AS verification
COPY migrations ./migrations
COPY public ./public
COPY src ./src
COPY scripts ./scripts
COPY test ./test
COPY Dockerfile railway.json ./

# V60 gzip artifacts are stored in the repository as Base64 text so they can
# travel safely through text-only repository tooling. Normalize them to real gzip
# bytes inside the image, verify the SHA-256 of the DECOMPRESSED approved release
# content, and materialize verified plain-text siblings for application startup.
# The server never has to gunzip V60 during boot; gzip remains available only as
# an optional HTTP transfer encoding for the JS asset.
RUN node -e 'const fs=require("node:fs"); const {createHash}=require("node:crypto"); const {gunzipSync}=require("node:zlib"); const expected=new Map([["public/platform-v60.html.gz","e0936bdff50e844bc77bdb74feb41943caa24bcbdb87a413d686ff21360084d4"],["public/platform-v60.js.gz","b13ad13605f1a16b7a951de9107f2a099acfc17305634a9c766f0202148a20cb"]]); for (const [path,sha] of expected) { let data=fs.readFileSync(path); if (!(data[0]===0x1f && data[1]===0x8b)) { const text=data.toString("utf8").replace(/\s+/g,""); if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) throw new Error(`${path} is neither gzip nor Base64 gzip data`); data=Buffer.from(text,"base64"); } const payload=gunzipSync(data); const actual=createHash("sha256").update(payload).digest("hex"); if (actual!==sha) throw new Error(`${path} decompressed checksum mismatch: ${actual}`); fs.writeFileSync(path,data); fs.writeFileSync(path.replace(/\.gz$/, ""),payload); console.log(`Verified and materialized ${path} payload ${actual}`); }'
RUN npm run check \
 && npm run lint \
 && npm test \
 && npm run build

FROM dependencies AS production-dependencies
RUN npm prune --omit=dev

FROM node:24-alpine AS runtime
ENV NODE_ENV=production \
    PREVIEW_MEMORY_MODE=false \
    REQUIRE_PERSISTENT_DATABASE=true \
    DEMO_SEED=false \
    ALLOW_DEMO_BILLING=false \
    TELEGRAM_MODE=live \
    UCHIHA_API_1_MODE=test
WORKDIR /app
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node migrations ./migrations
COPY --from=verification --chown=node:node /app/public ./public
COPY --chown=node:node src ./src
COPY --chown=node:node railway-python-compat.sh /usr/local/bin/python
RUN chmod 755 /usr/local/bin/python
USER node
EXPOSE 4100
CMD ["node", "src/start.mjs"]
