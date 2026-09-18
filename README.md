# deepseek-usage · DeepSeek 余额 & 峰谷计价

Hermes Desktop 插件：状态栏芯片实时显示 **DeepSeek API 余额**，右侧面板显示 **峰谷时段 / 切换倒计时 / 当前单价 / 消耗趋势**。

```
DS · ¥42.17 ❄️        ← 状态栏芯片（余额 + 峰谷标记）
```

## 功能

| 区域 | 内容 |
|------|------|
| 状态栏芯片 | `DS · ¥余额` + 🔥高峰 / ❄️空闲 标记，点击弹出完整工具提示 |
| 右侧面板 | 余额（总额 / 充值 / 赠送）、峰谷时段与倒计时、当前单价表、今日 / 近 7 日消耗趋势 |

- **余额**：调用 `GET https://api.deepseek.com/user/balance`，5 分钟缓存。
- **峰谷计价**：高峰为北京时间周一至周五 `9:00–12:00`、`14:00–18:00`，其余为空闲，空闲价 = 高峰价 × 0.5；面板给出距下次切换的倒计时。
- **消耗趋势**：每次拉取余额时自动写入快照（最小间隔 10 分钟、上限 2000 条），据此估算今日与近 7 日消耗。

## 安装

把 `deepseek-usage/` 整个目录放进 Hermes 的插件目录：

```
$HERMES_HOME/plugins/deepseek-usage/          # Windows 默认 AppData\Local\hermes\plugins\...
├── plugin.yaml
├── dashboard/          # 后端（FastAPI 路由）
│   ├── manifest.json
│   └── plugin_api.py
├── desktop/            # 前端（状态栏芯片 + 面板）
│   └── plugin.js
└── data/               # 运行时生成余额快照 balance_history.json
```

重启 Hermes 网关 / 桌面端后生效。

## 配置 API Key

插件**只从服务端读 key，绝不下发前端**。按以下任一种方式提供 `DEEPSEEK_API_KEY`：

1. 环境变量 `DEEPSEEK_API_KEY`
2. Hermes 环境文件 `$HERMES_HOME/.env`：

   ```
   DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxx
   ```

未配置时面板会显示 `DEEPSEEK_API_KEY not found`，不会崩溃。

## API 端点

挂载于 `/api/plugins/deepseek-usage/`：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/balance` | 余额 + 今日 / 近 7 日消耗（5 分钟缓存，自动快照） |
| GET | `/pricing` | 当前峰谷状态、切换时间与倒计时、价格表 |
| GET | `/history` | 余额快照历史（最多返回最近 500 点） |

`/balance` 返回示例：

```json
{
  "ok": true,
  "balance": 42.17,
  "currency": "CNY",
  "granted": 0.0,
  "topped_up": 42.17,
  "spent_today": 1.32,
  "spent_week": 8.05,
  "snapshots": 214,
  "checked_at": 1758268800.0
}
```

## 价格表（USD / 百万 tokens，空闲价；高峰 ×2）

| 模型 | 输入 | 输出 | 缓存读 |
|------|------|------|--------|
| deepseek-flash | 0.15 | 0.60 | 0.003 |
| deepseek-v4-pro | 0.66 | 1.98 | 0.022 |

> 快照日期 2026-09-10，来源为 DeepSeek 官方定价页。价格变动时请直接修改 `dashboard/plugin_api.py` 中的 `PRICES` 常量。

## 说明

- 峰谷规则与价格为**社区整理**，实际以 DeepSeek 官方文档为准；本插件仅作展示，不参与计费。
- 余额快照文件 `data/balance_history.json` 为本机运行数据，已在 `.gitignore` 中排除。

## License

MIT
