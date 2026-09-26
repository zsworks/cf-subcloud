# 前端依赖自托管副本

这些文件通过 esbuild 的 `vendorText` 插件以文本形式内联进页面（见 `esbuild.js`、
`src/core/page/page.js` 头部），不再从 jsdelivr CDN 加载——CDN 在部分网络环境下被阻断
时，同步 `<script src>` 会挂起，导致页面主脚本不执行、整页只剩静态骨架。

| 文件 | 包 | 版本 | 上游来源 |
|------|----|------|----------|
| `qrcode.min.js` | `@keeex/qrcodejs-kx` | 1.0.2 | `https://cdn.jsdelivr.net/npm/@keeex/qrcodejs-kx@1.0.2/qrcode.min.js` |
| `marked.min.js` | `marked` | 12.0.2 | `https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js` |
| `purify.min.js` | `dompurify` | 3.0.5 | `https://cdn.jsdelivr.net/npm/dompurify@3.0.5/dist/purify.min.js` |

升级时：下载新版本覆盖对应文件、更新本表版本号；内联前确认文件中不含 `</script>`
序列（会截断 HTML 中的 script 块）。
