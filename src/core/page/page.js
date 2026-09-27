import configs from './config.js';
// 三个前端库自托管内联（原 jsdelivr CDN 在部分网络被阻断会导致整页脚本不执行）
// 版本：qrcodejs-kx@1.0.2 / marked@12.0.2 / dompurify@3.0.5，更新见 vendor/README.md
import qrcodeLib from './vendor/qrcode.min.js';
import markedLib from './vendor/marked.min.js';
import purifyLib from './vendor/purify.min.js';

const KEY_DIALOG = `    <dialog id="keyDialog" style="border: none; border-radius: 1.2rem; padding: 1.5rem; box-shadow: var(--shadow-md); position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); margin: 0; width: min(22rem, calc(100vw - 3rem));">
        <p id="keyDialogMsg" style="font-size: 0.88rem; color: var(--text-dark); line-height: 1.6; margin-bottom: 1rem;"></p>
        <div style="position: relative; margin-bottom: 1.2rem;">
            <input type="password" id="keyDialogInput" placeholder="请输入访问口令"
                style="width: 100%; padding: 10px 40px 10px 14px; border: 1px solid var(--border-light); border-radius: 0.8rem; font-size: 0.9rem; outline: none; text-align: center;" />
            <span id="keyToggle" title="显示/隐藏口令"
                style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); cursor: pointer; width: 18px; height: 18px; color: #94a3b8; display: flex; align-items: center; justify-content: center;"></span>
        </div>
        <input type="text" id="keyDialogLabel" placeholder="备注（可选）"
            style="display: none; width: 100%; padding: 10px 14px; border: 1px solid var(--border-light); border-radius: 0.8rem; font-size: 0.9rem; outline: none; margin-bottom: 1.2rem; text-align: center;" />
        <div style="display: flex; justify-content: flex-end; gap: 8px;">
            <button id="keyDialogCancel"
                style="border: 1px solid var(--border-light); background: transparent; color: var(--text-muted); border-radius: 999px; padding: 6px 18px; font-size: 0.82rem; cursor: pointer;">取消</button>
            <button id="keyDialogOk"
                style="border: none; background: var(--primary); color: #fff; border-radius: 999px; padding: 6px 18px; font-size: 0.82rem; cursor: pointer;">确定</button>
        </div>
    </dialog>`;

