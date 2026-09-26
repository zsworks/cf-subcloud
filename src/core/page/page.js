import configs from './config.js';

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
    return `
<!DOCTYPE html>
<html lang="zh-CN">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <link rel="icon" type="image/png" href="https://cdn.jsdelivr.net/gh/Kwisma/cf-worker-mihomo@main/favicon.png">
    <title>星尘配置转换 · 订阅转换</title>
    <script src="https://cdn.jsdelivr.net/npm/@keeex/qrcodejs-kx@1.0.2/qrcode.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/dompurify@3.0.5/dist/purify.min.js"></script>
    <style>
        * {
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
            background: url(${e.IMG});
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
            background: linear-gradient(135deg, var(--primary), var(--primary-soft));
            border-radius: 30px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            color: white;
            font-size: 1.3rem;
            font-weight: 500;
            transition: all 0.2s;
            box-shadow: 0 4px 8px rgba(99, 102, 241, 0.3);
        }

        .add-btn-circle:hover {
            transform: scale(1.03);
            background: var(--primary-dark);
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
            width: 26px;
            height: 26px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            font-size: 0.8rem;
            flex-shrink: 0;
            user-select: none;
        }
        .save-btn-circle { border: 1px solid var(--border-light); color: var(--primary); background: #fff; }
        .save-btn-circle:active { transform: scale(0.92); }
        .src-caret-btn { border: 1px solid var(--border-light); color: var(--text-muted); background: #fff; font-size: 0.6rem; }
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
        .src-chip-x { cursor: pointer; font-weight: 400; opacity: 0.6; }
        .src-chip-x:hover { opacity: 1; }
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
    </style>
</head>

<body>

    <div class="glass-container">
        <div class="hero">
            <h1>⚡ 星尘转换器</h1>
            <div class="badge">多合一订阅</div>
        </div>

        <!-- 已保存订阅列表 -->
        <div class="form-card" id="savedCard">
            <div class="section-title">📚 已保存订阅</div>
            <div id="savedList" class="saved-list"></div>
            <div class="saved-pagination">
                <span class="saved-page-btn" id="savedPrev">‹ 上一页</span>
                <span id="savedPageNum">1</span>
                <span class="saved-page-btn" id="savedNext">下一页 ›</span>
            </div>
        </div>

        <!-- 原始订阅库 -->
        <div class="form-card" id="sourceCard">
            <div class="section-title">🗃️ 原始订阅库</div>
            <div id="sourceList" style="display: flex; flex-direction: column; gap: 8px;"></div>
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

    <dialog id="keyDialog" style="border: none; border-radius: 1.2rem; padding: 1.5rem; box-shadow: var(--shadow-md); position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); margin: 0; width: min(22rem, calc(100vw - 3rem));">
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
    </dialog>

    <dialog id="nameDialog" style="border: none; border-radius: 1.2rem; padding: 1.5rem; box-shadow: var(--shadow-md); position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); margin: 0; width: min(22rem, calc(100vw - 3rem));">
        <p id="nameDialogMsg" style="font-size: 0.88rem; color: var(--text-dark); line-height: 1.6; margin-bottom: 1rem;"></p>
        <input type="text" id="nameDialogInput" placeholder="输入简短名称（如：机场A）"
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
                loadSavedList(savedPager.page);
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

        // ===== 已保存订阅列表 =====
        let editingCode = null;
        let editingLabel = '';
        // 修改回填时已验证的原密钥，保存更新时作为 oldKey 提交
        let editingOldKey = '';
        const savedPager = { page: 1, totalPages: 1 };
        // 已在本地解密的条目信息（code -> blob 解密结果），用于列表展示 label 等信息
        const unlockedInfo = new Map();
        // 已验证的密钥（code -> key），清除等操作免重复输入
        const unlockedKeys = new Map();
        let currentSavedItems = [];

        async function loadSavedList(page = 1) {
            try {
                const resp = await fetch(\`/api/short/list?page=\${page}&limit=5\`);
                const data = await resp.json();
                if (!resp.ok || !data.success) throw new Error(typeof data === 'string' ? data : data.error);
                savedPager.page = data.page;
                savedPager.totalPages = data.totalPages;
                currentSavedItems = data.items || [];
                renderSavedList(currentSavedItems);
                updateSavedPagerUI();
            } catch (err) {
                document.getElementById('savedCard').style.display = 'none';
            }
        }

        function updateSavedPagerUI() {
            const pageNum = document.getElementById('savedPageNum');
            const prev = document.getElementById('savedPrev');
            const next = document.getElementById('savedNext');
            if (pageNum) pageNum.innerText = \`\${savedPager.page} / \${savedPager.totalPages}\`;
            if (prev) prev.classList.toggle('disabled', savedPager.page <= 1);
            if (next) next.classList.toggle('disabled', savedPager.page >= savedPager.totalPages);
        }

        function turnSavedPage(dir) {
            const target = savedPager.page + dir;
            if (target < 1 || target > savedPager.totalPages) return;
            loadSavedList(target);
        }

        // 解锁条目：口令交服务端 HMAC 校验并解密，明文配置仅回传表单所需字段
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
            if (!box) return;
            box.innerHTML = '';
            if (!items.length) {
                box.innerHTML = '<div style="color: var(--text-muted); font-size: 0.8rem;">暂无保存的订阅</div>';
                return;
            }
            const origin = window.location.origin;
            items.forEach((item) => {
                const row = document.createElement('div');
                row.className = 'saved-item';
                if (item.code === editingCode) row.classList.add('editing');
                const date = item.created
                    ? new Date(item.created).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
                    : '';
                // 服务端返回 label；已解锁条目展示来源与缓存状态
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
                    info.innerHTML = \`<span class="saved-mode">\${labelText || modeName}</span><span class="saved-code">/s/\${item.code}</span><span class="saved-meta">\${modeName} · \${[srcPart, rawPart].filter(Boolean).join(' + ')} · \${date} · \${unlocked.hasContent ? '📦 已缓存' : '⏳ 待生成'}\`</span>\`;
                } else {
                    info.innerHTML = \`<span class="saved-code">\${labelText ? '' : '🔒 '}/s/\${item.code}</span><span class="saved-meta">\${date}\${labelText ? \` · \${labelText}\` : ' · 输入口令后显示详情'}\`</span>\`;
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
                editBtn.onclick = async () => {
                    try {
                        const unlocked2 = await unlockEntry(item.code, '请输入访问口令以载入该订阅的配置。', '载入');
                        if (!unlocked2) return;
                        fillFormFromParams(unlocked2.resp);
                        editingCode = item.code;
                        editingLabel = unlocked2.resp.label || '';
                        editingOldKey = unlocked2.key;
                        renderSavedList(currentSavedItems);
                        showToast('✓ 已载入，保存将更新该短链接', 'success');
                    } catch {
                        showToast('✗ 访问口令错误', 'error');
                    }
                };
                const clearBtn = document.createElement('button');
                clearBtn.className = 'saved-btn saved-btn-danger';
                clearBtn.innerText = '清除';
                clearBtn.onclick = async () => {
                    try {
                        // 已解锁条目自动携带会话内已验证的口令，免重复输入
                        let clearKey = unlockedKeys.get(item.code);
                        if (!clearKey) {
                            const r = await unlockEntry(item.code, '请输入访问口令以清除该订阅的缓存内容。', '清除');
                            if (!r) return;
                            clearKey = r.key;
                        }
                        const resp = await fetch('/api/short/clear', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ code: item.code, key: clearKey }),
                        });
                        const data = await resp.json();
                        if (!resp.ok || !data.success) throw new Error(typeof data === 'string' ? data : data.error || '清除失败');
                        unlockedInfo.delete(item.code);
                        await loadSavedList(savedPager.page);
                        showToast('✓ 已清除，下次访问将重新生成', 'success');
                    } catch (err) {
                        showToast(\`✗ \${err.message || '访问口令错误'}\`, 'error');
                    }
                };
                actions.append(copyBtn, editBtn, clearBtn);
                row.append(info, actions);
                box.appendChild(row);
            });
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
                    setRowSource(row, s);
                });
                (resp.rawUrls || []).forEach(() => addLinkRow(\`links-wrapper-\${modeId}\`, modeId));
                const inputs = wrapper.querySelectorAll('.dynamic-link-input');
                let idx = 0;
                (resp.rawUrls || []).forEach((u) => {
                    if (inputs[idx]) inputs[idx++].value = u;
                });
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

        document.getElementById('savedPrev')?.addEventListener('click', () => turnSavedPage(-1));
        document.getElementById('savedNext')?.addEventListener('click', () => turnSavedPage(1));

        // ===== 原始订阅库管理 =====
        async function loadSourceLibrary() {
            const box = document.getElementById('sourceList');
            if (!box) return;
            try {
                const resp = await fetch('/api/source/list');
                const data = await resp.json();
                if (!resp.ok || !data.success) throw new Error(data.error);
                box.innerHTML = '';
                const items = data.items || [];
                if (!items.length) {
                    box.innerHTML = '<div style="color: var(--text-muted); font-size: 0.8rem;">暂无原始订阅（在订阅链接行点 💾 保存）</div>';
                    return;
                }
                items.forEach((s) => {
                    const row = document.createElement('div');
                    row.className = 'saved-item';
                    const time = s.fetchedAt ? new Date(s.fetchedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
                    const info = document.createElement('div');
                    info.className = 'saved-info';
                    info.innerHTML = \`<span class="saved-mode">🗃️ \${s.name}</span><span class="saved-meta">\${time} 拉取 · 内容加密存储</span>\`;
                    const actions = document.createElement('div');
                    actions.className = 'saved-actions';
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
                    actions.append(refreshBtn, delBtn);
                    row.append(info, actions);
                    box.appendChild(row);
                });
            } catch (err) {
                box.innerHTML = \`<div style="color: var(--text-muted); font-size: 0.8rem;">原始订阅库不可用：\${err.message}</div>\`;
            }
        }

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

        // 名称输入弹窗（原始订阅入库用）
        function askName(message, prefill = '') {
            return new Promise((resolve) => {
                const dlg = document.getElementById('nameDialog');
                const msg = document.getElementById('nameDialogMsg');
                const input = document.getElementById('nameDialogInput');
                const ok = document.getElementById('nameDialogOk');
                const cancel = document.getElementById('nameDialogCancel');
                msg.innerText = message;
                input.value = prefill;
                let settled = false;
                const done = (val) => {
                    if (settled) return;
                    settled = true;
                    ok.onclick = null;
                    cancel.onclick = null;
                    input.onkeydown = null;
                    dlg.close();
                    resolve(val);
                };
                ok.onclick = () => done(input.value.trim() || null);
                cancel.onclick = () => done(null);
                input.onkeydown = (ev) => { if (ev.key === 'Enter') done(input.value.trim() || null); };
                dlg.showModal();
                setTimeout(() => input.focus(), 50);
            });
        }

        // 行 → 已入库标签态（表单持有 id，URL 不落表单）
        function setRowSource(row, src) {
            row.dataset.sourceId = src.id;
            row.dataset.sourceName = src.name;
            const input = row.querySelector('.dynamic-link-input');
            input.style.display = 'none';
            const chip = document.createElement('span');
            chip.className = 'src-chip';
            const label = document.createElement('span');
            label.innerText = \`🗃️ \${src.name}\`;
            const x = document.createElement('span');
            x.className = 'src-chip-x';
            x.innerText = '✕';
            x.title = '移除该订阅源';
            x.onclick = () => clearRowSource(row);
            chip.append(label, x);
            input.insertAdjacentElement('afterend', chip);
        }

        function clearRowSource(row) {
            delete row.dataset.sourceId;
            delete row.dataset.sourceName;
            const chip = row.querySelector('.src-chip');
            if (chip) chip.remove();
            const input = row.querySelector('.dynamic-link-input');
            input.style.display = '';
            input.value = '';
            input.focus();
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
            const name = await askName('将实时拉取该订阅内容并加密保存到服务器，请输入一个简短名称以便后续选用。');
            if (!name) return;
            try {
                showToast('⏳ 正在拉取并保存原始订阅…', 'success');
                const resp = await fetch('/api/source/save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url, name }),
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
                    item.innerText = \`🗃️ \${s.name}\`;
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

        function addLinkRow(containerId, modeId) {
            const linksContainer = document.getElementById(containerId);
            if (!linksContainer) return;
            const newRow = document.createElement('div');
            newRow.className = 'link-row';
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'link-input dynamic-link-input';
            input.placeholder = MODES_META[modeId]?.placeholder || '输入订阅地址';
            const addBtn = document.createElement('div');
            addBtn.className = 'add-btn-circle';
            addBtn.innerText = '＋';
            addBtn.onclick = () => addLinkRow(containerId, modeId);
            const saveBtn = document.createElement('div');
            saveBtn.className = 'row-tool-btn save-btn-circle';
            saveBtn.innerText = '💾';
            saveBtn.title = '保存到原始订阅库（输入名称后实时拉取内容）';
            saveBtn.onclick = () => saveRowToLibrary(newRow);
            const caretBtn = document.createElement('div');
            caretBtn.className = 'row-tool-btn src-caret-btn';
            caretBtn.innerText = '▾';
            caretBtn.title = '选择已保存的原始订阅';
            caretBtn.onclick = () => openSourceDropdown(newRow);
            newRow.append(input, saveBtn, caretBtn, addBtn);
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
            const addFirstBtn = document.createElement('div');
            addFirstBtn.className = 'add-btn-circle';
            addFirstBtn.innerText = '＋';
            addFirstBtn.onclick = () => addLinkRow(\`links-wrapper-\${modeId}\`, modeId);
            const saveFirstBtn = document.createElement('div');
            saveFirstBtn.className = 'row-tool-btn save-btn-circle';
            saveFirstBtn.innerText = '💾';
            saveFirstBtn.title = '保存到原始订阅库（输入名称后实时拉取内容）';
            saveFirstBtn.onclick = () => saveRowToLibrary(firstRow);
            const caretFirstBtn = document.createElement('div');
            caretFirstBtn.className = 'row-tool-btn src-caret-btn';
            caretFirstBtn.innerText = '▾';
            caretFirstBtn.title = '选择已保存的原始订阅';
            caretFirstBtn.onclick = () => openSourceDropdown(firstRow);
            firstRow.appendChild(firstInput);
            firstRow.appendChild(saveFirstBtn);
            firstRow.appendChild(caretFirstBtn);
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
        loadSavedList();
        loadSourceLibrary();
    </script>
</body>

</html>
    `;
}
