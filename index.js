const RSSParser = require('rss-parser');
const fs = require('fs');
const path = require('path');
const parser = new RSSParser();

const KEYWORDS_FILE = path.join(__dirname, 'keywords.json');

// ==================== 配置区域 ====================
const CONFIG = {
    rssUrl: 'https://rss.nodeseek.com/',
    checkInterval: (parseInt(process.env.CHECK_INTERVAL) || 10) * 1000, 
    telegram: {
        botToken: process.env.TG_BOT_TOKEN || 'YOUR_TELEGRAM_BOT_TOKEN', 
        adminChatId: process.env.TG_ADMIN_CHAT_ID || 'YOUR_TELEGRAM_CHAT_ID',
    }
};
// ==================================================

let keywords = [];
let isPaused = false;
let isDebugMode = false; // 默认关闭

function loadKeywords() {
    try {
        if (fs.existsSync(KEYWORDS_FILE)) {
            const data = fs.readFileSync(KEYWORDS_FILE, 'utf8');
            const rawKeywords = JSON.parse(data);
            if (Array.isArray(rawKeywords)) {
                keywords = [...new Set(rawKeywords.map(k => String(k).trim().toLowerCase()).filter(Boolean))];
            } else {
                keywords = [];
            }
        } else {
            saveKeywords();
        }
        console.log(`[INIT] 已加载的监控规则:`, keywords);
    } catch (e) {
        console.error('读取关键词文件失败，已重置为空数组:', e.message);
        keywords = [];
        saveKeywords();
    }
}

function saveKeywords() {
    try {
        const lowerKeywords = [...new Set(keywords.map(k => String(k).trim().toLowerCase()).filter(Boolean))];
        fs.writeFileSync(KEYWORDS_FILE, JSON.stringify(lowerKeywords, null, 2), 'utf8');
        console.log(`[INIT] 规则已保存，当前规则:`, lowerKeywords);
    } catch (e) {
        console.error('保存关键词文件失败:', e.message);
    }
}

const notifiedItems = new Set();
let isFirstRun = true;
let lastUpdateId = 0;

async function sendTelegramMessage(chatId, text) {
    const url = `https://api.telegram.org/bot${CONFIG.telegram.botToken}/sendMessage`;
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: text,
                parse_mode: 'HTML',
                disable_web_page_preview: true
            })
        });
        const data = await res.json();
        if (!data.ok) {
            console.error('Telegram API 报错:', data);
        }
    } catch (error) {
        console.error('发送 Telegram 请求网络异常:', error.message);
    }
}

