#!/bin/bash
# One-time setup for a fresh Ubuntu 24.04 droplet that hosts portfolio demos. Run as root (key login):
#   ssh root@HOST 'bash -s' < deploy/provision.sh
# Idempotent: safe to run again. Result: user `deploy` (docker, sudo, keys only), ufw 22/80/443, fail2ban,
# automatic security updates, 2 GB swap, Docker + Compose, and a shared Caddy edge proxy in /opt/edge
# that serves one site file per project from /opt/edge-sites over the Docker network `edge`.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
DEPLOY_USER=deploy

apt-get update -q
apt-get -y -q -o Dpkg::Options::=--force-confold upgrade
apt-get -y -q install ufw fail2ban unattended-upgrades ca-certificates curl gnupg git
dpkg-reconfigure -f noninteractive unattended-upgrades

# Swap: Keycloak (Java) + Node services on 2 GB RAM need a safety margin
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
fi
grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
printf 'vm.swappiness=10\nvm.vfs_cache_pressure=50\n' > /etc/sysctl.d/99-swap.conf
sysctl -q --system

# Working user with the same SSH keys as root
id "$DEPLOY_USER" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$DEPLOY_USER"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
install -m 600 -o "$DEPLOY_USER" -g "$DEPLOY_USER" /root/.ssh/authorized_keys "/home/$DEPLOY_USER/.ssh/authorized_keys"
echo "$DEPLOY_USER ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/90-$DEPLOY_USER"
chmod 440 "/etc/sudoers.d/90-$DEPLOY_USER" && visudo -cq

# SSH: keys only
cat > /etc/ssh/sshd_config.d/00-hardening.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitEmptyPasswords no
PubkeyAuthentication yes
PermitRootLogin prohibit-password
MaxAuthTries 3
LoginGraceTime 30
X11Forwarding no
EOF
sshd -t && systemctl reload ssh

printf '[sshd]\nenabled = true\nbackend = systemd\nmaxretry = 5\nbantime = 1h\n' > /etc/fail2ban/jail.d/sshd.local
systemctl enable --now fail2ban >/dev/null && systemctl restart fail2ban

ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow OpenSSH >/dev/null && ufw allow 80/tcp >/dev/null && ufw allow 443/tcp >/dev/null && ufw allow 443/udp >/dev/null
ufw --force enable >/dev/null

# Docker Engine + Compose plugin (official repository)
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get -y -q install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
printf '{ "log-driver": "local", "log-opts": { "max-size": "10m", "max-file": "3" } }\n' > /etc/docker/daemon.json
systemctl restart docker
usermod -aG docker "$DEPLOY_USER"

# Shared edge proxy: Caddy with automatic HTTPS, one site file per project in /opt/edge-sites
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" /opt/edge /opt/edge-sites
docker network inspect edge >/dev/null 2>&1 || docker network create edge >/dev/null
cat > /opt/edge/Caddyfile <<'EOF'
# Edge proxy for the demos on this droplet: each project adds its own site file to /opt/edge-sites.
import /etc/caddy/sites/*.caddy
EOF
cat > /opt/edge/compose.yaml <<'EOF'
name: edge
services:
  caddy:
    image: caddy:2.10.2-alpine
    restart: unless-stopped
    ports: ["80:80", "443:443", "443:443/udp"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - /opt/edge-sites:/etc/caddy/sites:ro
      - caddy_data:/data
      - caddy_config:/config
    networks: [edge]
    mem_limit: 128m
networks:
  edge:
    name: edge
    external: true
volumes:
  caddy_data:
  caddy_config:
EOF
chown -R "$DEPLOY_USER:$DEPLOY_USER" /opt/edge
(cd /opt/edge && docker compose up -d >/dev/null)

echo "provision: done"
