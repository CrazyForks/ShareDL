// 配置常量
const CONFIG = {
    FOLDER_CODE_LENGTH: 5,
    FILE_CODE_LENGTH: 6,
    MAX_RETRY_ATTEMPTS: 5,
    SPECIAL_HEADERS: {
        "*": {
            "Origin": "DELETE",
            "Referer": "DELETE"
        }
    }
};

// 工具函数
const Utils = {
    extractFilename(url) {
        try {
            const urlObj = new URL(url);
            const params = new URLSearchParams(urlObj.search);

            // 按优先级尝试获取文件名
            const possibleNames = [
                params.get('filename'),
                params.get('name'),
                decodeURIComponent(urlObj.pathname.split('/').pop())
            ].filter(Boolean);

            // 返回第一个有效的文件名，或默认值
            return possibleNames[0] || 'unknown';
        } catch (e) {
            return url.split('/').pop() || 'unknown';
        }
    },

    formatSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        // 使用 Number 的 toFixed 方法，避免字符串转换
        return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
    },

    formatDateTime(timestamp, includeSeconds = false) {
        if (!timestamp) return null;
        const date = new Date(timestamp);
        return date.toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            ...(includeSeconds ? { second: '2-digit' } : {}),
            hour12: false
        }).replace(/\//g, '-');
    },

    // 优化文件图标映射的性能
    FILE_ICONS: {
        image: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
        video: ['mp4', 'mkv', 'avi', 'mov'],
        audio: ['mp3', 'wav', 'flac', 'm4a'],
        document: ['pdf', 'doc', 'docx', 'txt'],
        archive: ['zip', 'rar', '7z'],
        executable: ['exe', 'apk', 'dmg']
    },

    ICON_MAP: {
        image: '🖼️',
        video: '🎥',
        audio: '🎵',
        document: '📄',
        archive: '📦',
        executable: '⚙️'
    },

    getFileIcon(filename) {
        const ext = filename.split('.').pop().toLowerCase();
        for (const [type, extensions] of Object.entries(this.FILE_ICONS)) {
            if (extensions.includes(ext)) {
                return this.ICON_MAP[type];
            }
        }
        return '📄';
    },

    getSizeClass(bytes) {
        if (bytes >= 1024 * 1024 * 1024) return 'size-large';
        if (bytes >= 1024 * 1024 * 100) return 'size-medium';
        return 'size-normal';
    }
};

// 请求处理类
class RequestHandler {
    constructor(request) {
        this.request = request;
        this.url = new URL(request.url);
    }

    // 处理所有请求的入口
    async handle() {
        // 检查是否是 favicon 请求
        if (this.url.pathname === '/favicon.ico') {
            return this.handleFavicon();
        }

        // 检查地区限制
        if (!this.checkRegion()) {
            return new Response("Access Denied", { status: 403 });
        }

        // 检查根路径
        if (this.url.pathname === "/") {
            return new Response("Not Found", { status: 404 });
        }

        try {
            // 根据路径分发到不同的处理方法
            if (this.url.pathname === ADMIN_PATH) {
                return await this.handleAdmin();
            }

            if (this.url.pathname.startsWith(ADMIN_PATH + '/delete/')) {
                return await this.handleAdminDelete();
            }

            if (this.url.pathname === ADMIN_PATH + '/create') {
                return await this.handleAdminCreate();
            }

            if (this.url.pathname.startsWith('/s/')) {
                return await this.handleShortlinkAccess();
            }

            if (this.url.pathname === ADMIN_PATH + '/clear-expired') {
                return await this.handleAdminClearExpired();
            }

            if (this.url.pathname === ADMIN_PATH + '/update') {
                return await this.handleAdminUpdate();
            }

            // 默认处理直接访问
            return await this.handleDirectAccess();
        } catch (error) {
            return new Response(
                error.message || "Internal Server Error",
                {
                    headers: { 'Content-Type': 'text/plain' },
                    status: 500
                }
            );
        }
    }

    // 检查地区限制
    checkRegion() {
        try {
            // 分割并处理地区代码
            const whiteRegions = WHITE_REGIONS.split(',')
                .map(r => r.trim().toUpperCase())
                .filter(r => r); // 过滤掉空值

            const region = this.request.headers.get('cf-ipcountry')?.toUpperCase();
            return whiteRegions.includes(region);
        } catch (error) {
            return true;
        }
    }

    // 处理管理页面
    async handleAdmin() {
        if (!ADMIN_PATH) {
            return new Response("Admin path not configured", { status: 404 });
        }

        try {
            const params = new URLSearchParams(this.url.search);
            const page = parseInt(params.get('page')) || 1;
            const pageSize = 20;
            const searchQuery = params.get('q') || '';

            const { items, totalItems } = await this.getFilteredItems(searchQuery);
            const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

            if (page > totalPages) {
                return this.redirectToFirstPage();
            }

            // 获取当前页数据
            const startIndex = (page - 1) * pageSize;
            const pageItems = items.slice(startIndex, Math.min(startIndex + pageSize, items.length));

            // 生成页面内容
            const tableContent = this.generateAdminTableContent(pageItems, totalItems, searchQuery, page, totalPages);
            const adminHtml = generateAdminHtml(tableContent);

            return new Response(
                adminHtml,
                { headers: { 'Content-Type': 'text/html;charset=UTF-8' } }
            );
        } catch (error) {
            return new Response(
                error.message || "Failed to get data",
                { headers: { 'Content-Type': 'text/plain' }, status: 500 }
            );
        }
    }