async function checkRSS() {
    try {
        console.log(`[${new Date().toLocaleString()}] 正在检查 NodeSeek 更新... (状态: ${isPaused ? '⏸️ 已暂停' : '▶️ 运行中'} | Debug: ${isDebugMode ? '🟢 开启' : '🔴 关闭'})`);

        const feed = await parser.parseURL(CONFIG.rssUrl);
        const items = feed.items.reverse();

        for (const item of items) {
            const itemId = item.guid || item.link;

            if (isFirstRun) {
                notifiedItems.add(itemId);
                continue;
            }

            if (notifiedItems.has(itemId)) continue;
            notifiedItems.add(itemId);

            if (notifiedItems.size > 500) {
                const firstItem = notifiedItems.values().next().value;
                notifiedItems.delete(firstItem);
            }

            if (isPaused) continue;
            if (keywords.length === 0) continue;

            const rawTitle = item.title || '';
            const lowerTitle = rawTitle.toLowerCase();

            if (isDebugMode) {
                console.log(`[DEBUG] 检测新文章: "${rawTitle}"`);
            }

            const matchedKeywords = keywords.filter(rule => {
                const cleanRule = rule.trim().toLowerCase();
                if (!cleanRule) return false;

                let isMatch = false;
                if (cleanRule.includes('+')) {
                    const subKeywords = cleanRule.split('+').map(s => s.trim()).filter(Boolean);
                    if (subKeywords.length > 0) {
                        isMatch = subKeywords.every(subKw => lowerTitle.includes(subKw));
                    }
                } else {
                    isMatch = lowerTitle.includes(cleanRule);
                }

                if (isDebugMode) {
                    console.log(`[DEBUG]   -> 规则 [${rule}]: ${isMatch ? '✅ 命中' : '❌ 未命中'}`);
                }

                return isMatch;
            });

            if (matchedKeywords.length > 0) {
                console.log(`🎉 成功捕获目标帖子: ${rawTitle} [匹配规则: ${matchedKeywords.join(', ')}]`);
                
                // 💡 格式化发布时间为上海时间
                let formattedPubDate = '未知';
                if (item.pubDate) {
                    try {
                        formattedPubDate = new Date(item.pubDate).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
                    } catch (e) {
                        formattedPubDate = item.pubDate;
                    }
                }

                const message = 
                    `<b>🚨 监测到 NodeSeek 新帖</b>\n\n` +
                    `<b>标题：</b><a href="${item.link}">${rawTitle}</a>\n` +
                    `<b>命中规则：</b><code>${matchedKeywords.join(', ')}</code>\n` +
                    `<b>发布时间：</b>${formattedPubDate}`;

                await sendTelegramMessage(CONFIG.telegram.adminChatId, message);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        if (isFirstRun) {
            console.log(`初始化完成，当前监控规则: [${keywords.join(', ')}], 开始高频监控 (间隔: ${CONFIG.checkInterval / 1000}秒)...`);
            isFirstRun = false;
        }
    } catch (error) {
        console.error('抓取 RSS 出错:', error.message);
    }
}

async function pollTelegramUpdates() {
    const url = `https://api.telegram.org/bot${CONFIG.telegram.botToken}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`;
    try {
        const response = await fetch(url);
        const data = await response.json();

        if (data.ok && data.result) {
            for (const update of data.result) {
                lastUpdateId = update.update_id;

                if (!update.message || !update.message.text) continue;

                const chatId = update.message.chat.id.toString();
                const text = update.message.text.trim();

                console.log(`收到来自 [${chatId}] 的消息: ${text}`);

                if (chatId !== CONFIG.telegram.adminChatId.toString()) {
                    console.warn(`拦截未授权的 chatId: ${chatId}`);
                    continue;
                }

                if (text.startsWith('/add ')) {
                    const rawInput = text.substring(5).trim();
                    const newItems = rawInput.split(',').map(i => i.trim().toLowerCase()).filter(Boolean);
                    
                    let addedCount = 0;
                    for (const item of newItems) {
                        if (item && !keywords.includes(item)) {
                            keywords.push(item);
                            addedCount++;
                        }
                    }

                    if (addedCount > 0) {
                        saveKeywords();
                        const listStr = keywords.map((k, idx) => `<b>${idx + 1}.</b> <code>${k}</code>`).join('\n');
                        await sendTelegramMessage(chatId, `✅ <b>成功批量添加 ${addedCount} 条规则！</b>\n\n<b>当前监控规则列表：</b>\n${listStr}`);
                    } else {
                        await sendTelegramMessage(chatId, `⚠️ 没有添加任何新规则（可能规则已全部存在或格式错误）。`);
                    }
                } else if (text.startsWith('/del ')) {
                    const rawInput = text.substring(5).trim();
                    const parts = rawInput.split(',').map(i => i.trim()).filter(Boolean);
                    
                    const itemsToRemove = new Set();
                    for (const part of parts) {
                        if (/^\d+-\d+$/.test(part)) { const [start, end] = part.split('-').map(Number); const min = Math.min(start, end); const max = Math.max(start, end); for (let i = min; i <= max; i++) { const index = i - 1; if (index >= 0 && index < keywords.length) { itemsToRemove.add(keywords[index]); } } } else if (/^\d+$/.test(part)) {
                            const index = parseInt(part) - 1;
                            if (index >= 0 && index < keywords.length) {
                                itemsToRemove.add(keywords[index]);
                            }
                        } else {
                            const lowerT = part.toLowerCase();
                            if (keywords.includes(lowerT)) {
                                itemsToRemove.add(lowerT);
                            }
                        }
                    }

                    let deletedCount = 0;
                    if (itemsToRemove.size > 0) {
                        keywords = keywords.filter(k => {
                            if (itemsToRemove.has(k)) {
                                deletedCount++;
                                return false;
                            }
                            return true;
                        });
                        saveKeywords();
                        let listStr = '暂无，当前规则列表为空';
                        if (keywords.length > 0) {
                            listStr = keywords.map((k, idx) => `<b>${idx + 1}.</b> <code>${k}</code>`).join('\n');
                        }
                        await sendTelegramMessage(chatId, `✅ <b>成功删除 ${deletedCount} 条规则！</b>\n\n<b>当前剩余监控规则列表：</b>\n${listStr}`);
                    } else {
                        await sendTelegramMessage(chatId, `⚠️ 未找到指定的序号、范围或规则。`);
                    }
                } else if (text === '/debug on') {
                    isDebugMode = true;
                    await sendTelegramMessage(chatId, `🛠️ <b>Debug 调试模式已开启！</b>\n现在将打印新消息的规则匹配明细。`);
                } else if (text === '/debug off') {
                    isDebugMode = false;
                    await sendTelegramMessage(chatId, `🧹 <b>Debug 调试模式已关闭！</b>`);
                } else if (text === '/pause') {
                    isPaused = true;
                    await sendTelegramMessage(chatId, `⏸️ <b>监控已暂停！</b>`);
                } else if (text === '/resume') {
                    isPaused = false;
                    await sendTelegramMessage(chatId, `▶️ <b>监控已恢复！</b>`);
                } else if (text === '/clear') {
                    await sendTelegramMessage(chatId, `⚠️ <b>警告：</b>你即将清空所有监控规则！\n如确认清除请回复：\n<code>/clear confirm</code>`);
                } else if (text === '/clear confirm') {
                    keywords = [];
                    saveKeywords();
                    await sendTelegramMessage(chatId, `🗑️ <b>已清空所有监控规则！</b>`);
                } else if (text === '/list') {
                    const statusText = isPaused ? '⏸️ 已暂停' : '▶️ 运行中';
                    const debugText = isDebugMode ? '🟢 开启' : '🔴 关闭';
                    let listStr = '暂无，请使用 /add 添加';
                    if (keywords.length > 0) {
                        listStr = keywords.map((k, idx) => `<b>${idx + 1}.</b> <code>${k}</code>`).join('\n');
                    }
                    await sendTelegramMessage(chatId, `📋 <b>当前状态：</b> ${statusText} | <b>Debug:</b> ${debugText}\n\n<b>监控规则列表：</b>\n${listStr}`);
                } else if (text === '/help') {
                    const helpMsg = 
                        `🤖 <b>NodeSeek 监控助手指令：</b>\n\n` +
                        `• <code>/add 规则1,规则2</code> - 批量添加规则\n` +
                        `• <code>/del 6,8-10</code> - 支持按序号、范围删除\n` +
                        `• <code>/debug on</code> - 开启新消息匹配调试日志\n` +
                        `• <code>/debug off</code> - 关闭调试日志\n` +
                        `• <code>/pause</code> - 暂停监控\n` +
                        `• <code>/resume</code> - 恢复监控\n` +
                        `• <code>/list</code> - 查看规则与Debug状态\n` +
                        `• <code>/clear</code> - 清空所有规则`;
                    await sendTelegramMessage(chatId, helpMsg);
                }
            }
        }
    } catch (error) {
        console.error('获取 Telegram 更新出错:', error.message);
    }

    setTimeout(pollTelegramUpdates, 1000);
}

loadKeywords();
checkRSS();
setInterval(checkRSS, CONFIG.checkInterval);
pollTelegramUpdates();
