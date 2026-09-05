'use strict';

const dns = require('node:dns').promises;
const https = require('node:https');
const net = require('node:net');
const { isPublicAddress, resolvePublicHost } = require('./server-client');

function validateDomain(value) {
  const domain = String(value || '').trim().toLowerCase();
  if (!domain || domain.length > 253 || domain.endsWith('.') || domain.includes('://') || domain.includes('/') || domain.includes(':')) {
    throw Object.assign(new Error('Invalid domain.'), { code: 'domain_invalid' });
  }
  if (net.isIP(domain) || !domain.includes('.') || !/^[a-z0-9.-]+$/.test(domain) || domain.includes('..')) {
    throw Object.assign(new Error('Invalid domain.'), { code: 'domain_invalid' });
  }
  const parts = domain.split('.');
  if (parts.some((part) => !part || part.length > 63 || part.startsWith('-') || part.endsWith('-'))) {
    throw Object.assign(new Error('Invalid domain.'), { code: 'domain_invalid' });
  }
  return domain;
}

function chooseExpectedRecord(addresses) {
  const list = Array.isArray(addresses) ? addresses : [];
  const ipv4 = list.find((entry) => entry && entry.family === 4 && isPublicAddress(entry.address));
  if (ipv4) return { type: 'A', name: '@', value: ipv4.address };
  const ipv6 = list.find((entry) => entry && entry.family === 6 && isPublicAddress(entry.address));
  if (ipv6) return { type: 'AAAA', name: '@', value: ipv6.address };
  throw Object.assign(new Error('Linked server has no public address.'), { code: 'domain_server_address_unavailable' });
}

async function expectedRecordForServer(server) {
  if (!server || !server.host) throw Object.assign(new Error('Project server is not linked.'), { code: 'domain_server_not_linked' });
  const addresses = await resolvePublicHost(server.host);
  return chooseExpectedRecord(addresses);
}

async function resolveDomain(domain) {
  const safeDomain = validateDomain(domain);
  let addresses;
  try {
    addresses = await dns.lookup(safeDomain, { all: true, verbatim: true });
  } catch {
    return [];
  }
  return addresses
    .filter((entry) => entry && isPublicAddress(entry.address))
    .map((entry) => ({ address: entry.address, family: entry.family }));
}

function matchesExpected(addresses, expectedRecord) {
  if (!expectedRecord || !expectedRecord.value) return false;
  return (addresses || []).some((entry) => entry && entry.address === expectedRecord.value);
}

function probeHttps(domain, pinnedAddress) {
  const safeDomain = validateDomain(domain);
  if (!isPublicAddress(pinnedAddress)) return Promise.reject(Object.assign(new Error('Pinned address is not public.'), { code: 'domain_address_invalid' }));
  return new Promise((resolve, reject) => {
    let certificate = null;
    let tlsProtocol = null;
    const req = https.request({
      host: safeDomain,
      servername: safeDomain,
      port: 443,
      path: '/',
      method: 'HEAD',
      timeout: 8000,
      rejectUnauthorized: true,
      headers: { Host: safeDomain, 'User-Agent': 'UCHIHA-Domain-Check' },
      lookup: (hostname, options, callback) => callback(null, pinnedAddress, net.isIP(pinnedAddress))
    }, (res) => {
      try {
        const socket = res.socket;
        certificate = socket && socket.getPeerCertificate ? socket.getPeerCertificate() : null;
        tlsProtocol = socket && socket.getProtocol ? socket.getProtocol() : null;
      } catch {}
      res.resume();
      resolve({
        ok: true,
        httpStatus: Number(res.statusCode || 0),
        certificateValidTo: certificate && certificate.valid_to ? String(certificate.valid_to) : null,
        tlsProtocol: tlsProtocol || null
      });
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('HTTPS verification timed out.'), { code: 'domain_https_timeout' })));
    req.on('error', () => reject(Object.assign(new Error('HTTPS verification failed.'), { code: 'domain_https_failed' })));
    req.end();
  });
}

async function verifyDomain(domain, expectedRecord) {
  const safeDomain = validateDomain(domain);
  const resolved = await resolveDomain(safeDomain);
  if (!matchesExpected(resolved, expectedRecord)) {
    return {
      dnsStatus: 'pending',
      httpsStatus: 'pending',
      resolvedAddresses: resolved.map((entry) => entry.address),
      certificateValidTo: null,
      tlsProtocol: null,
      httpStatus: null
    };
  }
  const matched = resolved.find((entry) => entry.address === expectedRecord.value);
  try {
    const httpsResult = await probeHttps(safeDomain, matched.address);
    return {
      dnsStatus: 'verified',
      httpsStatus: 'verified',
      resolvedAddresses: resolved.map((entry) => entry.address),
      certificateValidTo: httpsResult.certificateValidTo,
      tlsProtocol: httpsResult.tlsProtocol,
      httpStatus: httpsResult.httpStatus
    };
  } catch {
    return {
      dnsStatus: 'verified',
      httpsStatus: 'pending',
      resolvedAddresses: resolved.map((entry) => entry.address),
      certificateValidTo: null,
      tlsProtocol: null,
      httpStatus: null
    };
  }
}

module.exports = {
  validateDomain,
  chooseExpectedRecord,
  expectedRecordForServer,
  resolveDomain,
  matchesExpected,
  probeHttps,
  verifyDomain
};
