# 生产部署设计规格

**日期**：2026-04-24  
**状态**：已批准  
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
    ├── /api/*  → proxy_pass http://127.0.0.1:8000
    ├── /ws/*   → proxy_pass http://127.0.0.1:8000（WebSocket upgrade）
    └── /*      → root /var/www/liberstudy/dist（React 静态文件）

uvicorn（FastAPI，systemd 管理，开机自启）
    ├── 业务路由：process / sessions / live / diagnostics
    ├── 新增路由：auth（Google OAuth + JWT）
    └── SQLite：/var/lib/liberstudy/database.db + live_data.db

系统依赖
    ├── LibreOffice headless（PPT→PDF）+ 中文字体包
    └── FFmpeg（WebM/Opus→WAV）
```

**静态资源目录**（部署时不覆盖）：
- `/var/lib/liberstudy/static/slides/`
- `/var/lib/liberstudy/static/audio/`
- `/var/lib/liberstudy/static/runs/`

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

LobbyPage 顶部侧边栏底部显示当前用户头像 + 名字 + 退出登录按钮。退出调用 `DELETE /api/auth/logout`（清除 cookie）。

### 5.4 API 调用

因为用 `HttpOnly` cookie，前端 fetch 只需加 `credentials: 'include'`，不需要手动管理 token。`frontend/src/lib/api.ts` 统一加上此选项。

---

## 6. Nginx 配置要点

```nginx
server {
    listen 443 ssl;
    server_name yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    # 前端静态文件
    root /var/www/liberstudy/dist;
    index index.html;
    try_files $uri $uri/ /index.html;  # SPA 路由支持

    # 后端 API
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # WebSocket（Live ASR）
    location /ws/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;  # WebSocket 长连接
    }
}

# HTTP 强制跳转 HTTPS
server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$host$request_uri;
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

### 8.1 一次性初始化（首次部署）

```bash
# 1. 系统依赖
apt update && apt install -y nginx python3 python3-pip python3-venv ffmpeg certbot python3-certbot-nginx
apt install -y libreoffice fonts-noto-cjk  # LibreOffice + 中文字体（防乱码）

# 2. 项目目录
mkdir -p /var/www/liberstudy
mkdir -p /var/lib/liberstudy/static/{slides,audio,runs}

# 3. 后端 venv
cd /var/www/liberstudy
python3 -m venv venv
source venv/bin/activate
pip install -r backend/requirements.txt

# 4. 配置 .env（手动上传，不进 git）

# 5. 域名 DNS 解析到 ECS 公网 IP（提前做，等待生效）

# 6. 申请 SSL 证书
certbot --nginx -d yourdomain.com

# 7. systemd 服务
# 见 8.3
```

### 8.2 日常更新代码

```bash
cd /var/www/liberstudy
git pull origin main

# 前端
cd frontend && npm ci && npm run build
cp -r dist /var/www/liberstudy/dist

# 后端
source venv/bin/activate
pip install -r backend/requirements.txt

systemctl restart liberstudy
```

### 8.3 systemd 服务文件

`/etc/systemd/system/liberstudy.service`：

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
| SQLite 文件路径变更 | `db.py` 中路径改为绝对路径 `/var/lib/liberstudy/database.db` |
| Google OAuth 回调域名 | Google Console 白名单必须填写完整回调 URL |
| Let's Encrypt 证书续签 | Certbot 自动配置 cron，90 天自动续签 |
| static/ 目录被 git pull 覆盖 | static/ 目录软链到 /var/lib/liberstudy/static/，与代码分离 |
| 2G 内存 LibreOffice OOM | LibreOffice 转换完立即退出（headless 模式已是如此），风险低 |

---

## 10. 不在本次范围内

- 监控告警（Prometheus / 阿里云监控）
- 自动化 CI/CD（GitHub Actions）
- 多用户权限分级（当前5人均为普通用户）
- 备份策略（SQLite 手动定期 scp 到本地即可）
