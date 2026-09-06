const fs=require("fs");
const server=fs.readFileSync(require("path").join(__dirname,"../server.js"),"utf8");
const providers=fs.readFileSync(require("path").join(__dirname,"../providers/index.js"),"utf8");
if(server.includes('expiresInSeconds:600'))throw new Error('stale_activation_ttl');
if(server.includes('/^[A-HJ-NP-Z2-9]{6}$/'))throw new Error('stale_six_character_activation');
if(!server.includes('normalizeActivationCode(req.body?.code)'))throw new Error('activation_route_not_normalized');
if(server.includes('1.0.0-rc.20'))throw new Error('rc_version_exposed');
if(providers.includes('require("./demo")')||providers.includes('{ demo,'))throw new Error('demo_provider_runtime_enabled');
console.log('PRODUCTION_REALIZATION_AUDIT=PASS');
