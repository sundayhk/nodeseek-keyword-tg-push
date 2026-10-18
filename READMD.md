# 🤖 NodeSeek Keyword Telegram Push

基于 Node.js 与 Docker 的 **NodeSeek 论坛 RSS 关键词实时监控与 Telegram 智能推送助手**。支持多关键词组合、精确/模糊匹配、规则持久化及通过 Telegram 机器人指令动态管理监控规则。

---

## ✨ 功能特点

- **⚡ 实时监控**：定时轮询 NodeSeek RSS 官方源，秒级捕获最新发布的帖子。
- **🔍 智能匹配引擎**：
  - **单关键词**：支持大小写不敏感的子串模糊匹配。
  - **组合关键词**：支持用 `+` 连接的多条件交集匹配（如 `出+瓦工`、`出+dmit+wee`）。
- **📱 Telegram 交互式管理**：无需登录服务器，直接通过 Telegram 机器人指令增删改查规则、控制暂停/恢复及开关调试模式。
- **🛡️ 历史防轰炸**：容器启动时自动初始化去重，避免重复推送历史老贴。
- **🕒 本地化时间**：全面适配上海时区（UTC+8），控制台日志与 TG 推送时间精准同步。
- **🐳 容器化部署**：基于 Docker & Docker Compose，开箱即用，数据安全持久化。

---

## 🛠️ 项目文件结构

```text
nodeseek-keyword-tg-push/
├── .env-example         # 环境变量配置模板
├── docker-compose.yaml  # Docker Compose 编排文件
├── Dockerfile           # 镜像构建文件（含 Alpine 时区支持）
├── index.js             # 核心业务逻辑与 Telegram 机器人代码
└── keywords.json        # 监控规则持久化存储文件（自动生成/挂载）
