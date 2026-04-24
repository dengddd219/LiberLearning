# 生产部署设计规格

**日期**：2026-04-24  
**状态**：目标设计（尚未可执行）

> ⚠️ **执行前提**：第 4、5 节描述的认证体系（`backend/auth.py`、`/api/auth/*` 路由、前端 `PrivateRoute`、`credentials: 'include'`）**当前仓库尚未实现**。  
> 部署 runbook（第 8 节）需等认证改造完成后才能完整执行。基础设施搭建（ECS、域名、Nginx、HTTPS）可提前进行。

**范围**：LiberStudy 首次上线到阿里云，含用户认证、HTTPS、Google OAuth

---

## 1. 目标

将 LiberStudy（FastAPI 后端 + React 前端）部署到阿里云 ECS，支持 5 名用户通过 Google OAuth 登录后公开访问，全程 HTTPS，费用控制在 300 元/年以内。

---

## 2. 基础设施

| 资源 | 选型 | 费用 |
|------|------|------|
| 计算 | 阿里云 ECS 2核2G，Ubuntu 22.04 | ~99元/年（新用户） |
| 域名 | `.top` / `.xyz` 后缀 | ~10-30元/年 |
| HTTPS 证书 | Let's Encrypt（Certbot 自动续签） | 免费 |
| 数据库 | SQLite（保持现有） | 免费 |
| Google OAuth | Google Cloud Console | 免费 |

**安全组开放端口**：22（SSH）、80（HTTP，仅用于 Let's Encrypt 验证后重定向）、443（HTTPS）

---

## 3. 系统架构

```
用户浏览器
    ↓ HTTPS :443
Nginx
    ├── /api/ws/*  → proxy_pass http://127.0.0.1:8000（WebSocket upgrade，必须在 /api/ 之前）
    ├── /api/*     → proxy_pass http://127.0.0.1:8000
    └── /*         → root /var/www/liberstudy/dist（React 静态文件）

uvicorn（FastAPI，systemd 管理，开机自启）
    ├── 业务路由：process / sessions / live / diagnostics
    ├── 新增路由：auth（Google OAuth + JWT）
    ├── SQLite database.db → /var/lib/liberstudy/database.db（backend/db.py 改绝对路径）
    └── SQLite live_data.db → /var/lib/liberstudy/live_data.db（backend/services/live_store.py 改绝对路径）

系统依赖
    ├── LibreOffice headless（PPT→PDF）+ 中文字体包
    └── FFmpeg（WebM/Opus→WAV）
```

**持久化目录**（独立于代码目录，git pull 不覆盖）：
- `/var/lib/liberstudy/database.db`（主数据库）
- `/var/lib/liberstudy/live_data.db`（直播数据库）
- `/var/lib/liberstudy/static/slides/`
- `/var/lib/liberstudy/static/audio/`
- `/var/lib/liberstudy/static/runs/`

**落地方式**：代码中两个 DB 路径改为绝对路径（`backend/db.py` L14、`backend/services/live_store.py` L6）；`backend/static/` 建软链指向 `/var/lib/liberstudy/static/`（因为 `main.py` L33 用相对路径挂载 StaticFiles）。

---

## 4. 用户认证设计

### 4.1 Google OAuth 流程

```
前端 → GET /api/auth/google/login
    → 后端返回 Google OAuth 授权 URL
    → 浏览器重定向到 Google 授权页
    → 用户授权后 Google 回调 /api/auth/google/callback?code=xxx
    → 后端用 code 换取 access_token，再获取用户 profile（email、name、picture）
    → 后端 upsert users 表，生成 JWT
    → set-cookie: access_token=<jwt>; HttpOnly; Secure; SameSite=Lax; Path=/
    → 重定向到前端首页 /
```

### 4.2 数据库变更

新增 `users` 表（在 `backend/db.py`）：

```python
class UserRow(SQLModel, table=True):
    __tablename__ = "users"
    id: str = Field(primary_key=True)          # uuid
    google_id: str = Field(unique=True)
    email: str = Field(unique=True)
    name: str
    avatar_url: Optional[str] = None
    created_at: float = Field(default_factory=time.time)
```

`SessionRow` 新增字段：
```python
user_id: Optional[str] = Field(default=None, foreign_key="users.id")
```

### 4.3 JWT 设计

- 算法：HS256
- Payload：`{ sub: user_id, email, exp: now+7days }`
- 存储：`HttpOnly` cookie，同域无跨域问题（Nginx 反代后前后端同域）
- 续签：每次请求时如果 token 剩余有效期 < 1 天，自动刷新

### 4.4 认证中间件

