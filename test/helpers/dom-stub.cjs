const el = () => ({ style: {}, setAttribute() {}, appendChild() {}, hasChildNodes() { return false; }, removeChild() {}, childNodes: [] });
globalThis.document = {
    documentElement: { tagName: 'svg' },
    createElement: el,
    createElementNS: el,
    getElementById: () => null,
};
if (!globalThis.navigator) globalThis.navigator = { userAgent: 'node' };
globalThis.CanvasRenderingContext2D = function () {};
