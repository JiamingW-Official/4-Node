# 部署指南 / Deployment Guide

## 前端部署到 GitHub Pages

前端已经配置了 GitHub Actions 自动部署。每次推送到 `main` 分支时，会自动构建并部署到 GitHub Pages。

### 设置步骤：

1. **在 GitHub 仓库设置中启用 GitHub Pages**：
   - 进入仓库 Settings → Pages
   - Source: 选择 "GitHub Actions"

2. **配置 WebSocket 服务器 URL（可选）**：
   - 进入仓库 Settings → Secrets and variables → Actions
   - 点击 "New repository secret"
   - Name: `VITE_WS_URL`
   - Value: 你的 WebSocket 服务器 URL（例如：`wss://your-app.railway.app`）
   - 如果不设置，代码会使用默认值或显示错误提示

3. **推送代码**：
   ```bash
   git push origin main
   ```
   GitHub Actions 会自动构建并部署。

## WebSocket 服务器部署

### 选项 1: Railway（推荐，简单快速）

1. **注册 Railway**：
   - 访问 https://railway.app
   - 使用 GitHub 账号登录

2. **创建新项目**：
   - 点击 "New Project"
   - 选择 "Deploy from GitHub repo"
   - 选择你的仓库
   - 选择 `server` 目录作为根目录

3. **配置环境变量**（如果需要）：
   - 在项目设置中添加环境变量
   - `PORT` 会自动设置，无需手动配置

4. **获取 WebSocket URL**：
   - Railway 会自动提供一个 URL
   - 格式类似：`wss://your-app.railway.app`
   - 复制这个 URL

5. **更新前端配置**：
   - 在 GitHub 仓库设置中添加 Secret：`VITE_WS_URL` = `wss://your-app.railway.app`
   - 或者手动构建时设置环境变量

### 选项 2: Render

1. **注册 Render**：
   - 访问 https://render.com
   - 使用 GitHub 账号登录

2. **创建 Web Service**：
   - 点击 "New" → "Web Service"
   - 连接你的 GitHub 仓库
   - 设置：
     - **Root Directory**: `server`
     - **Build Command**: `npm install`
     - **Start Command**: `node server.js`
     - **Environment**: `Node`

3. **配置环境变量**：
   - `PORT` 会自动设置

4. **获取 WebSocket URL**：
   - Render 提供的 URL 格式：`wss://your-app.onrender.com`

### 选项 3: Heroku

1. **安装 Heroku CLI**：
   ```bash
   # Windows
   # 下载安装程序：https://devcenter.heroku.com/articles/heroku-cli
   ```

2. **登录 Heroku**：
   ```bash
   heroku login
   ```

3. **创建应用**：
   ```bash
   cd server
   heroku create your-app-name
   ```

4. **部署**：
   ```bash
   git subtree push --prefix server heroku main
   ```

5. **获取 URL**：
   - 格式：`wss://your-app-name.herokuapp.com`

## 本地测试生产构建

在部署到 GitHub Pages 之前，可以本地测试生产构建：

```bash
# 设置环境变量（Windows PowerShell）
$env:VITE_WS_URL="wss://your-websocket-server.com"
$env:NODE_ENV="production"

# 构建
cd client
npm run build

# 预览（需要安装 serve）
npx serve -s dist -l 3000
```

然后访问 `http://localhost:3000/4-Node/` 测试。

## 故障排除

### WebSocket 连接失败

1. **检查服务器是否运行**：
   - 访问你的 WebSocket 服务器 URL
   - 应该看到连接错误（这是正常的，因为浏览器不能直接连接 WebSocket）

2. **检查 URL 格式**：
   - 本地开发：`ws://localhost:3001`
   - 生产环境：`wss://your-server.com`（注意是 `wss://` 不是 `ws://`）

3. **检查 CORS 设置**（如果需要）：
   - 大多数 WebSocket 服务器不需要 CORS 配置
   - 如果遇到问题，检查服务器日志

### GitHub Pages 显示空白

1. **检查构建是否成功**：
   - 查看 GitHub Actions 日志
   - 确保没有构建错误

2. **检查 base 路径**：
   - 确保 `vite.config.js` 中生产环境的 base 是 `/4-Node/`
   - 访问 URL 应该是：`https://username.github.io/4-Node/`

3. **清除浏览器缓存**：
   - 使用无痕模式访问
   - 或清除浏览器缓存

## 更新 WebSocket URL

如果 WebSocket 服务器 URL 改变了：

1. **更新 GitHub Secret**：
   - Settings → Secrets and variables → Actions
   - 编辑 `VITE_WS_URL` secret
   - 更新为新的 URL

2. **重新触发部署**：
   - 可以推送一个空提交：`git commit --allow-empty -m "Trigger rebuild"`
   - 或手动触发 GitHub Actions workflow