新增 `backend/auth.py`：
- `get_current_user(request)` —— 从 cookie 读 JWT，验证并返回 UserRow
- 各路由 `Depends(get_current_user)` 注入
- 未认证返回 401，前端跳转到 `/login`

### 4.5 数据隔离

`GET /api/sessions` 和所有 session 相关接口加 `WHERE user_id = current_user.id` 过滤，确保用户只能看到自己的数据。

限流从按 IP 改为按 `user_id`（更精准，防止共享 IP 误触发）。

---

## 5. 前端改动

### 5.1 新增页面

`/login` —— 登录页，只有一个"使用 Google 账号登录"按钮，点击调用 `/api/auth/google/login`。

### 5.2 路由守卫

`frontend/src/App.tsx` 新增 `<PrivateRoute>` 组件：
- 调用 `/api/auth/me` 检查登录状态
- 未登录跳转 `/login`
- 所有现有页面（LobbyPage、LivePage、NotesPage 等）都包在 `<PrivateRoute>` 内

### 5.3 用户信息展示

LobbyPage 顶部侧边栏底部显示当前用户头像 + 名字 + 退出登录按钮。退出调用 `POST /api/auth/logout`（清除 cookie）。

### 5.4 API 调用

因为用 `HttpOnly` cookie，前端 fetch 只需加 `credentials: 'include'`，不需要手动管理 token。`frontend/src/lib/api.ts` 统一加上此选项。

---

## 6. Nginx 配置

首次部署分两阶段：先用 HTTP-only 配置让 Certbot 能完成 ACME 验证，再切换到完整 HTTPS 配置。

### 6a. 阶段一：HTTP-only（`deploy/nginx-http.conf`，仅首次用）

```nginx
server {
    listen 80;
    server_name yourdomain.com;

    # Certbot ACME 验证（不能重定向到 HTTPS，否则 Certbot 无法访问）
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    # 其余请求代理到后端（后端在第 11 步才启动，此阶段 API 不可用，仅 ACME 验证需要 Nginx 在线）
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
```

### 6b. 阶段二：完整 HTTPS（`deploy/nginx.conf`，证书申请后替换）

```nginx
server {
    listen 443 ssl;
    server_name yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    # WebSocket（Live ASR）— 必须在 /api/ 之前
    # 实际路径：/api/ws/live-asr（live router prefix=/api，路由=/ws/live-asr）
    location /api/ws/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;
    }

    # 后端 API
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # 静态资源（课件 PDF、缩略图、录音、run log）
    # 这些路径由 FastAPI StaticFiles 挂载（main.py L33-L35），必须转发到后端
    # 不能落到 Nginx 前端 root，否则返回 404
    location ~* ^/(slides|audio|runs)/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
    }

    # 前端 SPA
    root /var/www/liberstudy/dist;
    index index.html;
    location / {
        try_files $uri $uri/ /index.html;
    }
}

# HTTP 强制跳转 HTTPS，保留 ACME challenge 路径供续签用
server {
    listen 80;
    server_name yourdomain.com;

    # Certbot webroot 续签时走这里（certbot renew 不会触发 HTTPS 重定向）
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}
```

---

## 7. 环境变量新增

`backend/.env.example` 新增：

```
# Google OAuth
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URI=https://yourdomain.com/api/auth/google/callback

# JWT
JWT_SECRET=your_random_secret_key_min_32_chars
JWT_EXPIRE_DAYS=7

# 生产域名
FRONTEND_ORIGIN=https://yourdomain.com
```

---

## 8. 部署流程

### 8.1 一次性初始化（首次部署，纯净 ECS 执行）

