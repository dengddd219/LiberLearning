# 生产部署设计规格

**日期**：2026-04-24  
**状态**：可执行目标设计（基础设施优先版）

> 本版面向 **5 人熟人邀请内测**，默认所有受邀用户都可稳定使用 Google。
> 目标不是一次性做完整生产体系，而是先把基础设施、HTTPS、最小可用登录、数据持久化和自动备份做对。

**范围**：LiberStudy 首次上线到阿里云 ECS，包含：
- ECS 单机部署
- Nginx + HTTPS
- systemd 托管 FastAPI
- SQLite 持久化
- 自动备份
- Google OAuth 单一登录方式
- 受邀邮箱白名单

---

## 1. 目标

将 LiberStudy 部署到阿里云 ECS，支持 5 名受邀测试用户通过 Google 登录后访问，满足以下约束：

- 全站 HTTPS
- 单机可持续运行
- 代码更新流程简单
- 数据可持久化且不会被 `git pull` 覆盖
- 每日自动备份
- 成本控制在小规模内测可接受范围

---

## 2. 推荐方案

### 2.1 整体策略

本次上线采用两层思路：

1. **基础设施先落地**
   ECS、Nginx、HTTPS、systemd、SQLite、自动备份先搭好，保证服务能稳定在线。
2. **认证只做最小闭环**
   不做开放注册，不做密码体系，不做多身份供应商，不做权限分级。
   只支持 Google OAuth，并加受邀邮箱白名单。

### 2.2 为什么这样做

对于当前场景，这个方案最合适：

- 用户少，都是你认识的人，不需要开放注册
- 用户都能用 Google，没必要再引入邮箱密码、验证码、找回密码
- 白名单能挡掉非邀请用户，足够满足这一阶段的访问控制
- 单机 SQLite 对 5 人内测完全够用，复杂数据库和容器编排都不是当前收益点

### 2.3 本版不做

- 开放注册
- GitHub / Apple / Email Magic Link 等其他登录方式
- RBAC 权限分级
- 多机部署
- CI/CD
- 云数据库
- 对外正式商用级审计与监控

---

## 3. 基础设施选型

| 资源 | 选型 | 说明 |
|------|------|------|
| 计算 | 阿里云 ECS 2核2G，Ubuntu 22.04 | 足够支撑 5 人邀请内测 |
| Web Server | Nginx | 反向代理、TLS 终止、静态前端托管 |
| HTTPS | Let's Encrypt + Certbot | 免费证书，自动续签 |
| App Runtime | Python venv + systemd | 简单直接，便于排障 |
| Frontend Build | Node.js 22 LTS | 不使用 Ubuntu 默认 `apt nodejs` |
| 主数据库 | SQLite | 保持与当前仓库一致 |
| 备份 | 本机定时备份到 `/var/backups/liberstudy/` | 日备份 + 保留策略 |

**关键约束**：

- 前端构建必须使用 **Node 22 LTS**
- 不要使用 Ubuntu 22.04 默认仓库里的 `nodejs`
- 持久化目录必须独立于代码目录

---

## 4. 系统架构

```text
用户浏览器
    ↓ HTTPS :443
Nginx
    ├── /api/ws/*  → proxy_pass http://127.0.0.1:8000
    ├── /api/*     → proxy_pass http://127.0.0.1:8000
    ├── /slides/*  → proxy_pass http://127.0.0.1:8000
    ├── /audio/*   → proxy_pass http://127.0.0.1:8000
    ├── /runs/*    → proxy_pass http://127.0.0.1:8000
    └── /*         → /var/www/liberstudy/dist

uvicorn（systemd 托管）
    ├── FastAPI 路由
    ├── Google OAuth + allowlist 认证
    ├── SQLite: /var/lib/liberstudy/database.db
    ├── SQLite: /var/lib/liberstudy/live_data.db
    └── StaticFiles: /var/lib/liberstudy/static/*

定时备份
    └── 每日打包 DB + runs 输出到 /var/backups/liberstudy/
```

### 4.1 持久化目录

所有可持久化数据都放到代码目录外：

- `/var/lib/liberstudy/database.db`
- `/var/lib/liberstudy/live_data.db`
- `/var/lib/liberstudy/static/slides/`
- `/var/lib/liberstudy/static/audio/`
- `/var/lib/liberstudy/static/runs/`
- `/var/backups/liberstudy/`

