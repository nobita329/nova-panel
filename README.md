# 🌟 Nova Panel — Next-Gen Game & Server Management Platform

<p align="center">
  <img src="public/arix/Arix.png" alt="Nova Panel Banner" width="800" style="border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.4);" />
</p>

<p align="center">
  <a href="https://github.com/nobita329/nova-panel/releases"><img src="https://img.shields.io/github/v/release/nobita329/nova-panel?style=for-the-badge&color=6366f1" alt="Release"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-20+-22c55e?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js"></a>
  <a href="https://pm2.keymetrics.io/"><img src="https://img.shields.io/badge/PM2-Daemon-blue?style=for-the-badge&logo=pm2&logoColor=white" alt="PM2"></a>
  <a href="https://www.docker.com/"><img src="https://img.shields.io/badge/Docker-Containers-2496ed?style=for-the-badge&logo=docker&logoColor=white" alt="Docker"></a>
  <a href="https://www.papermc.io/"><img src="https://img.shields.io/badge/Minecraft-Java%2025+-e11d48?style=for-the-badge&logo=openjdk&logoColor=white" alt="Java 25 Ready"></a>
  <a href="#license"><img src="https://img.shields.io/badge/License-MIT-f59e0b?style=for-the-badge" alt="License"></a>
</p>

---

## 📖 Overview

**Nova Panel** is an ultra-fast, modern, all-in-one Game Server & VPS Management Panel designed for high performance, intuitive administration, and seamless scalability. Built with a lightweight **Node.js + Express** core and backed by **Docker Engine**, Nova Panel delivers near-instant server provisioning, zero overhead, and enterprise-grade isolation.

This release comes with full native integration of the **Arix Theme v2.1.3** and all **17-in-1 Premium Addons (v2.0.2)**, offering a cohesive glassmorphic UI, real-time audio telemetry, and deep game management capabilities out of the box.

---

## ✨ Key Features

### 🎨 Arix Theme v2.1.3 Full Integration
- **Glassmorphic Design System**: Modern dark aesthetic with customizable backdrop blurs, gradients, and accent color themes (Indigo, Emerald, Violet, Amber, Rose, Cyan).
- **Interactive Audio Feedback**: Native sound cues for server online, offline, and clipboard actions (`online.mp3`, `offline.mp3`, `copy.mp3`).
- **Responsive Architecture**: Smooth desktop, tablet, and mobile navigation with collapsible sidebar and slide-over mobile drawers.
- **Micro-Animations & Transitions**: Fluid status indicators, live memory & CPU meters, and seamless modal dialogs.
- **Custom Error & Maintenance Pages**: Integrated branded 403, 404, 500, and Maintenance screens.

### 🎮 Complete 17-in-1 Addons Suite (v2.0.2)
1. 🔌 **Plugin Installer**: Instant search and 1-click installation from SpigotMC, Bukkit, and PaperMC repositories.
2. 🧩 **Mod Manager**: Direct Modrinth and CurseForge browser with automatic dependency resolution.
3. 📦 **Modpack Installer**: One-click complete modpack deployments for Forge, Fabric, and NeoForge.
4. 🗺️ **World Manager**: Comprehensive multi-world creation, ZIP backup, direct download, and Nether/End dimension controls.
5. 🔄 **Version Changer**: Switch between Minecraft releases (Vanilla, Paper, Purpur, Spigot, Fabric, Forge) with automatic Java 8/11/17/21/25 detection.
6. ⚙️ **Server Properties Editor**: Form-based visual editor for `server.properties` with type-safe inputs and toggles.
7. 🌐 **Subdomain Manager**: Automatic DNS record management with SRV record support (`play.yourdomain.com`).
8. 🏷️ **Startup Variables**: Fine-tune JVM memory parameters (`-Xms`, `-Xmx`, GC algorithms) and startup launch scripts.
9. 🚗 **FiveM Server Tools**: Native support for FiveM license keys, txAdmin integration, and visual `server.cfg` editing.
10. 🎨 **Server Icon & Egg Changer**: Customize server avatars, display titles, and switch underlying runtime eggs.
11. 💾 **Database Manager**: 1-click MySQL/MariaDB database provisioning, credentials management, and SQL dump import/export.
12. 🛡️ **Auto-Backup & Cloud Sync**: Snapshot backups with compression, retention rules, and 1-click restore.
13. ⏱️ **Task Scheduler**: Cron-based automated schedules for server restarts, backups, and custom commands.
14. 👥 **Sub-Users & Granular ACL**: Multi-user collaboration with strict role-based permission flags.
15. 📜 **Audit & Activity Logs**: Real-time audit trail capturing user IP addresses, actions, and security events.
16. 🔑 **REST API & Webhooks**: Personal API tokens with custom permission scopes for automation and Discord bots.
17. 🎛️ **Admin Addons Switchboard**: Master control center at `/admin/addons` allowing administrators to enable/disable any addon globally.

### ⚡ Infrastructure & Server Capabilities
- **Docker Isolation**: Every server runs inside its own isolated Docker container with CPU, RAM, and disk quotas.
- **WebSocket Terminal**: Low-latency interactive xterm.js console with ANSI color support and command history.
- **Built-in SFTP Server**: Native SFTP daemon allowing users to connect with FileZilla, WinSCP, or Cyberduck using panel credentials.
- **Java 25+ Compatible**: Full support for Minecraft 1.20.5+ and 1.21+ requiring modern OpenJDK runtimes.

---

## 🏗️ Architecture

