const styleSheet = globalThis.CSSStyleSheet;

if (typeof styleSheet === 'function' && !styleSheet.prototype.replaceSync) {
  styleSheet.prototype.replaceSync = function replaceSync(this: CSSStyleSheet, text: string) {
    Object.defineProperty(this, 'cssText', { value: text, writable: true, configurable: true });
  };
  styleSheet.prototype.replace = function replace(this: CSSStyleSheet, text: string) {
    this.replaceSync(text);
    return Promise.resolve(this);
  };
}

for (const target of [Document.prototype, ShadowRoot.prototype]) {
  if (!('adoptedStyleSheets' in target)) {
    Object.defineProperty(target, 'adoptedStyleSheets', {
      value: [],
      writable: true,
      configurable: true,
    });
  }
}
