# Start Page

轻量级个人浏览器主页，纯 HTML / CSS / 原生 JS，无构建依赖。

## 功能

- **双页布局**：主页（时钟 + 搜索）与应用页（快捷方式网格）
- **底部 Dock**：快速切换页面与常用链接
- **每日壁纸**：默认使用 Bing 每日壁纸 API，失败时回退本地图片
- **壁纸信息**：应用页右上角悬停显示壁纸标题与描述
- **本地持久化**：设置、快捷方式、点赞数均存于 `localStorage`

## 快速开始

```bash
# 需要本地 HTTP 服务（ES Module 不支持 file:// 协议）
npx serve .
# 或
python3 -m http.server 8080
```

浏览器访问 `http://localhost:3000`（serve 默认端口）或 `http://localhost:8080`。

## Edge 扩展（新标签页）

可直接将本项目作为 Edge 解压缩扩展加载，覆盖新标签页。详见 [EXTENSION.md](./EXTENSION.md)。

## 设为浏览器主页

### Chrome / Edge
设置 → 外观 → 显示主页按钮 → 输入本地服务地址或部署后的 URL。

### 新标签页扩展

本项目自带 `manifest.json`，可按 [EXTENSION.md](./EXTENSION.md) 在 Edge 开发者模式下加载项目根目录。亦可配合 [Custom New Tab URL](https://chrome.google.com/webstore) 等扩展，将新标签指向本页面。

## 项目结构

```
StartPage/
├── index.html          # 入口
├── css/style.css       # 样式
├── js/
│   ├── app.js          # 主逻辑
│   ├── clock.js        # 时钟
│   ├── wallpaper.js    # 壁纸加载
│   ├── shortcuts.js    # 快捷方式与 Dock
│   └── storage.js      # 本地存储
└── assets/             # 静态资源
```

## 自定义

- 修改 `js/shortcuts.js` 中的 `DEFAULT_SHORTCUTS` 和 `DEFAULT_DOCK` 自定义默认链接
- 在应用页点击「+」可添加新快捷方式
- 点击右上角齿轮可切换搜索引擎与壁纸来源

## 轻量化设计

- 零 npm 依赖，无打包步骤
- 模块化 ES Module，按需拆分便于后续扩展
- 时钟每分钟更新一次，避免每秒渲染
- 图标优先使用字母占位，外链 favicon 懒加载
- 壁纸 API 请求失败自动降级，不阻塞页面