```bash
# 1. 系统依赖（含 Node.js）
apt update && apt install -y nginx python3 python3-pip python3-venv \
    ffmpeg certbot python3-certbot-nginx nodejs npm
apt install -y libreoffice fonts-noto-cjk

# 2. 拉取代码
git clone https://github.com/你的账号/LiberLearning.git /var/www/liberstudy
cd /var/www/liberstudy

# 3. 持久化数据目录 + 目录权限（www-data 是后端运行用户，必须有写权限）
mkdir -p /var/lib/liberstudy/static/{slides,audio,runs}
chown -R www-data:www-data /var/lib/liberstudy
chmod -R 755 /var/lib/liberstudy
# backend/static/ 软链到持久化目录（main.py 用相对路径挂载 StaticFiles）
ln -sfn /var/lib/liberstudy/static /var/www/liberstudy/backend/static
# 代码目录也要给 www-data 写权限（SQLite 在 backend/ 下创建临时文件）
chown -R www-data:www-data /var/www/liberstudy

# 4. 后端 venv
python3 -m venv /var/www/liberstudy/venv
source /var/www/liberstudy/venv/bin/activate
pip install -r backend/requirements.txt

# 5. 前端构建
cd frontend && npm ci && npm run build
rm -rf /var/www/liberstudy/dist
cp -r dist /var/www/liberstudy/dist
cd ..

# 6. 配置 .env（手动上传或 scp，不进 git）
# scp .env root@your-server-ip:/var/www/liberstudy/backend/.env
chown www-data:www-data /var/www/liberstudy/backend/.env
chmod 600 /var/www/liberstudy/backend/.env

# 7. 阶段一：启用 HTTP-only Nginx 配置（此时证书还不存在，不能用 HTTPS 配置）
cp deploy/nginx-http.conf /etc/nginx/sites-available/liberstudy
ln -s /etc/nginx/sites-available/liberstudy /etc/nginx/sites-enabled/liberstudy
# 删除默认站点避免冲突
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# 8. 域名 DNS 解析到 ECS 公网 IP（必须等待生效，用 dig yourdomain.com 确认）

# 9. 申请 SSL 证书
mkdir -p /var/www/certbot
certbot certonly --webroot -w /var/www/certbot -d yourdomain.com
# Certbot 自动配置 cron 续签，无需手动处理

# 10. 阶段二：切换到完整 HTTPS Nginx 配置
cp deploy/nginx.conf /etc/nginx/sites-available/liberstudy
nginx -t && systemctl reload nginx

# 11. 注册并启动 systemd 服务
cp deploy/liberstudy.service /etc/systemd/system/liberstudy.service
systemctl daemon-reload
systemctl enable liberstudy
systemctl start liberstudy
systemctl status liberstudy  # 确认 active (running)
```

### 8.2 日常更新代码

```bash
cd /var/www/liberstudy
git pull origin main

# 前端重新构建（先删旧 dist 避免层级错误）
cd frontend && npm ci && npm run build
rm -rf /var/www/liberstudy/dist
cp -r dist /var/www/liberstudy/dist
cd ..

# 后端依赖更新
source /var/www/liberstudy/venv/bin/activate
pip install -r backend/requirements.txt

systemctl restart liberstudy
```

### 8.3 需提前准备的部署文件

实施时需在仓库中新建 `deploy/` 目录，存放以下三个文件：

- **`deploy/nginx-http.conf`**（对应第 6a 节，首次部署阶段一用）
- **`deploy/nginx.conf`**（对应第 6b 节，证书申请后切换）
- **`deploy/liberstudy.service`**（对应本节 systemd 配置）

```ini
[Unit]
Description=LiberStudy FastAPI
After=network.target

[Service]
User=www-data
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

## 9. 风险与注意事项

| 风险 | 措施 |
|------|------|
| LibreOffice 中文字体乱码 | 安装 `fonts-noto-cjk`，测试一次 PPT 上传 |
| SQLite 路径（database.db） | `backend/db.py` L14 改绝对路径：`/var/lib/liberstudy/database.db` |
| SQLite 路径（live_data.db） | `backend/services/live_store.py` L6 改绝对路径：`/var/lib/liberstudy/live_data.db` |
| www-data 写不进数据库/静态目录 | 首次部署步骤 3 已包含 `chown -R www-data /var/lib/liberstudy` 和 `/var/www/liberstudy` |
| static/ 目录被 git pull 覆盖 | `backend/static/` 软链到 `/var/lib/liberstudy/static/`（首次部署步骤 3 已包含） |
| /slides、/audio、/runs 资源 404 | Nginx 加 `location ~* ^/(slides\|audio\|runs)/` 转发到后端（第 6 节已包含） |
| HTTPS 配置引导死锁 | 分两阶段：阶段一 HTTP-only + Certbot 申请证书；阶段二切换 HTTPS 配置（第 6a/6b 节） |
| Google OAuth 回调域名 | Google Console 白名单必须填写完整回调 URL |
| Let's Encrypt 证书续签 | Certbot 自动配置 cron，90 天自动续签 |
| 2G 内存 LibreOffice OOM | LibreOffice 转换完立即退出（headless 模式），风险低 |
| dist 目录层级错误 | 每次构建前先 `rm -rf dist`，再 `cp -r`（日常更新步骤已包含） |

---

## 10. 不在本次范围内

- 监控告警（Prometheus / 阿里云监控）
- 自动化 CI/CD（GitHub Actions）
- 多用户权限分级（当前5人均为普通用户）
- 备份策略（SQLite 手动定期 scp 到本地即可）
