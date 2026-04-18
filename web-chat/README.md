# Web Chat 实时通讯应用（AI写的喵，补药找我喵）

## 环境要求

- **Node.js**: >= 18.0.0（推荐 18.17.0，见 `.nvmrc`）
- **npm**: >= 8.0.0

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境

复制 `.env.example` 创建 `.env` 文件（可选，使用默认值）：

```bash
cp .env.example .env
```

环境变量说明：
- `PORT`: 服务器端口（默认：3000）
- `HOST`: 服务器主机（默认：0.0.0.0）
- `NODE_ENV`: 运行环境（development/production）

### 3. 启动服务器

**生产环境：**
```bash
npm start
```

**开发环境（自动重启）：**
```bash
npm run dev
```

服务器将运行在 `http://localhost:3000`

## 项目结构

```
.
├── server.js           # Express + WebSocket 服务器
├── index.html          # 聊天客户端页面
├── package.json        # 项目依赖配置
├── .nvmrc             # Node.js 版本管理
├── .env.example       # 环境变量示例
└── README.md          # 本文件
```

## 功能特性

- ✅ 实时消息通讯（WebSocket）
- ✅ 在线用户统计
- ✅ 自动重连机制
- ✅ 消息验证和安全防护
- ✅ 连接心跳检测
- ✅ XSS 防护

## 版本历史

### v1.0.0
- 初始版本
- 支持基本聊天功能
- 添加优化和安全措施
