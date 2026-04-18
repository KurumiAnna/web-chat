// server.js
import express from 'express';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const MAX_USERS = 15;
const MESSAGE_MAX_LENGTH = 500;
const HEARTBEAT_INTERVAL = 30000; // 30秒
const USERS_DB_FILE = path.join(__dirname, 'users.json');

// 用户数据库管理
class UserDB {
  constructor(filePath) {
    this.filePath = filePath;
    this.users = this.loadUsers();
    this.tokens = new Map(); // token -> username映射
  }

  loadUsers() {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = fs.readFileSync(this.filePath, 'utf-8');
        return JSON.parse(data);
      }
    } catch (e) {
      console.error('加载用户数据失败:', e.message);
    }
    return {};
  }

  saveUsers() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.users, null, 2), 'utf-8');
    } catch (e) {
      console.error('保存用户数据失败:', e.message);
    }
  }

  registerUser(username, password) {
    if (this.users[username]) {
      return { success: false, message: '用户名已存在' };
    }

    const passwordHash = this.hashPassword(password);
    this.users[username] = { password: passwordHash, createdAt: new Date().toISOString() };
    this.saveUsers();
    
    console.log(`[${new Date().toISOString()}] 新用户注册: ${username}`);
    return { success: true, message: '注册成功' };
  }

  authenticateUser(username, password) {
    const user = this.users[username];
    if (!user) {
      return { success: false, message: '用户不存在' };
    }

    if (user.password !== this.hashPassword(password)) {
      return { success: false, message: '密码错误' };
    }

    const token = crypto.randomBytes(16).toString('hex');
    this.tokens.set(token, username);
    
    console.log(`[${new Date().toISOString()}] 用户登录: ${username}`);
    return { success: true, token, username };
  }

  validateToken(token) {
    return this.tokens.get(token);
  }

  invalidateToken(token) {
    this.tokens.delete(token);
  }

  hashPassword(password) {
    return crypto.createHash('sha256').update(password + 'salt_key').digest('hex');
  }
}

const userDB = new UserDB(USERS_DB_FILE);

app.use(express.json());
app.use(express.static(path.join(__dirname, './')));

// 认证API
app.post('/api/auth/register', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.json({ success: false, message: '用户名和密码不能为空' });
  }

  if (username.length < 2 || username.length > 20) {
    return res.json({ success: false, message: '用户名长度需要2-20个字符' });
  }

  if (password.length < 6 || password.length > 30) {
    return res.json({ success: false, message: '密码长度需要6-30个字符' });
  }

  const result = userDB.registerUser(username, password);
  res.json(result);
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.json({ success: false, message: '用户名和密码不能为空' });
  }

  const result = userDB.authenticateUser(username, password);
  res.json(result);
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const server = app.listen(PORT, HOST, () => {
  console.log(`[${new Date().toISOString()}] 服务器运行在 http://${HOST}:${PORT}`);
});

const wss = new WebSocketServer({ 
  server,
  maxPayload: 50 * 1024 * 1024  // 增加到50MB以支持大图片
});
let onlineUsers = [];

// 定期检查连接
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      const userName = ws.userName || 'unknown';
      console.log(`[${new Date().toISOString()}] 用户 ${userName} 无响应，断开连接`);
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, HEARTBEAT_INTERVAL);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});

