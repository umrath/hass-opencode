#!/usr/bin/env python3
# Mobile-detection proxy for the OpenCode web terminal.
#
# ttyd cannot serve two different client profiles on one port, so we run two
# ttyd instances on localhost — desktop (tmux, normal font) and mobile (no tmux,
# larger font) — and front them with this transparent TCP proxy on the ingress
# port. The proxy peeks each HTTP request header and forwards the connection raw
# (including any Authorization header for ttyd basic auth) to the matching backend.
#
# Reliable iPad detection
# -----------------------
# iPadOS 13+ Safari sends a *desktop Mac* User-Agent, so a server-side UA check
# cannot tell an iPad from a MacBook — yet iPads are touch devices that cannot
# drive tmux. The only authoritative touch signal (navigator.maxTouchPoints) is
# client-side. So when the UA is ambiguous we serve a tiny JS probe page that
# measures touch support and persists the choice in an `oc_profile` cookie. The
# cookie rides on every subsequent request — crucially the ttyd WebSocket — which
# a `?mobile` query parameter does NOT. Phones are still UA-detected on the fast
# path; `?mobile` / `?desktop` remain as manual overrides.
# Pattern adapted from mistralvibe-hass-app.
import asyncio
import os
import re
from typing import Optional

LISTEN_PORT = int(os.environ.get("OC_PROXY_PORT", "7681"))
DESKTOP_PORT = int(os.environ.get("OC_DESKTOP_PORT", "7682"))
MOBILE_PORT = int(os.environ.get("OC_MOBILE_PORT", "7683"))

# Clients that are unambiguously mobile by User-Agent. Legacy iPads (iPadOS < 13)
# still send a literal "iPad" UA and are caught here; modern iPads masquerade as
# Macs (no "iPad" token) and fall through to the touch probe below.
MOBILE_PATTERNS = [b"iPhone", b"iPad", b"iPod", b"Android", b"Mobile"]
_UA_RE = re.compile(rb"User-Agent:\s*([^\r\n]+)", re.IGNORECASE)
_MOBILE_QS_RE = re.compile(rb"(?:\?|&)mobile(?:=|&| HTTP/)", re.IGNORECASE)
_DESKTOP_QS_RE = re.compile(rb"(?:\?|&)desktop(?:=|&| HTTP/)", re.IGNORECASE)
_COOKIE_RE = re.compile(rb"oc_profile=(mobile|desktop)", re.IGNORECASE)
_GET_RE = re.compile(rb"^GET\b")
_ACCEPT_HTML_RE = re.compile(rb"^Accept:[^\r\n]*text/html", re.IGNORECASE | re.MULTILINE)

# Client probe: pick the profile from the authoritative touch signal, persist it
# in a cookie (carries on the WebSocket), and reload unambiguously via the query.
_PROBE_BODY = (
    b"<!doctype html><html><head><meta charset=utf-8>"
    b"<meta name=viewport content=\"width=device-width,initial-scale=1\">"
    b"<noscript><meta http-equiv=refresh content=\"0;url=?desktop\"></noscript>"
    b"<title>OpenCode</title></head><body><script>"
    b"(function(){"
    b"var touch=(navigator.maxTouchPoints||0)>1||('ontouchstart' in window);"
    b"var p=touch?'mobile':'desktop';"
    b"document.cookie='oc_profile='+p+';path=/;max-age=31536000;samesite=Lax';"
    b"location.replace(location.pathname+'?'+p);"
    b"})();"
    b"</script></body></html>"
)
PROBE_RESPONSE = (
    b"HTTP/1.1 200 OK\r\n"
    b"Content-Type: text/html; charset=utf-8\r\n"
    b"Cache-Control: no-store\r\n"
    b"Content-Length: " + str(len(_PROBE_BODY)).encode() + b"\r\n"
    b"Connection: close\r\n\r\n" + _PROBE_BODY
)