    async handleAdminDelete() {
        if (!ADMIN_PATH) {
            return new Response("Admin path not configured", { status: 404 });
        }

        if (this.request.method === 'DELETE') {
            try {
                const key = decodeURIComponent(this.url.pathname.replace(ADMIN_PATH + '/delete/', ''));
                await URL_KV.delete(key);
                return new Response('ok', {
                    headers: {
                        'Content-Type': 'text/plain',
                        'Access-Control-Allow-Origin': '*'
                    }
                });
            } catch (error) {
                return new Response(error.message || "Delete failed", {
                    headers: {
                        'Content-Type': 'text/plain',
                        'Access-Control-Allow-Origin': '*'
                    },
                    status: 500
                });
            }
        } else if (this.request.method === 'OPTIONS') {
            return new Response(null, {
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'DELETE',
                    'Access-Control-Allow-Headers': 'Content-Type'
                }
            });
        }
    }

    async getFilteredItems(searchQuery) {
        let cursor = '';
        let items = [];

        do {
            const listResult = await URL_KV.list({ cursor, limit: 1000 });
            const pageItems = await Promise.all(
                listResult.keys.map(async key => {
                    const value = await URL_KV.get(key.name);
                    let createdAt = 0;
                    try {
                        const data = JSON.parse(value);
                        createdAt = data.createdAt || 0;
                    } catch (e) {}
                    return {
                        key: key.name,
                        value,
                        createdAt
                    };
                })
            );

            items = items.concat(this.filterItems(pageItems, searchQuery));
            cursor = listResult.cursor;

            if (!cursor) break;
        } while (true);

        items.sort((a, b) => b.createdAt - a.createdAt);

        return { items, totalItems: items.length };
    }

    filterItems(items, searchQuery) {
        return items.filter(item => {
            if (item.value === null) return false;
            if (!searchQuery) return true;

            const searchLower = searchQuery.toLowerCase();
            const shortUrl = `/s/${item.key}`;
            const fullShortUrl = new URL(shortUrl, this.url.origin).href;

            return [
                item.key.toLowerCase(),
                item.value.toLowerCase(),
                fullShortUrl.toLowerCase(),
                shortUrl.toLowerCase(),
                item.key.toLowerCase()
            ].some(text => text.includes(searchLower));
        });
    }

    generateAdminTableContent(items, totalItems, searchQuery, page, totalPages) {
        const searchHtml = `
            <div class="search-box">
                <div class="search-group">
                    <input type="text" id="searchInput" placeholder="搜索短链接..." value="${searchQuery}">
                    <select id="statusFilter" onchange="filterByStatus(this.value)">
                        <option value="all">全部状态</option>
                        <option value="active">生效中</option>
                        <option value="expired">已失效</option>
                    </select>
                </div>
                <div class="button-group">
                    <button onclick="search()">
                        <span>🔍</span>
                        <span>搜索</span>
                    </button>
                    <button class="btn-danger" onclick="clearExpired()">
                        <span>🗑️</span>
                        <span>清除过期链接</span>
                    </button>
                </div>
            </div>
        `;

        const tableHtml = `
            <table class="admin-table">
                <thead>
                    <tr>
                        <th>短链接</th>
                        <th>源信息</th>
                        <th>状态</th>
                        <th>有效期</th>
                        <th>访问统计</th>
                        <th>访问码</th>
                        <th>操作</th>
                    </tr>
                </thead>
                <tbody>
                    ${items.map(item => {
            let linkData;
            try {
                linkData = JSON.parse(item.value);
            } catch (e) {
                linkData = {
                    url: item.value,
                    createdAt: 0,
                    expireAt: null,
                    maxVisits: null,
                    visits: 0
                };
            }

            const isExpired = linkData.expireAt && Date.now() > linkData.expireAt;
            const isLimitExceeded = linkData.maxVisits && linkData.visits >= linkData.maxVisits;
            const isInvalid = isExpired || isLimitExceeded;

            const copyUrl = `${this.url.origin}/s/${item.key}`;

            const status = isInvalid
                ? '<span class="status expired">已失效</span>'
                : '<span class="status active">生效中</span>';

            const expireTime = linkData.expireAt
                ? `<span class="expire-time" onclick="event.stopPropagation(); editExpireTime('${item.key}', ${linkData.expireAt})" title="点击修改">
                                ${Utils.formatDateTime(linkData.expireAt, true)}
                               </span>`
                : `<span class="expire-time permanent" onclick="event.stopPropagation(); editExpireTime('${item.key}', null)" title="点击修改">永久</span>`;

            const visitsStatus = `<span class="visits ${isLimitExceeded ? 'exceeded' : ''}" onclick="event.stopPropagation(); editMaxVisits('${item.key}', ${linkData.maxVisits})" title="点击修改">
                          ${linkData.visits || 0} / ${linkData.maxVisits || '∞'}
                        </span>`;

            const accessCode = `<span class="access-code" onclick="event.stopPropagation(); editAccessCode('${item.key}', '${linkData.accessCode || ''}')" title="点击修改">
                            ${linkData.accessCode ? '🔒 ' + linkData.accessCode : '无'}
                        </span>`;

            const icon = linkData.type === 'folder' ? '📁' : '📄';
            const sourceInfo = SourceHandler.getSourceInfo(linkData);

            return `
                            <tr data-key="${item.key}" class="${isInvalid ? 'invalid' : ''} ${linkData.type === 'folder' ? 'folder-row' : ''}" data-status="${isInvalid ? 'expired' : 'active'}">
                                <td>
                                    <div class="link-info" onclick="copyToClipboard('${copyUrl}')" title="点击复制完整短链接">
                                        <span class="link-icon">${icon}</span>
                                        <span class="link-code">${item.key}</span>
                                    </div>
                                </td>
                                <td>
                                    <div class="source-info">
                                        ${linkData.sourceType ? `
                                            <a href="${sourceInfo.sourceLink}" target="_blank" class="source-icon" title="${sourceInfo.iconTitle}">
                                                <img src="${sourceInfo.iconUrl}" alt="${linkData.sourceType}" width="16" height="16">
                                            </a>
                                        ` : ''}
                                        <div class="copy-text" onclick="copyToClipboard('${sourceInfo.copyUrl}')" title="点击复制原始链接">
                                            ${sourceInfo.displayUrl}
                                        </div>
                                    </div>
                                </td>
                                <td>${status}</td>
                                <td>${expireTime}</td>
                                <td>${visitsStatus}</td>
                                <td>${accessCode}</td>
                                <td>
                                    <button class="delete-btn" onclick="deleteKey('${item.key}')">删除</button>
                                </td>
                            </tr>
                        `;
        }).join('')}
                </tbody>
            </table>
        `;

        return searchHtml + tableHtml + this.generatePagination(page, totalPages);
    }

    async handleShortlinkAccess() {
        const pathParts = this.url.pathname.split('/');
        const shortCode = pathParts[2];
        const subPath = pathParts.slice(3).join('/');  // 移除 decodeURIComponent

        const content = await URL_KV.get(shortCode);
        if (!content) {
            return new Response("Link not found", { status: 404 });
        }

        let linkData;
        try {
            linkData = JSON.parse(content);
        } catch (e) {
            linkData = {
                url: content,
                createdAt: 0,
                expireAt: null,
                maxVisits: null,
                visits: 0
            };
        }

        // 检查访问码
        const accessCode = linkData.accessCode;
        if (accessCode) {
            const providedCode = new URL(this.request.url).searchParams.get('code');

            // 如果URL中没有访问码，检查请求头中的访问码
            const headerCode = this.request.headers.get('X-Access-Code');

            // 如果都没有访问码，返回访问码输入页面
            if (!providedCode && !headerCode) {
                return new Response(
                    generateAccessCodeHtml(shortCode),
                    { headers: { 'Content-Type': 'text/html;charset=UTF-8' } }
                );
            }

            // 验证访问码
            if (providedCode !== accessCode && headerCode !== accessCode) {
                return new Response(
                    generateAccessCodeHtml(shortCode),
                    { headers: { 'Content-Type': 'text/html;charset=UTF-8' } }
                );
            }

            // 如果是下载请求，添加访问码到请求头
            if (this.request.headers.get('X-Download-Request') === 'true') {
                this.request.headers.set('X-Access-Code', accessCode);
            }
        }

        // 检查是否过期
        if (linkData.expireAt && Date.now() > linkData.expireAt) {
            return new Response("Link expired", { status: 410 });
        }

        // 检查访问次数
        if (linkData.maxVisits !== null) {
            if (linkData.visits >= linkData.maxVisits) {
                return new Response("Visit limit exceeded", { status: 410 });
            }
            linkData.visits++;
            await URL_KV.put(shortCode, JSON.stringify(linkData));
        }

        // 处理子路径
        if (subPath) {
            // 检查是否是文件请求
            const isFile = new URL(this.request.url).searchParams.get('type') === 'file';

            if (isFile) {
                let downloadUrl;
                try {
                    // 获取对应的源处理器
                    const handler = await SourceHandler.getHandler(linkData.sourceType);
                    downloadUrl = await handler.getDownloadUrl(subPath, linkData);
                } catch (error) {
                    return new Response("Failed to get download URL: " + error.message, { status: 500 });
                }

                // 检查是否是下载请求
                const isDownloadRequest = this.url.searchParams.get('download') === '1';

                // 如果是直接下载请求，返回文件内容
                if (isDownloadRequest) {
                    return this.handleFileContent(downloadUrl);
                }

                // 否则返回文件信息页面
                const fileName = subPath.split('/').pop();
                const fileSize = await this.getFileSize(downloadUrl);
                return new Response(
                    generateFileInfoHtml(fileName, fileSize),
                    { headers: { 'Content-Type': 'text/html;charset=UTF-8' } }
                );
            } else if (linkData.type === 'folder') {
                // 文件夹浏览请求
                const fullPath = `${linkData.url}/${subPath}`.replace(/\/+/g, '/');
                try {
                    const folderContent = await this.handleFolderContent(fullPath);
                    return new Response(
                        generateHtml(folderContent),
                        { headers: { 'Content-Type': 'text/html;charset=UTF-8' } }
                    );
                } catch (error) {
                    return new Response(error.message, { status: 500 });
                }
            }
        }

        // 处理原始路径
        if (linkData.type === 'folder') {
            try {
                const folderContent = await this.handleFolderContent(linkData.url);
                return new Response(
                    generateHtml(folderContent),
                    { headers: { 'Content-Type': 'text/html;charset=UTF-8' } }
                );
            } catch (error) {
                return new Response(error.message, { status: 500 });
            }
        } else {
            // 如果是文件类型
            if (accessCode) {
                // 检查是否是下载请求
                const isDownloadRequest = this.url.searchParams.get('download') === '1';

                if (isDownloadRequest) {
                    return this.handleFileContent(linkData.url);
                }

                const fileName = Utils.extractFilename(linkData.url);
                const fileSize = await this.getFileSize(linkData.url);
                return new Response(
                    generateFileInfoHtml(fileName, fileSize),
                    { headers: { 'Content-Type': 'text/html;charset=UTF-8' } }
                );
            } else {
                return this.handleFileContent(linkData.url);
            }
        }
    }

    async handleDirectAccess(shortCode, originalContent) {
        // 如果是短链接访问
        if (shortCode) {
            try {
                if (shortCode.length === CONFIG.FOLDER_CODE_LENGTH) {
                    return await this.handleFolderContent(originalContent);
                } else if (shortCode.length === CONFIG.FILE_CODE_LENGTH) {
                    return await this.handleFileContent(originalContent);
                }
                throw new Error('Invalid short code length');
            } catch (error) {
                return new Response(
                    error.message || "Failed to process content",
                    { headers: { 'Content-Type': 'text/plain' }, status: 500 }
                );
            }
        }

        // 直接访问模式
        const proxyPath = typeof PROXY_PATH !== 'undefined' ? PROXY_PATH : null;

        // 如果没有配置代理路径前缀,返回 404
        if (!proxyPath) {
            return new Response("Not Found", { status: 404 });
        }

        // 获取实际的URL
        let actualUrlStr;
        if (proxyPath === '/') {
            actualUrlStr = this.url.pathname.slice(1) + this.url.search + this.url.hash;
        } else {
            // 检查是否匹配配置的前缀
            if (!this.url.pathname.startsWith(proxyPath)) {
                return new Response("Not Found", { status: 404 });
            }
            actualUrlStr = this.url.pathname.slice(proxyPath.length) +
                this.url.search +
                this.url.hash;
        }

        try {
            new URL(actualUrlStr);
        } catch (error) {
            return new Response("Invalid URL", { status: 400 });
        }

        const modifiedRequest = this.createModifiedRequest(actualUrlStr, { handleSpecial: true });
        const response = await fetch(modifiedRequest);
        return this.createModifiedResponse(response);
    }

    // 处理文件夹内容
    async handleFolderContent(folderPath) {
        try {
            const pathParts = this.url.pathname.split('/');
            const shortCode = pathParts[2];

            const linkData = await URL_KV.get(shortCode);

            if (!linkData) {
                throw new Error('Link not found');
            }

            const linkConfig = JSON.parse(linkData);

            if (!linkConfig) {
                throw new Error('Invalid link configuration');
            }

            // 获取当前访问的子路径
            const subPath = pathParts.slice(3).join('/');

            // 获取对应的源处理器
            const handler = await SourceHandler.getHandler(linkConfig.sourceType);

            // 使用处理器获取文件列表
            try {
                let fullPath;
                if (linkConfig.sourceType === 'alist') {
                    // 对于 AList，基础路径就是 url，子路径需要附加到后面
                    const basePath = linkConfig.url || '/';
                    // 确保子路径是解码状态
                    const decodedSubPath = subPath ? decodeURIComponent(subPath) : '';
                    fullPath = decodedSubPath
                        ? `${basePath.replace(/\/+$/, '')}/${decodedSubPath}`.replace(/^\/+/, '')
                        : basePath.replace(/^\/+/, '');
                } else {
                    // 对于其他源（如 GitHub），保持原有逻辑
                    const basePath = linkConfig.path || '/';
                    fullPath = subPath
                        ? `${basePath.replace(/\/$/, '')}/${subPath}`.replace(/^\/+/, '')
                        : basePath;
                }

                const files = await handler.getFileList(fullPath, linkConfig.config);
                if (!files || !files.length) {
                    return generateEmptyFolderHtml();
                }

                // 获取当前路径和访问码
                const currentPath = pathParts.slice(3).join('/');
                const currentAccessCode = new URL(this.request.url).searchParams.get('code');

                // 生成文件列表 HTML
                const items = files
                    .map(item => {
                        const isDir = item.is_dir;
                        const icon = isDir ? '📁' : Utils.getFileIcon(item.name);

                        // 构建新的路径
                        const newPath = currentPath ? `${currentPath}/${item.name}` : item.name;

                        // 构建URL - 始终使用我们的代理下载链接
                        let itemUrl = isDir ?
                            `/s/${shortCode}/${newPath}` :
                            `/s/${shortCode}/${newPath}?type=file&download=1`;

                        if (currentAccessCode) {
                            itemUrl += (itemUrl.includes('?') ? '&' : '?') + `code=${currentAccessCode}`;
                        }

                        const modifiedTime = item.modified ? Utils.formatDateTime(item.modified) : '';

                        return `
                            <div class="file-item ${isDir ? 'folder' : 'file'}">
                                <a href="${itemUrl}" class="file-link">
                                    <span class="file-icon">${icon}</span>
                                    <span class="file-name">${item.name}</span>
                                    <div class="file-info">
                                        ${modifiedTime ? `<span class="file-time">${modifiedTime}</span>` : ''}
                                        ${!isDir ? `<span class="file-size">${Utils.formatSize(item.size)}</span>` : ''}
                                    </div>
                                </a>
                            </div>
                        `;
                    }).join('');
                // 构建返回上级目录的链接
                const parentLink = currentPath ? `
                    <div class="file-list-header">
                        <a href="/s/${shortCode}/${currentPath.split('/').slice(0, -1).join('/')}${currentAccessCode ? '?code=' + currentAccessCode : ''}" class="parent-link">
                            <span class="back-icon">←</span>
                            返回上级
                        </a>
                    </div>
                ` : '';

                return `
                    <div class="file-list">
                        ${parentLink}
                        <div class="file-list-content">
                            ${items}
                        </div>
                    </div>
                `;
            } catch (error) {
                return generateErrorHtml(`Failed to load folder content: ${error.message}`);
            }

        } catch (error) {
            return generateErrorHtml(`Error: ${error.message}`);
        }
    }

    // 处理文件内容
    async handleFileContent(url) {
        try {
            const accessCode = new URL(this.request.url).searchParams.get('code');
            const modifiedRequest = this.createModifiedRequest(url, { accessCode });
            const response = await fetch(modifiedRequest);

            // 获取文件名
            const filename = Utils.extractFilename(url);
            const ext = filename.split('.').pop().toLowerCase();

            // 创建新的响应头
            const headers = new Headers(response.headers);

            // 对于文本文件类型，强制设置为下载
            const textTypes = ['txt', 'md', 'json', 'log', 'yml', 'yaml', 'xml', 'csv'];
            if (textTypes.includes(ext)) {
                headers.set('Content-Disposition', `attachment; filename="${filename}"`);
            }

            // 返回修改后的响应
            return new Response(response.body, {
                status: response.status,
                headers: headers
            });
        } catch (error) {
            return new Response(error.message || "Failed to get content", {
                status: 500,
                headers: { 'Content-Type': 'text/plain' }
            });
        }
    }

    createModifiedRequest(url, options = {}) {
        return new Request(url, {
            method: this.request.method,
            headers: this.createCleanHeaders(options),
            redirect: 'follow'
        });
    }

    createModifiedResponse(response) {
        const modifiedResponse = new Response(response.body, response);
        modifiedResponse.headers.set('Access-Control-Allow-Origin', '*');

        // 获取文件名
        let filename = '';

        // 1. 先尝试从 Content-Disposition 获取
        const disposition = response.headers.get('Content-Disposition');
        if (disposition) {
            const matches = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
            if (matches && matches[1]) {
                filename = matches[1].replace(/['"]/g, '');
                try {
                    filename = decodeURIComponent(filename);
                } catch (e) {
                }
            }
        }

        // 2. 如果没有 Content-Disposition，从 URL 获取
        if (!filename) {
            filename = Utils.extractFilename(response.url);
        }

        // 3. 如果文件名存在，设置 Content-Disposition
        if (filename) {
            // 确保文件名是 UTF-8 编码
            const encodedFilename = encodeURIComponent(filename);
            modifiedResponse.headers.set(
                'Content-Disposition',
                `attachment; filename="${filename}"; filename*=UTF-8''${encodedFilename}`
            );
        }

        return modifiedResponse;
    }

    // 封装请求头处理方法
    createCleanHeaders(options = {}) {
        const headers = new Headers();

        // 基本必要的请求头
        const keepHeaders = [
            'range',
            'accept',
            'accept-encoding'
        ];

        // 从原始请求中复制必要的头部
        for (const header of keepHeaders) {
            const value = this.request.headers.get(header);
            if (value) {
                headers.set(header, value);
            }
        }

        // 处理访问码
        if (options.accessCode) {
            headers.set('X-Access-Code', options.accessCode);
        }

        // 处理特殊头部
        if (options.handleSpecial) {
            const specialHeaders = CONFIG.SPECIAL_HEADERS["*"] || {};
            for (const [header, action] of Object.entries(specialHeaders)) {
                if (action === "DELETE") {
                    headers.delete(header);
                } else if (action !== "KEEP") {
                    headers.set(header, action);
                }
            }
        }

        return headers;
    }


    redirectToFirstPage() {
        const redirectParams = new URLSearchParams(this.url.search);
        redirectParams.set('page', '1');
        return new Response(null, {
            status: 302,
            headers: {
                'Location': `${ADMIN_PATH}?${redirectParams.toString()}`
            }
        });
    }

    generatePagination(currentPage, totalPages) {
        if (totalPages <= 1) return '';

        const searchParams = new URLSearchParams(this.url.search);
        let pagination = '<div class="pagination">';

        // 上一页
        if (currentPage > 1) {
            searchParams.set('page', (currentPage - 1).toString());
            pagination += `<a href="${ADMIN_PATH}?${searchParams.toString()}" class="page-link">上一页</a>`;
        }

        // 页码
        for (let i = 1; i <= totalPages; i++) {
            if (
                i === 1 || // 第一页
                i === totalPages || // 最后一页
                (i >= currentPage - 2 && i <= currentPage + 2) // 当前页附近的页码
            ) {
                searchParams.set('page', i.toString());
                pagination += `<a href="${ADMIN_PATH}?${searchParams.toString()}" class="page-link ${i === currentPage ? 'active' : ''}">${i}</a>`;
            } else if (
                (i === currentPage - 3 && currentPage > 4) ||
                (i === currentPage + 3 && currentPage < totalPages - 3)
            ) {
                pagination += '<span class="page-ellipsis">...</span>';
            }
        }

        // 下一页
        if (currentPage < totalPages) {
            searchParams.set('page', (currentPage + 1).toString());
            pagination += `<a href="${ADMIN_PATH}?${searchParams.toString()}" class="page-link">下一页</a>`;
        }

        pagination += '</div>';
        return pagination;
    }

    async handleAdminCreate() {
        if (!ADMIN_PATH || this.request.method !== 'POST') {
            return new Response("Method not allowed", { status: 405 });
        }

        try {
            const data = await this.request.json();

            // 验证输入
            if (!data.url || !data.url.trim()) {
                throw new Error("URL is required");
            }
            if (data.maxVisits && (!Number.isInteger(data.maxVisits) || data.maxVisits < 1 || data.maxVisits > 9999)) {
                throw new Error("Max visits must be between 1 and 9999");
            }

            // 判断是否为文件夹类型
            const isFolder = data.type === 'folder';

            // 生成短码
            const shortCode = await generateFixedCode(data.url + Date.now(), isFolder);

            // 构建存储数据
            const linkData = {
                url: data.url.trim(),
                type: data.type,
                path: data.path,
                createdAt: Date.now(),
                expireAt: data.expireAt || null,
                maxVisits: data.maxVisits || null,
                visits: 0,
                accessCode: data.accessCode || null
            };

            // 如果是文件夹类型，添加源类型和配置
            if (isFolder) {
                linkData.sourceType = data.sourceType || 'alist';
                linkData.config = data.config || {};

                // 验证 GitHub 配置
                if (data.sourceType === 'github') {
                    if (!data.config.owner || !data.config.repo) {
                        throw new Error('GitHub repository owner and name are required');
                    }
                }
            }

            await URL_KV.put(shortCode, JSON.stringify(linkData));

            return new Response(JSON.stringify({ code: shortCode }), {
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        } catch (error) {
            return new Response(error.message, {
                status: 400,
                headers: {
                    'Content-Type': 'text/plain',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }
    }

    async handleAdminClearExpired() {
        if (!ADMIN_PATH || this.request.method !== 'POST') {
            return new Response("Method not allowed", { status: 405 });
        }

        try {
            let cursor = '';
            let clearedCount = 0;

            do {
                const listResult = await URL_KV.list({ cursor, limit: 1000 });

                for (const key of listResult.keys) {
                    const value = await URL_KV.get(key.name);
                    try {
                        const linkData = JSON.parse(value);
                        // 检查是否过期或超过访问次数限制
                        const isExpired = linkData.expireAt && Date.now() > linkData.expireAt;
                        const isVisitsExceeded = linkData.maxVisits && linkData.visits >= linkData.maxVisits;

                        if (isExpired || isVisitsExceeded) {
                            await URL_KV.delete(key.name);
                            clearedCount++;
                        }
                    } catch (e) {
                        continue;
                    }
                }

                cursor = listResult.cursor;
                if (!cursor) break;
            } while (true);

            return new Response(JSON.stringify({ clearedCount }), {
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        } catch (error) {
            return new Response(error.message, {
                status: 500,
                headers: {
                    'Content-Type': 'text/plain',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }
    }

    async handleAdminUpdate() {
        if (!ADMIN_PATH || this.request.method !== 'POST') {
            return new Response("Method not allowed", { status: 405 });
        }

        try {
            const { key, expireAt, maxVisits, accessCode } = await this.request.json();
            const content = await URL_KV.get(key);
            if (!content) throw new Error("Link not found");

            let linkData;
            try {
                linkData = JSON.parse(content);
            } catch (e) {
                linkData = {
                    url: content,
                    createdAt: Date.now(),
                    visits: 0
                };
            }

            // 更新数据
            if (expireAt !== undefined) linkData.expireAt = expireAt;
            if (maxVisits !== undefined) linkData.maxVisits = maxVisits;
            if (accessCode !== undefined) linkData.accessCode = accessCode;

            await URL_KV.put(key, JSON.stringify(linkData));

            return new Response('ok', {
                headers: {
                    'Content-Type': 'text/plain',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        } catch (error) {
            return new Response(error.message, {
                status: 400,
                headers: {
                    'Content-Type': 'text/plain',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }
    }

    // 添加获取文件大小的方法
    async getFileSize(url) {
        try {
            const response = await fetch(url, { method: 'HEAD' });
            return parseInt(response.headers.get('content-length') || '0');
        } catch (e) {
            return 0;
        }
    }

    // 添加 handleFavicon 方法
    handleFavicon() {
        // 一个 base64 编码的 16x16 像素的蓝色图标
        const iconBase64 = `iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAsTAAALEwEAmpwYAAABG0lEQVQ4jZ2TvUpDQRCFv7vZJIKFYKWNWFhZiYU+ho2FjY1PYGHlO/gEvoKdD2BvI1goCFZWChYiCEkM2d+xcGPuXRPRU8285cycMzM7K6q6Bf54RVWz+pVbEZHkr+RFpFbVoYhcqOp+KeAGGKrqZBnAzKbAHbBTCjCzfeAE2AzuETAGTOBbwAC4BHaB7TDwBEyAHWA3gK6Bm8CZAefAQzBtAJciUvkOVHUNOAOOgfVg/gQewQXMbA48A6/AO/CBc3kJrACrwDpQByoiUhORuoj0RKQrIm0RaYhILSLPzOwixtgEtoJrE+dWH2iJSMPMhsCBiKw5QKXEtQN0gVYAjMxsCgyANyDhHKKZvQP9nGsWY5wDL8A0xvgFJj5Vo923XqEAAAAASUVORK5CYII=`;

        return new Response(
            Uint8Array.from(atob(iconBase64), c => c.charCodeAt(0)),
            {
                headers: {
                    'Content-Type': 'image/png',
                    'Cache-Control': 'public, max-age=31536000'
                }
            }
        );
    }
}

// 主事件监听器
addEventListener('fetch', event => {
    const handler = new RequestHandler(event.request);
    event.respondWith(handler.handle());
});

// 只保留必要的全局函数
async function md5(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
}

async function generateFixedCode(url, isFolder = false) {
    const length = isFolder ? CONFIG.FOLDER_CODE_LENGTH : CONFIG.FILE_CODE_LENGTH;
    let attempts = 0;

    while (attempts < CONFIG.MAX_RETRY_ATTEMPTS) {
        const hash = await md5(url + (attempts ? `-${attempts}` : ''));
        const code = parseInt(hash.slice(0, 8), 16).toString(36).slice(0, length).padEnd(length, '0');

        const existing = await URL_KV.get(code);
        if (!existing || existing === url) {
            return code;
        }

        attempts++;
    }

    throw new Error('Failed to generate unique code');
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function generateErrorHtml(message) {
    return `
          <div class="error-container">
              <div class="error-icon">❌</div>
              <div class="error-message">${message}</div>
          </div>
      `;
}

// 生成普通页面 HTML
function generateHtml(content) {
    return `<!DOCTYPE html>
      <html>
      <head>
          <title>File List</title>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
              ${getCommonStyles()}
              ${getFileListStyles()}
          </style>
      </head>
      <body>
          <div class="container">
              ${content}
          </div>
      </body>
      </html>`;
}

//生成空文件夹模板
function generateEmptyFolderHtml() {
    return `
          <div class="empty-folder">
              <div class="empty-folder-icon">📂</div>
              <div class="empty-folder-text">Empty Folder</div>
          </div>
      `;
}

// 添加访问码页面模板
function generateAccessCodeHtml(shortCode) {
    return `<!DOCTYPE html>
      <html>
      <head>
          <title>访问验证</title>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
              ${getCommonStyles()}
              
              .access-container {
                  min-height: 100vh;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  padding: 1rem;
              }
              
              .access-form {
                  width: 100%;
                  max-width: 400px;
                  background: var(--container-bg);
                  padding: 2rem;
                  border-radius: var(--radius);
                  box-shadow: var(--shadow);
                  text-align: center;
              }
              
              .access-icon {
                  font-size: 3rem;
                  margin-bottom: 1.5rem;
                  color: var(--primary-color);
              }
              
              .access-title {
                  font-size: 1.5rem;
                  color: var(--text-primary);
                  margin-bottom: 0.5rem;
              }
              
              .access-subtitle {
                  color: var(--text-secondary);
                  margin-bottom: 2rem;
                  font-size: 0.9rem;
              }
              
              .input-group {
                  position: relative;
                  margin-bottom: 1.5rem;
              }
              
              .input-group input {
                  width: 100%;
                  padding: 1rem;
                  padding-left: 3rem;
                  border: 2px solid var(--border-color);
                  border-radius: 12px;
                  background: var(--bg-color);
                  color: var(--text-primary);
                  font-size: 1rem;
                  transition: all 0.3s ease;
              }
              
              .input-group input:focus {
                  outline: none;
                  border-color: var(--primary-color);
                  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
              }
              
              .input-group .input-icon {
                  position: absolute;
                  left: 1rem;
                  top: 50%;
                  transform: translateY(-50%);
                  color: var(--text-secondary);
                  font-size: 1.2rem;
              }
              
              .submit-btn {
                  width: 100%;
                  padding: 1rem;
                  background: var(--primary-color);
                  color: white;
                  border: none;
                  border-radius: 12px;
                  font-size: 1rem;
                  font-weight: 500;
                  cursor: pointer;
                  transition: all 0.3s ease;
              }
              
              .submit-btn:hover {
                  background: var(--hover-color);
                  transform: translateY(-1px);
              }
              
              .submit-btn:active {
                  transform: translateY(0);
              }
              
              @keyframes shake {
                  0%, 100% { transform: translateX(0); }
                  25% { transform: translateX(-5px); }
                  75% { transform: translateX(5px); }
              }
              
              .error {
                  animation: shake 0.5s ease;
                  border-color: #ef4444 !important;
              }
              
              .error-message {
                  color: #ef4444;
                  font-size: 0.875rem;
                  margin-top: 0.5rem;
                  display: none;
              }
              
              .error-message.show {
                  display: block;
              }
  
              /* 添加下载状态相关样式 */
              .download-status {
                  display: none;
                  text-align: center;
                  margin-top: 2rem;
              }
  
              .download-status.show {
                  display: block;
              }
  
              .spinner {
                  display: inline-block;
                  width: 2rem;
                  height: 2rem;
                  border: 3px solid var(--bg-color);
                  border-top-color: var(--primary-color);
                  border-radius: 50%;
                  animation: spin 1s linear infinite;
              }
  
              @keyframes spin {
                  to { transform: rotate(360deg); }
              }
  
              .success-message {
                  color: #10b981;
                  margin-top: 1rem;
              }
          </style>
      </head>
      <body>
          <div class="access-container">
              <div class="access-form">
                  <div class="access-icon">🔒</div>
                  <h1 class="access-title">访问受限</h1>
                  <p class="access-subtitle">请输入访问码以继续访问</p>
                  
                  <form onsubmit="submitCode(event)" id="accessForm">
                      <div class="input-group">
                          <span class="input-icon">🔑</span>
                          <input 
                              type="password" 
                              id="accessCode" 
                              placeholder="请输入访问码"
                              autocomplete="off"
                              required
                          >
                          <div class="error-message" id="errorMessage">访问码不能为空</div>
                      </div>
                      
                      <button type="submit" class="submit-btn">
                          确认访问
                      </button>
                  </form>
  
                  <div class="download-status" id="downloadStatus">
                      <div class="spinner"></div>
                      <p class="success-message">文件正在下载中，请稍候...</p>
                  </div>
              </div>
          </div>
          
          <script>
              // 检查是否为文件下载请求
              function isFileDownload() {
                  const url = new URL(window.location.href);
                  return url.searchParams.get('type') === 'file';
              }

              async function submitCode(e) {
                  e.preventDefault();
                  const input = document.getElementById('accessCode');
                  const errorMessage = document.getElementById('errorMessage');
                  const code = input.value.trim();
                  
                  if (!code) {
                      input.classList.add('error');
                      errorMessage.classList.add('show');
                      input.focus();
                      
                      setTimeout(() => {
                          input.classList.remove('error');
                      }, 500);
                      
                      return;
                  }
                  
                  errorMessage.classList.remove('show');

                  const url = new URL(window.location.href);
                  url.searchParams.set('code', code);

                  if (isFileDownload()) {
                      // 如果是文件下载，显示下载状态
                      document.getElementById('accessForm').style.display = 'none';
                      document.getElementById('downloadStatus').classList.add('show');
                      
                      // 创建一个隐藏的 iframe 来处理下载
                      const iframe = document.createElement('iframe');
                      iframe.style.display = 'none';
                      document.body.appendChild(iframe);
                      iframe.src = url.toString();

                      // 3秒后提示用户可以关闭页面
                      setTimeout(() => {
                          const successMessage = document.querySelector('.success-message');
                          successMessage.textContent = '文件已开始下载，您可以关闭此页面';
                          document.querySelector('.spinner').style.display = 'none';
                      }, 3000);
                  } else {
                      // 如果是文件夹访问，直接跳转
                      window.location.href = url.toString();
                  }
              }
              
              // 添加输入时的错误状态清除
              document.getElementById('accessCode').addEventListener('input', function() {
                  this.classList.remove('error');
                  document.getElementById('errorMessage').classList.remove('show');
              });

              // 如果已经有访问码且是文件下载，直接显示下载状态
              if (isFileDownload() && new URL(window.location.href).searchParams.get('code')) {
                  document.getElementById('accessForm').style.display = 'none';
                  document.getElementById('downloadStatus').classList.add('show');
                  
                  setTimeout(() => {
                      const successMessage = document.querySelector('.success-message');
                      successMessage.textContent = '文件已开始下载，您可以关闭此页面';
                      document.querySelector('.spinner').style.display = 'none';
                  }, 3000);
              }
          </script>
      </body>
      </html>`;
}

// 添加生成文件信息页面的函数
function generateFileInfoHtml(fileName, fileSize) {
    const modifiedTime = new Date().toISOString();

    return `<!DOCTYPE html>
      <html>
      <head>
          <title>${fileName} - 文件信息</title>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
              ${getCommonStyles()}
              
              .file-container {
                  min-height: 100vh;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  padding: 1rem;
              }
              
              .file-card {
                  width: 100%;
                  max-width: 500px;
                  background: var(--container-bg);
                  padding: 2rem;
                  border-radius: var(--radius);
                  box-shadow: var(--shadow);
                  text-align: center;
              }
              
              .file-icon {
                  font-size: 4rem;
                  margin-bottom: 1.5rem;
                  color: var(--primary-color);
              }
              
              .file-info {
                  margin-bottom: 2rem;
              }
              
              .file-name {
                  font-size: 1.25rem;
                  font-weight: 500;
                  color: var(--text-primary);
                  margin-bottom: 0.5rem;
                  word-break: break-all;
              }
              
              .file-size {
                  color: var(--text-secondary);
                  font-size: 0.9rem;
              }
              
              .file-modified {
                  color: var(--text-secondary);
                  font-size: 0.9rem;
                  margin-top: 0.5rem;
              }
              
              .download-btn {
                  display: block;
                  width: 100%;
                  padding: 1rem;
                  background: var(--primary-color);
                  color: white;
                  border: none;
                  border-radius: 8px;
                  font-size: 1rem;
                  cursor: pointer;
                  text-align: center;
                  text-decoration: none;
                  transition: all 0.3s ease;
              }
              
              .download-btn:hover:not(:disabled) {
                  background: var(--hover-color);
                  transform: translateY(-1px);
              }
              
              .download-btn:disabled {
                  opacity: 0.7;
                  cursor: not-allowed;
              }
              
              .countdown {
                  display: none;
                  font-size: 0.9rem;
                  color: var(--text-secondary);
                  text-align: center;
                  margin-top: 0.5rem;
              }
  
              .download-status {
                  display: none;
                  margin-top: 1rem;
                  color: var(--text-secondary);
              }
  
              .download-status.show {
                  display: block;
              }
          </style>
      </head>
      <body>
          <div class="file-container">
              <div class="file-card">
                  <div class="file-icon">📄</div>
                  <div class="file-info">
                      <div class="file-name">${fileName}</div>
                      <div class="file-size">文件大小：${formatFileSize(fileSize)}</div>
                      <div class="file-modified">修改时间：${Utils.formatDateTime(modifiedTime)}</div>
                  </div>
                  
                  <button onclick="startDownload(this)" class="download-btn">
                      下载文件
                  </button>
                  <div id="countdown" class="countdown"></div>
                  <div id="downloadStatus" class="download-status"></div>
              </div>
          </div>
          
          <script>
              
              function startDownload(btn) {
                  // 禁用按钮
                  btn.disabled = true;
                  
                  // 添加下载参数
                  const downloadUrl = new URL(window.location.href);
                  downloadUrl.searchParams.set('download', '1');
                  
                  // 开始下载
                  window.location.href = downloadUrl.toString();
                  
                  // 显示下载状态
                  const downloadStatus = document.getElementById('downloadStatus');
                  downloadStatus.textContent = '文件开始下载...';
                  downloadStatus.classList.add('show');
                  
                  // 显示倒计时
                  const countdown = document.getElementById('countdown');
                  countdown.style.display = 'block';
                  let seconds = 3;
                  
                  const timer = setInterval(() => {
                      countdown.textContent = seconds + ' 秒后可再次下载';
                      seconds--;
                      
                      if (seconds < 0) {
                          clearInterval(timer);
                          btn.disabled = false;
                          countdown.style.display = 'none';
                          downloadStatus.textContent = '如果下载没有开始，请点击按钮重新下载';
                      }
                  }, 1000);
              }
          </script>
      </body>
      </html>`;
}

// 生成管理页面 HTML
function generateAdminHtml(content) {
    return `<!DOCTYPE html>
      <html>
      <head>
          <title>短链接管理</title>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
              ${getCommonStyles()}
              ${getAdminStyles()}
          </style>
      </head>
      <body>
          <div class="container">
              <div class="header">
                  <h1 class="title">短链接管理</h1>
                  <div class="header-actions">
                      <button class="btn-toggle" onclick="toggleCreateForm()">创建短链接 <span class="toggle-icon">▼</span></button>
                  </div>
              </div>
              
              ${createForm}
  
              ${content}
          </div>
          ${getAdminScripts()}
          <script>
              // 确保 DOM 加载完成后再绑定事件
              document.addEventListener('DOMContentLoaded', function() {
                  // 初始化搜索框事件监听
                  const searchInput = document.getElementById('searchInput');
                  if (searchInput) {
                      searchInput.addEventListener('keypress', function(e) {
                          if (e.key === 'Enter') {
                              search();
                          }
                      });
                  }
              });
          </script>
      </body>
      </html>`;
}

// 管理页面脚本
function getAdminScripts() {
    return '<script>' +
        'window.SourceHandler = {' +
        'getSourceConfig: function(sourceType) {' +
        'const configs = {' +
        'github: {' +
        'parseRepoUrl: function(url) {' +
        'const cleanUrl = url.trim().replace(/\\.git$/, "");' +
        'const match = cleanUrl.match(/github\\.com\\/([^/\\s]+)\\/([^/\\s?#]+)/i);' +
        'if (!match) {' +
        'throw new Error("无效的 GitHub 仓库地址");' +
        '}' +
        'return {' +
        'owner: match[1],' +
        'repo: match[2]' +
        '};' +
        '}' +
        '},' +
        'alist: {}' +
        '};' +
        'return configs[sourceType];' +
        '},' +
        'getSourceInfo: function(linkData) {' +
        'if (!linkData.sourceType) {' +
        'return {' +
        'displayUrl: linkData.url,' +
        'copyUrl: linkData.url' +
        '};' +
        '}' +
        'switch (linkData.sourceType) {' +
        'case "github":' +
        'const pathInfo = linkData.path ? ` (${linkData.path})` : "";' +
        'const branchInfo = linkData.config.ref ? ` [${linkData.config.ref}]` : "";' +
        'return {' +
        'displayUrl: linkData.url + pathInfo + branchInfo,' +
        'copyUrl: linkData.url,' +
        'iconUrl: "data:image/svg+xml;base64,PHN2ZyB2aWV3Qm94PSIwIDAgOTggOTYiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZmlsbC1ydWxlPSJldmVub2RkIiBjbGlwLXJ1bGU9ImV2ZW5vZGQiIGQ9Ik00OC44NTQgMEMyMS44MzkgMCAwIDIyIDAgNDkuMjE3YzAgMjEuNzU2IDEzLjk5MyA0MC4xNzIgMzMuNDA1IDQ2LjY5IDIuNDI3LjQ5IDMuMzE2LTEuMDU5IDMuMzE2LTIuMzYyIDAtMS4xNDEtLjA4LTUuMDUyLS4wOC03LjI5Ny0xMy41OSAyLjkzNC0xNi40Mi01Ljg2Ny0xNi40Mi01Ljg2Ny0yLjE4NC01LjcwNC01LjQyLTcuMTctNS40Mi03LjE3LTQuNDQ4LTMuMDE1LjMyNC0zLjAxNS4zMjQtMy4wMTUgNC45MzQuMzI2IDcuNTIzIDUuMDUyIDcuNTIzIDUuMDUyIDQuMzY3IDcuNDk2IDExLjQwNCA1LjM3OCAxNC4yMzUgNC4wNzQuNDA0LTMuMTc4IDEuNjk5LTUuMzc4IDMuMDc0LTYuNi0xMC44MzktMS4xNDEtMjIuMjQzLTUuMzc4LTIyLjI0My0yNC4yODMgMC01LjM3OCAxLjk0LTkuNzc4IDUuMDE0LTEzLjItLjQ4NS0xLjIyMi0yLjE4NC02LjI3NS40ODYtMTMuMDM4IDAgMCA0LjEyNS0xLjMwNCAxMy40MjYgNS4wNTJhNDYuOTcgNDYuOTcgMCAwIDEgMTIuMjE0LTEuNjNjNC4xMjUgMCA4LjMzLjU3MSAxMi4yMTMgMS42MyA5LjMwMi02LjM1NiAxMy40MjctNS4wNTIgMTMuNDI3LTUuMDUyIDIuNjcgNi43NjMuOTcgMTEuODE2LjQ4NSAxMy4wMzggMy4xNTUgMy40MjIgNS4wMTUgNy44MjIgNS4wMTUgMTMuMiAwIDE4LjkwNS0xMS40MDQgMjMuMDYtMjIuMzI0IDI0LjI4MyAxLjc4IDEuNTQ4IDMuMzE2IDQuNDgxIDMuMzE2IDkuMTI2IDAgNi42LS4wOCAxMS44OTctLjA4IDEzLjUyNiAwIDEuMzA0Ljg5IDIuODUzIDMuMzE2IDIuMzY0IDE5LjQxMi02LjUyIDMzLjQwNS0yNC45MzUgMzMuNDA1LTQ2LjY5MUM5Ny43MDcgMjIgNzUuNzg4IDAgNDguODU0IDB6IiBmaWxsPSIjMjQyOTJmIi8+PC9zdmc+",' +
        'iconTitle: "访问 GitHub 仓库"' +
        '};' +
        'case "alist":' +
        'const fullUrl = `${linkData.url}`;' + 
        'return {' +
        'displayUrl: fullUrl,' +
        'copyUrl: fullUrl,' +
        'iconUrl: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48cGF0aCBkPSJNNTAgMEMyMi40IDAgMCAyMi40IDAgNTBzMjIuNCA1MCA1MCA1MCA1MC0yMi40IDUwLTUwUzc3LjYgMCA1MCAwem0wIDkwYy0yMi4xIDAtNDAtMTcuOS00MC00MHMxNy45LTQwIDQwLTQwIDQwIDE3LjkgNDAgNDBjMCAyMi4yLTE3LjkgNDAtNDAgNDB6IiBmaWxsPSIjMDA5NURGIi8+PHBhdGggZD0iTTQ1IDI1djVoNXYzNWg1VjMwaDV2LTVINDV6TTMwIDQwdjVoNXYyNWg1VjQ1aDV2LTVIMzB6TTYwIDQwdjVoNXYyNWg1VjQ1aDV2LTVINjB6IiBmaWxsPSIjMDA5NURGIi8+PC9zdmc+",' +
        'iconTitle: "访问 AList 文件夹",' +
        '};' +
        'default:' +
        'return {' +
        'displayUrl: linkData.url,' +
        'copyUrl: linkData.url' +
        '};' +
        '}' +
        '}' +
        '};' +

        'function generateLinkRow(link) {' +
        'return `' +
        '<tr data-key="${link.code}" class="${link.type === "folder" ? "folder-row" : ""}" data-status="${getStatus(link)}">' +
        '<td>' +
        '<div class="link-info" onclick="copyToClipboard(\\\'${window.location.origin}/s/${link.code}\\\')" title="点击复制完整短链接">' +
        '<span class="link-icon">${link.type === "folder" ? "📁" : "📄"}</span>' +
        '<span class="link-code">${link.code}</span>' +
        '</div>' +
        '</td>' +
        '<td>' +
        '<div class="source-info">' +
        '${link.sourceType ? `<a href="${SourceHandler.getSourceInfo(link).sourceLink}" target="_blank" class="source-icon" title="${SourceHandler.getSourceInfo(link).iconTitle}"><img src="${SourceHandler.getSourceInfo(link).iconUrl}" alt="${link.sourceType}" width="16" height="16"></a>` : ""}' +
        '<div class="copy-text" onclick="copyToClipboard(\\\'${link.sourceType ? SourceHandler.getSourceInfo(link).copyUrl : link.url}\\\')" title="点击复制原始链接">' +
        '${link.sourceType ? SourceHandler.getSourceInfo(link).displayUrl : link.url}' +
        '</div>' +
        '</div>' +
        '</td>' +
        '<td><span class="status ${getStatus(link)}">${getStatusText(link)}</span></td>' +
        '<td><span class="expire-time ${link.expireAt ? "" : "permanent"}" onclick="editExpireTime(\\\'${link.code}\\\', ${link.expireAt || "null"})" title="点击修改">${formatExpireTime(link.expireAt)}</span></td>' +
        '<td><span class="visits" onclick="editMaxVisits(\\\'${link.code}\\\', ${link.maxVisits || "null"})" title="点击修改">' +
        '${link.visits || 0} / ${link.maxVisits || "∞"}' +
        '</span></td>' +
        '<td><span class="access-code" onclick="editAccessCode(\\\'${link.code}\\\', \\\'${link.accessCode || ""}\\\')" title="点击修改">' +
        '${link.accessCode ? "已设置" : "无"}' +
        '</span></td>' +
        '<td>' +
        '<button class="delete-btn" onclick="deleteKey(\\\'${link.code}\\\')">删除</button>' +
        '</td>' +
        '</tr>' +
        '`;' +
        '}' +

        'window.activeToasts = [];' +
        'window.toastCount = 0;' +

        'window.clearExpired = function() {' +
        'showModal("", [' +
        '"<div style=\\"text-align:center;\\">", ' +
        '"    <p style=\\"font-size:1.1rem;margin-bottom:0.5rem;\\">确定清除所有过期链接？</p>", ' +
        '"</div>"' +
        '].join(""), function(modal) {' +
        'fetch("' + ADMIN_PATH + '/clear-expired", {' +
        'method: "POST"' +
        '})' +
        '.then(response => response.json())' +
        '.then(data => {' +
        'window.showToast(`已清除 ${data.clearedCount} 个过期链接`);' +
        'setTimeout(() => {' +
        'location.reload();' +
        '}, 1000);' +
        '})' +
        '.catch(error => {' +
        'window.showToast("清除失败");' +
        '})' + 
        '})' + 
        '};' + 

        'window.showToast = function(message) {' +
        'if (window.activeToasts.includes(message)) return;' +

        'var toast = document.createElement("div");' +
        'toast.className = "toast";' +
        'toast.textContent = message;' +
        'document.body.appendChild(toast);' +

        'window.activeToasts.push(message);' +
        'window.toastCount++;' +

        'requestAnimationFrame(function() {' +
        'toast.classList.add("show");' +
        '});' +

        'setTimeout(function() {' +
        'toast.classList.remove("show");' +
        'setTimeout(function() {' +
        'toast.remove();' +
        'window.toastCount--;' +
        'window.activeToasts = window.activeToasts.filter(function(msg) {' +
        'return msg !== message;' +
        '});' +
        '}, 300);' +
        '}, 1000);' +
        '};' +

        'window.copyToClipboard = function(text) {' +
        'navigator.clipboard.writeText(text).then(function() {' +
        'window.showToast("已复制到剪贴板");' +
        'setTimeout(() => {' +
        'const result = document.querySelector(".create-result");' +
        'if (result) {' +
        'result.classList.remove("show");' +
        'setTimeout(() => result.remove(), 300);' +
        '}' +
        '}, 500);' +
        '}).catch(function(err) {' +
        'window.showToast("复制失败");' +
        '});' +
        '};' +

        'window.showModal = function(title, content, onConfirm) {' +
        'var overlay = document.createElement("div");' +
        'overlay.className = "modal-overlay";' +

        'var modal = document.createElement("div");' +
        'modal.className = "modal";' +

        'modal.innerHTML = [' +
        '"<div class=\\"modal-header\\">", ' +
        '"    <h3>" + title + "</h3>", ' +
        '"</div>", ' +
        '"<div class=\\"modal-body\\">", ' +
        '    content, ' +
        '"</div>", ' +
        '"<div class=\\"modal-footer\\">", ' +
        '"    <button class=\\"btn-secondary\\" onclick=\\"this.closest(\'.modal-overlay\').remove()\\">取消</button>", ' +
        '"    <button class=\\"btn-primary\\" onclick=\\"handleConfirm(this)\\">确定</button>", ' +
        '"</div>"' +
        '].join("");' +

        'overlay.appendChild(modal);' +
        'document.body.appendChild(overlay);' +

        'requestAnimationFrame(function() {' +
        'overlay.classList.add("show");' +
        'modal.classList.add("show");' +
        '});' +

        'window.handleConfirm = function(btn) {' +
        'var result = onConfirm(modal);' +
        'if (result !== false) {' +
        'btn.closest(".modal-overlay").remove();' +
        '}' +
        '};' +
        '};' +

        'window.deleteKey = function(key) {' +
        'showModal("", [' +
        '"<div style=\\"text-align:center;\\">", ' +
        '"    <p style=\\"font-size:1.1rem;margin-bottom:0.5rem;\\">确定删除这个链接？</p>", ' +
        '"</div>"' +
        '].join(""), function(modal) {' +
        'fetch("' + ADMIN_PATH + '/delete/" + encodeURIComponent(key), {' +
        'method: "DELETE"' +
        '})' +
        '.then(function(response) {' +
        'if (!response.ok) throw new Error("Delete failed");' +
        'var row = document.querySelector("tr[data-key=\\"" + key + "\\"]");' +
        'if (row) {' +
        'row.style.opacity = "0";' +
        'setTimeout(function() { row.remove(); }, 300);' +
        '}' +
        'window.showToast("删除成功");' +
        '})' +
        '.catch(function(err) {' +
        'window.showToast("删除失败");' +
        '});' +
        '});' +
        '};' +

        'window.editExpireTime = function(key, currentExpireAt) {' +
        'var currentValue = currentExpireAt ? new Date(currentExpireAt).toISOString().slice(0, 16) : "";' +

        'showModal("设置有效期", [' +
        '"<label>有效期类型</label>", ' +
        '"<select id=\\"modalExpireType\\" onchange=\\"toggleCustomExpire()\\">", ' +
        '"    <option value=\\"never\\">永久有效</option>", ' +
        '"    <option value=\\"1\\">1天</option>", ' +
        '"    <option value=\\"2\\">2天</option>", ' +
        '"    <option value=\\"3\\">3天</option>", ' +
        '"    <option value=\\"7\\">7天</option>", ' +
        '"    <option value=\\"30\\">30天</option>", ' +
        '"    <option value=\\"custom\\">自定义</option>", ' +
        '"</select>", ' +
        '"<div id=\\"modalCustomExpire\\" style=\\"display:none\\">", ' +
        '"    <label>自定义时间</label>", ' +
        '"    <input type=\\"datetime-local\\" id=\\"modalCustomTime\\" value=\\"" + currentValue + "\\">", ' +
        '"</div>"' +
        '].join(""), function(modal) {' +
        'var type = modal.querySelector("#modalExpireType").value;' +
        'var expireAt = null;' +

        'if (type !== "never") {' +
        'if (type === "custom") {' +
        'var customTime = modal.querySelector("#modalCustomTime").value;' +
        'if (!customTime) return false;' +
        'expireAt = new Date(customTime).getTime();' +
        '} else {' +
        'var days = parseInt(type);' +
        'expireAt = Date.now() + days * 24 * 60 * 60 * 1000;' +
        '}' +
        '}' +

        'window.updateLink(key, { expireAt: expireAt });' +
        '});' +
        '};' +

        'window.toggleCustomExpire = function() {' +
        'var customExpire = document.getElementById("modalCustomExpire");' +
        'customExpire.style.display = ' +
        'document.getElementById("modalExpireType").value === "custom" ? "block" : "none";' +
        '};' +

        'window.editMaxVisits = function(key, currentMaxVisits) {' +
        'showModal("设置访问次数限制", [' +
        '"<label>最大访问次数（留空表示不限制）</label>",' +
        '"<input type=\\"number\\" id=\\"modalMaxVisits\\" min=\\"1\\" max=\\"9999\\" value=\\"" + (currentMaxVisits || "") + "\\" placeholder=\\"最大9999次\\">"' +
        '].join(""), function(modal) {' +
        'var maxVisits = modal.querySelector("#modalMaxVisits").value.trim();' +
        'var value = maxVisits ? parseInt(maxVisits) : null;' +

        'if (value && (isNaN(value) || value < 1 || value > 9999)) {' +
        'window.showToast("访问次数必须在1-9999之间");' +
        'return false;' +
        '}' +

        'window.updateLink(key, { maxVisits: value });' +
        '});' +
        '};' +

        'window.editAccessCode = function(key, currentAccessCode) {' +
        'showModal("设置访问码", [' +
        '"<label>访问码（留空表示无需访问码）</label>",' +
        '"<input type=\\"text\\" id=\\"modalAccessCode\\" value=\\"" + (currentAccessCode || "") + "\\" placeholder=\\"请输入访问码\\">"' +
        '].join(""), function(modal) {' +
        'var accessCode = modal.querySelector("#modalAccessCode").value.trim();' +
        'window.updateLink(key, { accessCode: accessCode || null });' +
        '});' +
        '};' +

        'window.updateLink = function(key, data) {' +
        'fetch("' + ADMIN_PATH + '/update", {' +
        'method: "POST",' +
        'headers: { "Content-Type": "application/json" },' +
        'body: JSON.stringify(Object.assign({ key: key }, data))' +
        '})' +
        '.then(function(response) {' +
        'if (!response.ok) throw new Error("Update failed");' +
        'window.showToast("更新成功");' +
        'location.reload();' +
        '})' +
        '.catch(function(err) {' +
        'window.showToast("更新失败：" + err.message);' +
        '});' +
        '};' +

        'window.createShortlink = async function() {' +
        'const linkType = document.getElementById("linkType").value;' +
        'const url = document.getElementById("urlInput").value;' +
        'const expireType = document.getElementById("expireType").value;' +
        'const customExpire = document.getElementById("customExpire").value;' +
        'const maxVisits = document.getElementById("maxVisits").value;' +
        'const accessCode = document.getElementById("accessCode").value;' +

        'let expireAt = null;' +
        'if (expireType !== "never") {' +
        'if (expireType === "custom") {' +
        'expireAt = new Date(customExpire).getTime();' +
        '} else {' +
        'const days = parseInt(expireType);' +
        'expireAt = Date.now() + days * 24 * 60 * 60 * 1000;' +
        '}' +
        '}' +

        'let requestData = {' +
        'type: linkType === "file" ? "file" : "folder",' +
        'expireAt: expireAt,' +
        'maxVisits: maxVisits ? parseInt(maxVisits) : null,' +
        'accessCode: accessCode.trim() || null' +
        '};' +

        'if (linkType === "github") {' +
        'const githubUrl = document.getElementById("githubUrl").value.trim();' +
        'const githubRef = document.getElementById("githubRef").value.trim();' +
        'const folderPath = url.trim();' +

        'if (!githubUrl) {' +
        'window.showToast("请输入 GitHub 仓库地址");' +
        'return;' +
        '}' +

        'try {' +
        'const repoInfo = SourceHandler.getSourceConfig("github").parseRepoUrl(githubUrl);' +
        'const config = {' +
        'owner: repoInfo.owner,' +
        'repo: repoInfo.repo' +
        '};' +

        // 只有当用户填写了分支时才添加 ref 字段
        'if (githubRef) {' +
        'config.ref = githubRef;' +
        '}' +

        'Object.assign(requestData, {' +
        'url: githubUrl,' +
        'path: folderPath.replace(/^\\/+/, "").replace(/\\/+$/, "") || "/",' +
        'sourceType: "github",' +
        'config: config' +
        '});' +
        '} catch (error) {' +
        'window.showToast(error.message);' +
        'return;' +
        '}' +
        '} else if (linkType === "alist") {' +
        'Object.assign(requestData, {' +
        'url: url.replace(/^\\/+/, "").replace(/\\/+$/, "") || "/",' +
        'sourceType: "alist"' +
        '});' +
        '} else if (linkType === "github-releases") {' +
        'const githubUrl = document.getElementById("githubUrl").value.trim();' +
        'const githubTag = document.getElementById("githubTag").value.trim();' +
        'const releaseCount = parseInt(document.getElementById("releaseCount").value) || 20;' +
        'const skipFolder = document.getElementById("skipFolder").checked;' +

        'if (!githubUrl) {' +
        'window.showToast("请输入 GitHub 仓库地址");' +
        'return;' +
        '}' +

        'try {' +
        'const repoInfo = SourceHandler.getSourceConfig("github").parseRepoUrl(githubUrl);' +
        'Object.assign(requestData, {' +
        'url: githubUrl,' +
        'type: "folder",' +
        'sourceType: "github-releases",' +
        'config: {' +
        'owner: repoInfo.owner,' +
        'repo: repoInfo.repo,' +
        'tag: githubTag || null,' +
        'count: githubTag ? 1 : releaseCount,' +
        'skipFolder: skipFolder && (githubTag || releaseCount === 1)' +
        '}' +
        '});' +
        '} catch (error) {' +
        'window.showToast(error.message);' +
        'return;' +
        '}' +
        '} else {' +
        'requestData.url = url;' +
        '}' +

        'fetch("' + ADMIN_PATH + '/create", {' +
        'method: "POST",' +
        'headers: { "Content-Type": "application/json" },' +
        'body: JSON.stringify(requestData)' +
        '})' +
        '.then(response => {' +
        'if (!response.ok) {' +
        'return response.text().then(text => {' + 
        'try {' +
        'const data = JSON.parse(text);' +
        'throw new Error(data.error);' +
        '} catch (e) {' +
        'throw new Error(text || response.statusText);' +
        '}' +
        '});' +
        '}' +
        'return response.json();' +
        '})' +
        '.then(data => {' +
        'const shortUrl = window.location.origin + "/s/" + data.code;' +
        'const accessCodeValue = document.getElementById("accessCode").value.trim();' +
        'const copyText = accessCodeValue ? `${shortUrl} 访问码 ${accessCodeValue}` : shortUrl;' +
        'const resultHtml = `' +
        '<div class="create-result">' +
        '<div class="result-header">' +
        '<h3>创建成功</h3>' +
        '<button class="close-btn" onclick="closeCreateResult()">×</button>' +
        '</div>' +
        '<div class="result-item">' +
        '<span class="result-label">链接：</span>' +
        '<span class="result-value">${accessCodeValue ? copyText : shortUrl}</span>' +
        '<button class="result-copy" onclick="copyToClipboard(\\\'${copyText}\\\')">复制</button>' +
        '</div>' +
        '</div>' +
        '`;' +

        'const createForm = document.querySelector(".create-form");' +
        'const toggleBtn = document.querySelector(".btn-toggle");' +
        'createForm.style.display = "none";' +
        'toggleBtn.innerHTML = \'创建短链接 <span class="toggle-icon">▼</span>\';' +

        'const oldResult = document.querySelector(".create-result");' +
        'if (oldResult) oldResult.remove();' +
        'createForm.insertAdjacentHTML("afterend", resultHtml);' +

        'const inputs = createForm.querySelectorAll("input, select, textarea");' +
        'inputs.forEach(input => {' +
        '  if (input.type === "checkbox" || input.type === "radio") {' +
        '    input.checked = false;' +
        '  } else if (input.type === "number" && input.id === "releaseCount") {' +
        '    input.value = "20";' + 
        '  } else {' +
        '    input.value = "";' +
        '  }' +
        '});' +
        
        // 重置选择框为默认值
        'document.getElementById("linkType").value = "file";' +
        'document.getElementById("expireType").value = "never";' +
        
        // 重置各区域显示状态
        'document.getElementById("customExpire").style.display = "none";' +
        'document.getElementById("githubConfig").style.display = "none";' +
        'document.getElementById("githubRepoConfig").style.display = "none";' +
        'document.getElementById("githubReleasesConfig").style.display = "none";' +
        'document.getElementById("skipFolderGroup").style.display = "none";' +

        // 刷新列表
        'refreshLinkList();' +

        'setTimeout(() => {' +
        'document.querySelector(".create-result").classList.add("show");' +
        '}, 10);' +
        '})' +
        '.catch(error => {' +
        'window.showToast("创建失败：" + error.message);' +
        '});' +
        '};' +

        'window.onExpireTypeChange = function() {' +
        'const customExpireInput = document.getElementById("customExpire");' +
        'customExpireInput.style.display = ' +
        'document.getElementById("expireType").value === "custom" ? "block" : "none";' +
        '};' +

        'window.search = function() {' +
        'const query = document.getElementById("searchInput").value.trim();' +
        'const url = new URL(window.location.href);' +
        'if (query) {' +
        'url.searchParams.set("q", query);' +
        'url.searchParams.delete("page");' +
        '} else {' +
        'url.searchParams.delete("q");' +
        '}' +
        'window.location.href = url.toString();' +
        '};' +

        'window.filterByStatus = function(status) {' +
        'const rows = document.querySelectorAll(".admin-table tbody tr");' +
        'rows.forEach(row => {' +
        'if (status === "all") {' +
        'row.style.display = "";' +
        '} else if (status === "active") {' +
        'row.style.display = row.getAttribute("data-status") === "active" ? "" : "none";' +
        '} else if (status === "expired") {' +
        'row.style.display = row.getAttribute("data-status") === "expired" ? "" : "none";' +
        '}' +
        '});' +
        '};' +

        'window.toggleCreateForm = function() {' +
        'const form = document.getElementById("createForm");' +
        'const btn = document.querySelector(".btn-toggle");' +
        'const icon = btn.querySelector(".toggle-icon");' +
        'if (form.style.display === "none") {' +
        'form.style.display = "block";' +
        'btn.innerHTML = \'创建短链接 <span class="toggle-icon expanded">▼</span>\';' +
        'setTimeout(() => form.classList.add("show"), 10);' +
        
        'const inputs = form.querySelectorAll("input, select, textarea");' +
        'inputs.forEach(input => {' +
        '  if (input.type === "checkbox" || input.type === "radio") {' +
        '    input.checked = false;' +
        '  } else if (input.type === "number" && input.id === "releaseCount") {' +
        '    input.value = "20";' + 
        '  } else {' +
        '    input.value = "";' +
        '  }' +
        '});' +
        
        // 重置选择框为默认值
        'document.getElementById("linkType").value = "file";' +
        'document.getElementById("expireType").value = "never";' +
        
        // 重置各区域显示状态
        'document.getElementById("customExpire").style.display = "none";' +
        'document.getElementById("githubConfig").style.display = "none";' +
        'document.getElementById("githubRepoConfig").style.display = "none";' +
        'document.getElementById("githubReleasesConfig").style.display = "none";' +
        'document.getElementById("skipFolderGroup").style.display = "none";' +
        
        // 重置URL输入字段的标签和占位符
        'document.getElementById("urlLabel").textContent = "URL";' +
        'document.getElementById("urlInput").placeholder = "输入需要转换的URL";' +
        
        // 触发链接类型变更函数
        'onLinkTypeChange();' +
        '} else {' +
        'form.classList.remove("show");' +
        'btn.innerHTML = \'创建短链接 <span class="toggle-icon">▼</span>\';' +
        'setTimeout(() => form.style.display = "none", 300);' +
        '}' +
        '};' +

        // 初始化事件监听' +
        'document.addEventListener("DOMContentLoaded", function() {' +
        'const searchInput = document.getElementById("searchInput");' +
        'if (searchInput) {' +
        'searchInput.addEventListener("keypress", function(e) {' +
        'if (e.key === "Enter") {' +
        'window.search();' +
        '}' +
        '});' +
        '}' +
        '});' +

        'window.closeCreateResult = function() {' +
        'const result = document.querySelector(".create-result");' +
        'if (result) {' +
        'result.classList.remove("show");' +
        'setTimeout(() => result.remove(), 300);' +
        '}' +
        '};' +

        'window.refreshLinkList = function() {' +
        'const url = new URL(window.location.href);' +
        'fetch(url)' +
        '.then(response => response.text())' +
        '.then(html => {' +
        'const parser = new DOMParser();' +
        'const doc = parser.parseFromString(html, "text/html");' +
        'const newContent = doc.querySelector(".admin-table");' +
        'const oldContent = document.querySelector(".admin-table");' +
        'if (newContent && oldContent) {' +
        'oldContent.innerHTML = newContent.innerHTML;' +
        // 重新绑定事件处理器
        'const rows = oldContent.querySelectorAll("tr");' +
        'rows.forEach(row => {' +
        'const copyTexts = row.querySelectorAll(".copy-text");' +
        'copyTexts.forEach(el => {' +
        'const originalOnclick = el.getAttribute("onclick");' +
        'if (originalOnclick) {' +
        'el.onclick = function() {' +
        'eval(originalOnclick);' +
        '};' +
        '}' +
        '});' +
        'const deleteBtn = row.querySelector(".delete-btn");' +
        'if (deleteBtn) {' +
        'const originalOnclick = deleteBtn.getAttribute("onclick");' +
        'if (originalOnclick) {' +
        'deleteBtn.onclick = function() {' +
        'eval(originalOnclick);' +
        '};' +
        '}' +
        '}' +
        '});' +
        '}' +
        '})' +
        '.catch(error => {' +
        'window.showToast("刷新列表失败，请手动刷新页面");' +
        '});' +
        '};' +

        // 在 getAdminScripts 中添加以下函数
        'window.onLinkTypeChange = function() {' +
        'const linkType = document.getElementById("linkType").value;' +
        'const githubConfig = document.getElementById("githubConfig");' +
        'const githubRepoConfig = document.getElementById("githubRepoConfig");' + 
        'const githubReleasesConfig = document.getElementById("githubReleasesConfig");' + 
        'const urlLabel = document.getElementById("urlLabel");' +
        'const urlInput = document.getElementById("urlInput");' +

        // 重置所有配置的显示状态
        'githubConfig.style.display = "none";' +
        'githubRepoConfig.style.display = "none";' + 
        'githubReleasesConfig.style.display = "none";' + 
        'urlLabel.style.display = "block";' +
        'urlInput.style.display = "block";' +

        'switch(linkType) {' +
        'case "file":' +
        'githubConfig.style.display = "none";' +
        'urlLabel.textContent = "URL";' +
        'urlInput.placeholder = "输入需要转换的URL";' +
        'break;' +
        'case "alist":' +
        'githubConfig.style.display = "none";' +
        'urlLabel.textContent = "文件夹路径";' +
        'urlInput.placeholder = "输入文件夹路径";' +
        'break;' +
        'case "github":' +
        'githubConfig.style.display = "block";' +
        'githubRepoConfig.style.display = "block";' + 
        'urlLabel.textContent = "仓库路径";' +
        'urlInput.placeholder = "输入仓库中的路径（可选）";' +
        'break;' +
        'case "github-releases":' +
        'githubConfig.style.display = "block";' +
        'githubReleasesConfig.style.display = "block";' + 
        'urlLabel.style.display = "none";' +
        'urlInput.style.display = "none";' +
        'updateSkipFolderVisibility();' + 
        'break;' +
        '}' +
        '};' +

        'window.onSourceTypeChange = function() {' +
        'const sourceType = document.getElementById("sourceType").value;' +
        'const githubConfig = document.getElementById("githubConfig");' +
        'const urlInput = document.getElementById("urlInput");' +

        'if (sourceType === "github") {' +
        'githubConfig.style.display = "block";' +
        'urlInput.placeholder = "输入仓库中的路径（可选）";' +
        '} else {' +
        'githubConfig.style.display = "none";' +
        'urlInput.placeholder = "输入文件夹路径";' +
        '}' +
        '};' +

        'window.updateSkipFolderVisibility = function() {' +
        'const tag = document.getElementById("githubTag").value.trim();' +
        'const count = parseInt(document.getElementById("releaseCount").value) || 20;' +
        'const skipFolderGroup = document.getElementById("skipFolderGroup");' +

        'if (tag || count === 1) {' +
        'skipFolderGroup.style.display = "block";' +
        '} else {' +
        'skipFolderGroup.style.display = "none";' +
        'document.getElementById("skipFolder").checked = false;' +
        '}' +
        '};' +
        '</script>';
}

// 通用样式
function getCommonStyles() {
    return `
          :root {
              --primary-color: #2563eb;
              --hover-color: #1d4ed8;
              --bg-color: #f1f5f9;
              --container-bg: #ffffff;
              --text-primary: #1e293b;
              --text-secondary: #64748b;
              --border-color: #e2e8f0;
              --hover-bg: #f8fafc;
              --shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
              --radius: 12px;
          }
  
          @media (prefers-color-scheme: dark) {
              :root {
                  --primary-color: #60a5fa;
                  --hover-color: #93c5fd;
                  --bg-color: #0f172a;
                  --container-bg: #1e293b;
                  --text-primary: #e2e8f0;
                  --text-secondary: #94a3b8;
                  --border-color: #334155;
                  --hover-bg: #334155;
              }
          }
  
          * { 
              box-sizing: border-box;
              margin: 0;
              padding: 0;
          }
  
          body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              background: var(--bg-color);
              color: var(--text-primary);
              line-height: 1.5;
              padding: 1rem;
          }
  
          .container {
              max-width: 1200px;
              margin: 0 auto;
              background: var(--container-bg);
              border-radius: var(--radius);
              box-shadow: var(--shadow);
              padding: 1.5rem;
          }
  
          .empty-folder {
              text-align: center;
              padding: 4rem 1rem;
              color: var(--text-secondary);
              background: var(--container-bg);
              border-radius: var(--radius);
              margin-top: 1rem;
          }
  
          .empty-folder-icon {
              font-size: 4rem;
              margin-bottom: 1.5rem;
              opacity: 0.7;
          }
  
          .empty-folder-text {
              font-size: 1.125rem;
          }
  
          .modal-overlay {
              position: fixed;
              top: 0;
              left: 0;
              right: 0;
              bottom: 0;
              background: rgba(0, 0, 0, 0.5);
              display: flex;
              align-items: center;
              justify-content: center;
              z-index: 1000;
              opacity: 0;
              transition: opacity 0.3s;
          }
  
          .modal {
              background: var(--container-bg);
              border-radius: var(--radius);
              padding: 2rem;
              width: 90%;
              max-width: 400px;
              transform: translateY(20px);
              transition: transform 0.3s;
              text-align: center;
          }
  
          .modal.show {
              transform: translateY(0);
          }
  
          .modal-overlay.show {
              opacity: 1;
          }
  
          .modal-header {
              margin-bottom: 1rem;
              padding-bottom: 0.5rem;
              border-bottom: 1px solid var(--border-color);
          }
  
          .modal-body {
              margin: 1.5rem 0;
              font-size: 1.1rem;
          }
  
          .modal-footer {
              display: flex;
              justify-content: center;
              gap: 1rem;
          }
  
          .modal button {
              min-width: 100px;
              padding: 0.75rem 1.5rem;
              border-radius: 6px;
              border: none;
              cursor: pointer;
              font-size: 0.95rem;
          }
  
          .modal .btn-primary {
              background: var(--primary-color);
              color: white;
          }
  
          .modal .btn-secondary {
              background: var(--border-color);
              color: var(--text-primary);
          }
  
          .modal input, .modal select {
              width: 100%;
              padding: 0.5rem;
              margin: 0.5rem 0;
              border: 1px solid var(--border-color);
              border-radius: 6px;
              background: var(--container-bg);
              color: var(--text-primary);
          }
  
          .modal label {
              display: block;
              margin-top: 1rem;
              color: var(--text-secondary);
          }
      `;
}

// 文件列表样式
function getFileListStyles() {
    return `
          .file-list { 
              list-style: none;
              margin: 0;
              padding: 0;
          }
  
          .file-item { 
              padding: 0.75rem;
              border-radius: 8px;
              margin-bottom: 0.25rem;
              display: flex;
              align-items: center;
              justify-content: space-between;
              transition: all 0.2s ease;
              gap: 1rem;
          }
  
          .file-item:hover {
              background: var(--hover-bg);
              transform: translateX(4px);
          }
  
          .file-link, .folder-link { 
              text-decoration: none;
              display: flex;
              align-items: center;
              gap: 0.75rem;
              min-width: 0;
              flex: 1;
              max-width: calc(100% - 280px);
          }
  
          .file-link { color: var(--text-primary); }
          .folder-link { color: var(--primary-color); }
  
          .file-icon {
              flex-shrink: 0;
              width: 2rem;
              height: 2rem;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 1.25rem;
              background: var(--bg-color);
              border-radius: 6px;
          }
  
          .file-name {
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
              flex: 1;
              min-width: 0;
          }
  
          .file-info {
              display: flex;
              align-items: center;
              gap: 1.5rem;
              flex-shrink: 0;
              width: 280px;
              justify-content: flex-end;
          }
  
          .file-meta, .file-size {
              color: var(--text-secondary);
              font-size: 0.875rem;
          }
  
          .file-meta {
              width: 200px;
              text-align: right;
              white-space: nowrap;
              font-feature-settings: "tnum";
          }
  
          .file-size {
              width: 80px;
              text-align: right;
              white-space: nowrap;
              font-feature-settings: "tnum";
          }
  
          .size-large { color: #ef4444; }
          .size-medium { color: #f97316; }
          .size-normal { color: var(--text-secondary); }
  
          @media (max-width: 768px) {
              .file-meta {
                  display: none;
              }
  
              .file-info {
                  width: auto;
                  gap: 0.75rem;
              }
  
              .file-size {
                  width: 60px;
              }
  
              .file-link, .folder-link {
                  max-width: calc(100% - 60px);
              }
          }
  
          .file-list-header {
              margin-bottom: 1rem;
          }
  
          .parent-link {
              display: inline-flex;
              align-items: center;
              text-decoration: none;
              color: var(--text-secondary);
              font-size: 0.9rem;
              padding: 0.5rem 0.75rem;
              border-radius: 4px;
              transition: all 0.2s;
          }
  
          .parent-link:hover {
              color: var(--primary-color);
              background: var(--hover-bg);
          }
  
          .back-icon {
              margin-right: 0.5rem;
              font-size: 1.1rem;
          }
  
          .empty-folder {
              text-align: center;
              padding: 2rem;
              color: var(--text-secondary);
          }
  
          .empty-folder-icon {
              font-size: 3rem;
              margin-bottom: 1rem;
          }
  
          .empty-folder-text {
              font-size: 1.2rem;
          }

          .file-link { 
            text-decoration: none;
            display: flex;
            align-items: center;
            gap: 0.75rem;
            min-width: 0;
            flex: 1;
            color: var(--text-primary);
        }

        .file-info {
            margin-left: auto;
            display: flex;
            align-items: center;
            gap: 1rem;
            flex-shrink: 0;
        }

        .file-time {
            color: var(--text-secondary);
            font-size: 0.875rem;
            white-space: nowrap;
        }

        .file-size {
            color: var(--text-secondary);
            font-size: 0.875rem;
            min-width: 70px;
            text-align: right;
            white-space: nowrap;
        }

        @media (max-width: 768px) {
            .file-time {
                display: none;
            }
        }
      `;
}

// 管理页面样式
function getAdminStyles() {
    return `
          /* 原有的基础样式 */
          .title {
              margin-bottom: 2rem;
              color: var(--text-primary);
          }

          .search-box {
              display: flex;
              gap: 0.75rem;
              margin-bottom: 2rem;
              background: var(--bg-color);
              padding: 1.25rem;
              border-radius: var(--radius);
              align-items: center;
              flex-wrap: wrap;
          }

          .search-box input {
              flex: 1;
              min-width: 200px;
              padding: 0.75rem 1rem;
              border: 1px solid var(--border-color);
              border-radius: 8px;
              background: var(--container-bg);
              color: var(--text-primary);
              font-size: 0.95rem;
              transition: all 0.2s;
          }

          .search-box input:focus {
              outline: none;
              border-color: var(--primary-color);
              box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.1);
          }

          .search-box select {
              padding: 0.75rem 1rem;
              border: 1px solid var(--border-color);
              border-radius: 8px;
              background: var(--container-bg);
              color: var(--text-primary);
              font-size: 0.95rem;
              min-width: 120px;
          }

          .search-box .button-group {
              display: flex;
              gap: 0.5rem;
              align-items: center;
          }

          .search-box button {
              padding: 0.75rem 1.5rem;
              background: var(--primary-color);
              color: white;
              border: none;
              border-radius: 8px;
              cursor: pointer;
              font-size: 0.95rem;
              transition: all 0.2s;
              white-space: nowrap;
              display: flex;
              align-items: center;
              gap: 0.5rem;
          }

          .search-box button:hover {
              transform: translateY(-1px);
          }

          .search-box button:active {
              transform: translateY(0);
          }

          /* 移动端适配 */
          @media (max-width: 768px) {
              .search-box {
                  gap: 1rem;
                  padding: 1rem;
              }

              .search-box .search-group {
                  display: flex;
                  width: 100%;
                  gap: 0.5rem;
              }

              .search-box input {
                  flex: 1;
                  min-width: 0;
              }

              .search-box select {
                  width: auto;
                  flex-shrink: 0;
              }

              .search-box .button-group {
                  width: 100%;
                  justify-content: space-between;
              }

              .search-box button {
                  flex: 1;
                  justify-content: center;
                  padding: 0.875rem;
              }

              .search-box .btn-danger {
                  background: #dc2626;
              }

              .search-box .btn-danger:hover {
                  background: #b91c1c;
              }
          }

          .result-item {
              display: flex;
              align-items: center;
              gap: 0.75rem;
              margin: 0.5rem 0;
              padding: 0.75rem;
              background: var(--container-bg);
              border-radius: 8px;
          }

          .result-value {
              flex: 1;
              padding: 0.75rem;
              background: var(--bg-color);
              border-radius: 6px;
              word-break: break-all;
              font-family: monospace;
          }

          .result-copy {
              padding: 0.5rem 1rem;
              background: var(--primary-color);
              color: white;
              border: none;
              border-radius: 6px;
              cursor: pointer;
              transition: all 0.2s;
              white-space: nowrap;
          }

          .result-copy:hover {
              background: var(--hover-color);
          }

          .admin-table {
              width: 100%;
              border-collapse: collapse;
              margin: 1rem 0;
          }

          .admin-table th,
          .admin-table td {
              padding: 0.75rem;
              text-align: left;
              border-bottom: 1px solid var(--border-color);
          }

          .admin-table th {
              font-weight: 500;
              color: var(--text-secondary);
              background: var(--bg-color);
          }

          .admin-table td {
              max-width: 300px;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
          }

          .copy-btn {
              padding: 0.25rem 0.5rem;
              background: var(--bg-color);
              border: 1px solid var(--border-color);
              border-radius: 4px;
              color: var(--text-secondary);
              cursor: pointer;
              font-size: 0.875rem;
          }

          .delete-btn {
              padding: 0.25rem 0.5rem;
              background: #ef4444;
              color: white;
              border: none;
              border-radius: 4px;
              cursor: pointer;
              font-size: 0.875rem;
          }

          .delete-btn:hover {
              opacity: 0.9;
          }

          .create-form {
              margin-bottom: 2rem;
              padding: 1.5rem;
              background: var(--bg-color);
              border-radius: var(--radius);
          }

          .form-group {
              margin-bottom: 1rem;
          }

          .form-group label {
              display: block;
              margin-bottom: 0.5rem;
              color: var(--text-secondary);
          }

          .form-group input,
          .form-group select {
              width: 100%;
              padding: 0.5rem;
              border: 1px solid var(--border-color);
              border-radius: 6px;
              background: var(--container-bg);
              color: var(--text-primary);
          }

          .form-group input[type="number"] {
              width: 120px;
          }

          .form-actions {
              margin-top: 1.5rem;
          }

          .btn-create {
              padding: 0.5rem 1rem;
              background: var(--primary-color);
              color: white;
              border: none;
              border-radius: 6px;
              cursor: pointer;
          }

          .btn-create:hover {
              background: var(--hover-color);
          }

          .pagination {
              display: flex;
              justify-content: center;
              gap: 0.5rem;
              margin-top: 1rem;
          }

          .page-link {
              padding: 0.5rem 1rem;
              border: 1px solid var(--border-color);
              border-radius: 4px;
              color: var(--text-primary);
              text-decoration: none;
          }

          .page-link.active {
              background: var(--primary-color);
              color: white;
              border-color: var(--primary-color);
          }

          .page-ellipsis {
              padding: 0.5rem;
              color: var(--text-secondary);
          }

          .toast {
              position: fixed;
              bottom: 2rem;
              left: 50%;
              transform: translateX(-50%) translateY(100%);
              background: rgba(0, 0, 0, 0.8);
              color: white;
              padding: 0.75rem 1.5rem;
              border-radius: 9999px;
              font-size: 0.875rem;
              transition: transform 0.3s ease;
              z-index: 1000;
          }

          .toast.show {
              transform: translateX(-50%) translateY(0);
          }

          .copy-text {
              cursor: pointer;
              padding: 0.25rem;
              border-radius: 4px;
              transition: background-color 0.2s;
              max-width: 300px;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
          }

          .copy-text:hover {
              background: var(--hover-bg);
          }

          .copy-text.active {
              background: var(--primary-color);
              color: white;
          }

          .header {
              display: flex;
              justify-content: space-between;
              align-items: center;
              margin-bottom: 2rem;
          }

          .header-actions {
              display: flex;
              gap: 1rem;
          }

          .btn-toggle, .btn-clear {
              padding: 0.5rem 1rem;
              color: white;
              border: none;
              border-radius: 6px;
              cursor: pointer;
              transition: all 0.2s;
          }

          .btn-toggle {
              background: var(--primary-color);
              display: flex;
              align-items: center;
              gap: 0.5rem;
          }

          .btn-clear {
              background: var(--text-secondary);
          }

          .btn-toggle:hover, .btn-clear:hover {
              opacity: 0.9;
          }

          .toggle-icon {
              font-size: 1.2rem;
              transition: transform 0.3s;
          }

          .toggle-icon.expanded {
              transform: rotate(180deg);
          }
          
          /* 添加危险按钮样式 */
          .btn-danger {
              background: #dc2626 !important;
          }
          .btn-danger:hover {
              background: #b91c1c !important;
          }

          .link-info {
              cursor: pointer;
              display: flex;
              align-items: center;
              gap: 8px;
              padding: 6px 10px;
              border-radius: 4px;
              transition: all 0.2s;
          }

          .link-info:hover {
              background-color: var(--hover-bg);
          }

          .link-code {
              font-family: monospace;
              font-size: 1.1em;
              color: var(--text-primary);
              font-weight: 500;
          }

          .link-icon {
              opacity: 0.7;
              font-size: 1.1em;
          }
          
          .create-result {
              background: var(--bg-color);
              border-radius: var(--radius);
              padding: 1.5rem;
              margin: 1rem 0;
              box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
              opacity: 0;
              transform: translateY(-10px);
              transition: all 0.3s ease;
          }
  
          .create-result.show {
              opacity: 1;
              transform: translateY(0);
          }
  
          .result-header {
              display: flex;
              justify-content: space-between;
              align-items: center;
              margin-bottom: 1rem;
          }
  
          .close-btn {
              background: none;
              border: none;
              font-size: 1.5rem;
              color: var(--text-secondary);
              cursor: pointer;
              padding: 0.5rem;
              line-height: 1;
              border-radius: 4px;
          }
  
          .close-btn:hover {
              background: var(--hover-bg);
              color: var(--text-primary);
          }

          /* 源信息相关样式 */
          .source-info {
              display: flex;
              align-items: center;
              gap: 8px;
          }

          .source-icon {
              opacity: 0.6;
              transition: opacity 0.2s;
              display: flex;
              align-items: center;
              justify-content: center;
              width: 20px;
              height: 20px;
              border-radius: 4px;
          }

          .source-icon:hover {
              opacity: 1;
              background-color: var(--hover-bg);
              transform: scale(1.1);
          }

          .source-icon img {
              width: 16px;
              height: 16px;
              object-fit: contain;
          }

          /* GitHub 信息展示样式 */
          .gh-info {
              display: flex;
              flex-direction: column;
              gap: 4px;
              padding: 4px 0;
          }

          .gh-repo-info {
              display: flex;
              align-items: center;
              gap: 8px;
          }

          .gh-owner-repo {
              font-weight: 500;
              color: var(--text-primary);
          }

          .gh-owner {
              color: #2563eb;
          }

          .gh-repo {
              color: #059669;
          }

          .gh-branch {
              font-size: 0.9em;
              padding: 2px 6px;
              background: #f3f4f6;
              border-radius: 4px;
              color: #6b7280;
          }

          .gh-folder {
              font-size: 0.9em;
              color: var(--text-secondary);
              display: flex;
              align-items: center;
              gap: 4px;
          }

          .folder-icon {
              opacity: 0.7;
          }

          /* 暗色模式适配 */
          @media (prefers-color-scheme: dark) {
              .gh-owner { color: #60a5fa; }
              .gh-repo { color: #34d399; }
              .gh-branch { 
                  background: #374151;
                  color: #9ca3af;
              }
              .source-icon img {
                  filter: invert(1);
              }
          }

          /* 移动端适配 */
          @media (max-width: 768px) {
              .container {
                  padding: 1rem;
              }

              .admin-table {
                  display: block;
                  overflow-x: auto;
                  -webkit-overflow-scrolling: touch;
                  margin: 0 -1rem;
                  padding: 0 1rem;
                  width: calc(100% + 2rem);
              }

              .admin-table td {
                  white-space: nowrap;
                  font-size: 0.9rem;
                  padding: 0.75rem 0.5rem;
              }

              .gh-info {
                  gap: 2px;
              }
              
              .gh-repo-info {
                  flex-wrap: wrap;
              }

              .source-info {
                  flex-direction: column;
                  align-items: flex-start;
              }

              .copy-text {
                  max-width: 140px;
              }

              .result-item {
                  flex-direction: column;
                  align-items: stretch;
              }
              
              .result-copy {
                  width: 100%;
                  padding: 0.75rem;
              }
          }

          .gh-branch-icon {
              font-size: 0.9em;
              padding: 2px 6px;
              background: #f3f4f6;
              border-radius: 4px;
              color: #6b7280;
              transition: all 0.2s;
          }

          .gh-branch-icon:hover {
              background: #e5e7eb;
              transform: scale(1.1);
          }

          @media (prefers-color-scheme: dark) {
              .gh-branch-icon { 
                  background: #374151;
                  color: #9ca3af;
              }
              .gh-branch-icon:hover {
                  background: #4b5563;
              }
          }
      `;
}

class SourceHandler {
    // 源类型的图标配置
    static ICONS = {
        // AList logo base64
        ALIST: 'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyB2ZXJzaW9uPSIxLjEiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0Ij4KPHBhdGggZD0iTTAgMCBDMi4zNzk2Mzg2NyAwLjAwMDk3NjU2IDIuMzc5NjM4NjcgMC4wMDA5NzY1NiA1IDEgQzcuMDAxMjIwNyAzLjU2OTMzNTk0IDcuMDAxMjIwNyAzLjU2OTMzNTk0IDguOTI1NzgxMjUgNi45ODQzNzUgQzkuMjc3MDY1ODkgNy41OTU4MTM2IDkuNjI4MzUwNTIgOC4yMDcyNTIyIDkuOTkwMjgwMTUgOC44MzcyMTkyNCBDMTEuMTEzNDk3NzkgMTAuNzk5NjMzMjEgMTIuMjEzNDQ1MjYgMTIuNzczOTcwNTUgMTMuMzEyNSAxNC43NSBDMTQuNDAxMzEyMTMgMTYuNjcyMzQ2NyAxNS40OTQ4MDY2OSAxOC41OTE5NzE2MiAxNi41ODg4MzY2NyAyMC41MTEzNTI1NCBDMTcuMzEzNDMxNjMgMjEuNzg0OTczMDggMTguMDM1MDU0NDkgMjMuMDYwMjg5MTMgMTguNzUzNjkyNjMgMjQuMzM3MjgwMjcgQzIwLjUzNjIwNjE1IDI3LjQ5MzY0MzEgMjIuMzU4NjM0NzQgMzAuNjEwMTU0MjUgMjQuMjkwNTI3MzQgMzMuNjc3NzM0MzggQzI0Ljg0MjIyODQ3IDM0LjU1MzgwMzQxIDI0Ljg0MjIyODQ3IDM0LjU1MzgwMzQxIDI1LjQwNTA3NTA3IDM1LjQ0NzU3MDggQzI2LjQxNTE4MjU1IDM3LjAzNzg0MTE3IDI3LjQzNjEwOTI0IDM4LjYyMTIyNDY5IDI4LjQ1Nzc2MzY3IDQwLjIwNDEwMTU2IEMyOS45NjM3ODg3NyA0Mi45MzQzNTMxOCAzMC43Njc1MTAzNSA0NC45MDAyNDczNSAzMSA0OCBDMjkuMjg5MDYyNSA1MC43ODUxNTYyNSAyOS4yODkwNjI1IDUwLjc4NTE1NjI1IDI2IDUzIEMyMi4xMDcwNDczOCA1My42NTU4NTMzMyAxOC4zMTE0NzI4IDUzLjU2MTczMjc0IDE0LjM3NSA1My40Mzc1IEMxMy4zMjU3MDMxMiA1My40MzE2OTkyMiAxMi4yNzY0MDYyNSA1My40MjU4OTg0NCAxMS4xOTUzMTI1IDUzLjQxOTkyMTg4IEMzLjQ0MzU0MjE4IDUzLjI5NTY5NDc5IDMuNDQzNTQyMTggNTMuMjk1Njk0NzkgMCA1MSBDLTAuNTgzNzE3ODQgNDcuNzA1MzYxNzkgLTAuMTM2ODkwMjMgNDYuMjM5MjA4NjkgMS41MzEyNSA0My4zMjQyMTg3NSBDMi4xODA5Mzc1IDQyLjQ1NDEwMTU2IDIuODMwNjI1IDQxLjU4Mzk4NDM4IDMuNSA0MC42ODc1IEM0LjE0OTY4NzUgMzkuODA0NDkyMTkgNC43OTkzNzUgMzguOTIxNDg0MzcgNS40Njg3NSAzOC4wMTE3MTg3NSBDNS45NzQwNjI1IDM3LjM0Nzg1MTU2IDYuNDc5Mzc1IDM2LjY4Mzk4NDM4IDcgMzYgQzguNjUgMzYuMzMgMTAuMyAzNi42NiAxMiAzNyBDMTMuMTI1IDQxLjc1IDEzLjEyNSA0MS43NSAxMiA0NCBDMTQuNjQgNDQgMTcuMjggNDQgMjAgNDQgQzE3Ljk0MDU4MzM0IDQwLjMzMTU5MzU1IDE1Ljg3NjkwNTc4IDM2LjY2NTYwMDc3IDEzLjgxMjUgMzMgQzEzLjIzNDM1NTQ3IDMxLjk3MDAzOTA2IDEyLjY1NjIxMDk0IDMwLjk0MDA3ODEyIDEyLjA2MDU0Njg4IDI5Ljg3ODkwNjI1IEM4LjgzNzQyNDM2IDI0LjE2MTA1MDUgNS41MzEzMjAwNCAxOC41MzMwNjY0MyAyIDEzIEMwLjYwMDA0MjQ1IDE1LjIwNTgwMjE5IC0wLjc5NTMzOTY0IDE3LjQxNDI3Nzc2IC0yLjE4NzUgMTkuNjI1IEMtMi44NDcyMTgwMiAyMC42NjkzODIzMiAtMi44NDcyMTgwMiAyMC42NjkzODIzMiAtMy41MjAyNjM2NyAyMS43MzQ4NjMyOCBDLTYuMjM2MDE5NjYgMjYuMDY5MzQ3MTkgLTguODQ5MTYxOCAzMC40NDY5OTE0NiAtMTEuMzgyODEyNSAzNC44OTA2MjUgQy0xMS45NTIzMzY0MyAzNS44ODIzOTc0NiAtMTIuNTIxODYwMzUgMzYuODc0MTY5OTIgLTEzLjEwODY0MjU4IDM3Ljg5NTk5NjA5IEMtMTQuMjMyNDU3OTIgMzkuODYwODYxMzggLTE1LjM0NDU3NzUgNDEuODMyNDY4OCAtMTYuNDQ0MDkxOCA0My44MTEwMzUxNiBDLTE2Ljk2Mzk4NjgyIDQ0LjcxNjQ0MDQzIC0xNy40ODM4ODE4NCA0NS42MjE4NDU3IC0xOC4wMTk1MzEyNSA0Ni41NTQ2ODc1IEMtMTguNzAxNzI3MjkgNDcuNzY4NzQyNjggLTE4LjcwMTcyNzI5IDQ3Ljc2ODc0MjY4IC0xOS4zOTc3MDUwOCA0OS4wMDczMjQyMiBDLTIxLjM5MzU0NDA0IDUxLjQ4OTQyNjU1IC0yMi45MTYwNDA1MiA1Mi4yNjM3MDI3OSAtMjYgNTMgQy0yNi45OSA1Mi4zNCAtMjcuOTggNTEuNjggLTI5IDUxIEMtMjguNDk2ODY3MjUgNDUuODU3OTA0NTMgLTI2LjY0NDU1OTM5IDQyLjEzMjc1OTQ3IC0yMy45OTIxODc1IDM3LjgwMDc4MTI1IEMtMjMuNTg4NDc5MzEgMzcuMTI1MDg1OTEgLTIzLjE4NDc3MTEyIDM2LjQ0OTM5MDU2IC0yMi43Njg4MjkzNSAzNS43NTMyMTk2IEMtMjEuNDc5NzAwMjYgMzMuNjAwODcyOTEgLTIwLjE3NzQ3MDQ1IDMxLjQ1Njc5MzQ0IC0xOC44NzUgMjkuMzEyNSBDLTE4LjAyMjU5OTUgMjcuODkxNzc4NDkgLTE3LjE3MTAyOTM2IDI2LjQ3MDU1ODQzIC0xNi4zMjAzMTI1IDI1LjA0ODgyODEyIEMtMy4yMzIxMjQyIDMuMjMyMTI0MiAtMy4yMzIxMjQyIDMuMjMyMTI0MiAwIDAgWiAiIGZpbGw9IiM3NkM4QzAiIHRyYW5zZm9ybT0idHJhbnNsYXRlKDMxLDYpIi8+CjxwYXRoIGQ9Ik0wIDAgQzIuNjI1IDAuMzc1IDIuNjI1IDAuMzc1IDUgMSBDNS43NzAxODkyNiAzLjI1MjUzOTgzIDYuMTY1MDA0MzYgNC41Mjc5NTAxMyA1LjM2NjY5OTIyIDYuODExNzY3NTggQzUuMDE2MjM1MzUgNy40MTY1Nzk1OSA0LjY2NTc3MTQ4IDguMDIxMzkxNiA0LjMwNDY4NzUgOC42NDQ1MzEyNSBDMy45MTc5Njg3NSA5LjMyMTkzMzU5IDMuNTMxMjUgOS45OTkzMzU5NCAzLjEzMjgxMjUgMTAuNjk3MjY1NjIgQzIuNTEwMTk1MzEgMTEuNzQ0MzA2NjQgMi41MTAxOTUzMSAxMS43NDQzMDY2NCAxLjg3NSAxMi44MTI1IEMxLjQ4MzEyNSAxMy40OTg5MjU3OCAxLjA5MTI1IDE0LjE4NTM1MTU2IDAuNjg3NSAxNC44OTI1NzgxMiBDLTYuNTY4MjAwNDkgMjcuNDI0MDczOSAtNi41NjgyMDA0OSAyNy40MjQwNzM5IC0xMC4wMjc4MzIwMyAyOC44MTU2NzM4MyBDLTEwLjY3ODY0NzQ2IDI4Ljg3NjUwMTQ2IC0xMS4zMjk0NjI4OSAyOC45MzczMjkxIC0xMiAyOSBDLTEyLjY2IDI4LjM0IC0xMy4zMiAyNy42OCAtMTQgMjcgQy0xMy45MjQ2ODAzNyAyMC40ODA2Njc5NiAtMTEuMDEwMjM2MTMgMTYuMDYyODE0MTUgLTcuNTYyNSAxMC42ODc1IEMtNy4wNTkxMjEwOSA5Ljg3NzMyNDIyIC02LjU1NTc0MjE5IDkuMDY3MTQ4NDQgLTYuMDM3MTA5MzggOC4yMzI0MjE4OCBDLTIuMzQ3MjIwMjggMi4zNDcyMjAyOCAtMi4zNDcyMjAyOCAyLjM0NzIyMDI4IDAgMCBaICIgZmlsbD0iIzI1QTREOSIgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoMzEsMzApIi8+Cjwvc3ZnPgo=',

        // GitHub logo base64
        GITHUB: 'data:image/svg+xml;base64,PHN2ZyB2aWV3Qm94PSIwIDAgOTggOTYiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZmlsbC1ydWxlPSJldmVub2RkIiBjbGlwLXJ1bGU9ImV2ZW5vZGQiIGQ9Ik00OC44NTQgMEMyMS44MzkgMCAwIDIyIDAgNDkuMjE3YzAgMjEuNzU2IDEzLjk5MyA0MC4xNzIgMzMuNDA1IDQ2LjY5IDIuNDI3LjQ5IDMuMzE2LTEuMDU5IDMuMzE2LTIuMzYyIDAtMS4xNDEtLjA4LTUuMDUyLS4wOC03LjI5Ny0xMy41OSAyLjkzNC0xNi40Mi01Ljg2Ny0xNi40Mi01Ljg2Ny0yLjE4NC01LjcwNC01LjQyLTcuMTctNS40Mi03LjE3LTQuNDQ4LTMuMDE1LjMyNC0zLjAxNS4zMjQtMy4wMTUgNC45MzQuMzI2IDcuNTIzIDUuMDUyIDcuNTIzIDUuMDUyIDQuMzY3IDcuNDk2IDExLjQwNCA1LjM3OCAxNC4yMzUgNC4wNzQuNDA0LTMuMTc4IDEuNjk5LTUuMzc4IDMuMDc0LTYuNi0xMC44MzktMS4xNDEtMjIuMjQzLTUuMzc4LTIyLjI0My0yNC4yODMgMC01LjM3OCAxLjk0LTkuNzc4IDUuMDE0LTEzLjItLjQ4NS0xLjIyMi0yLjE4NC02LjI3NS40ODYtMTMuMDM4IDAgMCA0LjEyNS0xLjMwNCAxMy40MjYgNS4wNTJhNDYuOTcgNDYuOTcgMCAwIDEgMTIuMjE0LTEuNjNjNC4xMjUgMCA4LjMzLjU3MSAxMi4yMTMgMS42MyA5LjMwMi02LjM1NiAxMy40MjctNS4wNTIgMTMuNDI3LTUuMDUyIDIuNjcgNi43NjMuOTcgMTEuODE2LjQ4NSAxMy4wMzggMy4xNTUgMy40MjIgNS4wMTUgNy44MjIgNS4wMTUgMTMuMiAwIDE4LjkwNS0xMS40MDQgMjMuMDYtMjIuMzI0IDI0LjI4MyAxLjc4IDEuNTQ4IDMuMzE2IDQuNDgxIDMuMzE2IDkuMTI2IDAgNi42LS4wOCAxMS44OTctLjA4IDEzLjUyNiAwIDEuMzA0Ljg5IDIuODUzIDMuMzE2IDIuMzY0IDE5LjQxMi02LjUyIDMzLjQwNS0yNC45MzUgMzMuNDA1LTQ2LjY5MUM5Ny43MDcgMjIgNzUuNzg4IDAgNDguODU0IDB6IiBmaWxsPSIjMjQyOTJmIi8+PC9zdmc+'
    };

    // 源类型的处理配置
    static SOURCE_CONFIGS = {
        github: {
            parseUrl: (url) => {
                const repoMatch = url.match(/github\.com\/([^/]+)\/([^/]+)/);
                return {
                    owner: repoMatch ? repoMatch[1] : '',
                    repo: repoMatch ? repoMatch[2] : ''
                };
            },
            formatDisplay: (data) => {
                const { owner, repo } = SourceHandler.SOURCE_CONFIGS.github.parseUrl(data.url);
                const branch = data.config.ref || '默认分支';
                const folder = data.path ? data.path.replace(/^\/+|\/+$/g, '') : '/';

                return `
                    <div class="gh-info">
                        <div class="gh-repo-info">
                            <span class="gh-owner-repo" title="仓库信息">
                                <span class="gh-owner">${owner}</span> / 
                                <span class="gh-repo">${repo}</span>
                            </span>
                            <span class="gh-branch-icon" title="分支: ${branch}">🔖</span>
                            <span class="gh-folder" title="文件夹路径">
                                <span class="folder-icon">📁</span> ${folder}
                            </span>
                        </div>
                    </div>
                `;
            },
            getSourceInfo: (data) => ({
                iconUrl: SourceHandler.ICONS.GITHUB,
                iconTitle: "访问 GitHub 仓库",
                sourceLink: data.url
            })
        },
        'github-releases': {
            parseUrl: (url) => {
                const repoMatch = url.match(/github\.com\/([^/]+)\/([^/]+)/);
                return {
                    owner: repoMatch ? repoMatch[1] : '',
                    repo: repoMatch ? repoMatch[2] : ''
                };
            },
            formatDisplay: (data) => {
                const { owner, repo } = SourceHandler.SOURCE_CONFIGS['github-releases'].parseUrl(data.url);
                const tag = data.config.tag || 'latest';
                const count = data.config.count || 20;

                return `
                    <div class="gh-info">
                        <div class="gh-repo-info">
                            <span class="gh-owner-repo" title="仓库信息">
                                <span class="gh-owner">${owner}</span> / 
                                <span class="gh-repo">${repo}</span>
                            </span>
                            <span class="gh-branch-icon" title="Releases${tag !== 'latest' ? ': ' + tag : ''}" style="background-color: #2563eb1a; color: #2563eb;">
                                🏷️ ${tag !== 'latest' ? tag : count > 1 ? `最近 ${count} 个` : '最新'}
                            </span>
                        </div>
                    </div>
                `;
            },
            getSourceInfo: (data) => ({
                iconUrl: SourceHandler.ICONS.GITHUB,
                iconTitle: "访问 GitHub Releases",
                sourceLink: `${data.url}/releases${data.config.tag ? '/tag/' + data.config.tag : ''}`,
                copyUrl: data.url
            })
        },
        alist: {
            formatDisplay: (data) => {
                // 格式化显示文件夹路径
                const folderPath = data.url ? ('/' + data.url).replace(/\/+/g, '/') : '/';
                return `
                    <div class="gh-info">
                        <div class="gh-repo-info">
                            <span class="gh-folder" title="文件夹路径">
                                <span class="folder-icon">📁</span> ${folderPath}
                            </span>
                        </div>
                    </div>
                `;
            },
            getSourceInfo: (data) => ({
                iconUrl: SourceHandler.ICONS.ALIST,
                iconTitle: "访问 AList 文件夹",
                sourceLink: `${ALIST_API_URL}${data.url ? '/' + data.url : ''}`,
                copyUrl: data.url || '/'
            })
        }
    };

    static getSourceInfo(linkData) {
        // 处理无源类型的情况
        if (!linkData.sourceType) {
            return {
                displayUrl: linkData.url,
                copyUrl: linkData.url,
                iconUrl: null,
                iconTitle: null,
                sourceLink: null
            };
        }

        // 获取源类型配置
        const sourceConfig = this.SOURCE_CONFIGS[linkData.sourceType];
        if (!sourceConfig) {
            return {
                displayUrl: linkData.url,
                copyUrl: linkData.url,
                iconUrl: null,
                iconTitle: null,
                sourceLink: null
            };
        }

        // 获取源信息
        const sourceInfo = sourceConfig.getSourceInfo(linkData);
        const displayUrl = sourceConfig.formatDisplay(linkData);

        return {
            displayUrl,
            copyUrl: linkData.url,
            ...sourceInfo
        };
    }

    static async getHandler(sourceType) {
        switch (sourceType) {
            case 'alist':
                return new AlistHandler();
            case 'github':
                return new GitHubHandler();
            case 'github-releases':
                return new GitHubReleasesHandler();
            default:
                throw new Error('Unsupported source type');
        }
    }

}

// 添加基础处理器类
class BaseHandler {
    // 处理路径标准化
    normalizePath(path) {
        if (!path) return '/';
        return '/' + path.replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
    }

    // 合并基础路径和子路径
    joinPaths(basePath, subPath) {
        const normalizedBase = this.normalizePath(basePath);
        const normalizedSub = subPath ? this.normalizePath(subPath) : '';
        return (normalizedBase + normalizedSub).replace(/\/+/g, '/');
    }

    // 基础文件列表获取方法
    async getFileList(path, config) {
        throw new Error('Method not implemented');
    }

    // 基础下载链接获取方法
    async getDownloadUrl(subPath, linkData) {
        throw new Error('Method not implemented');
    }

    // 标准化文件信息
    normalizeFile(file) {
        return {
            name: file.name,
            size: file.size || 0,
            is_dir: file.is_dir,
            modified: file.modified,
            download_url: file.download_url || '',
            provider: file.provider
        };
    }
}

class AlistHandler extends BaseHandler {
    async getFileList(path, config) {
        const normalizedPath = this.normalizePath(path);

        const response = await fetch(`${ALIST_API_URL}/api/fs/list`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': ALIST_TOKEN
            },
            body: JSON.stringify({
                path: normalizedPath,
                password: '',
                page: 1,
                per_page: 0,
                refresh: false
            })
        });

        if (!response.ok) {
            throw new Error('Failed to fetch from AList');
        }

        const data = await response.json();

        if (!data || !data.data || !data.data.content) {
            return [];
        }

        return data.data.content.map(item => this.normalizeFile({
            name: item.name,
            size: item.size,
            is_dir: item.type === 1,
            modified: item.modified,
            download_url: item.download_url,
            provider: 'alist'
        }));
    }

    async getDownloadUrl(subPath, linkData) {
        // 使用基类的路径合并方法
        const fullPath = this.joinPaths(linkData.url, subPath);
        return `${ALIST_API_URL}/d${fullPath}`;
    }
}

class GitHubHandler extends BaseHandler {
    static parseRepoUrl(url) {
        const cleanUrl = url.trim().replace(/\.git$/, '');
        const match = cleanUrl.match(/github\.com\/([^/\s]+)\/([^/\s?#]+)/i);
        if (!match) {
            throw new Error('无效的 GitHub 仓库地址');
        }
        return {
            owner: match[1],
            repo: match[2]
        };
    }

    async getFileList(path, config) {
        const { owner, repo, ref } = config;
        const normalizedPath = this.normalizePath(path).replace(/^\//, '');

        const headers = {
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'CloudflareWorker/1.0',
            'Authorization': `token ${GITHUB_TOKEN}`
        };

        const apiUrl = normalizedPath
            ? `https://api.github.com/repos/${owner}/${repo}/contents/${normalizedPath}${ref ? `?ref=${ref}` : ''}`
            : `https://api.github.com/repos/${owner}/${repo}/contents${ref ? `?ref=${ref}` : ''}`;

        try {
            const response = await fetch(apiUrl, { headers });
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`GitHub API error: ${response.status} - ${errorText}`);
            }

            const data = await response.json();
            const items = Array.isArray(data) ? data : [data];

            return items.map(item => {
                let download_url = null;
                if (item.type === 'file') {
                    download_url = item.download_url;
                }

                return this.normalizeFile({
                    name: item.name,
                    size: item.size || 0,
                    is_dir: item.type === 'dir',
                    modified: null,
                    download_url: download_url,
                    provider: 'github'
                });
            }).sort((a, b) => {
                if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
                return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
            });
        } catch (error) {
            throw error;
        }
    }

    async getDownloadUrl(subPath, linkData) {
        const { owner, repo, ref } = linkData.config;
        // 这里需要考虑 linkData.path 和 subPath 的组合
        const fullPath = this.joinPaths(linkData.path || '', subPath || '').replace(/^\//, '');

        if (!ref) {
            // 如果没有指定分支，需要先获取文件信息来获取 download_url
            const headers = {
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'CloudflareWorker/1.0',
                'Authorization': `token ${GITHUB_TOKEN}`
            };

            const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${fullPath}`;

            const response = await fetch(apiUrl, { headers });

            if (!response.ok) {
                throw new Error(`GitHub API error: ${response.status}`);
            }

            const data = await response.json();
            if (!data.download_url) {
                throw new Error('File not found or is a directory');
            }
            return data.download_url;
        }

        return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${fullPath}`;
    }
}

class GitHubReleasesHandler extends BaseHandler {
    async getFileList(path, config) {
        const { owner, repo, skipFolder, tag } = config;
        const normalizedPath = this.normalizePath(path);

        try {
            const releases = await this.getReleasesList(owner, repo, config);

            if (!releases.length) {
                return [];
            }

            let targetRelease;
            if (tag || config.count === 1) {
                targetRelease = releases[0];
            }

            if (!normalizedPath || normalizedPath === '/') {
                if (skipFolder && targetRelease) {
                    return targetRelease.assets.map(asset => this.normalizeFile({
                        name: asset.name,
                        size: asset.size,
                        is_dir: false,
                        modified: asset.modified,
                        download_url: asset.download_url,
                        provider: 'github-releases',
                        release_tag: targetRelease.name
                    }));
                }

                return releases.map(release => ({
                    name: release.name,
                    is_dir: true,
                    size: 0,
                    modified: release.modified,
                    provider: 'github-releases'
                }));
            }

            // 处理文件下载路径
            const pathParts = normalizedPath.split('/').filter(Boolean);

            let release;
            if (skipFolder && targetRelease) {
                release = targetRelease;
            } else {
                const releaseName = pathParts[0];
                release = releases.find(r => r.name === releaseName);
            }

            if (!release) {
                throw new Error('Release not found');
            }

            const fileName = skipFolder ? pathParts[0] : pathParts[1];

            if (fileName) {
                const asset = release.assets.find(a => a.name === fileName);
                if (!asset) {
                    throw new Error('File not found');
                }
                return [this.normalizeFile({
                    name: asset.name,
                    size: asset.size,
                    is_dir: false,
                    modified: asset.modified,
                    download_url: asset.download_url,
                    provider: 'github-releases'
                })];
            }

            return release.assets.map(asset => this.normalizeFile({
                name: asset.name,
                size: asset.size,
                is_dir: false,
                modified: asset.modified,
                download_url: asset.download_url,
                provider: 'github-releases'
            }));

        } catch (error) {
            throw error;
        }
    }

    async getReleasesList(owner, repo, config) {
        const headers = {
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'CloudflareWorker'
        };

        if (GITHUB_TOKEN) {
            headers['Authorization'] = `token ${GITHUB_TOKEN}`;
        }

        let apiUrl;
        if (config.tag) {
            apiUrl = `https://api.github.com/repos/${owner}/${repo}/releases/tags/${config.tag}`;
        } else if (config.count === 1) {
            apiUrl = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
        } else {
            apiUrl = `https://api.github.com/repos/${owner}/${repo}/releases?per_page=${config.count || 20}`;
        }

        const response = await fetch(apiUrl, { headers });
        if (!response.ok) {
            throw new Error(`GitHub API error: ${response.status}`);
        }

        const data = await response.json();
        const releases = Array.isArray(data) ? data : [data];

        return releases.map(release => ({
            name: release.tag_name,
            is_dir: true,
            size: 0,
            modified: new Date(release.published_at).getTime(),
            assets: release.assets.map(asset => ({
                name: asset.name,
                is_dir: false,
                size: asset.size,
                modified: new Date(asset.updated_at).getTime(),
                download_url: asset.browser_download_url
            }))
        }));
    }

    async getDownloadUrl(subPath, linkData) {
        const { owner, repo, tag, skipFolder } = linkData.config;

        if (skipFolder) {
            const fileName = subPath;
            return tag
                ? `https://github.com/${owner}/${repo}/releases/download/${tag}/${fileName}`
                : `https://github.com/${owner}/${repo}/releases/latest/download/${fileName}`;
        }

        const pathParts = this.normalizePath(subPath).split('/').filter(Boolean);
        const [releaseName, fileName] = pathParts;

        if (!fileName) {
            throw new Error("File not found");
        }
        return `https://github.com/${owner}/${repo}/releases/download/${releaseName}/${fileName}`;
    }
}

// 修改 createForm 变量
const createForm = `
  <div class="create-form" id="createForm" style="display: none;">
      <div class="form-group">
          <label>链接类型</label>
          <select id="linkType" onchange="onLinkTypeChange()">
              <option value="file">文件</option>
              <option value="alist">AList 文件夹</option>
              <option value="github">GitHub 仓库</option>
              <option value="github-releases">GitHub Releases</option>
          </select>
      </div>

      <div id="githubConfig" style="display: none;">
          <div class="form-group">
              <label>GitHub 仓库地址</label>
              <input type="text" id="githubUrl" placeholder="例如: https://github.com/owner/repo">
          </div>
      </div>

      <!-- GitHub 仓库配置 -->
      <div id="githubRepoConfig" style="display: none;">
          <div class="form-group">
              <label>分支/标签</label>
              <input type="text" id="githubRef" placeholder="留空使用默认分支">
          </div>
      </div>

      <!-- GitHub Releases 配置 -->
      <div id="githubReleasesConfig" style="display: none;">
          <div class="form-group">
              <label>Release 设置</label>
              <div style="display: flex; gap: 10px; align-items: flex-end;">
                  <div style="flex: 1;">
                      <small style="display: block; margin-bottom: 5px;">指定 Tag (可选)</small>
                      <input type="text" id="githubTag" placeholder="留空显示最新/多个" onchange="updateSkipFolderVisibility()">
                  </div>
                  <div>
                      <small style="display: block; margin-bottom: 5px;">显示数量</small>
                      <input type="number" id="releaseCount" value="20" min="1" max="100" style="width: 80px;" onchange="updateSkipFolderVisibility()">
                  </div>
              </div>
          </div>
          <div class="form-group" id="skipFolderGroup" style="display: none;">
              <div style="display: flex; align-items: center; background-color: #f5f7f9; padding: 10px; border-radius: 4px;">
                  <div style="display: flex; align-items: center; margin-right: 10px;">
                      <input type="checkbox" id="skipFolder" style="margin: 0;">
                  </div>
                  <div>
                      <strong>直接显示文件列表</strong>
                  </div>
              </div>
          </div>
      </div>

      <div class="form-group" id="urlGroup">
          <label id="urlLabel">URL</label>
          <input type="text" id="urlInput" placeholder="输入需要转换的URL">
      </div>


      <div class="form-group">
          <label>有效期</label>
          <select id="expireType" onchange="onExpireTypeChange()">
              <option value="never">永久有效</option>
              <option value="1">1天</option>
              <option value="2">2天</option>
              <option value="3">3天</option>
              <option value="7">7天</option>
              <option value="30">30天</option>
              <option value="custom">自定义</option>
          </select>
          <input type="datetime-local" id="customExpire" style="display:none;margin-top:0.5rem">
      </div>
      <div class="form-group">
          <label>访问次数限制（留空表示不限制）</label>
          <input type="number" id="maxVisits" min="1" max="9999" placeholder="最大9999次">
      </div>
      <div class="form-group">
          <label>访问码（可选）</label>
          <input type="text" id="accessCode" placeholder="留空表示无需访问码">
      </div>
      <div class="form-actions">
          <button class="btn-create" onclick="createShortlink()">创建短链接</button>
      </div>
  </div>
  `;