const PAGE_STYLE = (img) => `    <style>        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        :root {
            --primary: #6366f1;
            --primary-dark: #4f46e5;
            --primary-soft: #818cf8;
            --accent: #22d3ee;
            --bg-glass: rgba(255, 255, 255, 0.75);
            --card-bg: rgba(255, 255, 255, 0.9);
            --text-dark: #0f172a;
            --text-muted: #475569;
            --border-light: #e2e8f0;
            --shadow-sm: 0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.02);
            --shadow-md: 0 20px 35px -12px rgba(0, 0, 0, 0.1);
            --success: #10b981;
            --error: #ef4444;
        }

        body {
            background: url(${img});
            font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, sans-serif;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
            position: relative;
        }

        body::before {
            content: "";
            position: fixed;
            inset: 0;
            background: radial-gradient(circle at 20% 40%, rgba(99, 102, 241, 0.12), transparent 50%);
            pointer-events: none;
        }

        .glass-container {
            max-width: 760px;
            width: 100%;
            background: var(--bg-glass);
            backdrop-filter: blur(16px);
            -webkit-backdrop-filter: blur(16px);
            border-radius: 2.5rem;
            padding: 1.8rem;
            box-shadow: var(--shadow-md), inset 0 1px 0 rgba(255, 255, 255, 0.6);
            border: 1px solid rgba(255, 255, 255, 0.4);
            transition: all 0.2s ease;
            z-index: 2;
        }

        .hero {
            text-align: center;
            margin-bottom: 2rem;
        }

        .hero h1 {
            font-size: 2.1rem;
            font-weight: 700;
            background: linear-gradient(135deg, var(--primary-dark), var(--accent));
            background-clip: text;
            -webkit-background-clip: text;
            color: transparent;
            letter-spacing: -0.3px;
        }

        .hero .badge {
            display: inline-block;
            background: rgba(99, 102, 241, 0.12);
            backdrop-filter: blur(4px);
            border-radius: 40px;
            padding: 4px 12px;
            font-size: 0.75rem;
            font-weight: 500;
            color: var(--primary-dark);
            margin-top: 8px;
        }

        .mode-panel {
            display: none;
            animation: fadeSlideUp 0.25s ease-out;
        }

        .mode-panel.active {
            display: block;
        }

        @keyframes fadeSlideUp {
            from {
                opacity: 0;
                transform: translateY(8px);
            }

            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        .form-card {
            background: var(--card-bg);
            border-radius: 1.75rem;
            padding: 1.25rem 1.5rem;
            margin-bottom: 1.5rem;
            border: 1px solid var(--border-light);
            transition: box-shadow 0.2s;
        }

        .form-card:hover {
            box-shadow: var(--shadow-sm);
        }

        .section-title {
            font-size: 0.9rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: var(--text-muted);
            margin-bottom: 1rem;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        /* 模板选择器 */
        .template-trigger {
            display: flex;
            justify-content: space-between;
            align-items: center;
            background: #f8fafc;
            border: 1.5px solid var(--border-light);
            border-radius: 1.25rem;
            padding: 12px 16px;
            font-size: 0.9rem;
            cursor: pointer;
            transition: all 0.2s;
        }

        .template-trigger span:first-child {
            color: var(--text-dark);
            font-weight: 500;
        }

        .template-trigger span:last-child {
            color: var(--primary);
            font-weight: 500;
        }

        .template-dropdown {
            margin-top: 8px;
            background: white;
            border-radius: 1.25rem;
            border: 1px solid var(--border-light);
            max-height: 280px;
            overflow-y: auto;
            box-shadow: 0 8px 20px rgba(0, 0, 0, 0.08);
            display: none;
        }

        .template-dropdown.open {
            display: block;
            animation: fadeSlideUp 0.15s;
        }

        .template-group {
            padding: 6px 0;
        }

        .template-group-header {
            font-size: 0.7rem;
            font-weight: 700;
            padding: 8px 16px 4px;
            color: #6c757d;
            letter-spacing: 0.5px;
            background: #f9fafb;
            position: sticky;
            top: 0;
            z-index: 1;
        }

        .template-opt {
            padding: 10px 20px;
            cursor: pointer;
            transition: background 0.1s;
            font-size: 0.85rem;
            border-left: 3px solid transparent;
        }

        .template-opt:hover {
            background: #f1f5f9;
        }

        .template-opt.selected {
            background: #eef2ff;
            border-left-color: var(--primary);
            font-weight: 500;
            color: var(--primary-dark);
        }

        .links-area {
            margin-top: 12px;
        }

        .link-row {
            display: flex;
            gap: 12px;
            margin-bottom: 12px;
            align-items: center;
        }

        .link-input {
            flex: 1;
            min-width: 0;
            padding: 12px 14px;
            border: 1.5px solid var(--border-light);
            border-radius: 1.25rem;
            font-size: 0.85rem;
            transition: 0.2s;
            background: white;
        }

        .link-input:focus {
            outline: none;
            border-color: var(--primary);
            box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2);
        }

        .add-btn-circle {
            width: 44px;
            height: 44px;
            border: 1.5px solid rgba(34, 197, 94, 0.35);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            flex-shrink: 0;
            transition: all 0.2s;
            background: #fff;
            user-select: none;
        }

        .add-btn-circle:hover {
            transform: scale(1.03);
            background: #f0fdf4;
        }

        .checkbox-group {
            display: flex;
            flex-wrap: wrap;
            gap: 12px;
            margin-top: 8px;
        }

        .checkbox-group label {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 0.85rem;
            background: #f1f5f9;
            padding: 6px 14px;
            border-radius: 40px;
            cursor: pointer;
            transition: all 0.1s;
        }

        .checkbox-group label:hover {
            background: #e2e8f0;
        }

        .checkbox-group input {
            accent-color: var(--primary);
            width: 16px;
            height: 16px;
            margin: 0;
        }

        .generate-btn {
            width: 100%;
            padding: 14px;
            background: linear-gradient(105deg, var(--primary), var(--primary-dark));
            border: none;
            border-radius: 2rem;
            font-weight: 700;
            font-size: 1rem;
            color: white;
            cursor: pointer;
            transition: all 0.2s;
            margin-top: 6px;
            margin-bottom: 20px;
            box-shadow: 0 10px 15px -6px rgba(79, 70, 229, 0.4);
        }

        .generate-btn:hover {
            transform: translateY(-2px);
            filter: brightness(1.02);
        }

        .result-card {
            background: #ffffffdd;
            backdrop-filter: blur(8px);
            border-radius: 1.5rem;
            padding: 0.2rem 0 0.8rem 0;
        }

        .result-header {
            display: flex;
            justify-content: space-between;
            align-items: baseline;
            padding: 12px 18px 6px 18px;
            font-size: 0.85rem;
            font-weight: 600;
            color: var(--text-muted);
            letter-spacing: normal;
            flex-wrap: wrap;
        }

        .result-header span:first-child {
            font-size: 0.85rem;
            font-weight: 600;
            white-space: nowrap;
        }

        /* 已保存订阅列表 */
        .saved-list {
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
        }

        .saved-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            padding: 10px 14px;
            background: rgba(99, 102, 241, 0.06);
            border: 1px solid var(--border-light);
            border-radius: 0.9rem;
            flex-wrap: wrap;
        }

        .saved-item.editing {
            border-color: var(--primary);
            background: rgba(99, 102, 241, 0.12);
        }

        .saved-info {
            display: flex;
            align-items: center;
            gap: 8px;
            flex-wrap: wrap;
            font-size: 0.82rem;
            color: var(--text-dark);
            min-width: 0;
        }

        .saved-mode {
            background: var(--primary);
            color: #fff;
            padding: 2px 10px;
            border-radius: 999px;
            font-size: 0.72rem;
            font-weight: 600;
            white-space: nowrap;
        }

        /* 订阅代码徽标：描边样式，与实底 .saved-mode 区分 */
        .src-code-chip {
            border: 1px solid var(--primary);
            color: var(--primary-dark);
            padding: 1px 9px;
            border-radius: 999px;
            font-size: 0.72rem;
            font-weight: 700;
            white-space: nowrap;
            font-family: monospace;
        }

        .saved-code {
            font-family: monospace;
            color: var(--primary-dark);
            font-size: 0.8rem;
        }

        .saved-meta {
            color: var(--text-muted);
            font-size: 0.75rem;
        }

        .saved-actions {
            display: flex;
            gap: 6px;
        }

        .saved-btn {
            border: 1px solid var(--primary-soft);
            color: var(--primary-dark);
            border-radius: 999px;
            padding: 4px 12px;
            font-size: 0.75rem;
            cursor: pointer;
            transition: all 0.2s;
            background: transparent;
            white-space: nowrap;
        }

        .saved-btn:hover {
            background: var(--primary);
            color: #fff;
        }

        .saved-btn-danger {
            border-color: #fca5a5;
            color: var(--error);
        }

        .saved-btn-danger:hover {
            background: var(--error);
            color: #fff;
        }

        .saved-pagination {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 14px;
            margin-top: 0.9rem;
            font-size: 0.8rem;
            color: var(--text-muted);
        }

        .saved-page-btn {
            color: var(--primary-dark);
            cursor: pointer;
            user-select: none;
            padding: 2px 8px;
        }

        .saved-page-btn:hover {
            text-decoration: underline;
        }

        .saved-page-btn.disabled {
            color: var(--border-light);
            cursor: default;
            text-decoration: none;
        }

        #keyToggle:hover {
            color: var(--primary-dark);
        }

        .copy-hint {
            cursor: pointer;
            background: rgba(99, 102, 241, 0.08);
            padding: 4px 12px;
            border-radius: 40px;
            font-size: 0.7rem;
            font-weight: 500;
            transition: 0.1s;
        }

        .copy-hint:hover {
            background: rgba(99, 102, 241, 0.2);
        }

        #result {
            background: #fefefe;
            border: 1px solid var(--border-light);
            border-radius: 1.25rem;
            padding: 14px 18px;
            font-family: 'SF Mono', 'Fira Code', monospace;
            font-size: 0.8rem;
            width: 100%;
            cursor: pointer;
            word-break: break-all;
            margin: 0 0 6px 0;
            line-height: 1.4;
        }

        #qrcode {
            display: flex;
            justify-content: center;
            padding: 12px 0 6px;
            margin-top: 4px;
            border-top: 1px dashed var(--border-light);
        }

        .hidden-qr {
            display: none;
        }

        .tip-icon-sm {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            background: var(--primary-soft);
            color: white;
            width: 20px;
            height: 20px;
            border-radius: 30px;
            font-size: 12px;
            font-weight: bold;
            cursor: pointer;
            margin-left: 6px;
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
        }

        .tip-pop {
            position: relative;
            display: inline-block;
        }

        .tip-content {
            position: absolute;
            top: 28px;
            left: -20px;
            width: 300px;
            background: white;
            border-radius: 20px;
            padding: 16px;
            font-size: 0.8rem;
            box-shadow: 0 15px 35px rgba(0, 0, 0, 0.2);
            border: 1px solid var(--border-light);
            z-index: 30;
            opacity: 0;
            visibility: hidden;
            transition: 0.15s;
            pointer-events: none;
            color: var(--text-dark);
            line-height: 1.5;
            text-align: left;
        }

        .tip-content p,
        .tip-content ul,
        .tip-content ol,
        .tip-content h1,
        .tip-content h2,
        .tip-content h3,
        .tip-content h4,
        .tip-content blockquote {
            margin: 0 0 8px 0;
            padding-left: 0;
        }

        .tip-content ul,
        .tip-content ol {
            padding-left: 20px;
        }

        .tip-content li {
            margin-bottom: 4px;
        }

        .tip-content h2,
        .tip-content h3 {
            font-size: 0.9rem;
            font-weight: 700;
            margin-top: 8px;
            margin-bottom: 6px;
        }

        .tip-content strong,
        .tip-content b {
            color: var(--primary-dark);
        }

        .tip-pop.active .tip-content {
            opacity: 1;
            visibility: visible;
            pointer-events: auto;
        }

        .tip-content a {
            color: var(--primary);
        }

        .github-corner {
            position: fixed;
            top: 0px;
            right: 0px;
            z-index: 50;
        }

        .beian {
            text-align: center;
            font-size: 0.7rem;
            padding-top: 1rem;
            color: #6c757d;
        }

        .row-tool-btn {
            width: 44px;
            height: 44px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            font-size: 1.05rem;
            flex-shrink: 0;
            user-select: none;
        }
        .save-btn-circle { border: 1.5px solid var(--border-light); color: var(--primary); background: #fff; }
        .save-btn-circle:active { transform: scale(0.92); }
        .src-caret-btn { border: 1.5px solid var(--border-light); color: var(--text-muted); background: #fff; font-size: 1.1rem; }
        .src-chip {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: rgba(99, 102, 241, 0.1);
            color: var(--primary);
            border-radius: 999px;
            padding: 5px 12px;
            font-size: 0.8rem;
            font-weight: 600;
            max-width: 100%;
        }
        .src-remove-btn { border: 1.5px solid rgba(239, 90, 90, 0.35); background: #fff; }
        .src-dd {
            position: absolute;
            z-index: 30;
            background: #fff;
            border: 1px solid var(--border-light);
            border-radius: 0.8rem;
            box-shadow: var(--shadow-md);
            max-height: 200px;
            overflow-y: auto;
            min-width: 160px;
        }
        .src-dd-item { padding: 8px 14px; font-size: 0.82rem; cursor: pointer; }
        .src-dd-item:hover { background: rgba(99, 102, 241, 0.08); }

        @media (max-width: 560px) {
            .glass-container {
                padding: 1.2rem;
            }

            .checkbox-group label {
                font-size: 0.75rem;
                padding: 4px 12px;
            }

            .result-header span:first-child {
                white-space: normal;
                font-size: 0.8rem;
            }
        }

        .home-nav {
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 14px;
            margin: 2px 0 6px;
        }

        .home-nav-link {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 9px 22px;
            border-radius: 999px;
            background: rgba(99, 102, 241, 0.08);
            color: var(--primary-dark);
            font-size: 0.88rem;
            font-weight: 600;
            text-decoration: none;
            border: 1px solid rgba(99, 102, 241, 0.25);
            transition: all 0.2s;
        }

        .home-nav-link:hover {
            background: var(--primary);
            color: #fff;
            transform: translateY(-1px);
            box-shadow: 0 4px 10px rgba(99, 102, 241, 0.3);
        }

        .page-back {
            text-align: center;
            margin: 0 0 10px;
        }

        .page-back a {
            color: var(--text-muted);
            font-size: 0.85rem;
            text-decoration: none;
        }

        .page-back a:hover {
            color: var(--primary);
        }
    </style>`;

export async function getFakePage(e) {
    let configData = JSON.parse(configs(e.tplmh, e.tplsb));
    if (e.templateBaseUrl) {
        try {
            const res = await fetch(`${e.templateBaseUrl}/templates.json`);
            if (res.ok) {
                const externalTemplates = await res.json();
                for (const [target, templates] of Object.entries(externalTemplates)) {
                    if (configData[target]) {
                        configData[target].templates = templates;
                    }
                }
            }
        } catch (_) {}
    }
    const configJson = JSON.stringify(configData);

    if (e.view === 'saved') return savedPageHtml(e, configJson);
    if (e.view === 'sources') return sourcesPageHtml(e);
    return homePageHtml(e, configJson);
}