```
                    ┌─────────────────────────────────────┐
                    │            Client Browser           │
                    └──────────────────┬──────────────────┘
                                       │ HTTP / WebSocket (WS)
                                       ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           Nova Panel (Node.js)                          │
│                                                                         │
│  ┌──────────────────────┐  ┌─────────────────────┐  ┌────────────────┐  │
│  │   Arix Theme v2.1    │  │   Addons Pack v2.0  │  │  Express Core  │  │
│  │ (EJS / CSS / Tokens) │  │  (17 Native Tools)  │  │ (Auth & REST)  │  │
│  └──────────────────────┘  └─────────────────────┘  └────────────────┘  │
│                                       │                                 │
│  ┌──────────────────────┐  ┌──────────▼──────────┐  ┌────────────────┐  │
│  │    SQLite Storage    │  │   WebSocket Bridge  │  │  SFTP Daemon   │  │
│  │   (better-sqlite3)   │  │   (Real-time Logs)  │  │  (Port 2022)   │  │
│  └──────────────────────┘  └─────────────────────┘  └────────────────┘  │
└──────────────────────────────────────┬──────────────────────────────────┘
                                       │ Docker Socket (/var/run/docker.sock)
                                       ▼
                    ┌─────────────────────────────────────┐
                    │      Docker Engine / Containers     │
                    │  [Server 1]   [Server 2]   [Server 3]│
                    └─────────────────────────────────────┘
```

---

## 🚀 Quick Start Guide

### Prerequisites
- **Linux Operating System** (Ubuntu 20.04+, Debian 11+, Rocky Linux 9, or AlmaLinux)
- **Node.js 20.x or 22.x LTS**
- **Docker Engine** (`docker.io` or Docker CE)
- **PM2** (Process Manager)

### 1. Clone the Repository
```bash
git clone https://github.com/nobita329/nova-panel.git
cd nova-panel
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment
Copy the example environment file and customize your configuration:
```bash
cp .env.example .env
nano .env
```

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `3000` | HTTP port for the web interface |
| `SESSION_SECRET` | *(random)* | Secret string for session signing |
| `DATABASE_PATH` | `./data/nova.sqlite` | Path to SQLite database file |
| `DOCKER_SOCKET` | `/var/run/docker.sock`| Path to local Docker socket |
| `SFTP_PORT` | `2022` | Port for the built-in SFTP server |
| `DATA_DIR` | `./Instance` | Directory storing server data and files |

### 4. Run Database Migrations
```bash
npm run migrate
```

### 5. Create the Initial Administrator Account
```bash
node src/scripts/createuser.js --username admin --email admin@example.com --password YourStrongPassword --admin
```

### 6. Production Launch with PM2
Launch Nova Panel with auto-restart and cluster support:
```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

Check status and logs anytime:
```bash
pm2 status
pm2 logs nova-panel
```

Access the panel in your browser at `http://your-server-ip:3000`.

---

## 🧩 Addons Administration

Administrators can enable, disable, and configure individual addon modules globally:

1. Log in with an administrator account.
2. Navigate to **Admin Area** → **Addons** (`/admin/addons`).
3. Toggle features on/off instantly without restarting the server:
   - Plugin & Mod Installers
   - World Manager
   - Version Changer
   - FiveM Integration
   - Subdomain Dispatcher
   - Auto-Backup Service

---

## ☕ Java Compatibility (Minecraft 1.20.5+ / 1.21+)

Minecraft 1.20.5 and newer requires running the server with Java 21 or Java 25. Nova Panel's Version Changer and Docker environments automatically select the required runtime:

- **Java 8**: Minecraft 1.8 – 1.16.4
- **Java 11**: Minecraft 1.16.5
- **Java 17**: Minecraft 1.17 – 1.20.4
- **Java 21**: Minecraft 1.20.5 – 1.21.x
- **Java 25**: Minecraft 26w / future releases

---

## 🛠️ Project Structure

```
nova-panel/
├── .github/
│   └── workflows/
│       └── release.yml          # Automated GitHub Release CI/CD workflow
├── data/                        # Database files and persistent storage
├── public/
│   ├── arix/                    # Arix theme graphic assets, banners & audio
│   ├── css/
│   │   └── arix.css             # Main compiled Arix design system
│   ├── js/
│   │   └── arix.js              # Arix interactive components & audio triggers
│   └── themes/                  # Pterodactyl-compatible styles
├── src/
│   ├── config/                  # App & database configurations
│   ├── middleware/              # Auth, permissions & upload handling
│   ├── routes/
│   │   ├── admin.js             # Administration endpoints
│   │   ├── api.js               # REST API endpoints
│   │   ├── auth.js              # Authentication (Login/Register/2FA)
│   │   ├── server.js            # Server management & addon endpoints
│   │   └── user.js              # Client account endpoints
│   ├── services/
│   │   ├── addons.js            # Addons logic (17 modules)
│   │   ├── backup.js            # Backup & restore services
│   │   ├── docker.js            # Docker container lifecycle management
│   │   ├── mcjars.js            # Minecraft jar downloads & version metadata
│   │   ├── sftp.js              # Embedded SFTP server implementation
│   │   └── websocket.js         # Real-time console & metrics streaming
│   └── views/                   # EJS templates themed with Arix
│       ├── admin/               # Admin management views
│       ├── auth/                # Authentication views
│       ├── errors/              # Custom error pages (403, 404, 500, maintenance)
│       ├── layouts/             # Shared headers, sidebars & footers
│       ├── server/              # Server console, file manager, and addons
│       └── user/                # Account settings & dashboard
├── ecosystem.config.js          # PM2 production configuration
├── package.json                 # Project dependencies & scripts
├── server.js                    # Application entry point
└── README.md                    # Project documentation
```

---

## 🤝 Contributing

Contributions, bug reports, and feature requests are welcome!
Feel free to open an issue or submit a pull request on the [GitHub repository](https://github.com/nobita329/nova-panel).

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).