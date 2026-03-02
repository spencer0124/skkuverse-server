# Deployment Guide: skkumap-server-express → Oracle Cloud Free Tier

## Context

Deploy the Express API server to Oracle Cloud Free Tier with domain `api.skkuuniverse.com` (Cloudflare DNS). The project already has production-ready Docker config (Dockerfile, docker-compose.yml, health checks, graceful shutdown, non-root user, resource limits).

---

## Recommended Architecture

```
Client → Cloudflare (DNS proxy, SSL, DDoS) → Oracle Cloud ARM VM → Nginx → Docker (Express :3000)
```

### Why this stack (not Cloudflare Tunnel)

| Approach | Pros | Cons |
|----------|------|------|
| **Nginx + Cloudflare DNS Proxy** (recommended) | Full control, lower latency for API, standard setup, easy debugging | Need to open ports 80/443 on OCI |
| Cloudflare Tunnel | No open ports, simpler firewall | Extra hop adds latency (bad for real-time bus API), `cloudflared` daemon uses memory, harder to debug |

For a real-time bus tracking API with 10-15s polling intervals, minimizing latency matters. Nginx + Cloudflare DNS Proxy is the better fit.

---

## Step-by-Step Preparation Checklist

### 1. Oracle Cloud Setup

- [ ] Create OCI account (free tier)
- [ ] Create ARM instance: **VM.Standard.A1.Flex** (1 OCPU, 6GB RAM is plenty)
  - OS: **Ubuntu 22.04** (or 24.04) — better Docker support than Oracle Linux
  - Boot volume: 50GB (free tier allows up to 200GB total)
- [ ] Download SSH key pair during instance creation
- [ ] Note the public IP address

### 2. OCI Networking (CRITICAL — most common blocker)

Three layers of firewall must ALL allow traffic:

#### Layer 1: VCN Security List (OCI Console)
- Add **Ingress Rules** for TCP ports 80 and 443 (source: 0.0.0.0/0)
- SSH (port 22) is already open by default

#### Layer 2: OS-level firewall (iptables)
```bash
# Ubuntu on OCI comes with restrictive iptables
# IMPORTANT: Insert rules BEFORE the REJECT rule, not after
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

#### Layer 3: Docker handles container port mapping automatically

### 3. Server Software Installation

```bash
# Install Docker
sudo apt update && sudo apt upgrade -y
sudo apt install -y ca-certificates curl gnupg
# Add Docker's official GPG key and repository
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Add user to docker group
sudo usermod -aG docker $USER
```

### 4. Nginx Reverse Proxy (on host, outside Docker)

Install Nginx on the host to handle SSL termination and proxying:

```bash
sudo apt install -y nginx
```

Nginx config is version-controlled at `infra/nginx/api.skkuuniverse.com` in the repo. Copy it to the server:

```bash
sudo cp infra/nginx/api.skkuuniverse.com /etc/nginx/sites-available/
```

The config uses an upstream block with passive health checks for load balancing between two API replicas. See `infra/nginx/api.skkuuniverse.com` for the full config.

Enable the site:
```bash
sudo ln -s /etc/nginx/sites-available/api.skkuuniverse.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### 5. Cloudflare Configuration

#### DNS Records
- **A Record**: `api` → Oracle VM public IP, **Proxy ON** (orange cloud)

#### SSL/TLS Settings
- SSL mode: **Full (Strict)**
- Generate **Origin Certificate** (Cloudflare dashboard → SSL/TLS → Origin Server)
  - 15-year validity, free
  - Download `.pem` and `-key.pem`, place on server at `/etc/ssl/cloudflare/`

#### Recommended Cloudflare Settings
- **Always Use HTTPS**: ON
- **Minimum TLS Version**: 1.2
- **Auto Minify**: OFF (it's an API, not a website)
- **Caching**: Create a Cache Rule for `api.skkuuniverse.com/*` → Cache Level: Bypass
  - API responses should NOT be cached by Cloudflare

### 6. Deploy the Application

```bash
# On the Oracle VM
git clone <your-repo> ~/skkumap-server-express
cd ~/skkumap-server-express

# Create .env with production values
nano .env

# Build and start
docker compose up -d --build

# Verify
docker compose ps
curl http://localhost:3001/health/ready
curl http://localhost:3002/health/ready
```

### 7. docker-compose.yml Port Binding

The docker-compose.yml runs two API replicas with localhost-only ports (Nginx handles external traffic):

```yaml
# api-1
ports:
  - "127.0.0.1:3001:3000"

# api-2
ports:
  - "127.0.0.1:3002:3000"
```

This prevents direct access to the Express app, forcing all traffic through Nginx. The Nginx upstream block load-balances between the two replicas.

### 8. Swagger URL Update

Set in `.env`:
```
SWAGGER_SERVER_URL=https://api.skkuuniverse.com
```

Note: Swagger UI is disabled in production mode per current config, so this is only relevant if you re-enable it.

---

## MongoDB Atlas Configuration

MongoDB is hosted on Atlas (cloud). No need to run MongoDB on the Oracle VM.

- [ ] **Allowlist Oracle VM's public IP** in Atlas → Network Access → IP Access List
- [ ] Verify `MONGO_URL` in `.env` points to Atlas cluster
- [ ] Test connectivity from VM: `docker compose exec api-1 wget -qO- --timeout=5 https://cloud.mongodb.com` (basic DNS check)
- [ ] Consider: allowlist `0.0.0.0/0` temporarily during setup, then restrict to VM IP only

---

## Security Hardening

- [ ] SSH key-only auth (disable password login)
- [ ] `fail2ban` for SSH brute-force protection
- [ ] Firewall only allows 22, 80, 443
- [ ] Docker port bound to 127.0.0.1 only
- [ ] Cloudflare Origin Certificate for encrypted origin traffic
- [ ] Consider: Cloudflare "Authenticated Origin Pulls" to ensure only Cloudflare can reach your Nginx

---

## Monitoring & Maintenance

- [ ] `docker compose logs -f` for app logs
- [ ] Nginx access/error logs: `/var/log/nginx/`
- [ ] Set up auto-restart: Docker `unless-stopped` already configured
- [ ] OS auto-updates: `sudo apt install unattended-upgrades`
- [ ] Disk monitoring: free tier has limited storage

---

## Cost Analysis

| Resource | Free Tier Allowance | Your Usage |
|----------|-------------------|------------|
| ARM Compute | 4 OCPU, 24GB RAM | 1 OCPU, 6GB RAM |
| Boot Volume | 200GB total | 50GB |
| Outbound Data | 10TB/month | Minimal (API JSON) |
| Public IP | 1 per instance | 1 |
| **Cloudflare** | Free plan | DNS, proxy, SSL |
| **MongoDB Atlas** | Free tier (512MB) | Already using Atlas |

**Total monthly cost: $0**

---

## Verification

1. `curl https://api.skkuuniverse.com/health` → `{"status":"ok","uptime":...}`
2. Test from Flutter app by updating base URL
3. Check Cloudflare Analytics for traffic flow
4. Verify SSL with `curl -vI https://api.skkuuniverse.com`