function homePageHtml(e, configJson) {
    return `
<!DOCTYPE html>
<html lang="zh-CN">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>⚡</text></svg>">
    <title>星尘配置转换 · 订阅转换</title>
    <script>${qrcodeLib}</script>
    <script>${markedLib}</script>
    <script>${purifyLib}</script>
    ${PAGE_STYLE(e.IMG)}
</head>

<body>

    <div class="glass-container">
        <div class="hero">
            <h1>⚡ 星尘转换器</h1>
            <div class="badge">多合一订阅</div>
        </div>

        <!-- 列表页导航 -->
        <div class="home-nav">
            <a class="home-nav-link" href="/saved">📚 已保存订阅</a>
            <a class="home-nav-link" href="/sources">🗃️ 原始订阅库</a>
        </div>

        <!-- 模式选择器 - 与模板选择器样式一致 -->
        <div class="form-card">
            <div class="section-title">📱 选择客户端类型</div>
            <div class="template-trigger" id="modeTrigger">
                <span>当前客户端</span>
                <span id="selectedModeLabel">Clash(mihomo)</span>
            </div>
            <div class="template-dropdown" id="modeDropdown"></div>
        </div>

        <div id="panelsContainer"></div>

        <!-- 结果区 -->
        <div class="result-card">
            <div class="result-header">
                <span>📋 订阅地址 (点击输入框复制)</span>
                <span style="display: flex; gap: 10px;">
                    <span class="copy-hint" id="saveContentBtn">🔒 保存订阅内容</span>
                    <span class="copy-hint" id="copyToastBtn">📎 一键复制</span>
                </span>
            </div>
            <input type="text" id="result" readonly onclick="copyToClipboard()">
            <div id="qrcode" class="hidden-qr"></div>
        </div>
        <div class="beian">
            <a href="${e.beianurl}" style="color: var(--primary-dark); text-decoration: none;">${e.beian}</a>
        </div>
    </div>

    ${KEY_DIALOG}

    <dialog id="nameDialog" style="border: none; border-radius: 1.2rem; padding: 1.5rem; box-shadow: var(--shadow-md); position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); margin: 0; width: min(22rem, calc(100vw - 3rem));">
        <p id="nameDialogMsg" style="font-size: 0.88rem; color: var(--text-dark); line-height: 1.6; margin-bottom: 1rem;"></p>
        <input type="text" id="nameDialogInput" placeholder="输入简短名称（如：机场A）"
            style="width: 100%; padding: 10px 14px; border: 1px solid var(--border-light); border-radius: 0.8rem; font-size: 0.9rem; outline: none; text-align: center; margin-bottom: 0.7rem;" />
        <input type="text" id="nameDialogCodeInput" placeholder="订阅代码（可选，如：YT，合并时作节点名前缀）"
            style="width: 100%; padding: 10px 14px; border: 1px solid var(--border-light); border-radius: 0.8rem; font-size: 0.9rem; outline: none; text-align: center; margin-bottom: 1.2rem;" />
        <div style="display: flex; justify-content: flex-end; gap: 8px;">
            <button id="nameDialogCancel"
                style="border: 1px solid var(--border-light); background: transparent; color: var(--text-muted); border-radius: 999px; padding: 6px 18px; font-size: 0.82rem; cursor: pointer;">取消</button>
            <button id="nameDialogOk"
                style="border: none; background: var(--primary); color: #fff; border-radius: 999px; padding: 6px 18px; font-size: 0.82rem; cursor: pointer;">确定</button>
        </div>
    </dialog>

    <a href="https://github.com/Kwisma/cf-SubCloud" target="_blank" class="github-corner" aria-label="GitHub">
        <svg width="48" height="48" viewBox="0 0 250 250" style="fill:#6366f1; color:white;">
            <path d="M0,0 L115,115 L130,115 L142,142 L250,250 L250,0 Z"></path>
            <path
                d="M128.3,109.0 C113.8,99.7 119.0,89.6 119.0,89.6 C122.0,82.7 120.5,78.6 120.5,78.6 C119.2,72.0 123.4,76.3 123.4,76.3 C127.3,80.9 125.5,87.3 125.5,87.3 C122.9,97.6 130.6,101.9 134.4,103.2"
                fill="currentColor" class="octo-arm"></path>
            <path
                d="M115.0,115.0 C114.9,115.1 118.7,116.5 119.8,115.4 L133.7,101.6 C136.9,99.2 139.9,98.4 142.2,98.6 C133.8,88.0 127.5,74.4 143.8,58.0 C148.5,53.4 154.0,51.2 159.7,51.0 C160.3,49.4 163.2,43.6 171.4,40.1 C171.4,40.1 176.1,42.5 178.8,56.2 C183.1,58.6 187.2,61.8 190.9,65.4 C194.5,69.0 197.7,73.2 200.1,77.6 C213.8,80.2 216.3,84.9 216.3,84.9 C212.7,93.1 206.9,96.0 205.4,96.6 C205.1,102.4 203.0,107.8 198.3,112.5 C181.9,128.9 168.3,122.5 157.7,114.1 C157.9,116.9 156.7,120.9 152.7,124.9 L141.0,136.5 C139.8,137.7 141.6,141.9 141.8,141.8 Z"
                fill="currentColor" class="octo-body"></path>
        </svg>
    </a>

    <script>
        const MODES_META = ${configJson};

        let currentMode = 'mihomo';

        function updateResultAndQR(url) {
            const resultInput = document.getElementById('result');
            resultInput.value = url || '';
            const qrContainer = document.getElementById('qrcode');
            if (url && url.trim() !== "") {
                qrContainer.classList.remove('hidden-qr');
                qrContainer.innerHTML = "";
                new QRCode(qrContainer, {
                    text: url,
                    width: 200,
                    height: 200,
                    colorDark: "#4f46e5",
                    colorLight: "#ffffff",
                    correctLevel: QRCode.CorrectLevel.M
                });
            } else {
                qrContainer.classList.add('hidden-qr');
                qrContainer.innerHTML = "";
            }
        }

        window.copyToClipboard = function () {
            const val = document.getElementById('result').value;
            if (!val) return;
            navigator.clipboard.writeText(val).then(() => {
                showToast('✓ 已复制到剪贴板', 'success');
            }).catch(() => alert("手动复制链接"));
        };

        document.getElementById('copyToastBtn')?.addEventListener('click', () => window.copyToClipboard());

        // ===== 密钥弹窗（保存时可附带备注） =====
        const EYE_ICON =
            '<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>';
        const EYE_OFF_ICON =
            '<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/></svg>';

        function setKeyToggle(shown) {
            const toggle = document.getElementById('keyToggle');
            if (toggle) toggle.innerHTML = shown ? EYE_OFF_ICON : EYE_ICON;
        }

        function askKey(message, btnText = '确定', opts = {}) {
            return new Promise((resolve) => {
                const dlg = document.getElementById('keyDialog');
                const msg = document.getElementById('keyDialogMsg');
                const input = document.getElementById('keyDialogInput');
                const labelInput = document.getElementById('keyDialogLabel');
                const ok = document.getElementById('keyDialogOk');
                const cancel = document.getElementById('keyDialogCancel');
                msg.innerText = message;
                ok.innerText = btnText;
                input.value = '';
                input.type = 'password';
                setKeyToggle(false);
                labelInput.style.display = opts.withLabel ? 'block' : 'none';
                labelInput.value = opts.labelValue || '';
                let settled = false;
                const done = (val) => {
                    if (settled) return;
                    settled = true;
                    dlg.onclose = null;
                    ok.onclick = null;
                    cancel.onclick = null;
                    input.onkeydown = null;
                    dlg.close();
                    resolve(val);
                };
                ok.onclick = () => {
                    const key = input.value.trim() || null;
                    done(key ? { key, label: labelInput.value.trim() } : null);
                };
                cancel.onclick = () => done(null);
                dlg.onclose = () => done(null);
                input.onkeydown = (ev) => {
                    if (ev.key === 'Enter') {
                        const key = input.value.trim() || null;
                        done(key ? { key, label: labelInput.value.trim() } : null);
                    }
                };
                dlg.showModal();
                setTimeout(() => input.focus(), 50);
            });
        }

        // 口令的 base64 编码（UTF-8 安全），用于短链接 ?key= 参数
        function b64EncodeKey(str) {
            return btoa(String.fromCharCode(...new TextEncoder().encode(str)));
        }

        // ===== 保存订阅内容（服务端环境变量密钥加密） =====
        async function saveEncryptedContent() {
            if (!window.lastGen) {
                showToast('✗ 请先生成订阅链接', 'error');
                return;
            }
            const res = (await askKey(
                '订阅配置将由服务端加密保存（仅本应用可解密）。请设置访问口令：访问/修改该短链接时需要提供，口令哈希存储于服务器，忘记后将无法找回。',
                '保存',
                { withLabel: true, labelValue: editingLabel }
            )) || {};
            const { key, label } = res;
            if (!key) return;
            try {
                showToast('⏳ 正在保存订阅配置…', 'success');
                const resp = await fetch('/api/short', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        ...window.lastGen,
                        key,
                        label: label || '',
                        ...(editingCode ? { code: editingCode, oldKey: editingOldKey } : {}),
                    }),
                });
                const data = await resp.json();
                if (!resp.ok || !data.success) {
                    throw new Error(typeof data === 'string' ? data : data.error || '保存失败');
                }
                editingCode = data.code;
                editingLabel = label || '';
                editingOldKey = key;
                const shortUrl = \`\${window.location.origin}/s/\${data.code}?key=\${b64EncodeKey(key)}\`;
                updateResultAndQR(shortUrl);
                navigator.clipboard.writeText(shortUrl).then(() => {
                    showToast('✓ 已加密保存，短链接（含访问口令）已复制', 'success');
                }).catch(() => {
                    showToast('✓ 已加密保存，短链接已生成', 'success');
                });
            } catch (err) {
                showToast(\`✗ \${err.message}\`, 'error');
            }
        }

        document.getElementById('saveContentBtn')?.addEventListener('click', () => saveEncryptedContent());

        // 密钥输入框显示/隐藏切换
        document.getElementById('keyToggle')?.addEventListener('click', () => {
            const input = document.getElementById('keyDialogInput');
            const show = input.type === 'password';
            input.type = show ? 'text' : 'password';
            setKeyToggle(show);
            input.focus();
        });
        setKeyToggle(false);

        // ===== 编辑状态（?edit= 载入后保存更新原短链） =====
        let editingCode = null;
        let editingLabel = '';
        // 修改回填时已验证的原密钥，保存更新时作为 oldKey 提交
        let editingOldKey = '';

        // 解锁条目：口令交服务端 HMAC 校验并解密，明文配置仅回传表单所需字段
        async function unlockEntry(code, message, btnText) {
            const { key } = (await askKey(message, btnText)) || {};
            if (!key) return null;
            const resp = await fetch(\`/api/short/get?code=\${code}&key=\${encodeURIComponent(b64EncodeKey(key))}\`).then((x) => x.json());
            if (!resp.success) {
                throw new Error(typeof resp === 'string' ? resp : resp.error || '获取失败');
            }
            return { key, resp };
        }

        // 将保存的配置回填到表单（resp = /api/short/get 响应）
        function fillFormFromParams(resp) {
            const modeId = resp.target;
            if (!MODES_META[modeId]) return;
            const modeOpt = document.querySelector(\`#modeDropdown .template-opt[data-mode-id="\${modeId}"]\`);
            if (modeOpt) modeOpt.click();

            const wrapper = document.getElementById(\`links-wrapper-\${modeId}\`);
            if (wrapper) {
                wrapper.innerHTML = '';
                (resp.sources || []).forEach((s) => {
                    if (!s.name) {
                        showToast(\`⚠️ 原始订阅（\${String(s.id).slice(0, 8)}…）已删除，已跳过\`, 'error');
                        return;
                    }
                    addLinkRow(\`links-wrapper-\${modeId}\`, modeId);
                    const row = wrapper.lastElementChild;
                    setRowSource(row, s, { autoAppend: false });
                });
                (resp.rawUrls || []).forEach(() => addLinkRow(\`links-wrapper-\${modeId}\`, modeId));
                const inputs = wrapper.querySelectorAll('.dynamic-link-input');
                let idx = 0;
                (resp.rawUrls || []).forEach((u) => {
                    if (inputs[idx]) inputs[idx++].value = u;
                });
                const lastRow = wrapper.lastElementChild;
                if (lastRow) ensureTrailingEmptyRow(lastRow);
            }
            const params = resp.params || {};

            const container = document.getElementById(\`panel-\${modeId}\`);
            if (!container) return;

            container.querySelectorAll('.template-opt').forEach((o) => o.classList.remove('selected'));
            const label = document.getElementById(\`selectedLabel-\${modeId}\`);
            if (params.template && label) {
                const opt = container.querySelector(\`.template-opt[data-value="\${CSS.escape(params.template)}"]\`);
                if (opt) {
                    opt.classList.add('selected');
                    label.innerText = opt.innerText;
                } else {
                    label.innerText = '未匹配模板';
                }
            } else if (label) {
                label.innerText = '未选择 (默认)';
            }

            container.querySelectorAll('.proto-check').forEach((cb) => {
                cb.checked = params[cb.value] === 'true';
            });
            container.querySelectorAll('.proto-select').forEach((sel) => {
                sel.value = params[sel.getAttribute('data-proto')] || '';
            });
        }


        // ===== 原始订阅库管理 =====

        async function generateConfigForMode(modeId) {
            const container = document.getElementById(\`panel-\${modeId}\`);
            if (!container) return;
            const { sources, rawUrls } = collectLinkRows(container);
            let templateVal = '';
            const selectedTmpl = container.querySelector('.template-opt.selected');
            if (selectedTmpl) templateVal = selectedTmpl.dataset.value;
            // 获取 checkbox 参数
            const checkboxes = container.querySelectorAll('.proto-check');
            const protocolParams = {};
            checkboxes.forEach(cb => { protocolParams[cb.value] = cb.checked; });
            // 获取所有下拉框的值（通用）
            const selects = container.querySelectorAll('.proto-select');
            selects.forEach(select => {
                const protoName = select.getAttribute('data-proto');
                if (select.value) {
                    protocolParams[protoName] = select.value;
                }
            });
            if (!sources.length && !rawUrls.length) {
                alert('请至少填写一个订阅链接或选择一个已保存的原始订阅');
                return;
            }

            const origin = window.location.origin;
            const params = new URLSearchParams();
            if (templateVal) params.set('template', templateVal);
            params.set('target', modeId);
            // 统一设置参数
            for (const [key, value] of Object.entries(protocolParams)) {
                if (value === true) {
                    params.set(key, 'true');
                } else if (typeof value === 'string' && value) {
                    params.set(key, value);
                }
            }

            // 生成的完整参数（保存短链用）；直接链接仅由裸 URL 构成（已入库源以名称提示）
            window.lastGen = { sources: sources.map((s) => s.id), rawUrls, target: modeId, params: Object.fromEntries(params.entries()) };
            let fullUrl = '';
            if (!sources.length) {
                const displayParams = new URLSearchParams(params);
                displayParams.set('url', rawUrls.join(','));
                fullUrl = \`\${origin}/?\${displayParams.toString()}\`;
            } else {
                fullUrl = \`\${origin}/?target=\${modeId}&src=\${encodeURIComponent(sources.map((s) => s.name).join(','))}\`;
                showToast('含已入库订阅源，直接链接不可用，请使用「🔒 保存订阅内容」生成短链接', 'success');
            }

            updateResultAndQR(fullUrl);

            if (fullUrl) {
                navigator.clipboard.writeText(fullUrl).then(() => {
                    showToast('✓ 订阅链接已复制到剪贴板', 'success');
                }).catch(() => {
                    showToast('✗ 复制失败，请手动复制', 'error');
                });
            }
        }

        function showToast(message, type = 'success') {
            const toast = document.createElement('div');
            toast.innerText = message;
            toast.style.position = 'fixed';
            toast.style.bottom = '20px';
            toast.style.left = '50%';
            toast.style.transform = 'translateX(-50%)';
            toast.style.background = type === 'success' ? '#10b981' : '#ef4444';
            toast.style.color = 'white';
            toast.style.padding = '10px 24px';
            toast.style.borderRadius = '40px';
            toast.style.fontSize = '0.85rem';
            toast.style.zIndex = '999';
            toast.style.fontWeight = 'bold';
            toast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 2000);
        }

        // 名称输入弹窗（原始订阅入库用；第二个输入框为可选订阅代码）
        function askName(message, prefill = '', codePrefill = '') {
            return new Promise((resolve) => {
                const dlg = document.getElementById('nameDialog');
                const msg = document.getElementById('nameDialogMsg');
                const input = document.getElementById('nameDialogInput');
                const codeInput = document.getElementById('nameDialogCodeInput');
                const ok = document.getElementById('nameDialogOk');
                const cancel = document.getElementById('nameDialogCancel');
                msg.innerText = message;
                input.value = prefill;
                codeInput.value = codePrefill;
                let settled = false;
                const done = (val) => {
                    if (settled) return;
                    settled = true;
                    ok.onclick = null;
                    cancel.onclick = null;
                    input.onkeydown = null;
                    codeInput.onkeydown = null;
                    dlg.close();
                    resolve(val);
                };
                const submit = () => {
                    const name = input.value.trim();
                    if (!name) return;
                    done({ name, code: codeInput.value.trim() });
                };
                ok.onclick = submit;
                cancel.onclick = () => done(null);
                input.onkeydown = (ev) => { if (ev.key === 'Enter') codeInput.focus(); };
                codeInput.onkeydown = (ev) => { if (ev.key === 'Enter') submit(); };
                dlg.showModal();
                setTimeout(() => input.focus(), 50);
            });
        }

        // 行 → 已入库标签态（表单持有 id，URL 不落表单）
        // 已选源的行只保留一个红色减号：从列表中移除该行
        // 行内容提交（选源/输入完成）后，若该行是末行且有内容，自动补一个空输入行
        function ensureTrailingEmptyRow(row) {
            const wrapper = row.parentNode;
            if (!wrapper || !wrapper.id || !wrapper.id.startsWith('links-wrapper-')) return;
            const rows = wrapper.querySelectorAll('.link-row');
            if (rows[rows.length - 1] !== row) return;
            const hasContent = row.dataset.sourceId || (row.querySelector('.dynamic-link-input')?.value.trim() || '');
            if (hasContent) addLinkRow(wrapper.id, wrapper.id.replace('links-wrapper-', ''));
        }

        function setRowSource(row, src, opts = {}) {
            row.dataset.sourceId = src.id;
            row.dataset.sourceName = src.name;
            const input = row.querySelector('.dynamic-link-input');
            input.style.display = 'none';
            const chip = document.createElement('span');
            chip.className = 'src-chip';
            const label = document.createElement('span');
            label.innerText = \`🗃️ \${src.name}\`;
            chip.append(label);
            input.insertAdjacentElement('afterend', chip);
            for (const cls of ['.src-caret-btn', '.save-btn-circle', '.add-btn-circle']) {
                const b = row.querySelector(cls);
                if (b) b.style.display = 'none';
            }
            const rm = row.querySelector('.src-remove-btn');
            if (rm) rm.style.display = '';
            if (opts.autoAppend !== false) ensureTrailingEmptyRow(row);
        }

        // 汇总行状态：已入库源 + 裸 URL
        function collectLinkRows(wrapper) {
            const sources = [];
            const rawUrls = [];
            wrapper.querySelectorAll('.link-row').forEach((row) => {
                if (row.dataset.sourceId) {
                    sources.push({ id: row.dataset.sourceId, name: row.dataset.sourceName });
                } else {
                    const v = row.querySelector('.dynamic-link-input')?.value.trim();
                    if (v) rawUrls.push(v);
                }
            });
            return { sources, rawUrls };
        }

        // 💾 保存当前行 URL 到原始订阅库（保存即实时拉取上游）
        async function saveRowToLibrary(row) {
            const input = row.querySelector('.dynamic-link-input');
            const url = input.value.trim();
            if (!/^https?:\\/\\//.test(url)) {
                showToast('✗ 请先输入有效的订阅链接', 'error');
                return;
            }
            const picked = await askName('将实时拉取该订阅内容并加密保存到服务器，请输入一个简短名称以便后续选用。订阅代码可选，合并多个订阅时节点名会变为「代码_节点名」。');
            if (!picked) return;
            try {
                showToast('⏳ 正在拉取并保存原始订阅…', 'success');
                const resp = await fetch('/api/source/save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url, name: picked.name, code: picked.code, target: currentMode }),
                });
                const data = await resp.json();
                if (!resp.ok || !data.success) throw new Error(typeof data === 'string' ? data : data.error || '保存失败');
                setRowSource(row, { id: data.id, name: data.name });
                loadSourceLibrary();
                showToast(\`✓ 已保存原始订阅「\${data.name}」\`, 'success');
            } catch (err) {
                showToast(\`✗ \${err.message || '保存失败'}\`, 'error');
            }
        }

        // ▾ 下拉选择已保存的原始订阅（仅显示名称，URL 不出服务端）
        async function openSourceDropdown(row) {
            document.querySelectorAll('.src-dd').forEach((d) => d.remove());
            const dd = document.createElement('div');
            dd.className = 'src-dd';
            dd.innerHTML = '<div style="padding:8px 14px;color:var(--text-muted);font-size:0.78rem;">加载中…</div>';
            document.body.appendChild(dd);
            const rect = row.getBoundingClientRect();
            dd.style.top = \`\${window.scrollY + rect.bottom + 4}px\`;
            dd.style.left = \`\${window.scrollX + rect.left}px\`;
            const close = (ev) => {
                if (!dd.contains(ev.target)) {
                    dd.remove();
                    document.removeEventListener('click', close);
                }
            };
            setTimeout(() => document.addEventListener('click', close), 0);
            try {
                const resp = await fetch('/api/source/list');
                const data = await resp.json();
                if (!resp.ok || !data.success) throw new Error(data.error || '加载失败');
                dd.innerHTML = '';
                const items = data.items || [];
                if (!items.length) {
                    dd.innerHTML = '<div style="padding:8px 14px;color:var(--text-muted);font-size:0.78rem;">暂无已保存的原始订阅</div>';
                    return;
                }
                items.forEach((s) => {
                    const item = document.createElement('div');
                    item.className = 'src-dd-item';
                    item.innerText = \`🗃️ \${s.name}\${s.code ? ' · ' + s.code : ''}\`;
                    item.onclick = () => {
                        setRowSource(row, { id: s.id, name: s.name });
                        dd.remove();
                        document.removeEventListener('click', close);
                    };
                    dd.appendChild(item);
                });
            } catch (err) {
                dd.innerHTML = \`<div style="padding:8px 14px;color:#ef4444;font-size:0.78rem;">\${err.message}</div>\`;
            }
        }

        // 订阅行工具图标（渐变 SVG，与图标设计稿对应）
        const SRC_PICK_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" style="display:block" xmlns="http://www.w3.org/2000/svg"><g fill="url(#lg-src-pick)"><rect x="2" y="3.2" width="20" height="2.6" rx="1.3"/><rect x="2" y="9.2" width="20" height="2.6" rx="1.3"/><rect x="2" y="15.2" width="8.5" height="2.6" rx="1.3"/><rect x="2" y="21" width="8.5" height="2.6" rx="1.3"/></g><path d="M13.4 15.6 L16.9 19.3 L22.3 13.1" fill="none" stroke="url(#lg-src-pick)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        const SRC_SAVE_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" style="display:block" xmlns="http://www.w3.org/2000/svg"><path fill="url(#lg-src-save)" d="M2 4.5 C2 3.7 2.7 3 3.5 3 H8.6 C9 3 9.4 3.2 9.7 3.5 L11.6 5.5 H20.5 C21.3 5.5 22 6.2 22 7 V19 C22 19.8 21.3 20.5 20.5 20.5 H3.5 C2.7 20.5 2 19.8 2 19 Z"/><circle cx="12" cy="15" r="6" fill="#fff"/><path d="M12 11.6 V16 M9.9 14 L12 16.1 L14.1 14 M9 16.6 V17 A3 3 0 0 0 15 17 V16.6" fill="none" stroke="url(#lg-src-save)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        const SRC_REMOVE_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="11" fill="#ee5a5a"/><rect x="5.5" y="10.3" width="13" height="3.4" rx="1" fill="#fff"/></svg>';
        const ADD_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="22" height="22" rx="5.8" fill="#22c55e"/><path d="M12 7 V17 M7 12 H17" fill="none" stroke="#fff" stroke-width="2.7" stroke-linecap="round"/></svg>';

        // 减号：把该行从订阅列表中移除；若是最后一行则重置为空行
        function removeSourceRow(row, containerId) {
            const wrapper = document.getElementById(containerId);
            row.remove();
            const rows = wrapper ? wrapper.querySelectorAll('.link-row') : [];
            if (!rows.length) {
                addLinkRow(containerId, containerId.replace('links-wrapper-', ''));
            } else {
                ensureTrailingEmptyRow(rows[rows.length - 1]);
            }
        }

        // 共享渐变定义（全页唯一 id，动态插入的图标统一引用，避免重复 id 渲染异常）
        const ICON_GRAD_DEFS = '<svg width="0" height="0" style="position:absolute" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="lg-src-pick" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#a855f7"/><stop offset="1" stop-color="#38bdf8"/></linearGradient><linearGradient id="lg-src-save" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f97316"/><stop offset="1" stop-color="#fde047"/></linearGradient></defs></svg>';
        document.body.insertAdjacentHTML('afterbegin', ICON_GRAD_DEFS);

        function addLinkRow(containerId, modeId) {
            const linksContainer = document.getElementById(containerId);
            if (!linksContainer) return;
            const newRow = document.createElement('div');
            newRow.className = 'link-row';
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'link-input dynamic-link-input';
            input.placeholder = MODES_META[modeId]?.placeholder || '输入订阅地址';
            input.addEventListener('blur', () => ensureTrailingEmptyRow(newRow));
            input.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter') {
                    ensureTrailingEmptyRow(newRow);
                    input.blur();
                }
            });
            const addBtn = document.createElement('div');
            addBtn.className = 'add-btn-circle';
            addBtn.innerHTML = ADD_ICON;
            addBtn.onclick = () => addLinkRow(containerId, modeId);
            const saveBtn = document.createElement('div');
            saveBtn.className = 'row-tool-btn save-btn-circle';
            saveBtn.innerHTML = SRC_SAVE_ICON;
            saveBtn.title = '保存到原始订阅库（输入名称后实时拉取内容）';
            saveBtn.onclick = () => saveRowToLibrary(newRow);
            const caretBtn = document.createElement('div');
            caretBtn.className = 'row-tool-btn src-caret-btn';
            caretBtn.innerHTML = SRC_PICK_ICON;
            caretBtn.title = '选择已保存的原始订阅';
            caretBtn.onclick = () => openSourceDropdown(newRow);
            const removeBtn = document.createElement('div');
            removeBtn.className = 'row-tool-btn src-remove-btn';
            removeBtn.innerHTML = SRC_REMOVE_ICON;
            removeBtn.title = '从列表中移除';
            removeBtn.style.display = 'none';
            removeBtn.onclick = () => removeSourceRow(newRow, containerId);
            newRow.append(input, caretBtn, saveBtn, removeBtn, addBtn);
            linksContainer.appendChild(newRow);
        }

        function buildModePanel(modeId, meta) {
            const panel = document.createElement('div');
            panel.id = \`panel-\${modeId}\`;
            panel.className = 'mode-panel';

            if (!meta.noTemplate && meta.templates) {
                const templateCard = document.createElement('div');
                templateCard.className = 'form-card';
                templateCard.innerHTML = \`<div class="section-title">📁 配置模板</div>
                                      <div class="template-trigger" id="trigger-\${modeId}">
                                          <span>当前模板</span>
                                          <span id="selectedLabel-\${modeId}">未选择 (默认)</span>
                                      </div>
                                      <div class="template-dropdown" id="dropdown-\${modeId}"></div>\`;
                panel.appendChild(templateCard);
                const dropdownDiv = templateCard.querySelector(\`#dropdown-\${modeId}\`);
                const trigger = templateCard.querySelector(\`#trigger-\${modeId}\`);
                const selectedSpan = templateCard.querySelector(\`#selectedLabel-\${modeId}\`);

                for (const [groupName, opts] of Object.entries(meta.templates)) {
                    const groupDiv = document.createElement('div');
                    groupDiv.className = 'template-group';
                    const header = document.createElement('div');
                    header.className = 'template-group-header';
                    header.innerText = groupName;
                    groupDiv.appendChild(header);
                    opts.forEach(opt => {
                        const optDiv = document.createElement('div');
                        optDiv.className = 'template-opt';
                        optDiv.innerText = opt.label;
                        optDiv.dataset.value = opt.value;
                        optDiv.addEventListener('click', (e) => {
                            e.stopPropagation();
                            dropdownDiv.querySelectorAll('.template-opt').forEach(el => el.classList.remove('selected'));
                            optDiv.classList.add('selected');
                            selectedSpan.innerText = opt.label;
                            dropdownDiv.classList.remove('open');
                        });
                        groupDiv.appendChild(optDiv);
                    });
                    dropdownDiv.appendChild(groupDiv);
                }
                const firstOpt = dropdownDiv.querySelector('.template-opt');
                if (firstOpt) {
                    firstOpt.classList.add('selected');
                    selectedSpan.innerText = firstOpt.innerText;
                }
                trigger.addEventListener('click', (e) => {
                    e.stopPropagation();
                    dropdownDiv.classList.toggle('open');
                });
                document.addEventListener('click', (e) => {
                    if (!trigger.contains(e.target) && !dropdownDiv.contains(e.target)) dropdownDiv.classList.remove('open');
                });
            }

            const linkCard = document.createElement('div');
            linkCard.className = 'form-card';
            const linkHeader = document.createElement('div');
            linkHeader.className = 'section-title';
            linkHeader.innerHTML = \`🔗 订阅链接 <div class="tip-pop" id="tip-\${modeId}"><span class="tip-icon-sm">?</span><div class="tip-content"></div></div>\`;
            linkCard.appendChild(linkHeader);
            const linksWrapper = document.createElement('div');
            linksWrapper.id = \`links-wrapper-\${modeId}\`;
            linksWrapper.className = 'links-area';
            const firstRow = document.createElement('div');
            firstRow.className = 'link-row';
            const firstInput = document.createElement('input');
            firstInput.type = 'text';
            firstInput.className = 'link-input dynamic-link-input';
            firstInput.placeholder = meta.placeholder;
            firstInput.addEventListener('blur', () => ensureTrailingEmptyRow(firstRow));
            firstInput.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter') {
                    ensureTrailingEmptyRow(firstRow);
                    firstInput.blur();
                }
            });
            const addFirstBtn = document.createElement('div');
            addFirstBtn.className = 'add-btn-circle';
            addFirstBtn.innerHTML = ADD_ICON;
            addFirstBtn.onclick = () => addLinkRow(\`links-wrapper-\${modeId}\`, modeId);
            const saveFirstBtn = document.createElement('div');
            saveFirstBtn.className = 'row-tool-btn save-btn-circle';
            saveFirstBtn.innerHTML = SRC_SAVE_ICON;
            saveFirstBtn.title = '保存到原始订阅库（输入名称后实时拉取内容）';
            saveFirstBtn.onclick = () => saveRowToLibrary(firstRow);
            const caretFirstBtn = document.createElement('div');
            caretFirstBtn.className = 'row-tool-btn src-caret-btn';
            caretFirstBtn.innerHTML = SRC_PICK_ICON;
            caretFirstBtn.title = '选择已保存的原始订阅';
            caretFirstBtn.onclick = () => openSourceDropdown(firstRow);
            const removeFirstBtn = document.createElement('div');
            removeFirstBtn.className = 'row-tool-btn src-remove-btn';
            removeFirstBtn.innerHTML = SRC_REMOVE_ICON;
            removeFirstBtn.title = '从列表中移除';
            removeFirstBtn.style.display = 'none';
            removeFirstBtn.onclick = () => removeSourceRow(firstRow, \`links-wrapper-\${modeId}\`);
            firstRow.appendChild(firstInput);
            firstRow.appendChild(caretFirstBtn);
            firstRow.appendChild(saveFirstBtn);
            firstRow.appendChild(removeFirstBtn);
            firstRow.appendChild(addFirstBtn);
            linksWrapper.appendChild(firstRow);
            linkCard.appendChild(linksWrapper);
            panel.appendChild(linkCard);
            if (meta.protocolList && meta.protocolList.length) {
                const protoCard = document.createElement('div');
                protoCard.className = 'form-card';
                protoCard.innerHTML = \`<div class="section-title">⚙️ 附加参数</div><div class="checkbox-group" id="proto-group-\${modeId}"></div>\`;
                const groupDiv = protoCard.querySelector(\`#proto-group-\${modeId}\`);
    
                meta.protocolList.forEach(proto => {
                    const protoConfig = meta.protocolLabels[proto];
        
                    // 通用判断：如果是对象且有 levels 属性，则渲染为下拉框
                    if (protoConfig && typeof protoConfig === 'object' && protoConfig.levels) {
                        // 下拉框处理（通用）
                        const selectContainer = document.createElement('div');
                        selectContainer.style.display = 'flex';
                        selectContainer.style.alignItems = 'center';
                        selectContainer.style.gap = '12px';
                        selectContainer.style.marginBottom = '8px';
                        selectContainer.style.flexWrap = 'wrap';

                        const selectLabel = document.createElement('span');
                        const select = document.createElement('select');
                        select.className = 'proto-select';
                        select.setAttribute('data-proto', proto);
                        select.style.padding = '6px 12px';
                        select.style.borderRadius = '30px';
                        select.style.border = '1.5px solid var(--border-light)';
                        select.style.backgroundColor = 'white';
                        select.style.fontSize = '0.85rem';
                        select.style.cursor = 'pointer';

                        // 添加默认选项
                        const defaultOption = document.createElement('option');
                        defaultOption.value = '';
                        defaultOption.innerText = \`请选择\${protoConfig.label || proto}\`;
                        select.appendChild(defaultOption);
    
                        // 添加各级别选项
                        protoConfig.levels.forEach(level => {
                            const option = document.createElement('option');
                            option.value = level;
                            option.innerText = level;
                            select.appendChild(option);
                        });

                        selectContainer.appendChild(selectLabel);
                        selectContainer.appendChild(select);
                        groupDiv.appendChild(selectContainer);
                    } else {
                        // 复选框处理（字符串或没有 levels 的对象）
                        const label = document.createElement('label');
                        const labelText = (typeof protoConfig === 'object' && protoConfig.label) ? protoConfig.label : (protoConfig || proto);
                        label.innerHTML = \`<input type="checkbox" class="proto-check" value="\${proto}"> <span>\${labelText}</span>\`;
                        groupDiv.appendChild(label);
                    }
                });
                panel.appendChild(protoCard);
            }

            const genBtn = document.createElement('button');
            genBtn.className = 'generate-btn';
            genBtn.innerText = \`✨ 生成 \${meta.name} 订阅链接\`;
            genBtn.onclick = () => generateConfigForMode(modeId);
            panel.appendChild(genBtn);

            setTimeout(() => {
                const tipWrap = linkCard.querySelector(\`#tip-\${modeId}\`);
                if (tipWrap) {
                    const contentDiv = tipWrap.querySelector('.tip-content');
                    const rawMarkdown = meta.tipMarkdown;
                    contentDiv.innerHTML = DOMPurify.sanitize(marked.parse(rawMarkdown));
                    const tipIcon = tipWrap.querySelector('.tip-icon-sm');
                    tipIcon.addEventListener('click', (e) => {
                        e.stopPropagation();
                        tipWrap.classList.toggle('active');
                    });
                    document.addEventListener('click', (e) => {
                        if (!tipWrap.contains(e.target)) tipWrap.classList.remove('active');
                    });
                }
            }, 10);
            return panel;
        }

        function initApp() {
            const modeTrigger = document.getElementById('modeTrigger');
            const modeDropdown = document.getElementById('modeDropdown');
            const selectedModeLabel = document.getElementById('selectedModeLabel');
            const panelsContainer = document.getElementById('panelsContainer');
            panelsContainer.innerHTML = '';
            modeDropdown.innerHTML = '';
            for (const [modeId, meta] of Object.entries(MODES_META)) {
                const optDiv = document.createElement('div');
                optDiv.className = 'template-opt';
                optDiv.innerText = meta.name;
                optDiv.dataset.modeId = modeId;
                optDiv.addEventListener('click', (e) => {
                    e.stopPropagation();
                    modeDropdown.querySelectorAll('.template-opt').forEach(el => el.classList.remove('selected'));
                    optDiv.classList.add('selected');
                    selectedModeLabel.innerText = meta.name;
                    modeDropdown.classList.remove('open');
                    setActiveMode(modeId);
                });
                modeDropdown.appendChild(optDiv);
            }

            // 默认选中 mihomo
            const defaultOpt = Array.from(modeDropdown.querySelectorAll('.template-opt')).find(opt => opt.dataset.modeId === 'mihomo');
            if (defaultOpt) {
                defaultOpt.classList.add('selected');
                selectedModeLabel.innerText = defaultOpt.innerText;
            }

            // 触发器点击事件
            modeTrigger.addEventListener('click', (e) => {
                e.stopPropagation();
                modeDropdown.classList.toggle('open');
            });

            // 点击外部关闭
            document.addEventListener('click', (e) => {
                if (!modeTrigger.contains(e.target) && !modeDropdown.contains(e.target)) {
                    modeDropdown.classList.remove('open');
                }
            });

            // 预构建所有面板
            for (const [modeId, meta] of Object.entries(MODES_META)) {
                const panel = buildModePanel(modeId, meta);
                panelsContainer.appendChild(panel);
            }

            function setActiveMode(modeId) {
                currentMode = modeId;
                editingCode = null;
                editingLabel = '';
                editingOldKey = '';
                document.querySelectorAll('.mode-panel').forEach(panel => {
                    panel.classList.toggle('active', panel.id === \`panel-\${modeId}\`);
                });
                updateResultAndQR('');
            }

            setActiveMode('mihomo');
        }

        initApp();

        // ?edit=<短码>：从已保存订阅页跳转来修改配置，口令校验后回填表单
        (async () => {
            const editCode = new URLSearchParams(location.search).get('edit');
            if (!editCode || !/^[A-Za-z0-9]{4,16}$/.test(editCode)) return;
            try {
                const unlocked = await unlockEntry(editCode, '请输入访问口令以载入该订阅的配置。', '载入');
                if (unlocked) {
                    fillFormFromParams(unlocked.resp);
                    editingCode = editCode;
                    editingLabel = unlocked.resp.label || '';
                    editingOldKey = unlocked.key;
                    showToast('✓ 已载入，保存将更新该短链接', 'success');
                }
            } catch {
                showToast('✗ 访问口令错误', 'error');
            }
        })();
    </script>
</body>

</html>
    `;
}



