// Drag-path exclusions adapted from Tauri 2.11.6 window/scripts/drag.js.
// Copyright 2019-2024 Tauri Programme within The Commons Conservancy.
// SPDX-License-Identifier: Apache-2.0 OR MIT
// Main-window/macOS only. Ordinary dragging remains owned by Tauri.
(() => {
  if (window !== window.top) return;
  const clickableTags = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL', 'SUMMARY']);
  const interactiveRoles = new Set(['button', 'link', 'menuitem', 'tab', 'checkbox', 'radio', 'switch', 'option']);
  function isDragRegion(path) {
    for (const element of path) {
      if (!(element instanceof HTMLElement)) continue;
      const marker = element.getAttribute('data-tauri-drag-region');
      const interactive = clickableTags.has(element.tagName)
        || (element.hasAttribute('contenteditable') && element.getAttribute('contenteditable') !== 'false')
        || (element.hasAttribute('tabindex') && element.getAttribute('tabindex') !== '-1')
        || interactiveRoles.has(element.getAttribute('role'));
      if (interactive && marker === null) return false;
      if (marker === null) continue;
      if (marker === 'false') return false;
      if (marker === 'deep') return true;
      if (marker === '' || marker === 'true') return element === path[0];
    }
    return false;
  }
  let initial = null;
  document.addEventListener('mousedown', event => {
    initial = event.isTrusted && event.button === 0 && event.detail === 2 && isDragRegion(event.composedPath())
      ? { x: event.clientX, y: event.clientY } : null;
  }, true);
  document.addEventListener('mouseup', event => {
    const down = initial;
    initial = null;
    const invoke = window.__TAURI_INTERNALS__?.invoke;
    if (!down || !event.isTrusted || event.button !== 0 || event.detail !== 2
      || event.clientX !== down.x || event.clientY !== down.y
      || !isDragRegion(event.composedPath()) || typeof invoke !== 'function') return;
    // Stop the stock bubble handler even for No Action or a rejected command;
    // a blind maximize fallback would contradict the person's saved choice.
    event.preventDefault();
    event.stopImmediatePropagation();
    void invoke('squad_titlebar_double_click').catch(error => console.warn('Squad titlebar action failed:', error));
  }, true);
})();