### 4.2 代码适配点

当前仓库里有几个现状需要在实施时改掉：

- `backend/db.py` 当前主库路径仍是相对路径
- `backend/services/live_store.py` 当前 live DB 路径仍是相对路径
- `backend/main.py` 当前 `StaticFiles` 使用 `static/...` 相对路径挂载

因此落地方式为：

1. 把两个 SQLite 路径改成绝对路径
2. 将 `backend/static/` 软链到 `/var/lib/liberstudy/static/`
3. 保持现有 `/slides`、`/audio`、`/runs` 路径不变，减少前端改动

---

## 5. 认证方案

### 5.1 推荐方案

本次内测认证采用：

- **Google OAuth 单一登录**
- **受邀邮箱白名单**
- **HttpOnly Cookie**
- **服务端 session 模式**

不推荐在这个阶段继续使用上一版文档里的 “JWT + 自动续签 + 泛化多用户体系”。
对 5 人熟人内测，这套东西太重了，维护收益低。

### 5.2 为什么不是开放 Google 登录

只做 Google 登录还不够。
如果不加白名单，任何能访问到域名并拥有 Google 账号的人都可能登录。

所以应采用：

- Google 负责身份确认
- 后端白名单负责访问授权

### 5.3 登录流程

```text
前端访问 /login
    ↓
点击“使用 Google 登录”
    ↓
GET /api/auth/google/login
    ↓
跳转 Google 授权页
    ↓
Google 回调 /api/auth/google/callback?code=...
    ↓
后端换取 profile（email、name、picture）
    ↓
检查 email 是否在 allowlist 中
    ├── 不在白名单：返回 403
    └── 在白名单：upsert user，创建 session
    ↓
set-cookie: liberstudy_session=...
    ↓
跳转前端首页 /
```

### 5.4 白名单设计

白名单优先采用 **环境变量** 管理，不在本阶段引入复杂后台管理页。

新增环境变量：

```env
ALLOWED_GOOGLE_EMAILS=user1@gmail.com,user2@gmail.com,user3@gmail.com
```

优点：

- 实现最简单
- 部署时可控
- 用户数量少，手动维护完全可接受

### 5.5 数据库变更

建议新增 `users` 表：

```python
class UserRow(SQLModel, table=True):
    __tablename__ = "users"
    id: str = Field(primary_key=True)
    google_id: str = Field(unique=True)
    email: str = Field(unique=True, index=True)
    name: str
    avatar_url: Optional[str] = None
    created_at: float = Field(default_factory=time.time)
```

建议为主 session 数据增加归属：

```python
user_id: Optional[str] = Field(default=None, foreign_key="users.id")
```

`live_data.db` 中的 `live_sessions` 也应增加：

```sql
user_id TEXT
```

原因很直接：

- 登录之后必须能区分“谁的录音、谁的笔记、谁的 live session”
- 如果只给主库加 `user_id`，而 live 库不加，认证是半套的

### 5.6 Session 设计

本阶段推荐 **服务端 session**，不要做 JWT 刷新。

最小可行做法：

- 后端生成随机 `session_id`
- 以 `HttpOnly + Secure + SameSite=Lax` cookie 下发
- session 信息存储在 SQLite 新表 `auth_session`
- 有效期 7 天
- 登出时删除 cookie 并删除服务端 session 记录

这样做的好处：

- 逻辑比 JWT 刷新简单
- 可直接失效会话
- 对 5 人内测性能完全不是问题

### 5.7 前端改动

前端只做必要改动：

1. 新增 `/login` 页面
2. `App.tsx` 增加 `PrivateRoute`
3. 新增 `/api/auth/me` 检查当前登录态
4. `fetch` 统一带上 `credentials: 'include'`
5. 在 Lobby 页展示头像、名字、退出按钮

### 5.8 本阶段不做的认证能力

- 密码登录
- 注册页
- 忘记密码
- 多设备会话管理
- 角色权限系统
- Google 之外的登录方式

---

## 6. Nginx 配置

首次部署仍采用两阶段：

1. HTTP-only，先完成证书申请
2. 切换到完整 HTTPS 配置

### 6.1 阶段一：HTTP-only（仅 ACME 验证）

`deploy/nginx-http.conf`

```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 444;
    }
}
```

说明：

