---
type: ADR
id: "0181"
title: "Resolve TUN fake-IP answers through public encrypted DNS"
status: active
date: 2026-09-08
---

## Context

Web bookmarks and imported remote images use a shared public-network request boundary. It validates URL protocols and hosts, resolves DNS, rejects non-public destinations, and pins each connection to a validated address. Clash/Mihomo TUN can return synthetic addresses in `198.18.0.0/15`, so ordinary public sites fail before any HTTP request is made. Treating that entire address range as public would weaken the network boundary.

## Decision

Keep the system resolver as the normal path. When its answers contain only synthetic addresses from `198.18.0.0/15`, query Cloudflare's HTTPS DNS JSON endpoint for the hostname's public address. Bootstrap that TLS connection with a fixed Cloudflare public IP, retain certificate validation for `cloudflare-dns.com`, prohibit redirects, bound the response and timeout, and validate DNS response status and address records. Reject unavailable, malformed, empty or non-public results. Do not retry ordinary private-address results or general DNS errors through a public resolver.

The original request still uses a validated real public address, preserves the original hostname for TLS and HTTP, and repeats validation for each redirect. Literal private or reserved IP URLs remain prohibited, including literal fake-IP URLs. This requires no changes to the user's Clash settings and does not disable TUN.

## Consequences

- Public bookmarks and remote image imports can work while fake-IP DNS is active, without trusting synthetic destinations as public addresses.
- The fallback sends the hostname to Cloudflare. It does not send the bookmark URL path, query, note contents, credentials or page body to the DNS service.
- Only fake-IP environments depend on this additional resolver and incur its request latency. Resolver unavailability remains an observable failure rather than permission to contact a reserved address.
- Both resolver and page clients disable environment HTTP proxies so those cannot bypass the validated destination pin. TUN still routes socket traffic; explicit HTTP_PROXY/HTTPS_PROXY forwarding is not used by this public-network-only path.
- This is native HTTP request compatibility; the browser development mock bridge is not a production metadata proxy.

## Alternatives

- Allow `198.18.0.0/15`: rejected because it weakens destination validation and cannot distinguish synthetic routing from actual reserved hosts.
- Disable TUN or edit the user's fake-IP filters: rejected as an application requirement; it changes unrelated networking and must be maintained per domain.
- Use public DNS for every request: rejected because it overrides normal local resolution unnecessarily.

## Reference

[Cloudflare DNS over HTTPS JSON API](https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/make-api-requests/dns-json/).
