import { lookup } from "node:dns/promises";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";

const blockedIpv4 = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]
] as const) {
  blockedIpv4.addSubnet(address, prefix, "ipv4");
}
// Azure's platform endpoint is a virtual address despite its public IPv4 form.
blockedIpv4.addAddress("168.63.129.16", "ipv4");

const globalIpv6 = new BlockList();
globalIpv6.addSubnet("2000::", 3, "ipv6");
const blockedIpv6 = new BlockList();
// Conservatively exclude special-purpose, documentation, and transition ranges.
// IPv4-mapped/NAT64, local, multicast, and unspecified addresses are outside 2000::/3.
for (const [address, prefix] of [
  ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]
] as const) {
  blockedIpv6.addSubnet(address, prefix, "ipv6");
}

export function isPublicIpAddress(address: string) {
  const family = isIP(address);
  return family === 4
    ? !blockedIpv4.check(address, "ipv4")
    : family === 6 && globalIpv6.check(address, "ipv6") && !blockedIpv6.check(address, "ipv6");
}

export class RemotePdfSizeError extends Error {
  constructor() {
    super("PDF exceeds the download size limit.");
  }
}

function parsePdfUrl(value: string, base?: URL) {
  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    throw new Error("PDF link must be an HTTP or HTTPS URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("PDF link must be an HTTP or HTTPS URL.");
  }
  if (url.username || url.password) {
    throw new Error("PDF links must not contain credentials.");
  }
  return url;
}

function withAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

async function resolvePublicAddress(url: URL, signal: AbortSignal) {
  // URL parsing canonicalizes alternative IPv4 spellings; IPv6 hosts retain brackets.
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const family = isIP(hostname);
  const addresses = family
    ? [{ address: hostname, family }]
    : await withAbort(lookup(hostname, { all: true, verbatim: true }), signal);
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicIpAddress(address))) {
    throw new Error("PDF links must resolve only to public internet addresses.");
  }
  return addresses[0];
}

function requestPdf(url: URL, address: { address: string; family: number }, signal: AbortSignal) {
  signal.throwIfAborted();
  // Pin the validated address at connection time. Keeping the original URL
  // preserves Host, TLS SNI, and certificate validation without a second DNS lookup.
  const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
    if (options.all) callback(null, [address]);
    else callback(null, address.address, address.family);
  };
  return new Promise<IncomingMessage>((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      agent: false,
      family: address.family,
      lookup: pinnedLookup,
      signal,
      headers: { Accept: "application/pdf,*/*", "Accept-Encoding": "identity" }
    }, (response) => {
      // Cover stream errors even before the caller starts consuming the response.
      response.on("error", reject);
      resolve(response);
    });
    request.on("error", reject);
    request.end();
  });
}

async function readPdfBody(response: IncomingMessage, maxBytes: number) {
  const contentLength = Number(response.headers["content-length"] ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new RemotePdfSizeError();
  }
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of response) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += bytes.length;
    if (totalBytes > maxBytes) throw new RemotePdfSizeError();
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, totalBytes);
}

export async function fetchPublicPdf(pdfUrl: string, options: { maxBytes: number; timeoutMs: number }) {
  let url = parsePdfUrl(pdfUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("PDF retrieval timed out.")), options.timeoutMs);
  try {
    for (let redirects = 0; ; redirects += 1) {
      controller.signal.throwIfAborted();
      const address = await resolvePublicAddress(url, controller.signal);
      const response = await withAbort(requestPdf(url, address, controller.signal), controller.signal);
      try {
        const status = response.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status)) {
          if (redirects >= 5) throw new Error("PDF link returned too many redirects.");
          if (!response.headers.location) throw new Error("PDF redirect is missing its destination.");
          url = parsePdfUrl(response.headers.location, url);
          continue;
        }
        if (status < 200 || status >= 300) throw new Error(`PDF link returned HTTP ${status}.`);
        const buffer = await withAbort(readPdfBody(response, options.maxBytes), controller.signal);
        return { buffer, contentDisposition: response.headers["content-disposition"] ?? "" };
      } finally {
        // Do not consume redirect/error bodies or leave sockets open on failure.
        response.destroy();
      }
    }
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