- 阶段一的目标只有一个：让 Certbot 完成 ACME 验证
- 因此不暴露前端页面，不转发 API，不转发 WebSocket
- 拿到证书后再切换到完整 HTTPS 配置

### 6.2 阶段二：完整 HTTPS

`deploy/nginx.conf`

```nginx
server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    location /api/ws/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location ~* ^/(slides|audio|runs)/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
    }

    root /var/www/liberstudy/dist;
    index index.html;
    location / {
        try_files $uri $uri/ /index.html;
    }
}

server {
    listen 80;
    server_name yourdomain.com;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}
```

---

## 7. 环境变量

`backend/.env.example` 建议新增：

```env
# Frontend origin
FRONTEND_ORIGIN=https://yourdomain.com

# Google OAuth
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URI=https://yourdomain.com/api/auth/google/callback

# Invite allowlist
ALLOWED_GOOGLE_EMAILS=user1@gmail.com,user2@gmail.com

# Session cookie
SESSION_SECRET=your_random_secret_key_min_32_chars
SESSION_EXPIRE_DAYS=7

# Production paths
LIBERSTUDY_DB_PATH=/var/lib/liberstudy/database.db
LIBERSTUDY_LIVE_DB_PATH=/var/lib/liberstudy/live_data.db
```

---

## 8. 部署流程

### 8.1 一次性初始化

```bash
# 1. 系统依赖
apt update
apt install -y nginx python3 python3-pip python3-venv ffmpeg certbot \
  python3-certbot-nginx libreoffice fonts-noto-cjk sqlite3 curl

# 2. 安装 Node.js 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

# 3. 创建应用用户
adduser --system --group --no-create-home liberstudy

# 4. 拉取代码
git clone https://github.com/你的账号/LiberLearning.git /var/www/liberstudy
cd /var/www/liberstudy

# 4.1 统一代码目录所有者
chown -R liberstudy:liberstudy /var/www/liberstudy

# 5. 创建持久化目录
mkdir -p /var/lib/liberstudy/static/{slides,audio,runs}
mkdir -p /var/backups/liberstudy
chown -R liberstudy:liberstudy /var/lib/liberstudy /var/backups/liberstudy

# 6. 静态目录软链
ln -sfn /var/lib/liberstudy/static /var/www/liberstudy/backend/static

# 7. 后端虚拟环境
python3 -m venv /var/www/liberstudy/venv
source /var/www/liberstudy/venv/bin/activate
pip install --upgrade pip
pip install -r backend/requirements.txt

# 8. 前端构建
cd frontend
npm ci
npm run build
rm -rf /var/www/liberstudy/dist
cp -r dist /var/www/liberstudy/dist
cd ..

# 9. 配置 .env
# 手动上传到 /var/www/liberstudy/backend/.env
chown liberstudy:liberstudy /var/www/liberstudy/backend/.env
chmod 600 /var/www/liberstudy/backend/.env

# 10. Nginx 阶段一
cp deploy/nginx-http.conf /etc/nginx/sites-available/liberstudy
ln -s /etc/nginx/sites-available/liberstudy /etc/nginx/sites-enabled/liberstudy
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# 11. DNS 生效后申请证书
mkdir -p /var/www/certbot
certbot certonly --webroot -w /var/www/certbot -d yourdomain.com

# 12. 切换 HTTPS 配置
cp deploy/nginx.conf /etc/nginx/sites-available/liberstudy
nginx -t && systemctl reload nginx

# 13. systemd 服务
cp deploy/liberstudy.service /etc/systemd/system/liberstudy.service
systemctl daemon-reload
systemctl enable liberstudy
systemctl start liberstudy
```

### 8.2 日常更新代码

```bash
cd /var/www/liberstudy
git pull origin main

cd frontend
npm ci
npm run build
rm -rf /var/www/liberstudy/dist
cp -r dist /var/www/liberstudy/dist
cd ..

source /var/www/liberstudy/venv/bin/activate
pip install -r backend/requirements.txt

systemctl restart liberstudy
```

### 8.3 自动备份

建议新增 `deploy/backup-liberstudy.sh`：

