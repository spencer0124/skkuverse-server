# Client IP. Every request reaches this host through Cloudflare, so the TCP
# peer is a Cloudflare edge, not the client. Trusting CF-Connecting-IP from
# Cloudflare's published ranges (and only from them — a header sent by anyone
# else is ignored) makes $remote_addr the client. These directives sit at http
# level, so every vhost on the box logs and forwards the real client.
#
# Paired with `trust proxy 1` in src/main.ts: the X-Forwarded-For set below
# carries exactly one address, and Express takes it as req.ip — the key the
# rate limiter counts by. __tests__/nest/infra/nginx-site.test.ts pins both.
#
# Ranges from https://www.cloudflare.com/ips-v4 and /ips-v6, fetched
# 2026-09-24. A range missing here fails safe: requests through it are keyed
# on the edge address, as before.
set_real_ip_from 173.245.48.0/20;
set_real_ip_from 103.21.244.0/22;
set_real_ip_from 103.22.200.0/22;
set_real_ip_from 103.31.4.0/22;
set_real_ip_from 141.101.64.0/18;
set_real_ip_from 108.162.192.0/18;
set_real_ip_from 190.93.240.0/20;
set_real_ip_from 188.114.96.0/20;
set_real_ip_from 197.234.240.0/22;
set_real_ip_from 198.41.128.0/17;
set_real_ip_from 162.158.0.0/15;
set_real_ip_from 104.16.0.0/13;
set_real_ip_from 104.24.0.0/14;
set_real_ip_from 172.64.0.0/13;
set_real_ip_from 131.0.72.0/22;
set_real_ip_from 2400:cb00::/32;
set_real_ip_from 2606:4700::/32;
set_real_ip_from 2803:f800::/32;
set_real_ip_from 2405:b500::/32;
set_real_ip_from 2405:8100::/32;
set_real_ip_from 2a06:98c0::/29;
set_real_ip_from 2c0f:f248::/32;
real_ip_header CF-Connecting-IP;

upstream skkubus_api_new {
    server 127.0.0.1:3001 max_fails=3 fail_timeout=10s;
    server 127.0.0.1:3002 max_fails=3 fail_timeout=10s;
    server 127.0.0.1:3003 max_fails=3 fail_timeout=10s;

    # Reuse connections to the replicas instead of opening one per request.
    # The idle timeout stays under Node's default keepAliveTimeout (5 s), so
    # nginx never sends on a socket the replica is already closing.
    keepalive 32;
    keepalive_timeout 4s;
}

server {
    listen 80;
    server_name api.skkuverse.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name api.skkuverse.com;

    ssl_certificate /etc/ssl/cloudflare/skkuverse-origin.pem;
    ssl_certificate_key /etc/ssl/cloudflare/skkuverse-origin-key.pem;

    # HTTP/1.1 with an empty Connection header is what lets the upstream
    # keepalive pool above actually hold connections.
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    # Replaced, not appended: a client-supplied X-Forwarded-For would
    # otherwise ride ahead of the real address.
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;

    # Fail fast and try the other replica once, rather than holding a request
    # for the 60 s default while a replica is stuck. Non-idempotent requests
    # (POST) are not retried — nginx's default.
    proxy_connect_timeout 2s;
    proxy_read_timeout 30s;
    proxy_next_upstream error timeout;
    proxy_next_upstream_tries 2;

    # The API speaks JSON; the distro's gzip_types leaves it uncompressed.
    gzip_types application/json;
    gzip_proxied any;

    location / {
        proxy_pass http://skkubus_api_new;
    }
}