// ===== 子页面共享骨架 =====
function subpageShell(e, { title, heroIcon, heroTitle, badge, body, script }) {
    return `
<!DOCTYPE html>
<html lang="zh-CN">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>⚡</text></svg>">
    <title>${title}</title>
    ${PAGE_STYLE(e.IMG)}
</head>

<body>
    <div class="glass-container">
        <div class="hero">
            <h1>${heroIcon} ${heroTitle}</h1>
            <div class="badge">${badge}</div>
        </div>

        <div class="page-back"><a href="/">← 返回转换器</a></div>
${body}
        <div class="beian">
            <a href="${e.beianurl}" style="color: var(--primary-dark); text-decoration: none;">${e.beian}</a>
        </div>
    </div>

    ${KEY_DIALOG}

    <script>
${script}
    </script>
</body>

</html>
    `;
}

// ===== /saved 已保存订阅列表 =====
function savedPageHtml(e, configJson) {
    const body = `        <div class="form-card">
            <div class="section-title">📚 已保存订阅</div>
            <div id="savedList" class="saved-list"></div>
            <div class="saved-pagination">
                <span class="saved-page-btn" id="savedPrev">‹ 上一页</span>
                <span id="savedPageNum">1</span>
                <span class="saved-page-btn" id="savedNext">下一页 ›</span>
            </div>
        </div>`;
    const script = `const MODES_META = ${configJson};

        const EYE_ICON =
            '<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>';
        const EYE_OFF_ICON =
            '<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/></svg>';

        function setKeyToggle(shown) {
            const toggle = document.getElementById('keyToggle');
            if (toggle) toggle.innerHTML = shown ? EYE_OFF_ICON : EYE_ICON;
        }

        function askKey(message, btnText = '确定') {
            return new Promise((resolve) => {
                const dlg = document.getElementById('keyDialog');
                const msg = document.getElementById('keyDialogMsg');
                const input = document.getElementById('keyDialogInput');
                const ok = document.getElementById('keyDialogOk');
                const cancel = document.getElementById('keyDialogCancel');
                msg.innerText = message;
                ok.innerText = btnText;
                input.value = '';
                input.type = 'password';
                setKeyToggle(false);
                let settled = false;
                const done = (val) => {
                    if (settled) return;
                    settled = true;
                    dlg.onclose = null;
                    ok.onclick = null;
                    cancel.onclick = null;
                    input.onkeydown = null;
                    dlg.close();
                    resolve(val);
                };
                ok.onclick = () => {
                    const key = input.value.trim() || null;
                    done(key ? { key } : null);
                };
                cancel.onclick = () => done(null);
                dlg.onclose = () => done(null);
                input.onkeydown = (ev) => {
                    if (ev.key === 'Enter') {
                        const key = input.value.trim() || null;
                        done(key ? { key } : null);
                    }
                };
                dlg.showModal();
                setTimeout(() => input.focus(), 50);
            });
        }

        document.getElementById('keyToggle')?.addEventListener('click', () => {
            const input = document.getElementById('keyDialogInput');
            const show = input.type === 'password';
            input.type = show ? 'text' : 'password';
            setKeyToggle(show);
            input.focus();
        });
        setKeyToggle(false);

        function showToast(message, type = 'success') {
            const toast = document.createElement('div');
            toast.innerText = message;
            toast.style.position = 'fixed';
            toast.style.bottom = '20px';
            toast.style.left = '50%';
            toast.style.transform = 'translateX(-50%)';
            toast.style.background = type === 'success' ? '#10b981' : '#ef4444';
            toast.style.color = 'white';
            toast.style.padding = '10px 24px';
            toast.style.borderRadius = '40px';
            toast.style.fontSize = '0.85rem';
            toast.style.zIndex = '999';
            toast.style.fontWeight = 'bold';
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 2000);
        }

        function b64EncodeKey(str) {
            return btoa(String.fromCharCode(...new TextEncoder().encode(str)));
        }

        const savedPager = { page: 1, totalPages: 1 };
        const unlockedInfo = new Map();
        const unlockedKeys = new Map();
        let currentSavedItems = [];

        async function loadSavedList(page = 1) {
            try {
                const resp = await fetch(\`/api/short/list?page=\${page}&limit=10\`);
                const data = await resp.json();
                if (!resp.ok || !data.success) throw new Error(typeof data === 'string' ? data : data.error);
                savedPager.page = data.page;
                savedPager.totalPages = data.totalPages;
                currentSavedItems = data.items || [];
                renderSavedList(currentSavedItems);
                updateSavedPagerUI();
            } catch (err) {
                document.getElementById('savedList').innerHTML = '<div style="color: var(--text-muted); font-size: 0.8rem;">列表加载失败</div>';
            }
        }

        function updateSavedPagerUI() {
            document.getElementById('savedPageNum').innerText = \`\${savedPager.page} / \${savedPager.totalPages}\`;
            document.getElementById('savedPrev').classList.toggle('disabled', savedPager.page <= 1);
            document.getElementById('savedNext').classList.toggle('disabled', savedPager.page >= savedPager.totalPages);
        }

        document.getElementById('savedPrev')?.addEventListener('click', () => {
            if (savedPager.page > 1) loadSavedList(savedPager.page - 1);
        });
        document.getElementById('savedNext')?.addEventListener('click', () => {
            if (savedPager.page < savedPager.totalPages) loadSavedList(savedPager.page + 1);
        });

        async function unlockEntry(code, message, btnText) {
            const { key } = (await askKey(message, btnText)) || {};
            if (!key) return null;
            const resp = await fetch(\`/api/short/get?code=\${code}&key=\${encodeURIComponent(b64EncodeKey(key))}\`).then((x) => x.json());
            if (!resp.success) {
                throw new Error(typeof resp === 'string' ? resp : resp.error || '获取失败');
            }
            unlockedInfo.set(code, { ...resp, key });
            unlockedKeys.set(code, key);
            return { key, resp };
        }

        function renderSavedList(items) {
            const box = document.getElementById('savedList');
            box.innerHTML = '';
            if (!items.length) {
                box.innerHTML = '<div style="color: var(--text-muted); font-size: 0.8rem;">暂无保存的订阅（在转换器生成后点 🔒 保存订阅内容）</div>';
                return;
            }
            const origin = window.location.origin;
            items.forEach((item) => {
                const row = document.createElement('div');
                row.className = 'saved-item';
                const date = item.created
                    ? new Date(item.created).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
                    : '';
                const unlocked = unlockedInfo.get(item.code);
                const info = document.createElement('div');
                info.className = 'saved-info';
                const labelText = unlocked?.label || item.label;
                if (unlocked) {
                    const modeName = MODES_META[unlocked.target]?.name || unlocked.target;
                    const srcCount = (unlocked.sources || []).length;
                    const rawCount = (unlocked.rawUrls || []).length;
                    const srcPart = srcCount ? \`\${srcCount}个订阅源\` : '';
                    const rawPart = rawCount ? \`\${rawCount}条链接\` : '';
                    info.innerHTML = \`<span class="saved-mode">\${labelText || modeName}</span><span class="saved-code">/s/\${item.code}</span><span class="saved-meta">\${modeName} · \${[srcPart, rawPart].filter(Boolean).join(' + ')} · \${date} · \${unlocked.hasContent ? '📦 已缓存' : '⏳ 待生成'}</span>\`;
                } else {
                    info.innerHTML = \`<span class="saved-code">\${labelText ? '' : '🔒 '}/s/\${item.code}</span><span class="saved-meta">\${date}\${labelText ? \` · \${labelText}\` : ' · 输入口令后显示详情'}</span>\`;
                }
                const actions = document.createElement('div');
                actions.className = 'saved-actions';
                const copyBtn = document.createElement('button');
                copyBtn.className = 'saved-btn';
                copyBtn.innerText = '复制';
                copyBtn.onclick = async () => {
                    try {
                        const unlocked2 = await unlockEntry(item.code, '该订阅内容已加密，请输入访问口令以生成可用的短链接。', '复制');
                        if (!unlocked2) return;
                        renderSavedList(currentSavedItems);
                        const link = \`\${origin}/s/\${item.code}?key=\${b64EncodeKey(unlocked2.key)}\`;
                        await navigator.clipboard.writeText(link);
                        showToast('✓ 短链接已复制', 'success');
                    } catch {
                        showToast('✗ 访问口令错误', 'error');
                    }
                };
                const editBtn = document.createElement('button');
                editBtn.className = 'saved-btn';
                editBtn.innerText = '修改';
                editBtn.onclick = () => {
                    // 跳转转换器，口令在那里输入并回填表单
                    location.href = \`/?edit=\${item.code}\`;
                };
                const delBtn = document.createElement('button');
                delBtn.className = 'saved-btn saved-btn-danger';
                delBtn.innerText = '删除';
                delBtn.onclick = async () => {
                    try {
                        let delKey = unlockedKeys.get(item.code);
                        if (!delKey) {
                            const r = await unlockEntry(item.code, '请输入访问口令以删除该短链接。', '删除');
                            if (!r) return;
                            delKey = r.key;
                        }
                        const resp = await fetch('/api/short/delete', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ code: item.code, key: delKey }),
                        });
                        const data = await resp.json();
                        if (!resp.ok || !data.success) throw new Error(typeof data === 'string' ? data : data.error || '删除失败');
                        unlockedInfo.delete(item.code);
                        unlockedKeys.delete(item.code);
                        await loadSavedList(savedPager.page);
                        showToast('✓ 已删除', 'success');
                    } catch (err) {
                        showToast(\`✗ \${err.message || '访问口令错误'}\`, 'error');
                    }
                };
                actions.append(copyBtn, editBtn, delBtn);
                row.append(info, actions);
                box.appendChild(row);
            });
        }

        loadSavedList();`;
    return subpageShell(e, {
        title: '已保存订阅 · 星尘转换器',
        heroIcon: '📚',
        heroTitle: '已保存订阅',
        badge: '短链管理',
        body,
        script,
    });
}

