# Render 部署快速指南

## 问题解决

如果你遇到 `Cannot find module '/opt/render/project/src/server.js'` 错误，这是因为 Render 没有正确设置根目录。

## 解决方案

### 方法 1：使用 Render Dashboard 配置（推荐）

1. **访问 Render Dashboard**：
   - 登录 https://dashboard.render.com
   - 点击 "New" → "Web Service"

2. **连接仓库**：
   - 选择 "Connect a repository"
   - 选择 `JiamingW-Official/4-Node`

3. **配置服务**：
   ```
   Name: economics-quiz-server
   Root Directory: server          ← 非常重要！
   Environment: Node
   Build Command: npm install       ← 可以留空，Render 会自动检测
   Start Command: node server.js
   Plan: Free
   ```

4. **点击 "Create Web Service"**

5. **等待部署完成**（2-3 分钟）

6. **获取 WebSocket URL**：
   - 部署完成后，在服务页面会显示 URL
   - 格式：`wss://economics-quiz-server.onrender.com`
   - 复制这个 URL

### 方法 2：使用 render.yaml（更简单）

1. **在 Render Dashboard**：
   - 点击 "New" → "Blueprint"
   - 选择你的仓库
   - Render 会自动检测 `render.yaml` 文件

2. **应用配置**：
   - Render 会读取 `render.yaml` 中的配置
   - 点击 "Apply" 创建服务

3. **等待部署完成**

## 配置 GitHub Secret

部署完成后，需要将 WebSocket URL 配置到 GitHub：

1. **进入 GitHub 仓库**：
   - Settings → Secrets and variables → Actions

2. **添加 Secret**：
   - Name: `VITE_WS_URL`
   - Value: `wss://your-app-name.onrender.com`（你的 Render URL）

3. **保存**

## 验证部署

1. **检查 Render 日志**：
   - 在 Render Dashboard 中查看服务日志
   - 应该看到：`Quiz WebSocket server running on wss://...`

2. **测试连接**：
   - 访问你的 GitHub Pages：`https://JiamingW-Official.github.io/4-Node/`
   - 应该能看到 "connected" 状态

## 常见问题

### 问题 1：服务一直显示 "Building"
- **解决**：检查 Root Directory 是否设置为 `server`
- **解决**：检查 Build Command 是否正确

### 问题 2：部署后无法连接
- **检查**：WebSocket URL 是否正确（应该是 `wss://` 不是 `ws://`）
- **检查**：GitHub Secret `VITE_WS_URL` 是否已设置
- **检查**：Render 服务是否正在运行（查看 Dashboard）

### 问题 3：首次访问很慢
- **原因**：Render 免费计划会在 15 分钟无活动后休眠
- **解决**：首次访问需要几秒唤醒服务，这是正常的

### 问题 4：服务自动停止
- **原因**：免费计划有资源限制
- **解决**：可以升级到付费计划，或接受免费计划的限制

## 更新部署

如果代码更新了：

1. **推送到 GitHub**：
   ```bash
   git push origin main
   ```

2. **Render 会自动重新部署**（如果启用了自动部署）

3. **或者手动触发**：
   - 在 Render Dashboard 中点击 "Manual Deploy"

## 获取 WebSocket URL

部署完成后，WebSocket URL 格式：
- `wss://your-service-name.onrender.com`

**注意**：
- 使用 `wss://`（安全 WebSocket），不是 `ws://`
- URL 不包含端口号
- 确保在 GitHub Secret 中正确配置

