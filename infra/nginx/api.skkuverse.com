upstream skkubus_api_new {
    server 127.0.0.1:3001 max_fails=3 fail_timeout=30s;
    server 127.0.0.1:3002 max_fails=3 fail_timeout=30s;
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

    location / {
        proxy_pass http://skkubus_api_new;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
