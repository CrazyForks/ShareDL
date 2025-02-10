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
            console.warn('URL parsing failed:', e);
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
        
        // 获取并过滤数据
        const { items, totalItems } = await this.getFilteredItems(searchQuery);
        const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  
        // 处理页码超出范围的情况
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
  
    // 处理删除请求
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
  
    // 辅助方法：获取并过滤数据
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
  
      // 按创建时间倒序排序
      items.sort((a, b) => b.createdAt - a.createdAt);
  
      return { items, totalItems: items.length };
    }
  
    // 辅助方法：过滤数据
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
  
    // 辅助方法：生成管理页面表格内容
    generateAdminTableContent(items, totalItems, searchQuery, page, totalPages) {
      const searchHtml = `
          <div class="search-box">
              <input type="text" id="searchInput" placeholder="搜索短链接..." value="${searchQuery}">
              <select id="statusFilter" onchange="filterByStatus(this.value)">
                  <option value="all">全部状态</option>
                  <option value="active">生效中</option>
                  <option value="expired">已失效</option>
              </select>
              <button onclick="search()">搜索</button>
              <button class="btn-danger" onclick="clearExpired()">清除过期链接</button>
          </div>
      `;
  
      const tableHtml = `
          <table class="admin-table">
              <thead>
                  <tr>
                      <th>短链接</th>
                      <th>原始链接</th>
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
                          : '<span class="expire-time permanent" onclick="event.stopPropagation(); editExpireTime(\'' + item.key + '\', null)" title="点击修改">永久</span>';
  
                      const visitsStatus = `<span class="visits ${isLimitExceeded ? 'exceeded' : ''}" onclick="event.stopPropagation(); editMaxVisits('${item.key}', ${linkData.maxVisits})" title="点击修改">
                        ${linkData.visits || 0} / ${linkData.maxVisits || '∞'}
                      </span>`;
  
                      const accessCode = `<span class="access-code" onclick="event.stopPropagation(); editAccessCode('${item.key}', '${linkData.accessCode || ''}')" title="点击修改">
                          ${linkData.accessCode ? '🔒 ' + linkData.accessCode : '无'}
                      </span>`;
  
                      const icon = linkData.type === 'folder' ? '📁' : '📄';
  
                      return `
                          <tr data-key="${item.key}" class="${isInvalid ? 'invalid' : ''} ${linkData.type === 'folder' ? 'folder-row' : ''}" data-status="${isInvalid ? 'expired' : 'active'}">
                              <td>
                                  <div class="copy-text" onclick="copyToClipboard('${copyUrl}')" title="点击复制完整链接">
                                      <span class="item-icon">${icon}</span>
                                      ${item.key}
                                  </div>
                              </td>
                              <td>
                                  <div class="copy-text" onclick="copyToClipboard('${linkData.url}')" title="点击复制">
                                      ${linkData.url}
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
  
    // 处理短链接访问
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
              // 文件下载请求
              const fullUrl = `${ALIST_API_URL}/d/${linkData.url}/${subPath}`.replace(/\/+/g, '/');
              
              // 检查是否是下载请求
              const isDownloadRequest = this.url.searchParams.get('download') === '1';
              
              // 如果是直接下载请求，返回文件内容
              if (isDownloadRequest) {
                  return this.handleFileContent(fullUrl);
              }
              
              // 否则返回文件信息页面
              const fileName = subPath.split('/').pop();
              const fileSize = await this.getFileSize(fullUrl);
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
              
              // 如果是直接下载请求，返回文件内容
              if (isDownloadRequest) {
                  return this.handleFileContent(linkData.url);
              }
              
              // 否则返回文件信息页面
              const fileName = Utils.extractFilename(linkData.url);
              const fileSize = await this.getFileSize(linkData.url);
              return new Response(
                  generateFileInfoHtml(fileName, fileSize),
                  { headers: { 'Content-Type': 'text/html;charset=UTF-8' } }
              );
          } else {
              // 如果不需要访问码，直接下载文件
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
      
      // 检查 URL 是否有效
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
          // 解码路径并确保格式正确
          folderPath = decodeURIComponent(folderPath).replace(/^\/+/, '').replace(/\/+$/, '');
          
          // 构建 API URL
          const apiUrl = `${ALIST_API_URL}/api/fs/list`;
          
          // 准备请求数据，确保路径正确编码
          const requestData = {
              path: '/' + folderPath,
              password: '',
              page: 1,
              per_page: 0,
              refresh: false
          };
  
          // 发送请求
          const response = await fetch(apiUrl, {
              method: 'POST',
              headers: {
                  'Content-Type': 'application/json',
                  'Authorization': ALIST_TOKEN
              },
              body: JSON.stringify(requestData)
          });
  
          if (!response.ok) {
              throw new Error('Failed to fetch folder content');
          }
  
          const data = await response.json();
          
          if (!data.data || !data.data.content) {
              return generateEmptyFolderHtml();
          }
  
          // 获取当前短链接的路径部分
          const pathParts = this.url.pathname.split('/');
          const shortCode = pathParts[2];
          const currentPath = pathParts.slice(3).join('/');
  
          // 获取当前的访问码
          const currentAccessCode = new URL(this.request.url).searchParams.get('code');
          
          // 生成文件列表 HTML
          const items = data.data.content
              .sort((a, b) => {
                  if (a.is_dir !== b.is_dir) return b.is_dir ? 1 : -1;
                  return a.name.localeCompare(b.name, 'zh-CN');
              })
              .map(item => {
                  const isDir = item.is_dir;
                  const icon = isDir ? '📁' : '📄';
                  
                  // 构建新的路径，不需要手动编码
                  let newPath;
                  if (currentPath) {
                      newPath = `${currentPath}/${item.name}`;
                  } else {
                      newPath = item.name;
                  }
                  
                  // 构建URL，如果是文件则直接添加 download=1 参数
                  let itemUrl = isDir ? 
                      `/s/${shortCode}/${newPath}` : 
                      `/s/${shortCode}/${newPath}?type=file&download=1`;
                  
                  // 如果有访问码，添加到URL中
                  if (currentAccessCode) {
                      itemUrl += (itemUrl.includes('?') ? '&' : '?') + `code=${currentAccessCode}`;
                  }
  
                  return `
                      <div class="file-item ${isDir ? 'folder' : 'file'}">
                          <a href="${itemUrl}" class="file-link">
                              <span class="file-icon">${icon}</span>
                              <span class="file-name">${item.name}</span>
                              ${!isDir ? `<span class="file-size">${formatFileSize(item.size)}</span>` : ''}
                          </a>
                      </div>
                  `;
              }).join('');
  
          // 构建返回上级目录的链接，同样需要带上访问码
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
          console.error('Error fetching folder content:', error);
          return generateErrorHtml('Failed to load folder content');
      }
    }
  
    // 处理文件内容
    async handleFileContent(url) {
      const accessCode = new URL(this.request.url).searchParams.get('code');
      const modifiedRequest = this.createModifiedRequest(url, { accessCode });
      return await fetch(modifiedRequest);
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
                  // 如果解码失败，保持原样
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
        'range',          // 支持断点续传
        'accept',         // 接受的内容类型
        'accept-encoding' // 接受的编码方式
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
        const { url, expireAt, maxVisits } = data;
  
        // 验证输入
        if (!url || !url.trim()) {
          throw new Error("URL is required");
        }
        if (maxVisits && (!Number.isInteger(maxVisits) || maxVisits < 1 || maxVisits > 9999)) {
          throw new Error("Max visits must be between 1 and 9999");
        }
  
        // 判断是否为有效URL
        let isFolder = false;
        try {
          new URL(url);
        } catch (e) {
          // 如果不是有效URL，则作为文件夹路径处理
          isFolder = true;
        }
  
        // 生成短码
        const shortCode = await generateFixedCode(url + Date.now(), isFolder);  // 添加时间戳确保唯一性
        
        // 存储数据结构
        const linkData = {
          url: url.trim(),
          type: isFolder ? 'folder' : 'file',
          createdAt: Date.now(),
          expireAt: expireAt || null,
          maxVisits: maxVisits || null,
          visits: 0,
          accessCode: data.accessCode || null
        };
  
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
                      countdown.textContent = seconds + ' 秒后可再次下载';  // 修改这里，不使用模板字符串
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
              
              <div class="create-form" id="createForm" style="display: none;">
                  <div class="form-group">
                      <label>URL</label>
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
        'console.error("Clear error:", error);' +
        'window.showToast("清除失败");' +
        '});' +
        '});' +
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
        'console.error("复制失败:", err);' +
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
        'console.error("Delete error:", err);' +
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
        'document.getElementById("expireType").value === "custom" ? "block" : "none";' +
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
        'console.error("Update error:", err);' +
        'window.showToast("更新失败：" + err.message);' +
        '});' +
        '};' +

        'window.createShortlink = function() {' +
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

        'fetch("' + ADMIN_PATH + '/create", {' +
        'method: "POST",' +
        'headers: { "Content-Type": "application/json" },' +
        'body: JSON.stringify({' +
        'url,' +
        'expireAt,' +
        'maxVisits: maxVisits ? parseInt(maxVisits) : null,' +
        'accessCode: accessCode.trim() || null' +
        '})' +
        '})' +
        '.then(response => {' +
        'if (!response.ok) throw new Error(response.statusText);' +
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

        // 收起创建表单并更新按钮状态
        'const createForm = document.querySelector(".create-form");' +
        'const toggleBtn = document.querySelector(".btn-toggle");' +
        'createForm.style.display = "none";' +
        'toggleBtn.innerHTML = \'创建短链接 <span class="toggle-icon">▼</span>\';' +

        'const oldResult = document.querySelector(".create-result");' +
        'if (oldResult) oldResult.remove();' +
        'createForm.insertAdjacentHTML("afterend", resultHtml);' +

        // 重置表单
        'document.getElementById("urlInput").value = "";' +
        'document.getElementById("expireType").value = "never";' +
        'document.getElementById("maxVisits").value = "";' +
        'document.getElementById("accessCode").value = "";' +
        'document.getElementById("customExpire").style.display = "none";' +

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
        'console.error("Failed to refresh list:", error);' +
        'window.showToast("刷新列表失败，请手动刷新页面");' +
        '});' +
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
      `;
  }
  
  // 管理页面样式
  function getAdminStyles() {
      return `
          .title {
              margin-bottom: 2rem;
              color: var(--text-primary);
          }
  
          .search-box {
              display: flex;
              gap: 0.75rem;
              margin-bottom: 2rem;
              background: var(--bg-color);
              padding: 1rem;
              border-radius: var(--radius);
              align-items: center;
          }
  
          .search-box input {
              flex: 1;
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
  
          .search-box button {
              padding: 0.75rem 1.5rem;
              background: var(--primary-color);
              color: white;
              border: none;
              border-radius: 8px;
              cursor: pointer;
              font-size: 0.95rem;
              transition: background 0.2s;
          }
  
          .search-box button:hover {
              background: var(--hover-color);
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
  
          @keyframes slideDown {
              from {
                  opacity: 0;
                  transform: translateY(-10px);
              }
              to {
                  opacity: 1;
                  transform: translateY(0);
              }
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
  
          .create-form h2 {
              margin-bottom: 1.5rem;
              color: var(--text-primary);
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
  
          .create-form {
              background: var(--bg-color);
              border-radius: 8px;
              padding: 1.5rem;
              margin-bottom: 2rem;
              box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
              transition: all 0.3s ease;
          }
  
          .invalid {
              opacity: 0.7;
          }
  
          .invalid .delete-btn {
              opacity: 1;
          }
  
          .visits.exceeded {
              color: #ef4444;
          }
  
          .status, .visits {
              cursor: pointer;
          }
  
          .status:hover, .visits:hover {
              opacity: 0.8;
          }
  
          .item-icon {
              display: inline-block;
              margin-right: 0.5rem;
              font-size: 1.1rem;
              vertical-align: middle;
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
  
          /* 添加移动端适配 */
          @media (max-width: 768px) {
              .container {
                  padding: 1rem;
              }
  
              /* 调整表格布局 */
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
  
              /* 调整头部布局 */
              .header {
                  flex-direction: column;
                  align-items: stretch;
                  gap: 1rem;
              }
  
              .header-actions {
                  display: grid;
                  grid-template-columns: 1fr;
                  gap: 0.5rem;
              }
  
              .btn-toggle, 
              .btn-clear {
                  width: 100%;
                  padding: 0.75rem;
                  font-size: 0.95rem;
                  justify-content: center;
              }
  
              /* 调整创建表单 */
              .create-form {
                  padding: 1rem;
                  margin: 1rem 0;
              }
  
              .form-group input[type="number"] {
                  width: 100%;
              }
  
              /* 调整搜索框布局 */
              .search-box {
                  flex-direction: column;
                  gap: 0.5rem;
                  padding: 0.75rem;
              }
  
              .search-box input,
              .search-box select,
              .search-box button {
                  width: 100%;
                  margin: 0;
              }
          }
  
          @media (max-width: 480px) {
              .copy-text {
                  max-width: 140px;
              }
  
              .create-result {
                  margin: 1rem -1rem;
                  border-radius: 0;
              }
          }
  
          /* 添加搜索框操作按钮样式 */
          .search-actions {
              display: flex;
              gap: 0.5rem;
          }
  
          /* 移动端适配 */
          @media (max-width: 768px) {
              .search-actions {
                  display: grid;
                  grid-template-columns: 1fr;
                  gap: 0.5rem;
                  width: 100%;
              }
  
              .search-actions button {
                  width: 100%;
              }
          }

          /* 添加危险按钮样式 */
          .btn-danger {
              background: #dc2626 !important;
          }
          .btn-danger:hover {
              background: #b91c1c !important;
          }

          /* 移动端适配 */
          @media (max-width: 768px) {
              .result-item {
                  flex-direction: column;
                  align-items: stretch;
              }
              
              .result-copy {
                  width: 100%;
                  padding: 0.75rem;
              }
          }
      `;
  }