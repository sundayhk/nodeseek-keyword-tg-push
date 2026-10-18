FROM node:18-alpine

WORKDIR /app

# 仅拷贝依赖声明文件（如果有 package.json 的话）
# 本项目只用到了原生/内置库及 rss-parser，我们直接在这里安装
RUN npm install rss-parser

# 复制源码
COPY index.js .

# 启动脚本
CMD ["node", "index.js"]