def is_mobile_ua(header_bytes: bytes) -> bool:
    """True if the User-Agent is an unambiguously mobile (phone) client."""
    match = _UA_RE.search(header_bytes)
    if not match:
        return False
    ua = match.group(1)
    return any(p in ua for p in MOBILE_PATTERNS)


def is_mobile(header_bytes: bytes) -> bool:
    """Backwards-compatible mobile check: explicit ?mobile, oc_profile=mobile
    cookie, or a mobile-phone User-Agent."""
    if _MOBILE_QS_RE.search(header_bytes):
        return True
    cookie = _COOKIE_RE.search(header_bytes)
    if cookie:
        return cookie.group(1).lower() == b"mobile"
    return is_mobile_ua(header_bytes)


def select_profile(header_bytes: bytes) -> Optional[str]:
    """Return 'mobile' or 'desktop' if the request can be classified, or None when
    the client is ambiguous (e.g. an iPad/Mac UA with no cookie yet) and needs the
    touch probe. Precedence: explicit query > cookie > mobile-phone UA."""
    if _DESKTOP_QS_RE.search(header_bytes):
        return "desktop"
    if _MOBILE_QS_RE.search(header_bytes):
        return "mobile"
    cookie = _COOKIE_RE.search(header_bytes)
    if cookie:
        return cookie.group(1).lower().decode()
    if is_mobile_ua(header_bytes):
        return "mobile"
    return None


def wants_probe(header_bytes: bytes) -> bool:
    """Only probe on a top-level HTML navigation — never on assets/WebSocket/XHR
    (those carry the cookie once it is set, and curl health checks must pass through)."""
    return bool(_GET_RE.search(header_bytes) and _ACCEPT_HTML_RE.search(header_bytes))


async def _pipe(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    try:
        while True:
            data = await reader.read(65536)
            if not data:
                break
            writer.write(data)
            await writer.drain()
    except Exception:
        pass
    finally:
        try:
            writer.close()
        except Exception:
            pass


async def handle(client_r: asyncio.StreamReader, client_w: asyncio.StreamWriter) -> None:
    # Read until the end of the HTTP request headers (or give up after 10s).
    header = b""
    try:
        while b"\r\n\r\n" not in header:
            chunk = await asyncio.wait_for(client_r.read(4096), timeout=10)
            if not chunk:
                client_w.close()
                return
            header += chunk
            if len(header) > 65536:  # don't buffer unbounded garbage
                break
    except Exception:
        client_w.close()
        return

    profile = select_profile(header)
    if profile is None:
        # Ambiguous (likely an iPad or a Mac). Serve the touch probe for a real
        # page load; for anything else default to desktop until the cookie is set.
        if wants_probe(header):
            try:
                client_w.write(PROBE_RESPONSE)
                await client_w.drain()
            except Exception:
                pass
            finally:
                client_w.close()
            return
        profile = "desktop"

    port = MOBILE_PORT if profile == "mobile" else DESKTOP_PORT

    # ttyd may still be starting up — retry the backend connection briefly.
    srv_r = srv_w = None
    for attempt in range(5):
        try:
            srv_r, srv_w = await asyncio.open_connection("127.0.0.1", port)
            break
        except Exception:
            if attempt == 4:
                client_w.close()
                return
            await asyncio.sleep(0.5)

    srv_w.write(header)
    await srv_w.drain()
    await asyncio.gather(_pipe(client_r, srv_w), _pipe(srv_r, client_w))


async def main() -> None:
    print(f"[proxy] listening on 0.0.0.0:{LISTEN_PORT} -> desktop:{DESKTOP_PORT} mobile:{MOBILE_PORT}", flush=True)
    server = await asyncio.start_server(handle, "0.0.0.0", LISTEN_PORT)
    async with server:
        print(f"[proxy] started, accepting connections", flush=True)
        await server.serve_forever()


if __name__ == "__main__":
    asyncio.run(main())