```bash
#!/usr/bin/env bash
set -euo pipefail

BACKUP_ROOT="/var/backups/liberstudy"
STAMP="$(date +%F_%H-%M-%S)"
TMP_DIR="$BACKUP_ROOT/$STAMP"

mkdir -p "$TMP_DIR"

sqlite3 /var/lib/liberstudy/database.db ".backup '$TMP_DIR/database.db'"
sqlite3 /var/lib/liberstudy/live_data.db ".backup '$TMP_DIR/live_data.db'"
tar -czf "$TMP_DIR/runs.tar.gz" -C /var/lib/liberstudy/static runs

# 保留最近 7 天
find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -mtime +7 -exec rm -rf {} \;
```

然后通过 cron 或 systemd timer 每天凌晨执行一次。

推荐 cron：

```cron
0 3 * * * root /var/www/liberstudy/deploy/backup-liberstudy.sh >> /var/log/liberstudy-backup.log 2>&1
```

### 8.4 需提前准备的部署文件

仓库中建议新增 `deploy/` 目录，至少包含：

- `deploy/nginx-http.conf`
- `deploy/nginx.conf`
- `deploy/liberstudy.service`
- `deploy/backup-liberstudy.sh`

`deploy/liberstudy.service`：

```ini
[Unit]
Description=LiberStudy FastAPI
After=network.target

[Service]
User=liberstudy
Group=liberstudy
WorkingDirectory=/var/www/liberstudy/backend
Environment="PATH=/var/www/liberstudy/venv/bin"
EnvironmentFile=/var/www/liberstudy/backend/.env
ExecStart=/var/www/liberstudy/venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

---

## 9. 代码改造清单

在真正执行本部署方案前，代码层需要至少完成以下改造：

### 9.1 基础设施必需改造

- `backend/db.py` 支持从环境变量读取主库绝对路径
- `backend/services/live_store.py` 支持从环境变量读取 live DB 绝对路径
- `backend/static/` 可安全软链到持久化目录

### 9.2 登录最小闭环改造

这一节不是部署配置，而是一个独立开发任务包。
不能把它和 Nginx、systemd、`.env` 配置混在一起理解。

- 新增 `backend/auth.py`
- 新增 `/api/auth/google/login`
- 新增 `/api/auth/google/callback`
- 新增 `/api/auth/me`
- 新增 `/api/auth/logout`
- 新增白名单校验
- 新增用户表与 session 表
- 主 session 数据增加 `user_id`
- live session 数据增加 `user_id`

建议在实际开工前，再单独补一份认证实现计划，至少拆成：

- 后端 OAuth 与服务端 session 存储
- `users` / `auth_session` / `user_id` 数据模型改造
- live session 归属与鉴权
- 前端 `/login`、`PrivateRoute`、登录态恢复

### 9.3 前端最小改造

- 新增 `/login`
- `frontend/src/App.tsx` 增加 `PrivateRoute`
- `frontend/src/lib/api.ts` 统一加 `credentials: 'include'`
- LobbyPage 增加当前用户展示与退出

---

## 10. 风险与注意事项

| 风险 | 措施 |
|------|------|
| Ubuntu 默认 `nodejs` 版本过低，前端构建失败 | 明确使用 Node.js 22 LTS，不走默认 apt 源 |
| SQLite 路径仍是相对路径 | 改为环境变量驱动的绝对路径 |
| live 库没有 `user_id`，导致登录后仍无法隔离 live 数据 | 在 `live_sessions` 中补 `user_id` |
| `backend/static/` 被代码更新覆盖 | 使用软链指向 `/var/lib/liberstudy/static/` |
| `/slides`、`/audio`、`/runs` 返回 404 | Nginx 明确转发到后端 |
| Google 登录开放给所有人 | 必须加邮箱白名单 |
| 单机 SQLite 数据丢失 | 每日自动备份 DB + runs，保留 7 天 |
| 给整个代码目录写权限过宽 | 使用独立应用用户 `liberstudy`，仅对必要目录赋写权限 |
| 阶段一 HTTP-only 暴露不必要路由 | 阶段一配置仅保留 ACME challenge，其余请求直接拒绝 |
| 代码目录 owner 与 systemd 运行用户不一致 | `git clone` 后立即执行 `chown -R liberstudy:liberstudy /var/www/liberstudy` |
| 2G 内存下 LibreOffice 转换偶发压力 | 保持单机低并发，观察真实使用情况，必要时升级实例 |

---

## 11. 不在本次范围内

- 开放注册
- 管理后台
- 多角色权限
- CI/CD
- Docker / Kubernetes
- 云数据库
- 多机高可用
- 监控告警平台
- 正式商用级审计和合规