wss.on('connection', (ws, req) => {
  // 从URL查询参数获取token
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get('token');

  // 验证token
  const userName = userDB.validateToken(token);
  if (!userName) {
    console.log(`[${new Date().toISOString()}] WebSocket连接被拒绝：无效的token`);
    ws.send(JSON.stringify({ type: 'error', message: '认证失败，请重新登录' }));
    ws.close(4001, 'Unauthorized');
    return;
  }

  // 创建新用户ID（在使用之前先定义）
  const userId = crypto.randomBytes(8).toString('hex');

  // 断开同用户名的旧连接，防止重复登录
  const existingUser = onlineUsers.find(u => u.userName === userName);
  if (existingUser && existingUser.ws.readyState === WebSocket.OPEN) {
    console.log(`[${new Date().toISOString()}] 用户 ${userName} 重新连接，断开旧连接`);
    existingUser.ws.close(1000, 'Reconnect');
    
    // 立即从onlineUsers中移除旧连接的用户对象
    const oldIndex = onlineUsers.findIndex(u => u.userId === existingUser.userId);
    if (oldIndex !== -1) {
      onlineUsers.splice(oldIndex, 1);
    }
  }

  // 初始化连接
  ws.isAlive = true;
  ws.userName = userName;  // 保存用户名用于日志输出
  ws.userId = userId;      // 保存用户ID
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  // 检查在线人数是否已满
  if (onlineUsers.length >= MAX_USERS) {
    console.log(`[${new Date().toISOString()}] 连接被拒绝：人数已满`);
    ws.send(JSON.stringify({ type: 'error', message: '当前人数已满' }));
    ws.close();
    return;
  }

  // 添加用户到在线列表
  const userObj = { userId, userName, ws, connectedAt: new Date() };
  onlineUsers.push(userObj);

  console.log(`[${new Date().toISOString()}] 用户 ${userName}(${userId}) 加入，当前在线：${onlineUsers.length}`);

  // 向新用户发送其信息和用户列表
  ws.send(JSON.stringify({ 
    type: 'userJoin', 
    user: { userId, userName }, 
    onlineCount: onlineUsers.length,
    userList: onlineUsers.map(u => ({ userId: u.userId, userName: u.userName }))
  }));

  // 向其他用户广播
  broadcast({ 
    type: 'userJoin', 
    onlineCount: onlineUsers.length,
    userList: onlineUsers.map(u => ({ userId: u.userId, userName: u.userName }))
  }, ws);

  // 处理消息
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      if (data.type === 'chatMessage') {
        // 验证消息
        if (!data.message || typeof data.message !== 'string') {
          console.warn(`[${new Date().toISOString()}] 非法消息：缺少message字段`);
          return;
        }

        const msg = data.message.trim();
        
        if (!msg || msg.length === 0) {
          console.warn(`[${new Date().toISOString()}] 空消息被丢弃`);
          return;
        }

        if (msg.length > MESSAGE_MAX_LENGTH) {
          console.warn(`[${new Date().toISOString()}] 消息过长：${msg.length}字符`);
          ws.send(JSON.stringify({ 
            type: 'error', 
            message: `消息长度不能超过${MESSAGE_MAX_LENGTH}字符` 
          }));
          return;
        }

        console.log(`[${new Date().toISOString()}] 用户 ${userName}：${msg.substring(0, 50)}...`);
        
        broadcast({ 
          type: 'chatMessage', 
          sender: { userId, userName }, 
          message: msg,
          timestamp: new Date().toLocaleTimeString()
        }, ws);
      } else if (data.type === 'imageMessage') {
        // 验证图片消息
        if (!data.image || typeof data.image !== 'string') {
          console.warn(`[${new Date().toISOString()}] 非法图片消息：缺少image字段`);
          return;
        }

        // 检查Base64大小（限制在40MB以内）
        if (data.image.length > 40 * 1024 * 1024) {
          ws.send(JSON.stringify({ 
            type: 'error', 
            message: '图片大小不能超过20MB' 
          }));
          return;
        }

        console.log(`[${new Date().toISOString()}] 用户 ${userName} 发送了一张图片`);
        
        broadcast({ 
          type: 'imageMessage', 
          sender: { userId, userName }, 
          image: data.image,
          timestamp: new Date().toLocaleTimeString()
        }, ws);
      }
    } catch (e) {
      console.error(`[${new Date().toISOString()}] 消息解析错误:`, e.message);
    }
  });

  // 处理连接关闭
  ws.on('close', () => {
    const index = onlineUsers.findIndex(u => u.userId === userId);
    if (index !== -1) {
      onlineUsers.splice(index, 1);
      console.log(`[${new Date().toISOString()}] 用户 ${userName}(${userId}) 离开，当前在线：${onlineUsers.length}`);
    }
    
    // 注意：不在这里清除token，允许用户在短时间内重新连接
    // token 只在用户主动登出时才会被清除
    
    broadcast({ 
      type: 'userLeave', 
      userId, 
      onlineCount: onlineUsers.length,
      userList: onlineUsers.map(u => ({ userId: u.userId, userName: u.userName }))
    });
  });

  // 错误处理
  ws.on('error', (error) => {
    console.error(`[${new Date().toISOString()}] WebSocket错误:`, error.message);
  });
});

// 广播消息
function broadcast(message, excludeWs) {
  const payload = JSON.stringify(message);
  wss.clients.forEach(client => {
    try {
      if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    } catch (e) {
      console.error(`[${new Date().toISOString()}] 广播消息失败:`, e.message);
    }
  });
}

// WebSocket服务器事件监控
wss.on('error', (error) => {
  console.error(`[${new Date().toISOString()}] WebSocket服务器错误:`, error.message);
});

// 全局错误处理
process.on('uncaughtException', (error) => {
  console.error(`[${new Date().toISOString()}] 未捕获的异常:`, error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(`[${new Date().toISOString()}] 未处理的Promise拒绝:`, reason);
});

// 定期打印连接状态
setInterval(() => {
  console.log(`[${new Date().toISOString()}] 连接状态 - 在线用户: ${onlineUsers.length}, WebSocket客户端: ${wss.clients.size}`);
}, 60000);