// ===== /sources 原始订阅库 =====
function sourcesPageHtml(e) {
    const body = `        <div class="form-card">
            <div class="section-title">🗃️ 原始订阅库</div>
            <div id="sourceList" style="display: flex; flex-direction: column; gap: 8px;"></div>
        </div>

        <dialog id="srcEditDialog" style="border: none; border-radius: 1.2rem; padding: 1.5rem; box-shadow: var(--shadow-md); position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); margin: 0; width: min(22rem, calc(100vw - 3rem));">
            <p id="srcEditMsg" style="font-size: 0.88rem; color: var(--text-dark); line-height: 1.6; margin-bottom: 1rem;"></p>
            <input type="text" id="srcEditName" placeholder="订阅名称"
                style="width: 100%; padding: 10px 14px; border: 1px solid var(--border-light); border-radius: 0.8rem; font-size: 0.9rem; outline: none; text-align: center; margin-bottom: 0.7rem;" />
            <input type="text" id="srcEditCode" placeholder="订阅代码（可选，合并时作节点名前缀）"
                style="width: 100%; padding: 10px 14px; border: 1px solid var(--border-light); border-radius: 0.8rem; font-size: 0.9rem; outline: none; text-align: center; margin-bottom: 1.2rem;" />
            <div style="display: flex; justify-content: flex-end; gap: 8px;">
                <button id="srcEditCancel"
                    style="border: 1px solid var(--border-light); background: transparent; color: var(--text-muted); border-radius: 999px; padding: 6px 18px; font-size: 0.82rem; cursor: pointer;">取消</button>
                <button id="srcEditOk"
                    style="border: none; background: var(--primary); color: #fff; border-radius: 999px; padding: 6px 18px; font-size: 0.82rem; cursor: pointer;">保存</button>
            </div>
        </dialog>`;
    const script = `function showToast(message, type = 'success') {
            const toast = document.createElement('div');
            toast.innerText = message;
            toast.style.position = 'fixed';
            toast.style.bottom = '20px';
            toast.style.left = '50%';
            toast.style.transform = 'translateX(-50%)';
            toast.style.background = type === 'success' ? '#10b981' : '#ef4444';
            toast.style.color = 'white';
            toast.style.padding = '10px 24px';
            toast.style.borderRadius = '40px';
            toast.style.fontSize = '0.85rem';
            toast.style.zIndex = '999';
            toast.style.fontWeight = 'bold';
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 2000);
        }

        // 编辑弹窗：名称 + 订阅代码（代码全表唯一，留空表示不修改代码）
        function openSrcEdit(item, onSaved) {
            const dlg = document.getElementById('srcEditDialog');
            const msg = document.getElementById('srcEditMsg');
            const nameInput = document.getElementById('srcEditName');
            const codeInput = document.getElementById('srcEditCode');
            const ok = document.getElementById('srcEditOk');
            const cancel = document.getElementById('srcEditCancel');
            msg.innerText = \`编辑「\${item.name}」：\`;
            nameInput.value = item.name;
            codeInput.value = item.code || '';
            let settled = false;
            const done = (val) => {
                if (settled) return;
                settled = true;
                ok.onclick = null;
                cancel.onclick = null;
                codeInput.onkeydown = null;
                dlg.close();
                if (val) onSaved(val);
            };
            const submit = () => {
                const name = nameInput.value.trim();
                if (!name) return;
                done({ name, code: codeInput.value.trim() });
            };
            ok.onclick = submit;
            cancel.onclick = () => done(null);
            codeInput.onkeydown = (ev) => { if (ev.key === 'Enter') submit(); };
            dlg.showModal();
            setTimeout(() => nameInput.focus(), 50);
        }

        async function loadSourceLibrary() {
            const box = document.getElementById('sourceList');
            try {
                const resp = await fetch('/api/source/list');
                const data = await resp.json();
                if (!resp.ok || !data.success) throw new Error(data.error);
                box.innerHTML = '';
                const items = data.items || [];
                if (!items.length) {
                    box.innerHTML = '<div style="color: var(--text-muted); font-size: 0.8rem;">暂无原始订阅（在转换器的订阅链接行点 💾 保存）</div>';
                    return;
                }
                items.forEach((s) => {
                    const row = document.createElement('div');
                    row.className = 'saved-item';
                    const d = s.fetchedAt ? new Date(s.fetchedAt) : null;
                    const p2 = (n) => String(n).padStart(2, '0');
                    const time = d ? \`\${d.getFullYear()}-\${p2(d.getMonth() + 1)}-\${p2(d.getDate())} \${p2(d.getHours())}:\${p2(d.getMinutes())}\` : '';
                    const info = document.createElement('div');
                    info.className = 'saved-info';
                    info.innerHTML = \`<span class="saved-mode">🗃️ \${s.name}</span>\${s.code ? \`<span class="src-code-chip">\${s.code}</span>\` : ''}<span class="saved-meta">\${time}</span>\`;
                    const actions = document.createElement('div');
                    actions.className = 'saved-actions';
                    const renameBtn = document.createElement('button');
                    renameBtn.className = 'saved-btn';
                    renameBtn.innerText = '编辑';
                    renameBtn.onclick = async () => {
                        openSrcEdit(s, async ({ name, code }) => {
                            if (name === s.name && (code || '') === (s.code || '')) return;
                            try {
                                renameBtn.disabled = true;
                                const r = await fetch('/api/source/rename', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ id: s.id, name, code }),
                                }).then((x) => x.json());
                                if (!r.success) throw new Error(r.error || '保存失败');
                                showToast('✓ 已保存', 'success');
                                loadSourceLibrary();
                            } catch (err) {
                                showToast(\`✗ \${err.message}\`, 'error');
                            } finally {
                                renameBtn.disabled = false;
                            }
                        });
                    };
                    const refreshBtn = document.createElement('button');
                    refreshBtn.className = 'saved-btn';
                    refreshBtn.innerText = '刷新';
                    refreshBtn.onclick = async () => {
                        try {
                            refreshBtn.disabled = true;
                            const r = await fetch('/api/source/refresh', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ id: s.id }),
                            }).then((x) => x.json());
                            if (!r.success) throw new Error(r.error || '刷新失败');
                            showToast(\`✓ 已刷新「\${s.name}」，相关短链将自动重新生成\`, 'success');
                            loadSourceLibrary();
                        } catch (err) {
                            showToast(\`✗ \${err.message}\`, 'error');
                        } finally {
                            refreshBtn.disabled = false;
                        }
                    };
                    const delBtn = document.createElement('button');
                    delBtn.className = 'saved-btn saved-btn-danger';
                    delBtn.innerText = '删除';
                    delBtn.onclick = async () => {
                        if (!confirm(\`删除原始订阅「\${s.name}」？已生成缓存的短链仍可访问，但无法重新生成。\`)) return;
                        try {
                            const r = await fetch('/api/source/delete', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ id: s.id }),
                            }).then((x) => x.json());
                            if (!r.success) throw new Error(r.error || '删除失败');
                            showToast('✓ 已删除', 'success');
                            loadSourceLibrary();
                        } catch (err) {
                            showToast(\`✗ \${err.message}\`, 'error');
                        }
                    };
                    actions.append(renameBtn, refreshBtn, delBtn);
                    row.append(info, actions);
                    box.appendChild(row);
                });
            } catch (err) {
                box.innerHTML = '';
                console.warn('原始订阅库不可用', err.message);
            }
        }

        loadSourceLibrary();`;
    return subpageShell(e, {
        title: '原始订阅库 · 星尘转换器',
        heroIcon: '🗃️',
        heroTitle: '原始订阅库',
        badge: '内容加密存储',
        body,
        script,
    });
}
