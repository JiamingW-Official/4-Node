# 将客户端部署到 Render（静态网站）

## 为什么部署到 Render？

你的老师建议将客户端也部署到 Render，这样做的好处：
- ✅ **统一平台**：WebSocket 服务器和前端都在 Render，管理更方便
- ✅ **免费计划**：Render 的静态网站是免费的
- ✅ **自动部署**：连接 GitHub 后，每次推送代码都会自动部署
- ✅ **自定义域名**：可以轻松添加自定义域名

## 部署步骤详解

### 第 1 步：进入 Render Dashboard

1. 访问 https://dashboard.render.com
2. 登录你的 Render 账号

### 第 2 步：创建静态网站

1. 点击右上角的 **"New +"** 按钮
2. 在下拉菜单中选择 **"Static Site"**（静态网站）

### 第 3 步：连接 GitHub 仓库

1. 在 "Connect a repository" 部分
2. 从下拉菜单中选择你的仓库：`JiamingW-Official/4-Node`
3. 如果仓库没有显示，点击 "Configure account" 连接 GitHub 账号

### 第 4 步：配置设置

**重要配置项：**

- **Name**: `economics-quiz-client`（或任何你喜欢的名字）
- **Root Directory**: `client` ⚠️ **必须设置为 `client`**
- **Build Command**: `npm install && npm run build`
- **Publish Directory**: `dist`（构建输出目录）
- **Environment**: 可以留空，或添加环境变量：
  - `NODE_ENV`: `production`
  - `VITE_WS_URL`: `wss://four-node-2025.onrender.com`（可选，代码中已硬编码）

### 第 5 步：部署

1. 点击 **"Create Static Site"**
2. Render 会自动开始构建和部署
3. 等待部署完成（通常 2-3 分钟）

### 第 6 步：获取 URL

部署完成后，Render 会提供一个 URL，格式类似：
- `https://economics-quiz-client.onrender.com`

## 配置说明

### Root Directory: `client`

这告诉 Render 在哪个目录中查找 `package.json` 和源代码。

```
4-Node/
├── client/          ← Render 会在这个目录中工作
│   ├── package.json
│   ├── src/
│   └── ...
├── server/          ← WebSocket 服务器（已部署）
└── ...
```

### Build Command: `npm install && npm run build`

这个命令会：
1. `npm install` - 安装依赖
2. `npm run build` - 构建生产版本（输出到 `dist` 目录）

### Publish Directory: `dist`

这是 Vite 构建后的输出目录，包含所有静态文件。

## 自动部署

一旦配置完成，每次你推送代码到 GitHub 的 `main` 分支时：
1. Render 会自动检测到更改
2. 自动运行构建命令
3. 自动部署新版本

## Render vs GitHub Pages 对比

| 特性 | GitHub Pages | Render Static Site |
|------|-------------|-------------------|
| **免费** | ✅ 是 | ✅ 是 |
| **自动部署** | ✅ 是（通过 Actions） | ✅ 是（直接连接） |
| **自定义域名** | ✅ 支持 | ✅ 支持 |
| **HTTPS** | ✅ 自动 | ✅ 自动 |
| **构建时间** | 通常 2-3 分钟 | 通常 2-3 分钟 |
| **平台统一** | ❌ 需要 GitHub Actions | ✅ 与服务器同一平台 |

## 推荐方案

### 方案 A：使用 Render（老师推荐）

**优点：**
- 所有服务都在 Render，管理简单
- 不需要配置 GitHub Actions
- 统一平台，更容易理解

**步骤：**
1. 部署 WebSocket 服务器到 Render（已完成）
2. 部署客户端到 Render（按上述步骤）

### 方案 B：使用 GitHub Pages（当前方案）

**优点：**
- GitHub Pages 更稳定
- 与 GitHub 仓库集成更好
- 不需要额外平台账号

**步骤：**
1. 部署 WebSocket 服务器到 Render（已完成）
2. 使用 GitHub Actions 自动部署到 GitHub Pages（已配置）

## 注意事项

### 如果使用 Render 部署客户端

1. **Base Path 配置**：
   - Render 静态网站通常部署在根路径 `/`
   - 如果之前配置了 `/4-Node/`，需要修改 `vite.config.js`

2. **环境变量**：
   - 可以在 Render Dashboard 中设置环境变量
   - `VITE_WS_URL` 可以在这里设置（如果代码支持）

3. **WebSocket URL**：
   - 确保客户端代码中的 WebSocket URL 正确
   - 当前代码已硬编码为 `wss://four-node-2025.onrender.com`

## 修改 vite.config.js（如果需要）

如果部署到 Render，可能需要修改 base path：

```javascript
// client/vite.config.js
export default defineConfig({
  plugins: [react()],
  // Render 静态网站通常使用根路径
  base: '/',
})
```

## 验证部署

部署完成后：
1. 访问 Render 提供的 URL
2. 打开浏览器开发者工具（F12）
3. 检查 Console 和 Network 标签
4. 确认 WebSocket 连接成功

## 故障排除

### 构建失败

- 检查 Root Directory 是否正确设置为 `client`
- 检查 Build Command 是否正确
- 查看 Render 日志了解具体错误

### 404 错误

- 检查 Publish Directory 是否设置为 `dist`
- 确认构建成功完成

### WebSocket 连接失败

- 确认 WebSocket 服务器正在运行
- 检查客户端代码中的 WebSocket URL 是否正确

