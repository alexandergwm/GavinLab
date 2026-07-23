# GavinHub — Edge 浏览器扩展

Gavin 的个人新标签页：时钟、搜索、快捷方式、壁纸与资讯。

## 方式一：加载解压缩扩展（开发）

1. 打开 Edge，地址栏输入 `edge://extensions` 并回车。
2. 左下角打开 **开发人员模式**。
3. 点击 **加载解压缩的扩展**（Load unpacked）。
4. 选择项目根目录（包含 `manifest.json` 的文件夹）。
5. 打开新标签页（`Cmd+T`），应看到 GavinHub。

修改代码后，在扩展卡片上点击 **重新加载**，再开新标签页即可看到变更。

## 方式二：打包安装（分发）

在项目根目录执行：

```bash
npm run package:extension
```

产物：

| 路径 | 说明 |
|------|------|
| `dist/gavinhub-edge/` | 可直接「加载解压缩的扩展」的文件夹 |
| `dist/gavinhub-edge.zip` | 同上内容的 zip，可解压后加载或存档 |

安装步骤与方式一相同，选择 `dist/gavinhub-edge/` 文件夹即可。

## 搜索框自动聚焦

Chromium / Edge **官方规定**：`chrome_url_overrides` 的新标签页焦点永远在地址栏，页面里的 `focus()` / `autofocus` 无效。

GavinHub 用 background 在同一个标签内把 NTP 壳页接管为普通扩展页 `index.html`，既让中间搜索框拿到光标，也避免关闭旧标签、创建新标签带来的闪动。

**副作用**：地址栏会显示 `chrome-extension://…/index.html`（这是唯一可靠方案的代价）。

## 新标签页 vs 主页

| 场景 | 是否自动 | 怎么设置 |
|------|----------|----------|
| **新标签页**（`Cmd+T` / `Ctrl+T`） | ✅ 扩展自动接管 | 装好并启用扩展即可 |
| **主页按钮** | ❌ 需手动 | 见下方 |
| **启动 Edge 时** | ❌ 需手动 | 见下方 |

### 获取扩展地址

1. 打开 `edge://extensions`，找到 **GavinHub**，复制 **ID**。
2. 扩展地址：`chrome-extension://<你的扩展ID>/index.html`

### 设置主页 / 启动页

`edge://settings` → **开始、主页和新标签页** → 添加 `chrome-extension://…/index.html`

## 权限说明

| 权限 | 用途 |
|------|------|
| `tabs` | 新标签页焦点修复：在同一标签内切换到可聚焦的普通扩展页 |
| `host_permissions`（`http(s)://*/*`） | 壁纸、天气、RSS、arXiv、GitHub 等网络请求 |

## 卸载

在 `edge://extensions` 中关闭或移除「GavinHub」即可恢复 Edge 默认新标签页。
