# GavinHub

轻量级个人浏览器主页，纯 HTML / CSS / 原生 JS，无运行时依赖。

## 功能

- **双页布局**：主页（时钟 + 搜索）与应用页（快捷方式网格）
- **底部 Dock**：快速切换页面与常用链接
- **每日壁纸**：默认使用 Bing 每日壁纸 API，失败时回退本地图片
- **壁纸信息**：应用页右上角悬停显示壁纸标题与描述
- **日历与待办**：周/月视图、重复事项和长期目标
- **多端同步**：Edge 账号、JSON 文件或 GitHub Gist
- **本地持久化**：设置、快捷方式和待办均保存在浏览器本地

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
GavinHub/
├── index.html          # 入口
├── manifest.json       # Edge 扩展配置
├── css/                # 按首屏、Dock、应用页和弹窗拆分的样式
├── js/
│   ├── boot.js         # 轻量启动入口
│   ├── app.js          # 页面协调
│   ├── runtime.js      # 页面生命周期
│   ├── feature-registry.js # 可重试的功能懒加载
│   ├── style-registry.js   # 非阻塞样式激活
│   ├── clock.js        # 时钟
│   ├── wallpaper.js    # 壁纸加载
│   ├── wallpaper-effects.js # 毛玻璃层与预览缓存
│   ├── search-intelligence.js # 搜索智能解析懒加载边界
│   ├── shortcuts.js    # 快捷方式与 Dock
│   ├── calendar.js     # 日历与待办
│   ├── sync.js         # Edge / 文件同步
│   ├── github-sync.js  # GitHub Gist 同步
│   └── storage.js      # 本地存储
├── scripts/            # 检查与扩展打包
└── assets/             # 静态资源
```

## 自定义

- 修改 `js/shortcuts.js` 中的 `DEFAULT_SHORTCUTS` 和 `DEFAULT_DOCK` 自定义默认链接
- 在应用页点击「+」可添加新快捷方式
- 点击右上角齿轮可切换搜索引擎与壁纸来源

## 轻量化设计

- 零运行时依赖，无构建步骤
- 功能、页面、弹窗和样式拥有独立生命周期，可按需加载并在失败后重试
- 应用页样式和搜索智能解析按需加载，压低新标签页首屏解析成本
- 壁纸效果层拥有独立异步预览和可回收缓存，避免主线程同步图片编码
- 时钟每分钟更新一次，避免每秒渲染
- 图标优先使用字母占位，外链 favicon 懒加载
- 壁纸 API 请求失败自动降级，不阻塞页面

## 检查与打包

```bash
npm run check
```

该命令会运行架构与依赖审计、浏览器回归、帧性能审计、扩展打包和真实扩展加载测试。
