(function () {
  "use strict";

  const DEFAULT_OPTIONS = {
    budgetMs: 8,
    chunkSize: 220,
    debug: false,
    fallbackTerms: true,
    maxTextLength: 260,
    translateAttributes: true
  };
  const MAX_TRANSLATION_CACHE_SIZE = 6000;

  const SKIP_SELECTOR = [
    "#hidden-input-activedescendant",
    "[class*='fullscreen_accessibility_tree']",
    "canvas",
    "svg",
    "img",
    "video",
    "audio",
    "input",
    "textarea",
    "select",
    "option",
    "script",
    "style",
    "noscript",
    "code",
    "pre",
    "[contenteditable]:not([contenteditable='false'])",
    "[role='textbox']",
    "[data-testid='canvas']",
    "[data-testid='canvas-root']",
    "[data-testid='canvas_viewport']",
    "[data-testid='fullscreen-viewport']",
    "[data-testid='viewport']",
    "[data-onboarding-key='canvas']",
    "[data-figma-canvas='true']",
    "[data-figma-zh-skip='1']"
  ].join(",");

  const EDITABLE_SELECTOR = [
    "input",
    "textarea",
    "select",
    "[contenteditable]:not([contenteditable='false'])",
    "[role='textbox']",
    "[aria-multiline='true']"
  ].join(",");

  const USER_NAMED_CONTENT_SELECTOR = [
    "[data-testid*='page-name' i]",
    "[data-testid*='page_name' i]",
    "[data-testid*='page-row' i]",
    "[data-testid*='page_row' i]",
    "[class*='page_name' i]",
    "[class*='page_row' i]",
    "[class*='pageName']",
    "[class*='pageRow']",
    "[aria-label='Left sidebar'] [role='grid']",
    "[aria-label='左侧边栏'] [role='grid']",
    "[data-testid*='file-name' i]",
    "[data-testid*='filename' i]",
    "[data-testid*='project-name' i]",
    "[data-testid*='team-name' i]",
    "[data-testid*='workspace-name' i]",
    "[data-testid*='folder-name' i]",
    "[data-testid*='resource-name' i]",
    "[data-testid*='file-title' i]",
    "[data-testid*='project-title' i]",
    "a[href*='/file/']",
    "a[href*='/design/']",
    "a[href*='/board/']",
    "a[href*='/slides/']",
    "a[href*='/proto/']",
    "a[href*='/files/project/']",
    "a[href*='/team/']"
  ].join(",");

  const ATTR_SKIP_SELECTOR = [
    "#hidden-input-activedescendant",
    "[class*='fullscreen_accessibility_tree']",
    "canvas",
    "svg",
    "img",
    "video",
    "audio",
    "script",
    "style",
    "noscript",
    "[contenteditable]:not([contenteditable='false'])",
    "[role='textbox']",
    "[data-testid='canvas']",
    "[data-testid='canvas-root']",
    "[data-testid='canvas_viewport']",
    "[data-testid='fullscreen-viewport']",
    "[data-testid='viewport']",
    "[data-onboarding-key='canvas']",
    "[data-figma-canvas='true']",
    "[data-figma-zh-skip='1']"
  ].join(",");

  const STATE_ATTR = "data-figma-zh-localized";
  const PENDING_ATTR = "data-figma-zh-pending";
  const COMPACT_TEXT_ATTR = "data-figma-zh-compact-text";
  const TOOLTIP_ATTR = "data-figma-zh-tooltip";
  const GRADIENT_MENU_ATTR = "data-figma-zh-gradient-menu";
  const ORIGINAL_TEXT_KEY = "__figmaZhOriginalText";
  const TRANSLATED_TEXT_KEY = "__figmaZhTranslatedText";
  const ORIGINAL_ATTR_KEY = "__figmaZhOriginalAttrs";
  const TRANSLATED_ATTR_KEY = "__figmaZhTranslatedAttrs";
  const TRANSLATABLE_ATTRS = ["aria-label", "title", "placeholder"];
  const FONT_STYLE_RESTORABLE_ATTRS = ["aria-label", "title", "data-value", "aria-valuetext"];
  const ATTRIBUTE_NAMES = [...new Set([...TRANSLATABLE_ATTRS, ...FONT_STYLE_RESTORABLE_ATTRS])];
  const SKIP_TAGS = new Set(["canvas", "svg", "img", "video", "audio", "option", "script", "style", "noscript", "code", "pre"]);
  const SKIP_TEST_IDS = new Set(["canvas", "canvas-root", "canvas_viewport", "fullscreen-viewport", "viewport"]);

  // The walker has already checked the root's ancestors. Test only the child
  // itself here, without running a long selector for every decorative wrapper.
  function isSkippableSubtree(element) {
    const editable = element.getAttribute("contenteditable");
    return SKIP_TAGS.has(element.localName)
      || element.id === "hidden-input-activedescendant"
      || String(element.className).includes("fullscreen_accessibility_tree")
      || (editable !== null && editable !== "false")
      || element.getAttribute("role") === "textbox"
      || SKIP_TEST_IDS.has(element.getAttribute("data-testid"))
      || element.getAttribute("data-onboarding-key") === "canvas"
      || element.getAttribute("data-figma-canvas") === "true"
      || element.getAttribute("data-figma-zh-skip") === "1";
  }

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function preserveOuterWhitespace(original, translated) {
    const prefix = original.match(/^\s*/)[0];
    const suffix = original.match(/\s*$/)[0];
    return `${prefix}${translated}${suffix}`;
  }

  function createTranslator(dictionary) {
    const exact = new Map(Object.entries(dictionary.exact || {}));
    const uiTerms = Object.entries(dictionary.uiTerms || {})
      .filter(([from, to]) => from && to)
      .sort((a, b) => b[0].length - a[0].length);
    const commonTerms = Object.entries(dictionary.commonTerms || {})
      .filter(([from, to]) => from && to);
    const fallbackTermPairs = [...uiTerms, ...commonTerms]
      .sort((a, b) => b[0].length - a[0].length);
    const fallbackTermRules = fallbackTermPairs.map(([from, to]) => {
      const boundary = /^[A-Za-z0-9 ]+$/.test(from);
      const flags = from.length > 1 && /^[A-Za-z][A-Za-z0-9 ]*$/.test(from) ? "gi" : "g";
      const pattern = boundary
        ? new RegExp(`(?<![A-Za-z0-9_])${escapeRegExp(from)}(?![A-Za-z0-9_])`, flags)
        : new RegExp(escapeRegExp(from), flags);
      return [pattern, to];
    });
    const phrases = (dictionary.phrases || [])
      .filter((item) => Array.isArray(item) && item.length === 2)
      .sort((a, b) => b[0].length - a[0].length);
    const patterns = (dictionary.patterns || [])
      .filter((item) => Array.isArray(item) && item.length >= 2)
      .map(([source, replacement, flags, allowAscii, preserveCaptures]) => [
        new RegExp(source, flags || ""), replacement, Boolean(allowAscii), Boolean(preserveCaptures)
      ]);
    const cache = new Map();
    const allowedAsciiTokens = new Set([
      "AI",
      "Buzz",
      "Ctrl",
      "FigJam",
      "Figma",
      "GitHub",
      "Google",
      "JSON",
      "Make",
      "Site",
      "Slides",
      "X",
      "Y",
    "YouTube"
    ]);
    const protectedAsciiTokens = new Set([
      ...allowedAsciiTokens,
      "Android",
      "API",
      "Beta",
      "Chrome",
      "iOS",
      "macOS",
      "Microsoft",
      "MicroMessenger",
      "Windows"
    ]);

    function escapeRegExp(value) {
      return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    function looksLikeProtectedContent(value) {
      const text = normalizeText(value);
      if (!text) return false;
      if (/^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$/.test(text)) return true;
      if (/\b\d{1,3}(?:\.\d{1,3}){3}\b/.test(text)) return true;
      if (/^[a-z]+(?:_[a-z]+)+(?::[a-z]+)+$/.test(text)) return true;
      if (/^[A-Za-z0-9._/-]+\.(json|fig|png|jpe?g|gif|webp|svg|pdf|zip)$/i.test(text)) return true;
      if (/^[A-Za-z]:\\/.test(text) || /^\/[\w./-]+$/.test(text)) return true;
      if (/^[A-Z]{2,8}$/.test(text)) return true;
      return false;
    }

    function looksLikeUserContent(value) {
      const text = normalizeText(value);
      if (!text) return false;
      if (/^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$/.test(text)) return true;
      if (/^[\w\u4e00-\u9fff .'-]{1,48}'s\s+/i.test(text)) return true;
      if (/^[\w\u4e00-\u9fff .'-]{1,64}$/.test(text) && !exact.has(text)) return false;
      return false;
    }

    function isSafeForTermFallback(value) {
      if (!value || value.length > 96) return false;
      if (/^[-+]?[\d.,]+%?$/.test(value)) return false;
      if (/^#[0-9a-f]{3,8}$/i.test(value)) return false;
      if (/\.(json|fig|png|jpe?g|gif|webp|svg|pdf|zip)$/i.test(value)) return false;
      if (/^[A-Z]$/.test(value)) return false;
      return true;
    }

    function hasUntranslatedAscii(value) {
      const matches = String(value || "").match(/\b[A-Za-z][A-Za-z0-9]*\b/g) || [];
      return matches.some((token) => !allowedAsciiTokens.has(token));
    }

    function hasOnlyProtectedAscii(value) {
      const matches = String(value || "").match(/\b[A-Za-z][A-Za-z0-9]*\b/g) || [];
      return matches.length > 0 && matches.every((token) => protectedAsciiTokens.has(token));
    }

    function cacheResult(key, value) {
      if (cache.size >= MAX_TRANSLATION_CACHE_SIZE) {
        cache.delete(cache.keys().next().value);
      }
      cache.set(key, value);
      return value;
    }

    function replaceUiTerms(value) {
      if (!isSafeForTermFallback(value)) return null;

      let next = value;
      let changed = false;
      for (const [pattern, to] of fallbackTermRules) {
        next = next.replace(pattern, () => {
          changed = true;
          return to;
        });
      }
      next = next.replace(/([\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])/g, "$1");

      if (changed && hasUntranslatedAscii(next)) return null;

      return changed && /[\u4e00-\u9fff]/.test(next) ? next : null;
    }

    function translate(value, runtimeOptions) {
      const normalized = normalizeText(value);
      if (!normalized) return null;
      const fallbackTerms = !runtimeOptions || runtimeOptions.fallbackTerms !== false;
      const cacheKey = `${fallbackTerms ? "1" : "0"}:${normalized}`;
      if (cache.has(cacheKey)) return cache.get(cacheKey);

      const exactMatch = exact.get(normalized);
      if (exactMatch) {
        const result = preserveOuterWhitespace(value, exactMatch);
        return cacheResult(cacheKey, result);
      }

      const mcpServerStatus = normalized.match(/^MCP server enabled on (.+)$/);
      if (mcpServerStatus) {
        const result = preserveOuterWhitespace(value, `MCP 服务器已启用：${mcpServerStatus[1]}`);
        return cacheResult(cacheKey, result);
      }

      if (looksLikeProtectedContent(normalized)) return null;

      for (const [pattern, replacement, allowAscii, preserveCaptures] of patterns) {
        if (pattern.test(normalized)) {
          let next = normalized.replace(pattern, replacement);
          if (fallbackTerms && !preserveCaptures && /[A-Za-z]/.test(next)) {
            next = replaceUiTerms(next) || next;
          }
          if (!allowAscii && hasUntranslatedAscii(next)) continue;
          const result = preserveOuterWhitespace(value, next);
          return cacheResult(cacheKey, result);
        }
      }

      if (/[\u4e00-\u9fff]/.test(normalized)) {
        return cacheResult(cacheKey, null);
      }

      let next = normalized;
      let changed = false;
      for (const [from, to] of phrases) {
        if (next.includes(from)) {
          next = next.split(from).join(to);
          changed = true;
        }
      }

      if (fallbackTerms && (!changed || /[A-Za-z]/.test(next))) {
        const termMatch = replaceUiTerms(next);
        if (termMatch) {
          next = termMatch;
          changed = true;
        }
      }

      if (changed && hasUntranslatedAscii(next)) {
        return cacheResult(cacheKey, null);
      }

      const result = changed ? preserveOuterWhitespace(value, next) : null;
      return cacheResult(cacheKey, result);
    }

    function classifyUntranslated(value) {
      const text = normalizeText(value);
      if (!text || !/[A-Za-z]/.test(text)) return "none";
      if (looksLikeProtectedContent(text) || hasOnlyProtectedAscii(text)) return "protected";
      if (looksLikeUserContent(text)) return "userContent";
      return "ui";
    }

    return { translate, classifyUntranslated };
  }

  function isSkippableElement(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
    return Boolean(closestInBatch(element, SKIP_SELECTOR));
  }

  function isAttributeSkippableElement(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
    return Boolean(closestInBatch(element, ATTR_SKIP_SELECTOR));
  }

  function isEditableElement(element) {
    return Boolean(
      element
      && element.nodeType === Node.ELEMENT_NODE
      && (
        element.isContentEditable
        || Boolean(closestInBatch(element, EDITABLE_SELECTOR))
      )
    );
  }

  function isEditableNode(node) {
    if (!node) return false;
    if (node.nodeType === Node.TEXT_NODE) return isEditableElement(node.parentElement);
    return node.nodeType === Node.ELEMENT_NODE && isEditableElement(node);
  }

  function isLayerTreeContentElement(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
    return Boolean(closestInBatch(element,
      "[role='treeitem'],[data-testid*='layer-row' i],[data-testid*='layer_item' i],[data-testid*='layer-item' i],[data-testid*='layer-node' i],[data-testid*='layer_node' i]"
    ));
  }

  function looksLikeUserProvidedName(value) {
    const text = normalizeText(value);
    if (!text || text.length > 96) return false;
    if (!/[A-Za-z0-9\u4e00-\u9fff]/.test(text)) return false;
    if (/[。！？?：:;]/.test(text)) return false;
    return true;
  }

  function isFileBrowserRoute() {
    return /\/files(?:\/|$)|\/file_browser(?:\/|$)|\/team\//.test(window.location.pathname);
  }

  const FILE_BROWSER_SYSTEM_TITLES = new Set([
    "Drafts",
    "Recent",
    "Recents",
    "Recently viewed"
  ]);

  function isUserNamedContentElement(element, text) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
    if (closestInBatch(element, USER_NAMED_CONTENT_SELECTOR)) return true;
    if (!looksLikeUserProvidedName(text)) return false;
    if (FILE_BROWSER_SYSTEM_TITLES.has(normalizeText(text))) return false;
    if (!isFileBrowserRoute()) return false;
    // These titles are also valid user names. Exempt only the system heading
    // on its own route, outside the file list and named controls.
    const routeTitle = (normalizeText(text) === "Trash" && /^\/files\/team\/[^/]+\/trashed\/?$/.test(window.location.pathname))
      || (normalizeText(text) === "Resources" && /^\/files\/team\/[^/]+\/resources\/(?:internal|community)\/?$/.test(window.location.pathname));
    if (routeTitle
      && closestInBatch(element, "h1") && !closestInBatch(element, "main,button,[role='button']")) return false;
    return Boolean(closestInBatch(element, "h1,h2,[role='heading']"));
  }

  function isTextInputElement(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
    if (element.matches("textarea")) return true;
    if (!element.matches("input")) return false;
    const type = (element.getAttribute("type") || "text").toLowerCase();
    return !/^(button|checkbox|color|file|hidden|image|radio|range|reset|submit)$/.test(type);
  }

  function isInBodyRegion(node) {
    if (!node || !document.body) return false;
    if (node === document.body) return true;
    if (node.nodeType === Node.TEXT_NODE) return Boolean(node.parentElement && document.body.contains(node.parentElement));
    return Boolean(node.nodeType === Node.ELEMENT_NODE && document.body.contains(node));
  }

  function isIconOnlyControlElement(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
    if (!element.matches("button,a,[role='button'],[role='menuitem'],[role='option']")) return false;

    const text = normalizeText(element.textContent);
    const hasReadableText = /[A-Za-z0-9\u4e00-\u9fff]/.test(text);
    if (hasReadableText) return false;

    return Boolean(
      element.querySelector("svg,use,path")
      || element.hasAttribute("data-tooltip")
      || element.hasAttribute("aria-label")
      || element.hasAttribute("title")
    );
  }

  function shouldTranslateAttribute(element, name) {
    // These accessibility landmarks also define the content protection boundary.
    if (name === "aria-label" && /^(?:Left sidebar|Right sidebar|Canvas|Canvas viewport)$/.test(element.getAttribute(name) || "")) return false;
    if (isLayerTreeContentElement(element)) return false;
    if (isUserNamedContentElement(element, element.getAttribute(name))) return false;
    if (isFontStyleAttributeValue(element, element.getAttribute(name))) return false;
    if (name === "placeholder") return true;
    return !isIconOnlyControlElement(element);
  }

  function isProductFilterTerm(node) {
    const text = normalizeText(node && node.nodeValue);
    if (text !== "Design" && text !== "Prototype") return false;
    if (/\bfiles\b/.test(window.location.pathname)) return true;

    let element = node.parentElement;
    for (let depth = 0; element && depth < 10; depth += 1, element = element.parentElement) {
      const scopeText = normalizeText(element.textContent);
      if (scopeText.length > 1200) continue;
      const productHits = ["FigJam", "Slides", "Buzz", "Site", "Make"]
        .filter((term) => new RegExp(`\\b${term}\\b`).test(scopeText)).length;
      if (productHits >= 2) return true;
    }

    return false;
  }

  const FONT_STYLE_OPTION_TERMS = new Set([
    "Default",
    "Thin",
    "ExtraLight",
    "Extra Light",
    "Light",
    "Normal",
    "Regular",
    "Medium",
    "Semi Bold",
    "SemiBold",
    "Bold",
    "ExtraBold",
    "Extra Bold",
    "Heavy",
    "Black",
    "Thin Italic",
    "ExtraLight Italic",
    "Extra Light Italic",
    "Light Italic",
    "Italic",
    "Medium Italic",
    "SemiBold Italic",
    "Semi Bold Italic",
    "Bold Italic",
    "ExtraBold Italic",
    "Extra Bold Italic",
    "Heavy Italic",
    "Black Italic",
    "Variable font axes..."
  ]);

  const TRANSLATED_FONT_STYLE_TERMS = new Map([
    ["默认", "Default"],
    ["浅色", "Light"],
    ["正常", "Normal"],
    ["常规", "Regular"],
    ["中", "Medium"],
    ["中等", "Medium"],
    ["加粗", "Bold"],
    ["斜体", "Italic"],
    ["加粗/斜体", "Bold Italic"]
  ]);

  function isFontStyleTermText(text) {
    return Boolean(getFontStyleSourceTerm(text));
  }

  function getFontStyleSourceTerm(text) {
    const normalized = normalizeText(text).replace(/^[✓✔]\s*/, "");
    if (FONT_STYLE_OPTION_TERMS.has(normalized)) return normalized;
    return TRANSLATED_FONT_STYLE_TERMS.get(normalized) || "";
  }

  function preserveFontStyleMarker(original, translated) {
    const marker = String(original || "").match(/^(\s*[✓✔]\s*)/);
    if (!marker) return preserveOuterWhitespace(original, translated);
    const suffix = String(original || "").match(/\s*$/)[0];
    return `${marker[1]}${translated}${suffix}`;
  }

  const GRADIENT_TYPE_TERMS = new Map([
    ["Linear", "线性渐变"],
    ["Radial", "径向渐变"],
    ["Angular", "角度渐变"],
    ["Diamond", "菱形渐变"]
  ]);
  const TRANSLATED_GRADIENT_TYPE_TERMS = new Map([
    ["线性", "Linear"],
    ["径向", "Radial"],
    ["角度", "Angular"],
    ["菱形", "Diamond"]
  ]);

  function getElementControlContextText(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return "";

    const pieces = [normalizeText(element.textContent)];
    const addValue = (value) => {
      const text = normalizeText(value);
      if (text && text.length <= 120) pieces.push(text);
    };
    const collectFrom = (target) => {
      if (!target || target.nodeType !== Node.ELEMENT_NODE) return;
      if (isTextInputElement(target)) addValue(target.value);
      if (target.matches("select")) {
        addValue(target.value);
        const selected = target.selectedOptions && target.selectedOptions[0];
        if (selected) addValue(selected.textContent);
      }
      for (const attr of ["aria-label", "title", "data-tooltip", "data-testid", "data-value"]) {
        addValue(target.getAttribute(attr));
      }
    };

    collectFrom(element);
    const controls = element.querySelectorAll("input,textarea,select,[aria-label],[title],[data-tooltip],[data-testid],[data-value]");
    for (const control of controls) collectFrom(control);

    return normalizeText(pieces.join(" "));
  }

  function hasNearbyFontStyleControlContext(startElement, styleText) {
    let element = startElement;
    for (let depth = 0; element && depth < 8; depth += 1, element = element.parentElement) {
      const parent = element.parentElement;
      if (!parent || !parent.children) continue;

      if (hasTypographyPanelContext(parent, styleText)) return true;
      if (hasCompactFontStyleRowContext(element, styleText)) return true;

      const siblings = Array.from(parent.children);
      const index = siblings.indexOf(element);
      if (index < 0) continue;

      const before = siblings.slice(Math.max(0, index - 2), index)
        .map((item) => getElementControlContextText(item));
      const after = siblings.slice(index + 1, Math.min(siblings.length, index + 3))
        .map((item) => getElementControlContextText(item));
      const current = getElementControlContextText(element);
      const nearby = [...before, current, ...after].join(" ");
      const parentText = getElementControlContextText(parent);
      const hasTypographyControls = /(?:Typography|Letter spacing|Line height|Text align|排版|字距|行高|对齐方式)/.test(parentText);
      const hasNearbyFontSize = /\b(?:[8-9]|[1-9]\d|1\d\d)\b/.test(nearby);
      const hasNearbyFontFamily = before.some((value) => (
        /[A-Za-z]/.test(value)
        && !isFontStyleTermText(value)
        && !/(?:Typography|Letter spacing|Line height|Text align)/.test(value)
        && !/(?:排版|字距|行高|对齐方式)/.test(value)
        && !/\b(?:[8-9]|[1-9]\d|1\d\d)\b/.test(value)
        && value.length <= 64
      ));

      if (hasTypographyControls && hasNearbyFontFamily && hasNearbyFontSize) {
        return true;
      }
    }

    return false;
  }

  function hasCompactFontStyleRowContext(startElement, styleText) {
    if (!startElement || startElement.nodeType !== Node.ELEMENT_NODE) return false;

    const row = startElement.parentElement;
    if (!row || !row.children) return false;

    const rowText = getElementControlContextText(row);
    if (!rowText.includes(styleText)) return false;
    if (!/\b(?:[8-9]|[1-9]\d|1\d\d)\b/.test(rowText)) return false;

    let element = row;
    for (let depth = 0; element && depth < 7; depth += 1, element = element.parentElement) {
      const scopeText = getElementControlContextText(element);
      if (!scopeText || scopeText.length > 1800) continue;
      if (!scopeText.includes(styleText)) continue;
      if (!/(?:Typography|Line height|Letter spacing|Text align|Font size|排版|行高|字距|对齐方式|字号|字重)/.test(scopeText)) continue;
      if (hasTypographyFontContext(scopeText, styleText)) {
        return true;
      }
    }

    return false;
  }

  function hasTypographyFontContext(scopeText, styleText) {
    if (/(?:Inter|PingFang|Newsreader|Roboto|Arial|Helvetica|SF Pro|Noto Sans|Source Han|MiSans|HarmonyOS|Microsoft YaHei|苹方|微软雅黑)/i.test(scopeText)) {
      return true;
    }

    const textWithoutStyle = normalizeText(scopeText.replace(styleText, " "));
    const hasLikelyFontFamily = textWithoutStyle.split(/\s+/).some((token) => (
      /^[A-Z][A-Za-z0-9 ._-]{2,63}$/.test(token)
      && !isFontStyleTermText(token)
      && !/^(?:Typography|Line|height|Letter|spacing|Text|align|Font|size|Auto|px)$/i.test(token)
    ));
    const hasTypographyShape = /(?:Typography|排版)/.test(scopeText)
      && /(?:Line height|Letter spacing|Text align|行高|字距|对齐方式)/.test(scopeText)
      && /\b(?:[8-9]|[1-9]\d|1\d\d)\b/.test(scopeText);

    return hasLikelyFontFamily && hasTypographyShape;
  }

  function hasTypographyPanelContext(element, styleText) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;

    const scopeText = getElementControlContextText(element);
    if (!scopeText || scopeText.length > 1400) return false;
    if (!scopeText.includes(styleText)) return false;

    const hasTypographyControls = /(?:Typography|Line height|Letter spacing|Text align|Font size|排版|行高|字距|对齐方式|字号|字重)/.test(scopeText);
    if (!hasTypographyControls) return false;

    const hasFontSize = /\b(?:[8-9]|[1-9]\d|1\d\d)\b/.test(scopeText);
    const hasFontFamily = hasTypographyFontContext(scopeText, styleText);
    const hasFontControlShape = hasFontSize || /(?:Line height|Letter spacing|行高|字距)/.test(scopeText);

    return hasFontControlShape && hasFontFamily;
  }

  function hasNearbyFontStyleMenuContext(startElement, styleText) {
    let element = startElement;
    for (let depth = 0; element && depth < 4; depth += 1, element = element.parentElement) {
      const parent = element.parentElement;
      if (!parent || !parent.children) continue;

      const siblings = Array.from(parent.children).map((item) => normalizeText(item.textContent));
      let index = siblings.indexOf(styleText);
      if (index < 0) index = siblings.indexOf(normalizeText(element.textContent));
      if (index < 0) continue;

      const styleHits = siblings.filter((value) => isFontStyleTermText(value)).length;
      const hasVariableAction = siblings.some((value) => /(?:Apply variable|应用变量)/.test(value));
      const hasDistinctFontStyleTerm = siblings.some((value) => (
        /(?:Default|ExtraLight|Normal|Regular|Medium|Heavy|Semi Bold|SemiBold|Extra Bold|ExtraBold|Italic|Thin Italic|Variable font axes)/.test(value)
        || TRANSLATED_FONT_STYLE_TERMS.has(value)
      ));
      if (
        styleHits >= 5
        && hasDistinctFontStyleTerm
      ) {
        return true;
      }
      if (styleHits >= 2 && hasDistinctFontStyleTerm && hasMenuLikeControls(parent)) return true;
      if (styleHits >= 1 && hasDistinctFontStyleTerm && hasVariableAction && hasMenuLikeControls(parent)) return true;

      if (normalizeText(element.textContent) !== styleText) break;
    }

    return false;
  }

  function findNearbyFontStyleMenuContainer(startElement, styleText) {
    const source = getFontStyleSourceTerm(styleText) || styleText;
    let element = startElement;
    for (let depth = 0; element && depth < 8; depth += 1, element = element.parentElement) {
      if (!element.children) continue;

      const scopeText = normalizeText(element.textContent);
      if (!scopeText || scopeText.length > 1600) continue;
      if (!scopeText.includes(styleText) && !scopeText.includes(source)) continue;

      const itemTexts = Array.from(element.querySelectorAll("[role='option'],[role='menuitem'],button,[data-value]"))
        .map((item) => normalizeText(item.textContent) || normalizeText(item.getAttribute("data-value")));
      const directTexts = Array.from(element.children).map((item) => normalizeText(item.textContent));
      const terms = [...itemTexts, ...directTexts].map((value) => getFontStyleSourceTerm(value)).filter(Boolean);
      const uniqueTerms = new Set(terms);
      const hasVariableAction = /(?:Apply variable|应用变量)/.test(scopeText);
      if (uniqueTerms.size < 2 && !hasVariableAction) continue;
      if (!uniqueTerms.has(source)) continue;

      if (
        element.matches("[role='menu'],[role='listbox'],[role='dialog'],[data-testid*='dropdown' i],[data-testid*='popover' i]")
        || element.querySelector("[role='option'],[role='menuitem'],button,[data-value]")
      ) {
        return element;
      }
    }

    return null;
  }

  function isFontStyleControlTerm(node) {
    const text = normalizeText(node && node.nodeValue);
    if (!FONT_STYLE_OPTION_TERMS.has(text)) return false;
    if (hasNearbyFontStyleControlContext(node.parentElement, text)) return true;
    if (hasNearbyFontStyleMenuContext(node.parentElement, text)) return true;
    if (findNearbyFontStyleMenuContainer(node.parentElement, text)) return true;
    return false;
  }

  function getTranslatedFontStyleSourceTerm(node) {
    const text = normalizeText(node && node.nodeValue);
    const source = getFontStyleSourceTerm(text);
    if (!source) return "";
    if (source === text) return "";
    if (hasNearbyFontStyleControlContext(node.parentElement, text)) return source;
    if (hasNearbyFontStyleMenuContext(node.parentElement, source)) return source;
    if (findNearbyFontStyleMenuContainer(node.parentElement, text)) return source;
    return "";
  }

  function getTranslatedFontStyleAttributeSource(element, value) {
    const text = normalizeText(value);
    const source = TRANSLATED_FONT_STYLE_TERMS.get(text);
    if (!source) return "";
    if (hasNearbyFontStyleControlContext(element, text)) return source;
    if (hasNearbyFontStyleMenuContext(element, source)) return source;
    if (findNearbyFontStyleMenuContainer(element, text)) return source;
    return "";
  }

  function isFontStyleAttributeValue(element, value) {
    const source = getFontStyleSourceTerm(value);
    if (!source) return false;
    if (hasNearbyFontStyleControlContext(element, source)) return true;
    if (hasNearbyFontStyleMenuContext(element, source)) return true;
    if (findNearbyFontStyleMenuContainer(element, value)) return true;
    return false;
  }

  function getFontStyleAttributeSelector() {
    return Array.from(new Set([...TRANSLATABLE_ATTRS, ...FONT_STYLE_RESTORABLE_ATTRS]))
      .map((name) => `[${name}]`)
      .join(",");
  }

  function getGradientTypeTranslation(node) {
    const text = normalizeText(node && node.nodeValue);
    const source = getGradientTypeSourceTerm(text);
    const translated = GRADIENT_TYPE_TERMS.get(source);
    if (!translated) return "";
    if (text === translated) return "";

    let element = node.parentElement;
    for (let depth = 0; element && depth < 6; depth += 1, element = element.parentElement) {
      if (element.getAttribute(GRADIENT_MENU_ATTR) === "1") return translated;
      const scopeText = normalizeText(element.textContent);
      if (scopeText.length > 240) continue;
      const hits = countGradientTypeHits(scopeText);
      if (hits >= 3) {
        element.setAttribute(GRADIENT_MENU_ATTR, "1");
        normalizeGradientTypeDescendants(element);
        return translated;
      }
    }

    if (hasNearbyGradientTypeMenuContext(node.parentElement, true)) {
      return translated;
    }

    if (hasNearbyGradientControlContext(node.parentElement, true)) {
      return translated;
    }

    if (hasNearbyGradientEditorContext(node.parentElement, true)) {
      return translated;
    }

    return "";
  }

  function getGradientTypeSourceTerm(text) {
    return GRADIENT_TYPE_TERMS.has(text)
      ? text
      : TRANSLATED_GRADIENT_TYPE_TERMS.get(text);
  }

  function wouldTranslateGradientType(node) {
    const text = normalizeText(node && node.nodeValue);
    const source = getGradientTypeSourceTerm(text);
    const translated = GRADIENT_TYPE_TERMS.get(source);
    if (!translated || text === translated) return false;

    let element = node.parentElement;
    for (let depth = 0; element && depth < 6; depth += 1, element = element.parentElement) {
      if (element.getAttribute(GRADIENT_MENU_ATTR) === "1") return true;
      const scopeText = normalizeText(element.textContent);
      if (scopeText.length <= 240 && countGradientTypeHits(scopeText) >= 3) return true;
    }

    return (
      hasNearbyGradientTypeMenuContext(node.parentElement, false)
      || hasNearbyGradientControlContext(node.parentElement, false)
      || hasNearbyGradientEditorContext(node.parentElement, false)
    );
  }

  function countGradientTypeHits(text) {
    const normalized = normalizeText(text);
    let hits = 0;
    for (const term of GRADIENT_TYPE_TERMS.keys()) {
      if (new RegExp(`\\b${term}\\b`).test(normalized)) hits += 1;
    }
    for (const term of TRANSLATED_GRADIENT_TYPE_TERMS.keys()) {
      if (normalized.includes(term)) hits += 1;
    }
    return hits;
  }

  function hasNearbyGradientTypeMenuContext(startElement, normalizeMatches) {
    let element = startElement;
    for (let depth = 0; element && depth < 7; depth += 1, element = element.parentElement) {
      const parent = element.parentElement;
      if (!parent || !parent.children) continue;

      const siblingText = Array.from(parent.children)
        .map((item) => normalizeText(item.textContent))
        .filter(Boolean)
        .join(" ");
      const currentText = normalizeText(element.textContent);
      const combined = `${siblingText} ${currentText}`;
      if (combined.length <= 260 && countGradientTypeHits(combined) >= 3) {
        if (normalizeMatches) {
          parent.setAttribute(GRADIENT_MENU_ATTR, "1");
          normalizeGradientTypeDescendants(parent);
        }
        return true;
      }
    }

    return false;
  }

  function normalizeGradientTypeDescendants(root) {
    if (!root || root.nodeType !== Node.ELEMENT_NODE) return;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const text = normalizeText(node.nodeValue);
      if (isEditableElement(node.parentElement)) {
        node = walker.nextNode();
        continue;
      }
      const source = getGradientTypeSourceTerm(text);
      const translated = GRADIENT_TYPE_TERMS.get(source);
      if (translated && text !== translated) {
        node[ORIGINAL_TEXT_KEY] = node[ORIGINAL_TEXT_KEY] || node.nodeValue;
        node[TRANSLATED_TEXT_KEY] = preserveOuterWhitespace(node.nodeValue, translated);
        node.nodeValue = node[TRANSLATED_TEXT_KEY];
        markChangedElement(node.parentElement, text, translated);
      }
      node = walker.nextNode();
    }
  }

  function hasNearbyGradientControlContext(startElement, normalizeMatches) {
    let element = startElement;
    for (let depth = 0; element && depth < 8; depth += 1, element = element.parentElement) {
      const scopeText = normalizeText(element.textContent);
      if (scopeText.length > 360) continue;

      const hasPaintContext = /(?:Fill|Stroke|Selected colors|Gradient|填充|描边|所选(?:项)?颜色|渐变)/.test(scopeText);
      const hasPaintValue = /(?:#[0-9A-Fa-f]{3,8}|\d{1,3}\s*%|00[0-9A-Fa-f]{4})/.test(scopeText);
      const hasGradientType = countGradientTypeHits(scopeText) > 0;

      if (hasPaintContext && hasPaintValue && hasGradientType) {
        if (normalizeMatches) {
          element.setAttribute(GRADIENT_MENU_ATTR, "1");
          normalizeGradientTypeDescendants(element);
        }
        return true;
      }
    }

    return false;
  }

  function hasNearbyGradientEditorContext(startElement, normalizeMatches) {
    let element = startElement;
    for (let depth = 0; element && depth < 8; depth += 1, element = element.parentElement) {
      const scopeText = normalizeText(element.textContent);
      if (scopeText.length > 720) continue;

      const hasStopContext = /(?:Stops|Color stops|Gradient stop|Spread|色标|渐变断点|扩散)/.test(scopeText);
      const hasPaintValue = /(?:#[0-9A-Fa-f]{3,8}|\d{1,3}\s*%|00[0-9A-Fa-f]{4})/.test(scopeText);
      const hasGradientType = countGradientTypeHits(scopeText) > 0;

      if (hasStopContext && hasPaintValue && hasGradientType) {
        if (normalizeMatches) {
          element.setAttribute(GRADIENT_MENU_ATTR, "1");
          normalizeGradientTypeDescendants(element);
        }
        return true;
      }
    }

    return false;
  }

  function shouldTranslateTextNode(node, options, protectionChecked) {
    if (!node || node.nodeType !== Node.TEXT_NODE) return false;
    if (!node.nodeValue || !/[A-Za-z]/.test(node.nodeValue)) return false;
    if (node.nodeValue.trim().length > DEFAULT_OPTIONS.maxTextLength) return false;
    if (isProductFilterTerm(node)) return false;
    if (isFontStyleControlTerm(node)) return false;
    if (protectionChecked) return true;
    const parent = node.parentElement;
    if (!parent || isSkippableElement(parent)) return false;
    if (isLayerTreeContentElement(parent)) return false;
    if (isUserNamedContentElement(parent, node.nodeValue)
      && !(options && options.allowProtectedElement && options.allowProtectedElement(parent, node.nodeValue))) return false;
    if (isEditableElement(parent)) return false;
    return true;
  }

  function shouldKeepTranslatedTextOnOneLine(element, original, translated) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;

    const source = normalizeText(original);
    const target = normalizeText(translated);
    if (!source || !target) return false;
    if (target.length > 8 || /\s/.test(target)) return false;
    if (!/[\u4e00-\u9fff]/.test(target)) return false;
    if (!/^[A-Za-z][A-Za-z0-9 +&/.-]{0,24}$/.test(source)) return false;
    if (isEditableElement(element)) return false;

    const interactiveScope = closestInBatch(element,
      "[role='button'],[role='menuitem'],[role='option'],button,a,[role='menu'],[role='listbox'],[role='dialog'],[role='tooltip'],[data-testid*='dropdown' i],[data-testid*='popover' i],[data-testid*='tooltip' i]"
    );
    if (interactiveScope) return true;
    if (isEditorPanelLabel(element)) return true;
    if (isStaticFileBrowserContent(element)) return false;
    if (findTooltipContainer(element)) return true;

    const style = window.getComputedStyle(element);
    return (
      (style.position === "absolute" || style.position === "fixed")
      && element.getBoundingClientRect().width <= 160
    );
  }

  function markChangedElement(element, original, translated) {
    if (element && element.nodeType === Node.ELEMENT_NODE) {
      if (element.getAttribute(STATE_ATTR) !== "1") element.setAttribute(STATE_ATTR, "1");
      if (element.getAttribute(COMPACT_TEXT_ATTR) !== "1" && shouldKeepTranslatedTextOnOneLine(element, original, translated)) {
        element.setAttribute(COMPACT_TEXT_ATTR, "1");
      }
      const tooltip = findTooltipContainer(element);
      if (tooltip) tooltip.setAttribute(TOOLTIP_ATTR, "1");
    }
  }

  function closestInBatch(element, selector) {
    const policy = window.FigBoostTranslationPolicy;
    return policy && policy.closestInBatch ? policy.closestInBatch(element, selector) : element.closest(selector);
  }

  function isEditorPanelLabel(element) {
    return Boolean(closestInBatch(element,
      "[aria-label='Right sidebar'],[aria-label='右侧边栏'],[aria-label='Left sidebar'],[aria-label='左侧边栏']," +
      "[data-testid*='properties-panel'],[data-testid*='right-panel'],[class*='properties_panel'],[class*='right_panel']," +
      "[data-testid*='left-panel'],[class*='left_panel'],[role='toolbar']"
    )) && !closestInBatch(element, "[role='tooltip'],[role='dialog'],[role='menu'],[data-testid*='tooltip' i],[data-testid*='popover' i],[class*='popover' i]");
  }

  function isStaticFileBrowserContent(element) {
    return isFileBrowserRoute() && Boolean(closestInBatch(element, "main"))
      && !closestInBatch(element, "[role='tooltip'],[role='dialog'],[role='alertdialog'],[role='menu'],[role='listbox'],[data-testid*='tooltip' i],[data-testid*='popover' i],[class*='popover' i]");
  }

  function findTooltipContainer(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return null;
    // Text inside a control is its label, not a floating tooltip. Avoid layout
    // reads up the ancestor chain after each translated button write.
    if (closestInBatch(element, "button,a,input,textarea,select,[role='button'],[role='menuitem'],[role='option']")) return null;

    const explicit = closestInBatch(element, "[role='tooltip'],[data-testid*='tooltip' i]");
    if (explicit && !isTooltipTriggerElement(explicit) && !hasMenuLikeControls(explicit)) {
      return explicit;
    }

    // Property labels live in a known static panel. Measuring every ancestor
    // after text writes forces layout and delays later labels past the paint.
    if (isEditorPanelLabel(element)) return null;
    // Grid/list metadata is static content. Measuring every timestamp and its
    // ancestors as a possible tooltip forces layout after each translated write,
    // exhausting the observer slice before later visible rows reach Chinese.
    if (isStaticFileBrowserContent(element)) return null;

    const likely = closestLikelyFloatingTooltip(element);
    if (likely && !isTooltipTriggerElement(likely) && !hasMenuLikeControls(likely)) {
      return likely;
    }

    return null;
  }

  function closestLikelyFloatingTooltip(element) {
    let current = element;
    while (current && current !== document.body && current !== document.documentElement) {
      if (isLikelyFloatingTooltip(current)) return current;
      current = current.parentElement;
    }
    return null;
  }

  function isTooltipTriggerElement(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
    if (element.matches("button,a,input,textarea,select,[role='button'],[role='menuitem'],[role='option']")) return true;
    return (
      element.hasAttribute("data-tooltip")
      && !element.matches("[role='tooltip']")
      && !isLikelyFloatingTooltip(element)
    );
  }

  function isMenuLikeFloatingElement(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
    if (element.matches("[role='tooltip'],[data-testid*='tooltip' i]") && !hasMenuLikeControls(element)) return false;
    if (element.matches("[role='menu'],[role='listbox'],[role='dialog'],[role='option'],[role='menuitem'],button")) return true;
    if (hasMenuLikeControls(element)) return true;

    const textNodes = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && textNodes.length < 3) {
      if (normalizeText(node.nodeValue)) textNodes.push(node);
      node = walker.nextNode();
    }

    return textNodes.length > 1;
  }

  function hasMenuLikeControls(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
    return Boolean(element.querySelector("[role='menu'],[role='listbox'],[role='option'],[role='menuitem'],button"));
  }

  function isLikelyFloatingTooltip(element) {
    const text = normalizeText(element.textContent);
    if (!text || text.length > 80) return false;

    const style = window.getComputedStyle(element);
    if (style.position !== "fixed") return false;
    if (style.display === "none" || style.visibility === "hidden") return false;

    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    if (rect.width > 420 || rect.height > 96) return false;

    return true;
  }

  function restoreElement(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return;

    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let textNode = walker.nextNode();
    while (textNode) {
      if (textNode[ORIGINAL_TEXT_KEY]) {
        if (textNode.nodeValue === textNode[TRANSLATED_TEXT_KEY]) textNode.nodeValue = textNode[ORIGINAL_TEXT_KEY];
        delete textNode[ORIGINAL_TEXT_KEY];
        delete textNode[TRANSLATED_TEXT_KEY];
      }
      textNode = walker.nextNode();
    }

    const all = [element, ...element.querySelectorAll(`[${STATE_ATTR}],[${PENDING_ATTR}]`)];
    for (const node of all) {
      const originalAttrs = node[ORIGINAL_ATTR_KEY];
      if (originalAttrs) {
        for (const [name, value] of Object.entries(originalAttrs)) {
          if (node[TRANSLATED_ATTR_KEY] && node.getAttribute(name) === node[TRANSLATED_ATTR_KEY][name]) node.setAttribute(name, value);
        }
        delete node[ORIGINAL_ATTR_KEY];
        delete node[TRANSLATED_ATTR_KEY];
      }
      node.removeAttribute(STATE_ATTR);
      node.removeAttribute(PENDING_ATTR);
      node.removeAttribute(COMPACT_TEXT_ATTR);
      node.removeAttribute(TOOLTIP_ATTR);
      node.removeAttribute(GRADIENT_MENU_ATTR);
    }
  }

  function createLocalizer(dictionary, rawOptions) {
    const options = { ...DEFAULT_OPTIONS, ...(rawOptions || {}) };
    const translator = createTranslator(dictionary || {});
    const queue = new Set();
    const attributeQueue = new Set();
    let queuedNodes = new WeakMap();
    const stats = {
      processedNodes: 0,
      changedTexts: 0,
      changedAttributes: 0,
      batches: 0,
      lastBatchMs: 0,
      dictionaryVersion: dictionary && dictionary.version
    };
    let enabled = true;
    let scheduled = false;
    let observer = null;
    let scheduledHandle = null;
    let scheduledWithFrame = false;
    let scheduledTimeout = null;
    let scheduleToken = 0;
    let mutationStarted = null;

    function beginBatch() {
      const policy = window.FigBoostTranslationPolicy;
      if (policy) policy.beginBatch();
      if (options.beginBatch && (!policy || options.beginBatch !== policy.beginBatch)) options.beginBatch();
    }

    function log(...args) {
      if (options.debug) console.debug("[FigmaZh]", ...args);
    }

    function isOwnTextMutation(node) {
      return Boolean(
        node
        && node[TRANSLATED_TEXT_KEY]
        && node.nodeValue === node[TRANSLATED_TEXT_KEY]
      );
    }

    function isOwnAttributeMutation(mutation) {
      const element = mutation && mutation.target;
      const name = mutation && mutation.attributeName;
      if (!element || !name || element.nodeType !== Node.ELEMENT_NODE) return false;
      const translatedAttrs = element[TRANSLATED_ATTR_KEY];
      return Boolean(
        translatedAttrs
        && translatedAttrs[name]
        && element.getAttribute(name) === translatedAttrs[name]
      );
    }

    function restoreFontStyleAttributes(element) {
      if (!element || element.nodeType !== Node.ELEMENT_NODE) return;
      for (const name of FONT_STYLE_RESTORABLE_ATTRS) {
        const current = element.getAttribute(name);
        if (!current) continue;
        const source = getTranslatedFontStyleAttributeSource(element, current);
        if (!source || source === current) continue;

        if (!element[ORIGINAL_ATTR_KEY]) element[ORIGINAL_ATTR_KEY] = {};
        if (!element[TRANSLATED_ATTR_KEY]) element[TRANSLATED_ATTR_KEY] = {};
        element[ORIGINAL_ATTR_KEY][name] = source;
        element[TRANSLATED_ATTR_KEY][name] = source;
        element.setAttribute(name, preserveFontStyleMarker(current, source));
        markChangedElement(element);
        stats.changedAttributes += 1;
      }
    }

    function translateAttributes(element) {
      if (!options.translateAttributes || !element || element.nodeType !== Node.ELEMENT_NODE) return;
      if (!ATTRIBUTE_NAMES.some(name => element.hasAttribute(name))) return;
      if (isAttributeSkippableElement(element)) return;
      if (options.allowElement && !options.allowElement(element, "")) return;
      restoreFontStyleAttributes(element);
      for (const name of TRANSLATABLE_ATTRS) {
        if (!shouldTranslateAttribute(element, name)) continue;
        const current = element.getAttribute(name);
        if (!current || !/[A-Za-z]/.test(current)) continue;
        if (current.trim().length > options.maxTextLength) continue;
        const translatedAttrs = element[TRANSLATED_ATTR_KEY] || {};
        const priorTranslated = translatedAttrs[name];
        const priorOriginal = element[ORIGINAL_ATTR_KEY] && element[ORIGINAL_ATTR_KEY][name];
        const source = priorTranslated && current === priorTranslated ? priorOriginal : current;
        const builtin = translator.translate(source, options);
        const translated = options.resolveTranslation ? options.resolveTranslation(source, element, builtin, name) : builtin;
        if (!translated || translated === current) continue;

        if (!element[ORIGINAL_ATTR_KEY]) element[ORIGINAL_ATTR_KEY] = {};
        if (!element[TRANSLATED_ATTR_KEY]) element[TRANSLATED_ATTR_KEY] = {};
        element[ORIGINAL_ATTR_KEY][name] = source;
        element[TRANSLATED_ATTR_KEY][name] = translated;
        element.setAttribute(name, translated);
        markChangedElement(element);
        stats.changedAttributes += 1;
      }
  }

  function translateTextNode(node) {
    const parent = node.parentElement;
    if (!parent || isSkippableElement(parent) || isLayerTreeContentElement(parent) || isEditableElement(parent)) return;
    if (isUserNamedContentElement(parent, node.nodeValue)
      && !(options.allowProtectedElement && options.allowProtectedElement(parent, node.nodeValue))) return;
    if (options.allowElement && !options.allowElement(node.parentElement, node.nodeValue)) return;
    const fontStyleSource = getTranslatedFontStyleSourceTerm(node);
    if (fontStyleSource) {
      node.nodeValue = preserveFontStyleMarker(node.nodeValue, fontStyleSource);
      markChangedElement(node.parentElement);
      return;
    }
    const gradientTypeTranslation = getGradientTypeTranslation(node);
    if (gradientTypeTranslation) {
      const original = node[TRANSLATED_TEXT_KEY] && node.nodeValue === node[TRANSLATED_TEXT_KEY]
        ? node[ORIGINAL_TEXT_KEY] : node.nodeValue;
      const translated = options.resolveTranslation ? options.resolveTranslation(original, node, gradientTypeTranslation) : gradientTypeTranslation;
      if (!translated) return;
      node[ORIGINAL_TEXT_KEY] = original;
      node[TRANSLATED_TEXT_KEY] = preserveOuterWhitespace(original, translated);
      node.nodeValue = node[TRANSLATED_TEXT_KEY];
      markChangedElement(node.parentElement);
      return;
    }
    if (!shouldTranslateTextNode(node, options, true)) return;
    if (node.nodeValue.trim().length > options.maxTextLength) return;
    const original = node[TRANSLATED_TEXT_KEY] && node.nodeValue === node[TRANSLATED_TEXT_KEY]
        ? node[ORIGINAL_TEXT_KEY]
        : node.nodeValue;
      const builtin = translator.translate(original, options);
      const translated = options.resolveTranslation ? options.resolveTranslation(original, node, builtin) : builtin;
      if (!translated || translated === node.nodeValue) return;

      node[ORIGINAL_TEXT_KEY] = original;
      node[TRANSLATED_TEXT_KEY] = translated;
      node.nodeValue = translated;
      markChangedElement(node.parentElement, original, translated);
      stats.changedTexts += 1;
    }

    function createQueueJob(root) {
      return { root, walker: null, initialized: false, done: false };
    }

    function processQueueJob(job, started) {
      if (!job || job.done || !enabled) return true;
      const root = job.root;
      if (!isInBodyRegion(root) || isEditableNode(root)) return true;
      if (root.nodeType !== Node.TEXT_NODE && root.nodeType !== Node.ELEMENT_NODE) return true;

      let count = 0;
      let node = job.initialized ? job.walker && job.walker.nextNode() : root;
      while (node) {
        if (node.nodeType === Node.TEXT_NODE) {
          if (!isOwnTextMutation(node) && node.nodeValue && (/[A-Za-z]/.test(node.nodeValue) || getFontStyleSourceTerm(node.nodeValue))) {
            translateTextNode(node);
            stats.processedNodes += 1;
          }
        } else {
          // Attribute-only accessibility updates can wait until the visible
          // labels have been translated, without walking this subtree again.
          if (options.translateAttributes && ATTRIBUTE_NAMES.some(name => node.hasAttribute(name))) attributeQueue.add(node);
        }
        // Chunk size limits labels, not decorative wrappers/icons. Deeply
        // nested property rows should not split a small panel across frames.
        if (node.nodeType === Node.TEXT_NODE) count += 1;
        if (!job.initialized) {
          if (root.nodeType === Node.TEXT_NODE || isSkippableElement(root)) return true;
          job.walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
            acceptNode(child) {
              // Prune canvas/editable subtrees. Inputs still need placeholders.
              if (child.nodeType === Node.ELEMENT_NODE && isSkippableSubtree(child)) return NodeFilter.FILTER_REJECT;
              return NodeFilter.FILTER_ACCEPT;
            }
          });
          job.initialized = true;
        }
        if (count >= options.chunkSize || performance.now() - started >= options.budgetMs) return false;
        node = job.walker.nextNode();
      }
      job.done = true;
      return true;
    }

    function processOrQueueMutationNode(node) {
      if (!node || !enabled || !isInBodyRegion(node)) return;
      // React may rebuild a queued root before its walker resumes. Start from
      // its current children instead of continuing inside the detached tree.
      const previous = queuedNodes.get(node);
      if (previous) queue.delete(previous);
      queuedNodes.delete(node);
      const job = createQueueJob(node);
      const started = mutationStarted === null ? performance.now() : mutationStarted;
      if (performance.now() - started < options.budgetMs && processQueueJob(job, started)) return;
      queuedNodes.set(node, job);
      queue.add(job);
      schedule();
    }

    function flushQueue() {
      scheduled = false;
      scheduledHandle = null;
      if (!enabled) {
        queue.clear();
        queuedNodes = new WeakMap();
        return;
      }

      const started = performance.now();
      beginBatch();
      let count = 0;
      for (const job of Array.from(queue)) {
        queue.delete(job);
        const done = processQueueJob(job, started);
        count += 1;
        if (done) {
          if (job.root && job.root.nodeType) queuedNodes.delete(job.root);
          if (job.root && job.root.nodeType === Node.ELEMENT_NODE) job.root.removeAttribute(PENDING_ATTR);
        } else {
          queue.add(job);
        }

        const spent = performance.now() - started;
        if (count >= options.chunkSize || spent >= options.budgetMs) {
          break;
        }
      }

      flushAttributes(started);
      stats.batches += 1;
      stats.lastBatchMs = Math.round((performance.now() - started) * 10) / 10;
      log("batch", { count, remaining: queue.size + attributeQueue.size, ms: stats.lastBatchMs });
      if (queue.size > 0 || attributeQueue.size > 0) schedule();
    }

    function flushAttributes(started) {
      for (const element of attributeQueue) {
        if (performance.now() - started >= options.budgetMs) break;
        attributeQueue.delete(element);
        if (isInBodyRegion(element)) translateAttributes(element);
      }
    }

    function schedule() {
      if (scheduled) return;
      scheduled = true;
      const token = ++scheduleToken;
      const runner = () => {
        if (!scheduled || token !== scheduleToken) return;
        if (scheduledWithFrame) window.cancelAnimationFrame(scheduledHandle);
        window.clearTimeout(scheduledTimeout);
        scheduledTimeout = null;
        flushQueue();
      };
      // Idle callbacks can leave recycled labels in English for several frames.
      scheduledWithFrame = typeof window.requestAnimationFrame === "function" && !document.hidden;
      if (scheduledWithFrame) {
        scheduledHandle = window.requestAnimationFrame(runner);
        // Electron can throttle RAF even when document.hidden is still false.
        scheduledTimeout = window.setTimeout(runner, 50);
      } else {
        scheduledHandle = scheduledTimeout = window.setTimeout(runner, 16);
      }
    }

    function enqueue(node) {
      if (!node || !enabled || queuedNodes.has(node)) return;
      const job = createQueueJob(node);
      queuedNodes.set(node, job);
      queue.add(job);
      schedule();
    }

    function translateFileBrowserTimes(roots) {
      if (!/^\/files(?:\/|$)/.test(window.location.pathname)) return;
      // A view switch replaces many rows together. Finish the small, bounded
      // set of time labels before the general scan yields to another frame.
      // Use the normal translation/protection path, including same-named files.
      const time = /^(?:(?:Updated|Edited|Viewed|Trashed by you)\s*)?(?:\d+ (?:seconds?|minutes?|hours?|days?|weeks?|months?|years?) ago|just now|yesterday)?$/;
      const seen = new Set();
      let remaining = options.chunkSize;
      for (const root of roots) {
        const element = root.nodeType === Node.TEXT_NODE ? root.parentElement : root;
        if (!element || element.nodeType !== Node.ELEMENT_NODE || !isInBodyRegion(element)) continue;
        const main = closestInBatch(element, 'main') ? element : element.querySelector('main');
        if (!main) continue;
        const labels = root.nodeType === Node.TEXT_NODE ? [element]
          : [...(main.matches('i18n-text,td span') ? [main] : []), ...main.querySelectorAll('i18n-text,td span')];
        for (const label of labels) {
          const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (seen.has(node)) continue;
            if (seen.size >= options.chunkSize * 8) return;
            seen.add(node);
            if (isOwnTextMutation(node) || !/[A-Za-z]/.test(node.nodeValue) || !time.test(node.nodeValue.trim())) continue;
            if (remaining-- <= 0) return;
            translateTextNode(node);
          }
        }
      }
    }

    function start(root) {
      if (observer && enabled) return;
      enabled = true;
      observer = new MutationObserver((mutations) => {
        mutationStarted = performance.now();
        beginBatch();
        try {
          const roots = new Set();
          const attributes = new Set();
          for (const mutation of mutations) {
            if (mutation.type === "childList") {
              if (mutation.addedNodes.length > 1 && mutation.target.nodeType === Node.ELEMENT_NODE) roots.add(mutation.target);
              else for (const node of mutation.addedNodes) roots.add(node);
            } else if (mutation.type === "characterData") {
              if (!isOwnTextMutation(mutation.target)) roots.add(mutation.target);
            } else if (mutation.type === "attributes" && !isOwnAttributeMutation(mutation)) {
              attributes.add(mutation.target);
            }
          }
          // Direct label rewrites must not wait behind ancestor panel scans.
          const orderedRoots = [...roots].sort((a, b) => (b.nodeType === Node.TEXT_NODE) - (a.nodeType === Node.TEXT_NODE));
          translateFileBrowserTimes(orderedRoots);
          for (const node of orderedRoots) {
            let covered = false;
            for (let parent = node.nodeType === Node.TEXT_NODE ? null : node.parentNode; parent; parent = parent.parentNode) {
              if (roots.has(parent)) { covered = true; break; }
            }
            if (!covered) processOrQueueMutationNode(node);
          }
          // Attribute changes do not require a pass over the whole sidebar.
          for (const element of attributes) {
            if (!isInBodyRegion(element)) continue;
            if (performance.now() - mutationStarted < options.budgetMs) translateAttributes(element);
            else attributeQueue.add(element);
          }
          if (attributeQueue.size) schedule();
        } catch (error) {
          log("observer error", error);
        } finally {
          mutationStarted = null;
        }
      });
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ATTRIBUTE_NAMES
      });
      const initialRoot = root && isInBodyRegion(root) ? root : document.body;
      beginBatch();
      const started = performance.now();
      if (initialRoot) processOrQueueMutationNode(initialRoot);
      if (!queue.size) flushAttributes(started);
      if (attributeQueue.size) schedule();
      log("started");
    }

    function stop() {
      enabled = false;
      queue.clear();
      attributeQueue.clear();
      queuedNodes = new WeakMap();
      if (scheduledHandle !== null) {
        if (scheduledWithFrame) window.cancelAnimationFrame(scheduledHandle);
        else window.clearTimeout(scheduledHandle);
      }
      scheduled = false;
      scheduleToken += 1;
      window.clearTimeout(scheduledTimeout);
      scheduledTimeout = null;
      scheduledHandle = null;
      if (observer) observer.disconnect();
      observer = null;
      restoreElement(document.documentElement);
      log("stopped");
    }

    function setOptions(nextOptions) {
      Object.assign(options, nextOptions || {});
    }

    function getElementPath(element) {
      if (!element || element.nodeType !== Node.ELEMENT_NODE) return "";
      const parts = [];
      let current = element;
      while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
        let part = current.localName || current.nodeName.toLowerCase();
        const testId = current.getAttribute("data-testid");
        const role = current.getAttribute("role");
        if (current.id) {
          part += `#${current.id}`;
          parts.unshift(part);
          break;
        }
        if (testId) part += `[data-testid="${testId}"]`;
        if (role) part += `[role="${role}"]`;
        parts.unshift(part);
        current = current.parentElement;
      }
      return parts.join(" > ");
    }

    function getSkippedCategory(element) {
      if (!element || element.nodeType !== Node.ELEMENT_NODE) return null;
      if (closestInBatch(element, "canvas, svg, [data-testid='canvas'], [data-testid='canvas-root'], [data-testid='canvas_viewport'], [data-testid='fullscreen-viewport'], [data-testid='viewport'], [data-onboarding-key='canvas'], [data-figma-canvas='true']")) {
        return "canvas";
      }
      if (closestInBatch(element, "input, textarea, select, option, [contenteditable='true'], [role='textbox']")) {
        return "userContent";
      }
      if (closestInBatch(element, "code, pre")) return "protected";
      return null;
    }

    function addUntranslatedItem(items, seen, item, state, limit) {
      const key = `${item.type}:${item.attr || ""}:${item.text}`;
      if (seen.has(key)) return;
      seen.add(key);
      const category = item.category || "ui";
      state.counts[category] = (state.counts[category] || 0) + 1;
      if (category === "ui") state.count += 1;
      if (items.length < limit) items.push(item);
      if (options.debug) console.debug("[FigmaZh] untranslated", item);
    }

    function scanUntranslated(rawScanOptions) {
      beginBatch();
      const scanOptions = { limit: 200, ...(rawScanOptions || {}) };
      const limit = Math.max(1, scanOptions.limit || 200);
      const root = scanOptions.root || document.body || document.documentElement;
      const items = [];
      const seen = new Set();
      const state = { count: 0, counts: { ui: 0, protected: 0, canvas: 0, userContent: 0 } };
      if (!root) return { count: 0, counts: state.counts, items, limit, truncated: false };

      const inspectTextNode = (node) => {
        const text = normalizeText(node.nodeValue);
        if (!text || !/[A-Za-z]/.test(text)) return false;
        if (!shouldTranslateTextNode(node, options)) {
          const category = getSkippedCategory(node.parentElement);
          if (category) {
            addUntranslatedItem(items, seen, {
              type: "text",
              category,
              text,
              path: getElementPath(node.parentElement)
            }, state, limit);
          }
          return false;
        }
        if (translator.translate(text, options)) return false;
        const category = translator.classifyUntranslated(text);
        if (category === "none") return false;
        addUntranslatedItem(items, seen, {
          type: "text",
          category,
          text,
          path: getElementPath(node.parentElement)
        }, state, limit);
        return false;
      };

      if (root.nodeType === Node.TEXT_NODE) {
        inspectTextNode(root);
      } else if (root.nodeType === Node.ELEMENT_NODE && !isSkippableElement(root)) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
          acceptNode(node) {
            return shouldTranslateTextNode(node, options)
              ? NodeFilter.FILTER_ACCEPT
              : NodeFilter.FILTER_REJECT;
          }
        });

        let node = walker.nextNode();
        while (node) {
          inspectTextNode(node);
          node = walker.nextNode();
        }

        if (options.translateAttributes) {
          const attrNodes = [root, ...root.querySelectorAll(getFontStyleAttributeSelector())];
          for (const element of attrNodes) {
            if (isAttributeSkippableElement(element)) continue;
            for (const attr of TRANSLATABLE_ATTRS) {
              const text = normalizeText(element.getAttribute(attr));
              if (!text || !/[A-Za-z]/.test(text)) continue;
              const skippedCategory = getSkippedCategory(element);
              if (skippedCategory) {
                addUntranslatedItem(items, seen, {
                  type: "attribute",
                  category: skippedCategory,
                  attr,
                  text,
                  path: getElementPath(element)
                }, state, limit);
                continue;
              }
              if (translator.translate(text, options)) continue;
              const category = translator.classifyUntranslated(text);
              if (category === "none") continue;
              addUntranslatedItem(items, seen, {
                type: "attribute",
                category,
                attr,
                text,
                path: getElementPath(element)
              }, state, limit);
            }
          }
        }
      }

      return { count: state.count, counts: state.counts, items, limit, truncated: state.count > items.length };
    }

    return {
      enqueue,
      start,
      stop,
      setOptions,
      scanUntranslated,
      getStats: () => ({ ...stats, queueSize: queue.size + attributeQueue.size, enabled })
    };
  }

  window.FigmaZhLocalizer = {
    createLocalizer,
    normalizeText,
    preserveOuterWhitespace
  };
})();
