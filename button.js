(() => {
  const G = globalThis;
  const cc = G.cc || (G.GameGlobal && G.GameGlobal.cc);
  if (!cc) throw new Error('cc not found');

  const doc = (G.GameGlobal && G.GameGlobal.document) || G.document;
  const canvas = (cc.game && cc.game.canvas) || G.canvas || (G.GameGlobal && G.GameGlobal.canvas);
  let cachedSelfGid = null;

  function out(v) {
    try { console.dir(v); } catch (_) {}
    return v;
  }

  function wait(ms) {
    ms = Number(ms) || 0;
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function rememberSelfGid(value) {
    const gid = toPositiveNumber(value);
    if (gid != null) cachedSelfGid = gid;
    return gid;
  }

  function roundNum(n) {
    return typeof n === 'number' && isFinite(n) ? Math.round(n * 100) / 100 : n;
  }

  function scene() {
    return cc.director.getScene();
  }

  function walk(node, outArr) {
    outArr = outArr || [];
    if (!node) return outArr;
    outArr.push(node);
    const children = node.children || [];
    for (let i = 0; i < children.length; i++) {
      walk(children[i], outArr);
    }
    return outArr;
  }

  function fullPath(node) {
    const arr = [];
    for (let n = node; n; n = n.parent) arr.unshift(n.name || '(noname)');
    return arr.join('/');
  }

  function relativePath(node) {
    const s = scene();
    const fp = fullPath(node);
    return fp.indexOf(s.name + '/') === 0 ? fp.slice(s.name.length + 1) : fp;
  }

  function relativePathFrom(node, baseNode) {
    if (!node) return null;
    if (!baseNode) return relativePath(node);
    const full = fullPath(node);
    const base = fullPath(baseNode);
    if (full === base) return '.';
    return full.indexOf(base + '/') === 0 ? full.slice(base.length + 1) : full;
  }

  function nodeDepth(node, baseNode) {
    let depth = 0;
    for (let n = node; n && n !== baseNode; n = n.parent) depth++;
    return depth;
  }

  function findNode(path) {
    const s = scene();
    const raw = String(path || '').replace(/^\/+/, '');
    const rel = raw.indexOf(s.name + '/') === 0 ? raw.slice(s.name.length + 1) : raw;

    return (
      cc.find(rel, s) ||
      walk(s).find(n => fullPath(n) === raw) ||
      null
    );
  }

  function toNode(pathOrNode) {
    if (!pathOrNode) return null;
    return typeof pathOrNode === 'string' ? findNode(pathOrNode) : pathOrNode;
  }

  function getHandlers(btn) {
    const list = btn.clickEvents || [];
    return list.map((h, i) => ({
      index: i,
      target: h.target ? fullPath(h.target) : null,
      component: h._componentName || h.component || null,
      handler: h.handler || null,
      customEventData: h.customEventData == null ? null : h.customEventData,
      text: (h.target ? h.target.name : '??') + '::' + (h._componentName || h.component) + '.' + h.handler + '(' + (h.customEventData || '') + ')'
    }));
  }

  function componentNames(node) {
    return (node.components || []).map(c => {
      return c && c.constructor ? c.constructor.name : String(c);
    });
  }

  function allButtons(opts) {
    opts = opts || {};
    const activeOnly = !!opts.activeOnly;

    return walk(scene())
      .map(node => ({ node, btn: node.getComponent(cc.Button) }))
      .filter(x => !!x.btn)
      .filter(x => !activeOnly || x.node.activeInHierarchy)
      .map(({ node, btn }) => ({
        path: fullPath(node),
        relativePath: relativePath(node),
        active: !!node.activeInHierarchy,
        interactable: !!btn.interactable,
        enabledInHierarchy: !!btn.enabledInHierarchy,
        handlers: getHandlers(btn).map(x => x.text)
      }));
  }

  function dumpButtons(keyword, opts) {
    keyword = String(keyword || '').toLowerCase();
    const list = allButtons(opts).filter(x => {
      if (!keyword) return true;
      if (x.path.toLowerCase().indexOf(keyword) >= 0) return true;
      if (x.relativePath.toLowerCase().indexOf(keyword) >= 0) return true;
      for (let i = 0; i < x.handlers.length; i++) {
        if (x.handlers[i].toLowerCase().indexOf(keyword) >= 0) return true;
      }
      return false;
    });
    return out(list);
  }

  function firstComponent(root, Ctor) {
    const nodes = walk(root);
    for (let i = 0; i < nodes.length; i++) {
      const c = nodes[i].getComponent(Ctor);
      if (c) return c;
    }
    return null;
  }

  function getCamera() {
    return cc.Camera.main || firstComponent(scene(), cc.Camera);
  }

  function getNodeCenterWorld(node) {
    const ui = node.getComponent(cc.UITransform);
    if (ui && typeof ui.getBoundingBoxToWorld === 'function') {
      const box = ui.getBoundingBoxToWorld();
      return new cc.Vec3(box.x + box.width / 2, box.y + box.height / 2, 0);
    }
    const p = node.worldPosition || node.position || { x: 0, y: 0, z: 0 };
    return new cc.Vec3(p.x || 0, p.y || 0, p.z || 0);
  }

  function worldToClient(world, camera) {
    camera = camera || getCamera();
    if (!camera) throw new Error('Camera not found');

    const dpr = G.devicePixelRatio || 1;
    const screen = new cc.Vec3();
    camera.worldToScreen(screen, world);

    return {
      x: roundNum(screen.x / dpr),
      y: roundNum((cc.game.canvas.height - screen.y) / dpr)
    };
  }

  function nodeToClient(pathOrNode) {
    const node = toNode(pathOrNode);
    if (!node) throw new Error('Node not found: ' + pathOrNode);
    return worldToClient(getNodeCenterWorld(node));
  }

  function getViewportInfo() {
    const dpr = G.devicePixelRatio || 1;
    let width = canvas && typeof canvas.width === 'number' ? canvas.width / dpr : null;
    let height = canvas && typeof canvas.height === 'number' ? canvas.height / dpr : null;

    if ((!width || !height) && cc.view && typeof cc.view.getVisibleSize === 'function') {
      try {
        const visible = cc.view.getVisibleSize();
        if (visible) {
          width = width || Number(visible.width) || null;
          height = height || Number(visible.height) || null;
        }
      } catch (_) {}
    }

    if ((!width || !height) && cc.winSize) {
      width = width || Number(cc.winSize.width) || null;
      height = height || Number(cc.winSize.height) || null;
    }

    return {
      width: roundNum(width || 0),
      height: roundNum(height || 0),
      dpr
    };
  }

  function getNodeScreenRect(pathOrNode, opts) {
    opts = opts || {};
    const node = toNode(pathOrNode);
    if (!node || !node.getComponent) return null;

    const ui = node.getComponent(cc.UITransform);
    if (!ui || typeof ui.getBoundingBoxToWorld !== 'function') return null;

    let box = null;
    try {
      box = ui.getBoundingBoxToWorld();
    } catch (_) {
      box = null;
    }
    if (!box || !isFinite(box.width) || !isFinite(box.height)) return null;

    let topLeft = null;
    let bottomRight = null;
    try {
      topLeft = worldToClient(new cc.Vec3(box.x, box.y + box.height, 0), opts.camera);
      bottomRight = worldToClient(new cc.Vec3(box.x + box.width, box.y, 0), opts.camera);
    } catch (_) {
      return null;
    }

    const left = roundNum(Math.min(topLeft.x, bottomRight.x));
    const right = roundNum(Math.max(topLeft.x, bottomRight.x));
    const top = roundNum(Math.min(topLeft.y, bottomRight.y));
    const bottom = roundNum(Math.max(topLeft.y, bottomRight.y));
    const width = roundNum(Math.max(0, right - left));
    const height = roundNum(Math.max(0, bottom - top));

    return {
      left,
      top,
      right,
      bottom,
      width,
      height,
      centerX: roundNum(left + width / 2),
      centerY: roundNum(top + height / 2)
    };
  }

  function describeNode(node, opts) {
    opts = opts || {};
    const baseNode = opts.baseNode || null;
    const camera = opts.camera || null;
    const ui = node.getComponent(cc.UITransform);
    const btn = node.getComponent(cc.Button);
    const pos = node.position || { x: 0, y: 0, z: 0 };
    const world = node.worldPosition || { x: 0, y: 0, z: 0 };

    let screen = null;
    try {
      screen = worldToClient(getNodeCenterWorld(node), camera || undefined);
    } catch (_) {}

    return {
      path: fullPath(node),
      relativePath: relativePathFrom(node, baseNode),
      name: node.name || '',
      active: !!node.active,
      activeInHierarchy: !!node.activeInHierarchy,
      depth: nodeDepth(node, baseNode),
      childCount: (node.children && node.children.length) || 0,
      siblingIndex: typeof node.getSiblingIndex === 'function' ? node.getSiblingIndex() : null,
      layer: node.layer == null ? null : node.layer,
      position: {
        x: roundNum(pos.x || 0),
        y: roundNum(pos.y || 0),
        z: roundNum(pos.z || 0)
      },
      worldPosition: {
        x: roundNum(world.x || 0),
        y: roundNum(world.y || 0),
        z: roundNum(world.z || 0)
      },
      screen,
      size: ui ? {
        width: roundNum(ui.width),
        height: roundNum(ui.height),
        anchorX: roundNum(ui.anchorX),
        anchorY: roundNum(ui.anchorY)
      } : null,
      components: componentNames(node),
      button: btn ? {
        interactable: !!btn.interactable,
        enabledInHierarchy: !!btn.enabledInHierarchy,
        handlers: getHandlers(btn)
      } : null
    };
  }

  function buttonInfo(path) {
    const node = findNode(path);
    if (!node) throw new Error('Node not found: ' + path);

    const btn = node.getComponent(cc.Button);
    if (!btn) throw new Error('Button component not found: ' + fullPath(node));

    return out({
      path: fullPath(node),
      relativePath: relativePath(node),
      active: !!node.activeInHierarchy,
      components: componentNames(node),
      handlers: getHandlers(btn)
    });
  }

  function nodeInfo(pathOrNode) {
    const node = toNode(pathOrNode);
    if (!node) throw new Error('Node not found: ' + pathOrNode);

    return out({
      ...describeNode(node),
      componentDetails: (node.components || []).map((comp, index) => ({
        index,
        name: comp && comp.constructor ? comp.constructor.name : String(comp),
        enabled: comp && comp.enabled != null ? !!comp.enabled : null
      }))
    });
  }

  function triggerButton(path, index) {
    index = index || 0;

    const node = findNode(path);
    if (!node) throw new Error('Node not found: ' + path);

    const btn = node.getComponent(cc.Button);
    if (!btn) throw new Error('Button component not found: ' + fullPath(node));

    const h = btn.clickEvents && btn.clickEvents[index];
    if (!h) throw new Error('No clickEvents on: ' + fullPath(node));

    const target = h.target || node;
    const compName = h._componentName || h.component;
    const comp = target.getComponent(compName);
    if (!comp) throw new Error('Component not found: ' + compName + ' on ' + fullPath(target));

    const fn = comp[h.handler];
    if (typeof fn !== 'function') throw new Error('Handler not found: ' + h.handler);

    const evt = {
      type: 'click',
      target: node,
      currentTarget: node
    };

    const ret =
      h.customEventData !== undefined && h.customEventData !== ''
        ? fn.call(comp, evt, h.customEventData)
        : fn.call(comp, evt);

    out({
      action: 'triggerButton',
      path: fullPath(node),
      component: compName,
      handler: h.handler,
      customEventData: h.customEventData == null ? null : h.customEventData
    });

    return ret;
  }

  function mkTouch(x, y, id) {
    x = Math.round(x);
    y = Math.round(y);
    id = id || 1;
    return {
      identifier: id,
      id: id,
      pageX: x,
      pageY: y,
      clientX: x,
      clientY: y,
      screenX: x,
      screenY: y,
      force: 1
    };
  }

  function fireTouch(type, x, y, id) {
    if (!doc) throw new Error('document/GameGlobal.document not found');
    const p = mkTouch(x, y, id);
    const ended = type === 'touchend' || type === 'touchcancel';

    doc.dispatchEvent({
      type: type,
      timeStamp: Date.now(),
      target: canvas,
      currentTarget: canvas,
      changedTouches: [p],
      touches: ended ? [] : [p],
      targetTouches: ended ? [] : [p],
      preventDefault() {},
      stopPropagation() {}
    });
  }

  function tap(x, y, hold) {
    hold = hold == null ? 32 : hold;
    fireTouch('touchstart', x, y);
    setTimeout(() => fireTouch('touchend', x, y), hold);
    return out({ action: 'tap', x: x, y: y, hold: hold });
  }

  function tapNode(pathOrNode, hold) {
    hold = hold == null ? 32 : hold;
    const node = toNode(pathOrNode);
    if (!node) throw new Error('Node not found: ' + pathOrNode);

    const p = nodeToClient(node);
    fireTouch('touchstart', p.x, p.y);
    setTimeout(() => fireTouch('touchend', p.x, p.y), hold);

    return out({
      action: 'tapNode',
      path: fullPath(node),
      x: p.x,
      y: p.y,
      hold: hold
    });
  }

  function smartClick(path, index) {
    index = index || 0;
    const node = findNode(path);
    if (!node) throw new Error('Node not found: ' + path);

    const btn = node.getComponent(cc.Button);
    if (btn && btn.clickEvents && btn.clickEvents.length > 0) {
      return triggerButton(path, index);
    }
    return tapNode(path);
  }

  function findFarmRoot(pathOrNode) {
    const direct = toNode(pathOrNode);
    if (direct) return direct;

    const s = scene();
    const candidates = [
      'root/scene/farm_scene_v3',
      'startup/root/scene/farm_scene_v3',
      'root/scene/farm_scene',
      'startup/root/scene/farm_scene'
    ];

    for (let i = 0; i < candidates.length; i++) {
      const node = cc.find(candidates[i], s);
      if (node) return node;
    }

    return walk(s).find(n => n.name === 'farm_scene_v3' || n.name === 'farm_scene') || null;
  }

  function findGridOrigin(pathOrNode) {
    const direct = toNode(pathOrNode);
    if (direct) return direct;

    const root = findFarmRoot();
    if (!root) return null;

    const candidates = [
      'Scaled/Rotate/GridOrigin',
      'root/scene/farm_scene_v3/Scaled/Rotate/GridOrigin',
      'startup/root/scene/farm_scene_v3/Scaled/Rotate/GridOrigin'
    ];

    for (let i = 0; i < candidates.length; i++) {
      const node = findNode(candidates[i]);
      if (node) return node;
    }

    return walk(root).find(n => n.name === 'GridOrigin') || null;
  }

  function findPlantOrigin(pathOrNode) {
    const direct = toNode(pathOrNode);
    if (direct) return direct;

    const root = findFarmRoot();
    if (!root) return null;

    const candidates = [
      'PlantOrigin',
      'root/scene/farm_scene_v3/PlantOrigin',
      'startup/root/scene/farm_scene_v3/PlantOrigin'
    ];

    for (let i = 0; i < candidates.length; i++) {
      const node = findNode(candidates[i]);
      if (node) return node;
    }

    return walk(root).find(n => n.name === 'PlantOrigin') || null;
  }

  function findComponentByName(node, compName) {
    const list = (node && node.components) || [];
    for (let i = 0; i < list.length; i++) {
      const comp = list[i];
      const name = comp && comp.constructor ? comp.constructor.name : String(comp);
      if (name === compName) return comp;
    }
    return null;
  }

  function findFirstComponentByName(root, compName) {
    const nodes = walk(root);
    for (let i = 0; i < nodes.length; i++) {
      const comp = findComponentByName(nodes[i], compName);
      if (comp) return comp;
    }
    return null;
  }

  function findMainUIComp(pathOrNode) {
    const directNode = toNode(pathOrNode);
    if (directNode) {
      const directComp = findComponentByName(directNode, 'MainUIComp');
      if (directComp) return directComp;
    }

    const candidatePaths = [
      'startup/root/ui/LayerUI/main_ui_v2',
      'root/ui/LayerUI/main_ui_v2',
      'startup/root/ui/LayerUI',
      'root/ui/LayerUI'
    ];

    for (let i = 0; i < candidatePaths.length; i++) {
      const node = findNode(candidatePaths[i]);
      if (!node) continue;
      const comp = findComponentByName(node, 'MainUIComp') || findFirstComponentByName(node, 'MainUIComp');
      if (comp) return comp;
    }

    return findFirstComponentByName(scene(), 'MainUIComp');
  }

  function findMainMenuComp(pathOrNode) {
    const directNode = toNode(pathOrNode);
    if (directNode) {
      const directComp = findComponentByName(directNode, 'MainMenuComp');
      if (directComp) return directComp;
    }

    const mainUI = findMainUIComp(pathOrNode);
    if (mainUI && mainUI.mainMenuComp) return mainUI.mainMenuComp;

    const candidatePaths = [
      'startup/root/ui/LayerUI/main_ui_v2/Menu',
      'root/ui/LayerUI/main_ui_v2/Menu',
      'startup/root/ui/LayerUI/main_ui_v2',
      'root/ui/LayerUI/main_ui_v2'
    ];

    for (let i = 0; i < candidatePaths.length; i++) {
      const node = findNode(candidatePaths[i]);
      if (!node) continue;
      const comp = findComponentByName(node, 'MainMenuComp') || findFirstComponentByName(node, 'MainMenuComp');
      if (comp) return comp;
    }

    return findFirstComponentByName(scene(), 'MainMenuComp');
  }

  function getNodeTextList(pathOrNode, opts) {
    opts = opts || {};
    const node = toNode(pathOrNode);
    if (!node) return [];

    const maxDepth = opts.maxDepth == null ? 3 : Number(opts.maxDepth);
    const texts = [];
    const seen = new Set();

    function visit(cur, depth) {
      if (!cur || depth > maxDepth) return;

      const label = cc.Label && cur.getComponent ? cur.getComponent(cc.Label) : null;
      const text = label && typeof label.string === 'string' ? label.string.trim() : '';
      if (text && !seen.has(text)) {
        seen.add(text);
        texts.push(text);
      }

      const children = cur.children || [];
      for (let i = 0; i < children.length; i++) {
        visit(children[i], depth + 1);
      }
    }

    visit(node, 0);
    return texts;
  }

  function slimButtonInfo(item) {
    return {
      path: item.path,
      relativePath: item.relativePath,
      active: item.active,
      interactable: item.interactable,
      handlers: item.handlers
    };
  }

  function findButtonsByKeywords(keyword, opts) {
    opts = opts || {};
    const keywords = normalizeKeywords(keyword);
    return allButtons({ activeOnly: !!opts.activeOnly }).filter(item => {
      return matchesKeywords([item.path, item.relativePath].concat(item.handlers || []), keywords);
    });
  }

  function toPositiveNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function normalizeText(value) {
    return value == null ? '' : String(value).trim();
  }

  function normalizeMatchText(value) {
    return normalizeText(value).replace(/\s+/g, '').toLowerCase();
  }

  function unwrapModuleNamespace(mod) {
    if (!mod || typeof mod !== 'object') return null;
    const queue = [mod];
    const seen = new Set();

    while (queue.length > 0) {
      const cur = queue.shift();
      if (!cur || typeof cur !== 'object' || seen.has(cur)) continue;
      seen.add(cur);

      if (
        cur.GlobalData ||
        cur.FarmUtil ||
        cur.smc ||
        cur.oops ||
        cur.selfModel ||
        cur.curWatchFarmGid != null
      ) {
        return cur;
      }

      if (cur.namespace && typeof cur.namespace === 'object') queue.push(cur.namespace);
      if (cur.module && typeof cur.module === 'object') queue.push(cur.module);
      if (cur.exports && typeof cur.exports === 'object') queue.push(cur.exports);
      if (cur.default && typeof cur.default === 'object') queue.push(cur.default);
    }

    return null;
  }

  function getSystemModule(moduleIds) {
    const ids = Array.isArray(moduleIds) ? moduleIds : [moduleIds];
    const systems = [
      G.System,
      G.SystemJS,
      G.__system__,
      G.GameGlobal && G.GameGlobal.System,
      G.GameGlobal && G.GameGlobal.SystemJS
    ].filter(Boolean);

    for (let s = 0; s < systems.length; s++) {
      const sys = systems[s];
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        const getters = [
          () => typeof sys.get === 'function' ? sys.get(id) : null,
          () => sys.registry && typeof sys.registry.get === 'function' ? sys.registry.get(id) : null,
          () => sys._loader && sys._loader.modules
            ? (typeof sys._loader.modules.get === 'function' ? sys._loader.modules.get(id) : sys._loader.modules[id])
            : null,
          () => sys._loader && sys._loader.moduleRecords
            ? (typeof sys._loader.moduleRecords.get === 'function' ? sys._loader.moduleRecords.get(id) : sys._loader.moduleRecords[id])
            : null
        ];

        for (let gIndex = 0; gIndex < getters.length; gIndex++) {
          let raw = null;
          try {
            raw = getters[gIndex]();
          } catch (_) {
            raw = null;
          }
          const ns = unwrapModuleNamespace(raw);
          if (ns) {
            return {
              moduleId: id,
              namespace: ns
            };
          }
        }
      }
    }

    return null;
  }

  function findSystemModuleExport(moduleIds, exportNames) {
    const ids = Array.isArray(moduleIds) ? moduleIds : [moduleIds];
    const names = Array.isArray(exportNames) ? exportNames : [exportNames];
    const systems = [
      G.System,
      G.SystemJS,
      G.__system__,
      G.GameGlobal && G.GameGlobal.System,
      G.GameGlobal && G.GameGlobal.SystemJS
    ].filter(Boolean);

    function scan(raw) {
      const queue = [raw];
      const seen = new Set();

      while (queue.length > 0) {
        const cur = queue.shift();
        if (!cur || (typeof cur !== 'object' && typeof cur !== 'function') || seen.has(cur)) continue;
        seen.add(cur);

        for (let i = 0; i < names.length; i++) {
          const name = names[i];
          if (cur[name] != null) {
            return {
              exportName: name,
              namespace: cur,
              value: cur[name]
            };
          }
        }

        if (cur.namespace != null) queue.push(cur.namespace);
        if (cur.module != null) queue.push(cur.module);
        if (cur.exports != null) queue.push(cur.exports);
        if (cur.default != null) queue.push(cur.default);
      }

      return null;
    }

    for (let s = 0; s < systems.length; s++) {
      const sys = systems[s];
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        const getters = [
          () => typeof sys.get === 'function' ? sys.get(id) : null,
          () => sys.registry && typeof sys.registry.get === 'function' ? sys.registry.get(id) : null,
          () => sys._loader && sys._loader.modules
            ? (typeof sys._loader.modules.get === 'function' ? sys._loader.modules.get(id) : sys._loader.modules[id])
            : null,
          () => sys._loader && sys._loader.moduleRecords
            ? (typeof sys._loader.moduleRecords.get === 'function' ? sys._loader.moduleRecords.get(id) : sys._loader.moduleRecords[id])
            : null
        ];

        for (let gIndex = 0; gIndex < getters.length; gIndex++) {
          let raw = null;
          try {
            raw = getters[gIndex]();
          } catch (_) {
            raw = null;
          }
          const match = scan(raw);
          if (match) {
            return {
              moduleId: id,
              namespace: match.namespace,
              exportName: match.exportName,
              value: match.value
            };
          }
        }
      }
    }

    return null;
  }

  function getFriendManagerRuntime() {
    const candidates = [
      { source: 'globalThis.FriendManager', value: G.FriendManager },
      { source: 'GameGlobal.FriendManager', value: G.GameGlobal && G.GameGlobal.FriendManager }
    ];

    for (let i = 0; i < candidates.length; i++) {
      const item = candidates[i];
      const FriendManager = item.value && item.value.FriendManager ? item.value.FriendManager : item.value;
      if (!FriendManager) continue;
      let manager = null;
      try {
        manager = FriendManager.ins || FriendManager._instance || null;
      } catch (_) {
        manager = FriendManager._instance || null;
      }
      return {
        source: item.source,
        FriendManager,
        manager
      };
    }

    const resolved = findSystemModuleExport(
      ['chunks:///_virtual/FriendManager.ts', './FriendManager.ts'],
      'FriendManager'
    );
    if (!resolved || !resolved.value) return null;

    let manager = null;
    try {
      manager = resolved.value.ins || resolved.value._instance || null;
    } catch (_) {
      manager = resolved.value._instance || null;
    }

    return {
      source: 'System:' + resolved.moduleId,
      FriendManager: resolved.value,
      manager
    };
  }

  function getFarmUtilRuntime() {
    const candidates = [
      { source: 'globalThis.FarmUtil', value: G.FarmUtil },
      { source: 'GameGlobal.FarmUtil', value: G.GameGlobal && G.GameGlobal.FarmUtil }
    ];

    for (let i = 0; i < candidates.length; i++) {
      const item = candidates[i];
      const FarmUtil = item.value && item.value.FarmUtil ? item.value.FarmUtil : item.value;
      if (!FarmUtil || typeof FarmUtil.enterFarm !== 'function') continue;
      return {
        source: item.source,
        FarmUtil
      };
    }

    const resolved = findSystemModuleExport(
      ['chunks:///_virtual/FarmUtil.ts', './FarmUtil.ts'],
      'FarmUtil'
    );
    if (!resolved || !resolved.value || typeof resolved.value.enterFarm !== 'function') return null;

    return {
      source: 'System:' + resolved.moduleId,
      FarmUtil: resolved.value
    };
  }

  function getFarmEnterReasonRuntime() {
    const candidates = [
      {
        source: 'globalThis.FarmEnterReason',
        value: G.FarmEnterReason ? { FarmEnterReason: G.FarmEnterReason } : null
      },
      {
        source: 'GameGlobal.FarmEnterReason',
        value: G.GameGlobal && G.GameGlobal.FarmEnterReason
          ? { FarmEnterReason: G.GameGlobal.FarmEnterReason }
          : null
      }
    ];

    for (let i = 0; i < candidates.length; i++) {
      const item = candidates[i];
      const FarmEnterReason = item.value && item.value.FarmEnterReason ? item.value.FarmEnterReason : item.value;
      if (!FarmEnterReason) continue;
      return {
        source: item.source,
        FarmEnterReason
      };
    }

    const resolved = findSystemModuleExport(
      ['chunks:///_virtual/FarmEnum.ts', './FarmEnum.ts'],
      'FarmEnterReason'
    );
    if (!resolved || !resolved.value) return null;

    return {
      source: 'System:' + resolved.moduleId,
      FarmEnterReason: resolved.value
    };
  }

  function resolveFarmEnterReason(reason) {
    const fallback = {
      UNKNOWN: 0,
      BUBBLE: 1,
      FRIEND: 2,
      INTERACT: 3
    };

    if (typeof reason === 'number' && Number.isFinite(reason)) {
      const keys = Object.keys(fallback);
      let name = null;
      for (let i = 0; i < keys.length; i++) {
        if (fallback[keys[i]] === reason) {
          name = keys[i];
          break;
        }
      }
      return {
        name,
        value: Number(reason),
        source: 'number'
      };
    }

    const rawName = normalizeText(reason || 'FRIEND').toUpperCase();
    const runtime = getFarmEnterReasonRuntime();
    const enumObj = runtime && runtime.FarmEnterReason ? runtime.FarmEnterReason : fallback;
    const value = enumObj && enumObj[rawName] != null ? Number(enumObj[rawName]) : fallback[rawName];
    if (!Number.isFinite(value)) {
      throw new Error('Unknown FarmEnterReason: ' + reason);
    }

    return {
      name: rawName,
      value,
      source: runtime ? runtime.source : 'fallback'
    };
  }

  function getSelfGid() {
    let ownership = null;
    const watchState = readGlobalFarmWatchState();
    if (watchState) {
      if (watchState.selfGid != null) return rememberSelfGid(watchState.selfGid);
      if (watchState.isOwnFarm === true && watchState.curWatchFarmGid != null) {
        return rememberSelfGid(watchState.curWatchFarmGid);
      }
    }

    try {
      ownership = getFarmOwnership({ silent: true, allowWeakUi: true });
    } catch (_) {
      ownership = null;
    }

    if (ownership && ownership.farmType === 'own' && ownership.evidence) {
      const evidence = ownership.evidence;
      const currentUserGid = rememberSelfGid(evidence.farmModel && evidence.farmModel.currentUserGid);
      if (currentUserGid != null) return currentUserGid;

      const watchGid = rememberSelfGid(evidence.globalFarmWatch && evidence.globalFarmWatch.curWatchFarmGid);
      if (watchGid != null) return watchGid;
    }

    return cachedSelfGid;
  }

  async function waitForSelfGid(opts) {
    opts = opts || {};
    const timeoutMs = Math.max(0, Number(opts.timeoutMs) || 0);
    const intervalMs = Math.max(50, Number(opts.intervalMs) || 100);
    const deadlineAt = Date.now() + timeoutMs;

    while (true) {
      const gid = getSelfGid();
      if (gid != null) return gid;
      if (timeoutMs <= 0 || Date.now() >= deadlineAt) return null;
      await wait(Math.min(intervalMs, Math.max(0, deadlineAt - Date.now())));
    }
  }

  function readGlobalFarmWatchState() {
    const candidates = [
      { source: 'globalThis.GlobalData', value: G.GlobalData },
      { source: 'GameGlobal.GlobalData', value: G.GameGlobal && G.GameGlobal.GlobalData }
    ];

    const systemResolved = getSystemModule([
      'chunks:///_virtual/GlobalData.ts',
      './GlobalData.ts'
    ]);
    if (systemResolved) {
      candidates.push({
        source: 'System:' + systemResolved.moduleId,
        value: systemResolved.namespace
      });
    }

    for (let i = 0; i < candidates.length; i++) {
      const item = candidates[i];
      const ns = unwrapModuleNamespace(item.value);
      const globalData = ns && ns.GlobalData ? ns.GlobalData : ns;
      if (!globalData || typeof globalData !== 'object') continue;

      const selfGid = toPositiveNumber(globalData.selfModel && globalData.selfModel.gid);
      const curWatchFarmGid = toPositiveNumber(globalData.curWatchFarmGid);
      if (selfGid == null && curWatchFarmGid == null) continue;

      if (selfGid != null) rememberSelfGid(selfGid);

      return {
        source: item.source,
        selfGid,
        curWatchFarmGid,
        ready: selfGid != null && curWatchFarmGid != null,
        isOwnFarm: selfGid != null && curWatchFarmGid != null ? selfGid === curWatchFarmGid : null
      };
    }

    return null;
  }

  function classifyOwnershipByUiFallback(evidence) {
    const hasWarehouseButton =
      !!(evidence.warehouseButton && evidence.warehouseButton.active) ||
      !!(evidence.activeWarehouseButtons && evidence.activeWarehouseButtons.count > 0);
    const hasBackHomeButton =
      !!(evidence.backHomeButton && evidence.backHomeButton.active) ||
      !!(evidence.activeBackHomeButtons && evidence.activeBackHomeButtons.count > 0);
    const hasVisitNode = !!(evidence.visitNode && evidence.visitNode.active);
    const hasSourceNode = !!(evidence.sourceNode && evidence.sourceNode.active);
    const ownNavStrong = hasWarehouseButton || hasSourceNode;
    const friendNavStrong = hasBackHomeButton || hasVisitNode;
    const ownStrong =
      (hasWarehouseButton ? 3 : 0) +
      (hasSourceNode ? 1 : 0) +
      (evidence.shareButton && evidence.shareButton.active ? 1 : 0);
    const friendStrong =
      (hasBackHomeButton ? 3 : 0) +
      (hasVisitNode ? 1 : 0);

    if (ownNavStrong && !friendNavStrong) {
      return {
        farmType: 'own',
        confidence: 0.76,
        ownStrong,
        friendStrong,
        source: 'ui_nav'
      };
    }

    if (friendNavStrong && !ownNavStrong) {
      return {
        farmType: 'friend',
        confidence: 0.76,
        ownStrong,
        friendStrong,
        source: 'ui_nav'
      };
    }

    if ((ownStrong >= 3 && friendStrong === 0) || (ownStrong >= 4 && friendStrong <= 1)) {
      return {
        farmType: 'own',
        confidence: ownStrong >= 4 ? 0.72 : 0.62,
        ownStrong,
        friendStrong,
        source: 'ui_consensus'
      };
    }

    if ((friendStrong >= 3 && ownStrong === 0) || (friendStrong >= 4 && ownStrong <= 1)) {
      return {
        farmType: 'friend',
        confidence: friendStrong >= 4 ? 0.72 : 0.62,
        ownStrong,
        friendStrong,
        source: 'ui_consensus'
      };
    }

    return null;
  }

  function getFarmOwnership(opts) {
    opts = opts || {};

    const evidence = {};
    let modelReady = false;
    let landReady = false;
    let oneClickReady = false;
    let globalReady = false;
    const allowWeakUi = !!opts.allowWeakUi;

    const mainUI = findMainUIComp(opts.path);
    if (mainUI) {
      evidence.mainUI = {
        nodePath: mainUI.node ? fullPath(mainUI.node) : null
      };

      let farmModel = null;
      if (typeof mainUI.getFarmEntity === 'function') {
        try {
          const entity = mainUI.getFarmEntity();
          farmModel = entity && entity.FarmModel ? entity.FarmModel : null;
        } catch (_) {}
      }

      if (farmModel) {
        const playerId = farmModel.player_id == null ? null : Number(farmModel.player_id);
        const currentUser = farmModel.curUserModel || null;
        let landCellCount = null;
        try {
          const cells = farmModel.land && typeof farmModel.land.getCells === 'function'
            ? farmModel.land.getCells()
            : null;
          landCellCount = Array.isArray(cells) ? cells.length : null;
        } catch (_) {}
        modelReady = Number.isFinite(playerId) && playerId > 0;
        landReady = Number.isFinite(landCellCount) && landCellCount > 0;
        evidence.farmModel = {
          playerId,
          modelReady,
          landReady,
          landCellCount,
          isOwerFarm: modelReady && typeof farmModel.isOwerFarm === 'boolean' ? !!farmModel.isOwerFarm : null,
          isInVisit: modelReady && typeof farmModel.isInVisit === 'boolean' ? !!farmModel.isInVisit : null,
          currentUserGid: currentUser && currentUser.gid != null ? currentUser.gid : null,
          currentUserName: currentUser ? currentUser.limitName || currentUser.name || null : null
        };
      }

      const visitNode = mainUI.visitNode && mainUI.visitNode.node ? mainUI.visitNode.node : mainUI.visitNode;
      if (visitNode) {
        evidence.visitNode = {
          path: fullPath(visitNode),
          active: !!visitNode.activeInHierarchy,
          trusted: false
        };
      }

      const backNode = mainUI.btnBack && mainUI.btnBack.node ? mainUI.btnBack.node : null;
      if (backNode) {
        evidence.backHomeButton = {
          path: fullPath(backNode),
          active: !!backNode.activeInHierarchy,
          texts: getNodeTextList(backNode, { maxDepth: 2 }),
          trusted: false
        };
      }

      const sourceNode = mainUI.sourceComp && mainUI.sourceComp.node ? mainUI.sourceComp.node : null;
      if (sourceNode) {
        evidence.sourceNode = {
          path: fullPath(sourceNode),
          active: !!sourceNode.activeInHierarchy,
          trusted: false
        };
      }
    }

    const mainMenu = findMainMenuComp(opts.path);
    if (mainMenu) {
      evidence.mainMenu = {
        nodePath: mainMenu.node ? fullPath(mainMenu.node) : null
      };

      const warehouseNode = mainMenu.btnWarehouse && mainMenu.btnWarehouse.node ? mainMenu.btnWarehouse.node : null;
      if (warehouseNode) {
        evidence.warehouseButton = {
          path: fullPath(warehouseNode),
          active: !!warehouseNode.activeInHierarchy,
          texts: getNodeTextList(warehouseNode, { maxDepth: 2 }),
          trusted: false
        };
      }

      const shareNode = mainMenu.btnShare && mainMenu.btnShare.node ? mainMenu.btnShare.node : null;
      if (shareNode) {
        evidence.shareButton = {
          path: fullPath(shareNode),
          active: !!shareNode.activeInHierarchy,
          trusted: false
        };
      }
    }

    let oneClick = null;
    try {
      oneClick = findOneClickManager(opts.path);
    } catch (_) {}
    if (oneClick) {
      const harvestNode = oneClick.buttons && oneClick.buttons[0] && oneClick.buttons[0].node
        ? oneClick.buttons[0].node
        : null;
      const harvestTexts = harvestNode ? getNodeTextList(harvestNode, { maxDepth: 3 }) : [];
      const cachedIsOwerFarm = typeof oneClick.cachedIsOwerFarm === 'boolean'
        ? !!oneClick.cachedIsOwerFarm
        : null;
      const hasVisibilityCache = !!(oneClick.buttonVisibilityCache && oneClick.buttonVisibilityCache.size > 0);
      oneClickReady = hasVisibilityCache;

      evidence.oneClick = {
        nodePath: oneClick.node ? fullPath(oneClick.node) : null,
        hasVisibilityCache,
        cachedIsOwerFarm,
        textTrusted: hasVisibilityCache,
        harvestButtonTexts: harvestTexts
      };
    }

    const activeWarehouseButtons = findButtonsByKeywords(['openWarehouse', 'btn_warehouse'], { activeOnly: true });
    if (activeWarehouseButtons.length > 0) {
      evidence.activeWarehouseButtons = {
        trusted: false,
        count: activeWarehouseButtons.length,
        list: activeWarehouseButtons.map(slimButtonInfo)
      };
    }

    const activeBackHomeButtons = findButtonsByKeywords(['backOwerFarm'], { activeOnly: true });
    if (activeBackHomeButtons.length > 0) {
      evidence.activeBackHomeButtons = {
        trusted: false,
        count: activeBackHomeButtons.length,
        list: activeBackHomeButtons.map(slimButtonInfo)
      };
    }

    const globalFarmWatch = readGlobalFarmWatchState();
    if (globalFarmWatch) {
      evidence.globalFarmWatch = globalFarmWatch;
      globalReady = !!globalFarmWatch.ready;
    }

    const runtimeReady = modelReady || globalReady;
    let ownScore = 0;
    let friendScore = 0;
    let weakOwnScore = 0;
    let weakFriendScore = 0;
    let decisionSource = 'none';

    if (evidence.farmModel && evidence.farmModel.modelReady) {
      if (evidence.farmModel.isOwerFarm === true) ownScore += 20;
      if (evidence.farmModel.isOwerFarm === false) friendScore += 20;
      if (evidence.farmModel.isInVisit === true) friendScore += 3;
    }

    if (evidence.globalFarmWatch && evidence.globalFarmWatch.ready) {
      if (evidence.globalFarmWatch.isOwnFarm === true) ownScore += 16;
      if (evidence.globalFarmWatch.isOwnFarm === false) friendScore += 16;
    }

    const trustUi = runtimeReady || allowWeakUi;
    if (evidence.visitNode) {
      evidence.visitNode.trusted = trustUi;
      if (trustUi) {
        if (evidence.visitNode.active) friendScore += 3;
        else ownScore += 1;
      } else if (evidence.visitNode.active) {
        weakFriendScore += 1;
      }
    }

    if (evidence.backHomeButton) {
      evidence.backHomeButton.trusted = trustUi;
      if (trustUi && evidence.backHomeButton.active) friendScore += 3;
      else if (!trustUi && evidence.backHomeButton.active) weakFriendScore += 1;
    }

    if (evidence.sourceNode) {
      evidence.sourceNode.trusted = trustUi;
      if (trustUi && evidence.sourceNode.active) ownScore += 1;
      else if (!trustUi && evidence.sourceNode.active) weakOwnScore += 1;
    }

    if (evidence.warehouseButton) {
      evidence.warehouseButton.trusted = trustUi;
      if (trustUi && evidence.warehouseButton.active) ownScore += 3;
      else if (!trustUi && evidence.warehouseButton.active) weakOwnScore += 1;
    }

    if (evidence.shareButton) {
      evidence.shareButton.trusted = trustUi;
      if (trustUi && evidence.shareButton.active) ownScore += 1;
      else if (!trustUi && evidence.shareButton.active) weakOwnScore += 1;
    }

    if (evidence.activeWarehouseButtons) {
      evidence.activeWarehouseButtons.trusted = trustUi;
      if (trustUi) ownScore += 1;
      else weakOwnScore += 1;
    }

    if (evidence.activeBackHomeButtons) {
      evidence.activeBackHomeButtons.trusted = trustUi;
      if (trustUi) friendScore += 1;
      else weakFriendScore += 1;
    }

    let farmType = 'unknown';
    if (modelReady || globalReady || allowWeakUi) {
      if (ownScore > friendScore) farmType = 'own';
      else if (friendScore > ownScore) farmType = 'friend';
    }

    const scoreDiff = Math.abs(ownScore - friendScore);
    let confidence = 0;
    if (farmType === 'unknown') {
      confidence = runtimeReady ? 0.35 : 0.1;
    } else if (modelReady) {
      decisionSource = 'farm_model';
      confidence = 0.98;
    } else if (globalReady) {
      decisionSource = 'global_farm_watch';
      confidence = scoreDiff >= 12 ? 0.94 : 0.88;
    } else if (allowWeakUi) {
      decisionSource = 'weak_ui';
      confidence = scoreDiff >= 4 ? 0.55 : 0.35;
    }

    if (farmType === 'unknown') {
      const uiFallback = classifyOwnershipByUiFallback(evidence);
      if (uiFallback) {
        farmType = uiFallback.farmType;
        confidence = uiFallback.confidence;
        decisionSource = uiFallback.source;
        evidence.uiFallback = uiFallback;
      }
    }

    const payload = {
      farmType,
      isOwnFarm: farmType === 'own' ? true : farmType === 'friend' ? false : null,
      isFriendFarm: farmType === 'friend' ? true : farmType === 'own' ? false : null,
      modelReady,
      landReady,
      oneClickReady,
      globalReady,
      runtimeReady,
      confidence,
      decisionSource,
      allowWeakUi,
      scores: {
        own: ownScore,
        friend: friendScore
      },
      weakScores: {
        own: weakOwnScore,
        friend: weakFriendScore
      },
      evidence
    };

    return opts.silent ? payload : out(payload);
  }

  function getFarmEntity(opts) {
    opts = opts || {};
    const mainUI = findMainUIComp(opts.path);
    if (!mainUI || typeof mainUI.getFarmEntity !== 'function') return null;
    try {
      return mainUI.getFarmEntity() || null;
    } catch (_) {
      return null;
    }
  }

  function getFarmModel(opts) {
    const entity = getFarmEntity(opts);
    return entity && entity.FarmModel ? entity.FarmModel : null;
  }

  function mapFriendListItem(friend, index) {
    const plant = friend && friend.plant && typeof friend.plant === 'object' ? friend.plant : {};
    const workCounts = {
      collect: Math.max(0, Number(plant.steal_plant_num) || 0),
      water: Math.max(0, Number(plant.dry_num) || 0),
      eraseGrass: Math.max(0, Number(plant.weed_num) || 0),
      killBug: Math.max(0, Number(plant.insect_num) || 0)
    };
    const name = normalizeText(friend && friend.name);
    const remark = normalizeText(friend && friend.remark);
    const gid = toPositiveNumber(friend && friend.gid);
    const displayName = remark || name || (gid != null ? String(gid) : '');

    return {
      index,
      gid,
      name: name || null,
      remark: remark || null,
      displayName: displayName || null,
      level: friend && friend.level != null ? Number(friend.level) : null,
      gold: friend && friend.gold != null ? Number(friend.gold) : null,
      rank: friend && friend.rank != null ? Number(friend.rank) : null,
      avatar: friend && friend.avatar ? friend.avatar : null,
      isNew: !!(friend && friend.is_new),
      isFollow: !!(friend && friend.is_follow),
      authorizedStatus: friend && friend.authorized_status != null ? Number(friend.authorized_status) : null,
      visitRefreshTime: friend && friend.visitRefreshTime != null ? Number(friend.visitRefreshTime) : null,
      workCounts,
      canCollect: workCounts.collect > 0,
      needsWater: workCounts.water > 0,
      needsEraseGrass: workCounts.eraseGrass > 0,
      needsKillBug: workCounts.killBug > 0
    };
  }

  function getFriendSearchFields(item) {
    const values = [
      item && item.displayName,
      item && item.remark,
      item && item.name,
      item && item.gid != null ? String(item.gid) : ''
    ];
    const outArr = [];
    const seen = new Set();

    for (let i = 0; i < values.length; i++) {
      const text = normalizeText(values[i]);
      if (!text) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      outArr.push(text);
    }

    return outArr;
  }

  function filterFriendEntriesByKeyword(entries, keyword) {
    const normalized = normalizeMatchText(keyword);
    if (!normalized) return entries;

    return entries.filter(entry => {
      const fields = getFriendSearchFields(entry.item);
      for (let i = 0; i < fields.length; i++) {
        if (normalizeMatchText(fields[i]).indexOf(normalized) >= 0) return true;
      }
      return false;
    });
  }

  function formatFriendMatchList(entries) {
    const list = Array.isArray(entries) ? entries : [];
    return list.slice(0, 8).map(entry => {
      const item = entry && entry.item ? entry.item : entry;
      const label = item && (item.displayName || item.name || item.remark) ? (item.displayName || item.name || item.remark) : 'unknown';
      const gid = item && item.gid != null ? item.gid : '?';
      return label + '(' + gid + ')';
    }).join(', ');
  }

  /**
   * 调用 reqGameFriendsFromServer 获取好友最新植物状态（steal_plant_num, dry_num 等）。
   * reqFriendList (SyncAll) 返回的植物状态是缓存的，只有 reqGameFriendsFromServer (GetGameFriends)
   * 才能拿到服务端最新的可偷/可浇水等数据。
   * 游戏好友界面也是用 doRefreshFriendList -> reqGameFriendsFromServer 实现的。
   */
  async function refreshFriendPlantStatus(manager, timeoutMs) {
    timeoutMs = Math.max(500, Number(timeoutMs) || 2000);
    const list = typeof manager.getClientFriendList === 'function'
      ? manager.getClientFriendList()
      : manager.clientFriendList;
    if (!Array.isArray(list) || list.length === 0) return { refreshed: false, reason: 'empty_list' };

    const gids = list.map(f => f && f.gid).filter(g => g != null);
    if (gids.length === 0) return { refreshed: false, reason: 'no_gids' };

    if (typeof manager.reqGameFriendsFromServer !== 'function') {
      return { refreshed: false, reason: 'method_not_found' };
    }

    // 重置刷新页标记，允许重新请求
    if (typeof manager.resetRefreshPage === 'function') {
      try { manager.resetRefreshPage(); } catch (_) {}
    }
    if (typeof manager.resetFriendCanRefresh === 'function') {
      try { manager.resetFriendCanRefresh(); } catch (_) {}
    }

    // 直接调用 reqGameFriendsFromServer，分页发送（与游戏一致，每页50个）
    const PAGE_SIZE = manager.REFRESH_PAGE_NUM || 50;
    let pageCount = 0;
    for (let i = 0; i < gids.length; i += PAGE_SIZE) {
      const chunk = gids.slice(i, i + PAGE_SIZE);
      try {
        manager.reqGameFriendsFromServer(chunk);
        pageCount++;
      } catch (_) {}
    }

    // 等待 WebSocket 异步回调完成更新 clientFriendList
    await wait(Math.min(timeoutMs, 500 + pageCount * 200));

    return { refreshed: true, gidCount: gids.length, pages: pageCount };
  }

  function resolveFriendRuntimeContext() {
    const runtime = getFriendManagerRuntime();
    if (!runtime || !runtime.FriendManager) throw new Error('FriendManager not found');

    let manager = runtime.manager || null;
    if (!manager) {
      try {
        manager = runtime.FriendManager.ins || runtime.FriendManager._instance || null;
      } catch (_) {
        manager = runtime.FriendManager._instance || null;
      }
    }
    if (!manager) throw new Error('FriendManager instance not ready');

    return {
      runtime,
      manager
    };
  }

  function shouldRequestFriendRefresh(manager, opts) {
    if (!manager || typeof manager.reqFriendList !== 'function') return false;
    if (manager.bReqFriendListed !== true && opts.allowFetch !== false) return true;
    if (opts.refresh === true) return true;
    return false;
  }

  function buildFriendEntriesResult(runtime, manager, opts, refreshMeta) {
    refreshMeta = refreshMeta || {};
    opts = opts || {};

    if (opts.sort !== false && manager && typeof manager.sortClientFriendList === 'function') {
      try {
        manager.sortClientFriendList();
      } catch (_) {}
    }

    let rawList = [];
    try {
      rawList = opts.includeSelf
        ? (
            typeof manager.getClientFriendList === 'function'
              ? manager.getClientFriendList()
              : manager.clientFriendList
          )
        : (
            typeof manager.getClientFriendListExcludeSelf === 'function'
              ? manager.getClientFriendListExcludeSelf()
              : (
                  typeof manager.getClientFriendList === 'function'
                    ? manager.getClientFriendList()
                    : manager.clientFriendList
                )
          );
    } catch (_) {
      rawList = [];
    }
    rawList = Array.isArray(rawList) ? rawList : [];

    const watchState = readGlobalFarmWatchState();
    const selfGid = watchState && watchState.selfGid != null ? watchState.selfGid : null;
    const entries = rawList
      .map((friend, index) => ({
        raw: friend,
        item: mapFriendListItem(friend, index)
      }))
      .filter(entry => entry.item && entry.item.gid != null)
      .filter(entry => opts.includeSelf || selfGid == null || entry.item.gid !== selfGid);

    const keyword = opts.keyword != null ? opts.keyword : (opts.search != null ? opts.search : opts.query);
    const filteredEntries = keyword == null ? entries : filterFriendEntriesByKeyword(entries, keyword);

    return {
      source: runtime.source,
      manager,
      requestedRefresh: !!refreshMeta.requestedRefresh,
      refreshed: !!refreshMeta.refreshed,
      refreshError: refreshMeta.refreshError || null,
      refreshMode: refreshMeta.refreshMode || 'none',
      reqFriendListed: !!manager.bReqFriendListed,
      selfGid,
      totalCount: entries.length,
      entries: filteredEntries
    };
  }

  function getFriendEntriesSync(opts) {
    opts = opts || {};
    const ctx = resolveFriendRuntimeContext();
    const requestedRefresh = shouldRequestFriendRefresh(ctx.manager, opts);
    let refreshMode = 'none';

    // if (requestedRefresh) {
      refreshMode = 'background';
      Promise.resolve()
        .then(() => ctx.manager.reqFriendList())
        .then(() => {
          if (opts.refreshPlantStatus !== false) {
            return refreshFriendPlantStatus(ctx.manager, opts.plantRefreshTimeoutMs);
          }
        })
        .catch(() => {});
    // }

    return buildFriendEntriesResult(ctx.runtime, ctx.manager, opts, {
      requestedRefresh,
      refreshed: false,
      refreshError: null,
      refreshMode
    });
  }

  async function getFriendEntries(opts) {
    opts = opts || {};
    const ctx = resolveFriendRuntimeContext();
    const requestedRefresh = shouldRequestFriendRefresh(ctx.manager, opts);
    let refreshed = false;
    let refreshError = null;
    let refreshMode = 'none';
    let plantRefreshResult = null;

    // if (requestedRefresh) {
      refreshMode = 'awaited';
      try {
        // 1. reqFriendList (SyncAll) 拉取基本好友列表
        await ctx.manager.reqFriendList();
        refreshed = true;
      } catch (e) {
        refreshError = e && e.message ? e.message : String(e);
      }

      // 2. reqGameFriendsFromServer (GetGameFriends) 刷新真实植物状态
      if (opts.refreshPlantStatus !== false) {
        try {
          plantRefreshResult = await refreshFriendPlantStatus(ctx.manager, opts.plantRefreshTimeoutMs);
        } catch (e) {
          plantRefreshResult = { refreshed: false, error: e && e.message ? e.message : String(e) };
        }
      }
    // }

    const result = buildFriendEntriesResult(ctx.runtime, ctx.manager, opts, {
      requestedRefresh,
      refreshed,
      refreshError,
      refreshMode
    });
    result.plantRefresh = plantRefreshResult;
    return result;
  }

  function resolveFriendEntry(entries, target, opts) {
    opts = opts || {};
    const list = Array.isArray(entries) ? entries : [];
    if (list.length === 0) throw new Error('Friend list is empty');

    let gid = null;
    let query = '';
    if (target && typeof target === 'object' && !Array.isArray(target)) {
      gid = toPositiveNumber(target.gid);
      query = normalizeText(
        target.name != null ? target.name
          : target.remark != null ? target.remark
          : target.displayName != null ? target.displayName
          : target.keyword != null ? target.keyword
          : target.query
      );
    } else if (typeof target === 'number') {
      gid = toPositiveNumber(target);
    } else {
      const text = normalizeText(target);
      if (/^\d+$/.test(text)) gid = toPositiveNumber(text);
      else query = text;
    }

    if (gid != null) {
      const byGid = list.find(entry => entry.item && entry.item.gid === gid);
      if (byGid) {
        return {
          entry: byGid,
          matchType: 'gid'
        };
      }
      if (!query) throw new Error('Friend not found by gid: ' + gid);
    }

    const normalized = normalizeMatchText(query);
    if (!normalized) throw new Error('target required');

    function exactMatches(getter) {
      return list.filter(entry => {
        const value = normalizeMatchText(getter(entry.item));
        return !!value && value === normalized;
      });
    }

    const strategies = [
      { matchType: 'remark_exact', matches: exactMatches(item => item.remark) },
      { matchType: 'displayName_exact', matches: exactMatches(item => item.displayName) },
      { matchType: 'name_exact', matches: exactMatches(item => item.name) }
    ];

    for (let i = 0; i < strategies.length; i++) {
      const strategy = strategies[i];
      if (strategy.matches.length === 1) {
        return {
          entry: strategy.matches[0],
          matchType: strategy.matchType
        };
      }
      if (strategy.matches.length > 1) {
        throw new Error('Multiple friends matched ' + strategy.matchType + ': ' + formatFriendMatchList(strategy.matches));
      }
    }

    if (opts.fuzzy === false) {
      throw new Error('Friend not found: ' + query);
    }

    const fuzzyMatches = list.filter(entry => {
      const fields = getFriendSearchFields(entry.item);
      for (let i = 0; i < fields.length; i++) {
        if (normalizeMatchText(fields[i]).indexOf(normalized) >= 0) return true;
      }
      return false;
    });

    if (fuzzyMatches.length === 1) {
      return {
        entry: fuzzyMatches[0],
        matchType: 'fuzzy'
      };
    }
    if (fuzzyMatches.length > 1) {
      throw new Error('Multiple friends matched fuzzy query: ' + formatFriendMatchList(fuzzyMatches));
    }

    throw new Error('Friend not found: ' + query);
  }

  function buildFriendListPayload(data) {
    const list = data.entries.map(entry => entry.item);
    const counts = {
      friends: list.length,
      collectableFriends: 0,
      waterableFriends: 0,
      eraseGrassFriends: 0,
      killBugFriends: 0
    };
    const workCounts = {
      collect: 0,
      water: 0,
      eraseGrass: 0,
      killBug: 0
    };

    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      const work = item.workCounts || {};
      workCounts.collect += Number(work.collect) || 0;
      workCounts.water += Number(work.water) || 0;
      workCounts.eraseGrass += Number(work.eraseGrass) || 0;
      workCounts.killBug += Number(work.killBug) || 0;
      if (work.collect > 0) counts.collectableFriends++;
      if (work.water > 0) counts.waterableFriends++;
      if (work.eraseGrass > 0) counts.eraseGrassFriends++;
      if (work.killBug > 0) counts.killBugFriends++;
    }

    const payload = {
      source: data.source,
      requestedRefresh: data.requestedRefresh,
      refreshed: data.refreshed,
      refreshError: data.refreshError,
      refreshMode: data.refreshMode,
      reqFriendListed: data.reqFriendListed,
      selfGid: data.selfGid,
      count: list.length,
      counts,
      workCounts,
      list
    };
    return payload;
  }

  function getFriendList(opts) {
    opts = opts || {};
    if (opts.waitRefresh === true) {
      return (async () => {
        const data = await getFriendEntries(opts);
        const payload = buildFriendListPayload(data);
        return opts.silent ? payload : out(payload);
      })();
    }

    const data = getFriendEntriesSync(opts);
    const payload = buildFriendListPayload(data);

    return opts.silent ? payload : out(payload);
  }

  function findBackHomeButtonPath(ownership) {
    const evidence = ownership && ownership.evidence ? ownership.evidence : null;
    if (!evidence) return null;

    if (evidence.backHomeButton && evidence.backHomeButton.active && evidence.backHomeButton.path) {
      return evidence.backHomeButton.path;
    }

    const list = evidence.activeBackHomeButtons && Array.isArray(evidence.activeBackHomeButtons.list)
      ? evidence.activeBackHomeButtons.list
      : [];
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      if (item && item.active && item.path) return item.path;
    }

    return null;
  }

  async function enterFriendFarm(target, opts) {
    if (target && typeof target === 'object' && !Array.isArray(target) && opts == null) {
      opts = target;
      target = opts.target != null
        ? opts.target
        : opts.gid != null
          ? opts.gid
          : opts.name != null
            ? opts.name
            : opts.keyword;
    }
    opts = opts || {};

    const data = await getFriendEntries(opts);
    const resolved = resolveFriendEntry(data.entries, target, opts);
    const farmUtilRuntime = getFarmUtilRuntime();
    if (!farmUtilRuntime || !farmUtilRuntime.FarmUtil) throw new Error('FarmUtil not found');

    const reason = resolveFarmEnterReason(opts.reason == null ? 'FRIEND' : opts.reason);
    const waitMs = Math.max(0, Number(opts.waitMs) || 0);
    const beforeOwnership = opts.includeBeforeOwnership ? getFarmOwnership({ silent: true }) : null;

    await farmUtilRuntime.FarmUtil.enterFarm(resolved.entry.item.gid, reason.value);

    if (waitMs > 0) {
      await wait(waitMs);
    }

    let afterOwnership = null;
    if (opts.includeAfterOwnership || waitMs > 0) {
      try {
        afterOwnership = getFarmOwnership({ silent: true });
      } catch (_) {
        afterOwnership = null;
      }
    }

    const payload = {
      ok: true,
      source: farmUtilRuntime.source,
      reason,
      matchType: resolved.matchType,
      friend: resolved.entry.item,
      beforeOwnership,
      afterOwnership
    };

    return opts.silent ? payload : out(payload);
  }

  async function enterFarmByGid(gid, opts) {
    opts = opts || {};
    const targetGid = toPositiveNumber(gid);
    if (targetGid == null) throw new Error('gid required');

    const farmUtilRuntime = getFarmUtilRuntime();
    if (!farmUtilRuntime || !farmUtilRuntime.FarmUtil) throw new Error('FarmUtil not found');

    const reason = resolveFarmEnterReason(opts.reason == null ? 'UNKNOWN' : opts.reason);
    const waitMs = Math.max(0, Number(opts.waitMs) || 0);
    const beforeOwnership = opts.includeBeforeOwnership ? getFarmOwnership({ silent: true }) : null;

    await farmUtilRuntime.FarmUtil.enterFarm(targetGid, reason.value);

    if (waitMs > 0) {
      await wait(waitMs);
    }

    let afterOwnership = null;
    if (opts.includeAfterOwnership || waitMs > 0) {
      try {
        afterOwnership = getFarmOwnership({ silent: true });
      } catch (_) {
        afterOwnership = null;
      }
    }

    const payload = {
      ok: true,
      gid: targetGid,
      source: farmUtilRuntime.source,
      reason,
      beforeOwnership,
      afterOwnership
    };

    return opts.silent ? payload : out(payload);
  }

  async function enterOwnFarm(opts) {
    opts = opts || {};
    const waitMs = Math.max(0, Number(opts.waitMs) || 0);
    const reason = resolveFarmEnterReason(opts.reason == null ? 'UNKNOWN' : opts.reason);
    let ownership = null;
    try {
      ownership = getFarmOwnership({ silent: true, allowWeakUi: true });
    } catch (_) {
      ownership = null;
    }

    if (ownership && ownership.farmType === 'own') {
      const payload = {
        ok: true,
        source: 'already_own',
        reason,
        beforeOwnership: opts.includeBeforeOwnership ? ownership : null,
        afterOwnership: opts.includeAfterOwnership || waitMs > 0 ? ownership : null,
        selfGid: getSelfGid()
      };
      return opts.silent ? payload : out(payload);
    }

    const backHomePath = findBackHomeButtonPath(ownership);
    if (backHomePath) {
      smartClick(backHomePath);
      if (waitMs > 0) {
        await wait(waitMs);
      }

      let afterOwnership = null;
      if (opts.includeAfterOwnership || waitMs > 0) {
        try {
          afterOwnership = getFarmOwnership({ silent: true, allowWeakUi: true });
        } catch (_) {
          afterOwnership = null;
        }
      }

      if (!afterOwnership || afterOwnership.farmType === 'own') {
        const payload = {
          ok: true,
          source: 'back_home_button',
          path: backHomePath,
          reason,
          beforeOwnership: opts.includeBeforeOwnership ? ownership : null,
          afterOwnership,
          selfGid: getSelfGid()
        };
        return opts.silent ? payload : out(payload);
      }
    }

    const selfGid = await waitForSelfGid({
      timeoutMs: Math.max(waitMs, 1500),
      intervalMs: 100
    });
    if (selfGid == null) throw new Error('self gid not ready');

    const payload = await enterFarmByGid(selfGid, {
      ...opts,
      reason: reason.value,
      silent: true
    });
    payload.selfGid = selfGid;
    return opts.silent ? payload : out(payload);
  }

  function normalizeLandId(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function normalizeLandIds(list) {
    const arr = Array.isArray(list) ? list : [];
    const outArr = [];
    const seen = new Set();
    for (let i = 0; i < arr.length; i++) {
      const landId = normalizeLandId(arr[i]);
      if (landId == null || seen.has(landId)) continue;
      seen.add(landId);
      outArr.push(landId);
    }
    return outArr;
  }

  function buildLandIdSet(list) {
    const set = new Set();
    const arr = normalizeLandIds(list);
    for (let i = 0; i < arr.length; i++) set.add(arr[i]);
    return set;
  }

  function getLandRuntime(pathOrGridOrComp) {
    if (pathOrGridOrComp && typeof pathOrGridOrComp.canWater === 'function') {
      return pathOrGridOrComp;
    }

    let landId = null;
    if (pathOrGridOrComp && typeof pathOrGridOrComp.getLandId === 'function') {
      landId = pathOrGridOrComp.getLandId();
    } else {
      const node = toNode(pathOrGridOrComp);
      if (node) {
        const gridComp = findComponentByName(node, 'l7');
        if (gridComp && typeof gridComp.getLandId === 'function') {
          landId = gridComp.getLandId();
        }
      }
    }

    landId = normalizeLandId(landId);
    if (landId == null) return null;

    const farmModel = getFarmModel();
    if (!farmModel || typeof farmModel.getLandById !== 'function') return null;
    try {
      return farmModel.getLandById(landId) || null;
    } catch (_) {
      return null;
    }
  }

  function collectActionableLandIdsByGrid(root, farmType) {
    const idsByType = {
      collect: [],
      water: [],
      eraseGrass: [],
      killBug: [],
      eraseDead: []
    };

    const nodes = walk(root).filter(node => /(?:^|\/)grid_\d+_\d+$/.test(fullPath(node)));
    for (let i = 0; i < nodes.length; i++) {
      let info;
      try {
        info = getGridState(nodes[i], { silent: true, farmType });
      } catch (_) {
        continue;
      }

      const landId = normalizeLandId(info.landId);
      if (landId == null) continue;

      if (info.canCollect) idsByType.collect.push(landId);
      if (info.canWater) idsByType.water.push(landId);
      if (info.canEraseGrass) idsByType.eraseGrass.push(landId);
      if (info.canKillBug) idsByType.killBug.push(landId);
      if (info.canEraseDead) idsByType.eraseDead.push(landId);
    }

    return {
      collect: normalizeLandIds(idsByType.collect),
      water: normalizeLandIds(idsByType.water),
      eraseGrass: normalizeLandIds(idsByType.eraseGrass),
      killBug: normalizeLandIds(idsByType.killBug),
      eraseDead: normalizeLandIds(idsByType.eraseDead)
    };
  }

  function getAllGridNodes(root) {
    return walk(root).filter(node => /(?:^|\/)grid_\d+_\d+$/.test(fullPath(node)));
  }

  function resolveFarmContext(root, opts) {
    opts = opts || {};
    const farmStatus = opts.farmStatus && typeof opts.farmStatus === 'object'
      ? opts.farmStatus
      : null;
    const farmOwnership = opts.includeFarmOwnership === false
      ? null
      : (
          opts.farmOwnership ||
          (farmStatus && farmStatus.farmOwnership) ||
          getFarmOwnership({ path: root, silent: true })
        );
    const farmType = opts.farmType == null
      ? (
          farmStatus && farmStatus.farmType != null
            ? String(farmStatus.farmType)
            : farmOwnership
              ? farmOwnership.farmType
              : null
        )
      : String(opts.farmType);

    return {
      farmStatus,
      farmOwnership,
      farmType
    };
  }

  function getFarmWorkSummary(opts) {
    opts = opts || {};
    const root = findGridOrigin(opts.root || opts.path);
    if (!root) throw new Error('GridOrigin not found');

    const context = resolveFarmContext(root, opts);
    const farmOwnership = context.farmOwnership;
    const farmType = context.farmType;

    let idsByType = null;
    let source = 'grid_scan';
    let manager = null;
    try {
      manager = findOneClickManager(opts.path || root);
    } catch (_) {
      manager = null;
    }

    if (manager) {
      source = 'one_click_manager';
      idsByType = {
        collect: typeof manager.getAllHarvestableLandIds === 'function'
          ? normalizeLandIds(manager.getAllHarvestableLandIds())
          : [],
        water: typeof manager.getAllWaterableLandIds === 'function'
          ? normalizeLandIds(manager.getAllWaterableLandIds())
          : [],
        eraseGrass: typeof manager.getAllEraseGrassLandIds === 'function'
          ? normalizeLandIds(manager.getAllEraseGrassLandIds())
          : [],
        killBug: typeof manager.getAllKillBugLandIds === 'function'
          ? normalizeLandIds(manager.getAllKillBugLandIds())
          : [],
        eraseDead: typeof manager.getAllEraseableLandIds === 'function'
          ? normalizeLandIds(manager.getAllEraseableLandIds())
          : []
      };
    } else {
      idsByType = collectActionableLandIdsByGrid(root, farmType);
    }

    const payload = {
      farmOwnership,
      farmType,
      source,
      managerNodePath: manager && manager.node ? fullPath(manager.node) : null,
      counts: {
        collect: idsByType.collect.length,
        water: idsByType.water.length,
        eraseGrass: idsByType.eraseGrass.length,
        killBug: idsByType.killBug.length,
        eraseDead: idsByType.eraseDead.length
      },
      landIds: idsByType,
      sets: {
        collect: buildLandIdSet(idsByType.collect),
        water: buildLandIdSet(idsByType.water),
        eraseGrass: buildLandIdSet(idsByType.eraseGrass),
        killBug: buildLandIdSet(idsByType.killBug),
        eraseDead: buildLandIdSet(idsByType.eraseDead)
      }
    };

    if (opts.silent) return payload;

    return out({
      farmOwnership: payload.farmOwnership,
      farmType: payload.farmType,
      source: payload.source,
      managerNodePath: payload.managerNodePath,
      counts: payload.counts,
      landIds: payload.landIds
    });
  }

  function getGridComponent(pathOrNode) {
    const node = toNode(pathOrNode);
    if (!node) throw new Error('Grid node not found: ' + pathOrNode);

    const comp = findComponentByName(node, 'l7');
    if (!comp) throw new Error('Grid controller (l7) not found: ' + fullPath(node));
    return comp;
  }

  function getPlantComponent(pathOrNode) {
    const node = toNode(pathOrNode);
    if (!node) throw new Error('Plant node not found: ' + pathOrNode);

    const comp = findComponentByName(node, 'ln');
    if (!comp) throw new Error('Plant controller (ln) not found: ' + fullPath(node));
    return comp;
  }

  function getGridKey(input) {
    if (!input) return null;

    if (typeof input === 'string') {
      const match = /(?:plant_)?grid_(\d+)_(\d+)$/.exec(input);
      return match ? match[1] + '_' + match[2] : null;
    }

    if (typeof input.gridX === 'number' && typeof input.gridY === 'number') {
      return input.gridX + '_' + input.gridY;
    }

    if (input.node) return getGridKey(fullPath(input.node));
    return null;
  }

  function getGridCoords(input) {
    const key = getGridKey(input);
    if (!key) return null;
    const parts = key.split('_');
    return {
      x: Number(parts[0]),
      y: Number(parts[1])
    };
  }

  function getPlantNodeByGrid(pathOrNode) {
    const plantOrigin = findPlantOrigin();
    if (!plantOrigin) return null;

    const key = getGridKey(pathOrNode);
    if (!key) return null;

    return findNode(fullPath(plantOrigin) + '/plant_grid_' + key);
  }

  function getGridNodeByPlant(pathOrNode) {
    const gridOrigin = findGridOrigin();
    if (!gridOrigin) return null;

    const key = getGridKey(pathOrNode);
    if (!key) return null;

    return findNode(fullPath(gridOrigin) + '/grid_' + key);
  }

  function parseGrowPhases(growPhases) {
    return String(growPhases || '')
      .split(';')
      .map(item => item.trim())
      .filter(Boolean)
      .map((item, index) => {
        const parts = item.split(':');
        return {
          index: index + 1,
          name: parts[0] || '',
          duration: parts[1] == null ? null : Number(parts[1])
        };
      });
  }

  function getPlantRuntime(pathOrGridOrComp) {
    let plant;

    if (pathOrGridOrComp && typeof pathOrGridOrComp.checkHasPlant === 'function') {
      plant = pathOrGridOrComp.checkHasPlant();
    } else if (pathOrGridOrComp && typeof pathOrGridOrComp.getPlantData === 'function') {
      plant = pathOrGridOrComp.getPlantData();
    } else {
      const node = toNode(pathOrGridOrComp);
      if (!node) return null;

      const gridComp = findComponentByName(node, 'l7');
      if (gridComp && typeof gridComp.checkHasPlant === 'function') {
        plant = gridComp.checkHasPlant();
      } else {
        const plantComp = findComponentByName(node, 'ln');
        if (plantComp) {
          plant = typeof plantComp.getPlantData === 'function'
            ? plantComp.getPlantData()
            : plantComp.plantData;
        }
      }
    }

    return plant || null;
  }

  /** 与 game.resolved.js 中 PlantStage 枚举一致：MATURE=6, DEAD=7, ERASED=8 */
  const PlantStage = {
    PHASE_UNKNOWN: 0,
    SEED: 1,
    GERMINATION: 2,
    SMALL_LEAVES: 3,
    LARGE_LEAVES: 4,
    BLOOMING: 5,
    MATURE: 6,
    DEAD: 7,
    ERASED: 8
  };

  function getPlantStageSummary(plantRuntime) {
    if (!plantRuntime) return null;

    const config = plantRuntime.config || {};
    const plantData = plantRuntime.plantData || {};
    const phases = parseGrowPhases(config.grow_phases);
    const totalStages = phases.length > 0
      ? phases.length
      : Array.isArray(plantData.stage_infos) && plantData.stage_infos.length > 0
        ? Math.max.apply(null, plantData.stage_infos.map(x => Number(x.stage) || 0))
        : null;
    const currentStage = plantData.current_stage == null ? null : Number(plantData.current_stage);

    const isMatureByEnum = typeof plantRuntime.isMature === 'function'
      ? !!plantRuntime.isMature()
      : currentStage === PlantStage.MATURE;
    const isDeadByEnum = typeof plantRuntime.isDead === 'function'
      ? !!plantRuntime.isDead()
      : currentStage === PlantStage.DEAD;
    const isMatureByPhases = totalStages != null && currentStage === totalStages;

    return {
      config,
      plantData,
      phases,
      totalStages,
      currentStage,
      isMature: isMatureByEnum || isMatureByPhases,
      isDead: isDeadByEnum,
      isMatureByEnum,
      isMatureByPhases
    };
  }

  function getLandStageKind(hasPlant, stage) {
    if (!hasPlant) return 'empty';
    if (!stage) return 'unknown';
    if (stage.isDead) return 'dead';
    if (stage.currentStage === PlantStage.ERASED || stage.currentStage === PlantStage.PHASE_UNKNOWN) {
      return 'empty';
    }
    if (stage.isMature) return 'mature';
    if (typeof stage.currentStage === 'number' && stage.currentStage >= PlantStage.SEED && stage.currentStage < PlantStage.MATURE) {
      return 'growing';
    }
    return 'other';
  }

  function getGridState(pathOrNode, opts) {
    opts = opts || {};
    const node = toNode(pathOrNode);
    if (!node) throw new Error('Grid node not found: ' + pathOrNode);

    const gridComp = getGridComponent(node);
    const plantRuntime = getPlantRuntime(gridComp);
    const landId = typeof gridComp.getLandId === 'function' ? normalizeLandId(gridComp.getLandId()) : null;
    const landRuntime = getLandRuntime(gridComp);
    const stage = getPlantStageSummary(plantRuntime);
    const plantNode = getPlantNodeByGrid(node);
    const hasPlant = !!plantRuntime;
    const actionSets = opts.actionSets || null;
    const canHarvestRuntime = hasPlant && typeof plantRuntime.canHarvest === 'function'
      ? !!plantRuntime.canHarvest()
      : !!stage && !!stage.isMature;
    const canStealRuntime = hasPlant && typeof plantRuntime.canSteal === 'function'
      ? !!plantRuntime.canSteal()
      : false;
    const canWaterRuntime = actionSets && actionSets.water && landId != null
      ? actionSets.water.has(landId)
      : landRuntime && typeof landRuntime.canWater === 'function'
        ? !!landRuntime.canWater()
        : stage && stage.plantData && stage.plantData.dry_num != null
          ? Number(stage.plantData.dry_num) > 0
          : false;
    const canEraseGrassRuntime = actionSets && actionSets.eraseGrass && landId != null
      ? actionSets.eraseGrass.has(landId)
      : hasPlant && typeof plantRuntime.canEraseGrass === 'function'
        ? !!plantRuntime.canEraseGrass()
        : stage && stage.plantData && stage.plantData.weeds_num != null
          ? Number(stage.plantData.weeds_num) > 0
          : false;
    const canKillBugRuntime = actionSets && actionSets.killBug && landId != null
      ? actionSets.killBug.has(landId)
      : hasPlant && typeof plantRuntime.canKillBug === 'function'
        ? !!plantRuntime.canKillBug()
        : stage && stage.plantData && stage.plantData.insects_num != null
          ? Number(stage.plantData.insects_num) > 0
          : false;
    const farmType = opts.farmType == null ? null : String(opts.farmType);
    const canCollectRuntime = farmType === 'friend'
      ? canStealRuntime
      : farmType === 'own'
        ? canHarvestRuntime
        : (canHarvestRuntime || canStealRuntime);
    const canEraseDeadRuntime = actionSets && actionSets.eraseDead && landId != null
      ? actionSets.eraseDead.has(landId)
      : stage
        ? !!stage.isDead
        : hasPlant && typeof plantRuntime.isDead === 'function'
          ? !!plantRuntime.isDead()
          : false;

    const payload = {
      path: fullPath(node),
      gridPos: typeof gridComp.getGridPosition === 'function' ? gridComp.getGridPosition() : getGridCoords(node),
      landId,
      interactable: typeof gridComp.getInteractable === 'function' ? !!gridComp.getInteractable() : !!gridComp.isInteractable,
      selected: typeof gridComp.getSelected === 'function' ? !!gridComp.getSelected() : !!gridComp.isSelected,
      hasPlant,
      stageKind: getLandStageKind(hasPlant, stage),
      plantNode: plantNode ? fullPath(plantNode) : null,
      plantName: stage && stage.config ? stage.config.name || null : null,
      plantId: stage && stage.plantData ? stage.plantData.id : null,
      currentStage: stage ? stage.currentStage : null,
      totalStages: stage ? stage.totalStages : null,
      isMature: stage ? !!stage.isMature : false,
      isDead: stage ? !!stage.isDead : false,
      canHarvest: canHarvestRuntime,
      canSteal: canStealRuntime,
      canCollect: canCollectRuntime,
      canWater: canWaterRuntime,
      canEraseGrass: canEraseGrassRuntime,
      canKillBug: canKillBugRuntime,
      canEraseDead: canEraseDeadRuntime,
      needsWater: canWaterRuntime,
      needsEraseGrass: canEraseGrassRuntime,
      needsKillBug: canKillBugRuntime,
      needsEraseDead: canEraseDeadRuntime,
      leftFruit: stage && stage.plantData ? stage.plantData.left_fruit_num : null,
      fruitNum: stage && stage.plantData ? stage.plantData.fruit_num : null,
      raw: plantRuntime
    };
    return opts.silent ? payload : out(payload);
  }

  function getFarmStatus(opts) {
    opts = opts || {};
    const root = findGridOrigin(opts.root || opts.path);
    if (!root) throw new Error('GridOrigin not found');

    const context = resolveFarmContext(root, opts);
    const farmOwnership = context.farmOwnership;
    const farmType = context.farmType;
    const workSummary = getFarmWorkSummary({ path: root, farmOwnership, farmType, silent: true });
    const actionSets = workSummary.sets;
    const includeGrids = opts.includeGrids !== false;
    const includeLandIds = opts.includeLandIds !== false;
    const includeRawGrid = !!opts.includeRawGrid;
    const nodes = getAllGridNodes(root);
    const stageCounts = {
      empty: 0,
      mature: 0,
      dead: 0,
      growing: 0,
      other: 0,
      unknown: 0,
      error: 0
    };
    const grids = [];

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      try {
        const s = getGridState(node, { silent: true, farmType, actionSets });
        const kind = s.stageKind || 'unknown';
        if (stageCounts.hasOwnProperty(kind)) stageCounts[kind]++;
        else stageCounts.other++;

        if (includeGrids) {
          const entry = {
            path: s.path,
            gridPos: s.gridPos,
            landId: s.landId,
            interactable: s.interactable,
            selected: s.selected,
            hasPlant: s.hasPlant,
            stageKind: s.stageKind,
            plantNode: s.plantNode,
            plantName: s.plantName,
            plantId: s.plantId,
            currentStage: s.currentStage,
            totalStages: s.totalStages,
            isMature: s.isMature,
            isDead: s.isDead,
            canHarvest: s.canHarvest,
            canSteal: s.canSteal,
            canCollect: s.canCollect,
            canWater: s.canWater,
            canEraseGrass: s.canEraseGrass,
            canKillBug: s.canKillBug,
            canEraseDead: s.canEraseDead,
            needsWater: s.needsWater,
            needsEraseGrass: s.needsEraseGrass,
            needsKillBug: s.needsKillBug,
            needsEraseDead: s.needsEraseDead,
            leftFruit: s.leftFruit,
            fruitNum: s.fruitNum
          };
          if (includeRawGrid) entry.raw = s.raw;
          grids.push(entry);
        }
      } catch (e) {
        stageCounts.error++;
        if (includeGrids) {
          grids.push({
            path: fullPath(node),
            error: e && e.message ? e.message : String(e)
          });
        }
      }
    }

    const payload = {
      farmOwnership,
      farmType,
      totalGrids: nodes.length,
      stageCounts,
      workCounts: workSummary.counts,
      workSource: workSummary.source,
      managerNodePath: workSummary.managerNodePath
    };

    if (includeLandIds) payload.landIds = workSummary.landIds;
    if (includeGrids) payload.grids = grids;

    return opts.silent ? payload : out(payload);
  }

  function summarizeAllGrids(opts) {
    opts = opts || {};
    const status = getFarmStatus({
      ...opts,
      includeGrids: !!opts.includePaths,
      includeLandIds: false,
      silent: true
    });
    const payload = {
      farmOwnership: status.farmOwnership,
      farmType: status.farmType,
      workCounts: status.workCounts,
      totalGrids: status.totalGrids,
      counts: status.stageCounts,
      details: opts.includePaths ? status.grids : undefined
    };
    return opts.silent ? payload : out(payload);
  }

  function findHarvestableGrids(opts) {
    opts = opts || {};
    const root = findGridOrigin(opts.root || opts.path);
    if (!root) throw new Error('GridOrigin not found');
    const context = resolveFarmContext(root, opts);
    const farmOwnership = context.farmOwnership;
    const farmType = context.farmType;
    const workSummary = getFarmWorkSummary({ path: root, farmOwnership, farmType, silent: true });
    const actionMode = String(
      opts.actionMode || (farmType === 'friend' ? 'steal' : farmType === 'own' ? 'harvest' : 'collect')
    ).toLowerCase();

    const matureOnly = opts.matureOnly !== false;
    const nodes = getAllGridNodes(root);
    const list = [];

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      let info;
      try {
        info = getGridState(node, { silent: true, farmType, actionSets: workSummary.sets });
      } catch (_) {
        continue;
      }
      if (!info.hasPlant) continue;
      if (matureOnly && !info.isMature) continue;
      if (actionMode === 'harvest' && !info.canHarvest) continue;
      if (actionMode === 'steal' && !info.canSteal) continue;
      if (actionMode !== 'harvest' && actionMode !== 'steal' && !info.canCollect) continue;
      list.push({
        path: info.path,
        gridPos: info.gridPos,
        landId: info.landId,
        plantNode: info.plantNode,
        plantName: info.plantName,
        plantId: info.plantId,
        currentStage: info.currentStage,
        totalStages: info.totalStages,
        isMature: info.isMature,
        canHarvest: info.canHarvest,
        canSteal: info.canSteal,
        canCollect: info.canCollect,
        leftFruit: info.leftFruit,
        fruitNum: info.fruitNum
      });
    }

    return out({
      farmOwnership,
      farmType,
      actionMode,
      matureOnly,
      count: list.length,
      list
    });
  }

  function findMatureGrids(opts) {
    opts = opts || {};
    return findHarvestableGrids({ ...opts, matureOnly: true });
  }

  function normalizeGridActionType(action) {
    const raw = String(action == null ? 'collect' : action).trim().toLowerCase();
    const aliases = {
      collect: 'collect',
      harvest: 'collect',
      steal: 'collect',
      water: 'water',
      watering: 'water',
      bug: 'killBug',
      insect: 'killBug',
      killbug: 'killBug',
      kill_bug: 'killBug',
      grass: 'eraseGrass',
      weed: 'eraseGrass',
      erasegrass: 'eraseGrass',
      erase_grass: 'eraseGrass',
      dead: 'eraseDead',
      withered: 'eraseDead',
      erase_dead: 'eraseDead',
      erasedead: 'eraseDead'
    };
    if (aliases.hasOwnProperty(raw)) return aliases[raw];
    throw new Error('Unknown grid action type: ' + action);
  }

  function findActionableGrids(action, opts) {
    opts = opts || {};
    const root = findGridOrigin(opts.root || opts.path);
    if (!root) throw new Error('GridOrigin not found');

    const context = resolveFarmContext(root, opts);
    const farmOwnership = context.farmOwnership;
    const farmType = context.farmType;
    const actionType = normalizeGridActionType(action || opts.action);
    const workSummary = getFarmWorkSummary({ path: root, farmOwnership, farmType, silent: true });
    const landSet = workSummary.sets[actionType];
    const nodes = getAllGridNodes(root);
    const list = [];

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      let info;
      try {
        info = getGridState(node, { silent: true, farmType, actionSets: workSummary.sets });
      } catch (_) {
        continue;
      }

      const landId = normalizeLandId(info.landId);
      if (landId == null || !landSet || !landSet.has(landId)) continue;

      list.push({
        path: info.path,
        gridPos: info.gridPos,
        landId: info.landId,
        plantNode: info.plantNode,
        plantName: info.plantName,
        plantId: info.plantId,
        currentStage: info.currentStage,
        totalStages: info.totalStages,
        stageKind: info.stageKind,
        isMature: info.isMature,
        isDead: info.isDead,
        canHarvest: info.canHarvest,
        canSteal: info.canSteal,
        canCollect: info.canCollect,
        canWater: info.canWater,
        canEraseGrass: info.canEraseGrass,
        canKillBug: info.canKillBug,
        canEraseDead: info.canEraseDead,
        leftFruit: info.leftFruit,
        fruitNum: info.fruitNum
      });
    }

    return out({
      farmOwnership,
      farmType,
      action: actionType,
      count: list.length,
      list
    });
  }

  function findWaterableGrids(opts) {
    return findActionableGrids('water', opts);
  }

  function findEraseGrassGrids(opts) {
    return findActionableGrids('eraseGrass', opts);
  }

  function findKillBugGrids(opts) {
    return findActionableGrids('killBug', opts);
  }

  function findDeadGrids(opts) {
    return findActionableGrids('eraseDead', opts);
  }

  function inspectOneClickToolNodes(pathOrNode) {
    const parent = toNode(pathOrNode) || findNode('startup/root/ui/LayerUI/main_ui_v2/foot/LoadLazyRoot/OneClickOperationTools/parentNode') || findNode('root/ui/LayerUI/main_ui_v2/foot/LoadLazyRoot/OneClickOperationTools/parentNode');
    if (!parent) throw new Error('OneClickOperationTools parentNode not found');

    return out((parent.children || []).map(node => {
      const comp = findComponentByName(node, 'l4');
      const btn = node.getComponent ? node.getComponent(cc.Button) : null;
      return {
        path: fullPath(node),
        name: node.name,
        active: !!node.activeInHierarchy,
        components: componentNames(node),
        effectId: comp ? comp.effectId : null,
        interval: comp ? comp.interval : null,
        once: comp ? comp.once : null,
        clickEventCount: btn && btn.clickEvents ? btn.clickEvents.length : 0
      };
    }));
  }

  function isOneClickManagerComponent(comp) {
    if (!comp) return false;
    return typeof comp.onButtonClick === 'function'
      && typeof comp.getAllHarvestableLandIds === 'function'
      && typeof comp.updateAllButtonsVisibility === 'function';
  }

  function findOneClickManager(pathOrNode) {
    const directNode = toNode(pathOrNode);
    if (directNode) {
      const directComp = (directNode.components || []).find(isOneClickManagerComponent);
      if (directComp) return directComp;
    }

    const candidatePaths = [
      'startup/root/ui/LayerUI/main_ui_v2/foot/LoadLazyRoot/OneClickOperationTools',
      'root/ui/LayerUI/main_ui_v2/foot/LoadLazyRoot/OneClickOperationTools',
      'startup/root/ui/LayerUI/main_ui_v2/foot/LoadLazyRoot',
      'root/ui/LayerUI/main_ui_v2/foot/LoadLazyRoot'
    ];

    for (let i = 0; i < candidatePaths.length; i++) {
      const node = findNode(candidatePaths[i]);
      if (!node) continue;
      const comp = (node.components || []).find(isOneClickManagerComponent);
      if (comp) return comp;
      const nested = walk(node)
        .map(child => (child.components || []).find(isOneClickManagerComponent))
        .find(Boolean);
      if (nested) return nested;
    }

    return walk(scene())
      .map(node => (node.components || []).find(isOneClickManagerComponent))
      .find(Boolean) || null;
  }

  function getOneClickOperationNames() {
    return ['HARVEST', 'WATER', 'ERASE_GRASS', 'KILL_BUG'];
  }

  function resolveOneClickOperationIndex(typeOrIndex) {
    if (typeof typeOrIndex === 'number' && isFinite(typeOrIndex)) return typeOrIndex;
    const raw = String(typeOrIndex == null ? 'HARVEST' : typeOrIndex).trim().toUpperCase();
    const aliases = {
      'HARVEST': 0,
      'COLLECT': 0,
      'SHOUHUO': 0,
      'SHOU_HUO': 0,
      '收获': 0,
      '一键收获': 0,
      'WATER': 1,
      '浇水': 1,
      'ERASE_GRASS': 2,
      'GRASS': 2,
      '除草': 2,
      'KILL_BUG': 3,
      'BUG': 3,
      '除虫': 3
    };
    if (aliases.hasOwnProperty(raw)) return aliases[raw];
    throw new Error('Unknown one-click operation: ' + typeOrIndex);
  }

  function getOneClickManagerState(pathOrNode, opts) {
    opts = opts || {};
    const comp = findOneClickManager(pathOrNode);
    if (!comp) throw new Error('OneClickOperationBtnComp not found');

    const names = getOneClickOperationNames();
    const harvestButtonNode = comp.buttons && comp.buttons[0] && comp.buttons[0].node
      ? comp.buttons[0].node
      : null;
    const buttons = (comp.buttons || []).map((btn, index) => ({
      index,
      type: names[index] || String(index),
      path: btn && btn.node ? fullPath(btn.node) : null,
      active: !!(btn && btn.node && btn.node.activeInHierarchy),
      interactable: !!(btn && btn.interactable),
      hasHandler: !!(comp.buttonClickHandlers && comp.buttonClickHandlers.has && comp.buttonClickHandlers.has(index))
    }));

    const payload = {
      componentName: comp.constructor ? comp.constructor.name : String(comp),
      nodePath: comp.node ? fullPath(comp.node) : null,
      activeOperationType: comp.activeOperationType == null ? null : comp.activeOperationType,
      suppressHarvestButton: !!comp.suppressHarvestButton,
      cachedIsOwerFarm: typeof comp.cachedIsOwerFarm === 'boolean' ? !!comp.cachedIsOwerFarm : null,
      harvestButtonTexts: harvestButtonNode ? getNodeTextList(harvestButtonNode, { maxDepth: 3 }) : [],
      buttonVisibilityCache: comp.buttonVisibilityCache && comp.buttonVisibilityCache.forEach
        ? (() => {
            const arr = [];
            comp.buttonVisibilityCache.forEach(v => arr.push(v));
            return arr.sort();
          })()
        : [],
      buttons
    };
    return opts.silent ? payload : out(payload);
  }

  function triggerOneClickOperation(typeOrIndex, opts) {
    opts = opts || {};
    const comp = findOneClickManager(opts.path);
    if (!comp) throw new Error('OneClickOperationBtnComp not found');

    const index = resolveOneClickOperationIndex(typeOrIndex);
    if (typeof comp.onButtonClick !== 'function') {
      throw new Error('onButtonClick not found on OneClickOperationBtnComp');
    }

    const before = opts.includeBefore === false ? null : getOneClickManagerState(comp.node);
    const ret = comp.onButtonClick(index);
    const after = opts.includeAfter === false ? null : getOneClickManagerState(comp.node);

    const payload = {
      action: 'triggerOneClickOperation',
      index,
      type: getOneClickOperationNames()[index] || String(index),
      ret,
      before,
      after
    };
    return opts.silent ? payload : out(payload);
  }

  function triggerOneClickHarvest(opts) {
    return triggerOneClickOperation(0, opts);
  }

  // ─── 种植相关 ───

  function resolveOops() {
    const resolved = findSystemModuleExport(
      ['chunks:///_virtual/Oops.ts', './Oops.ts'],
      'oops'
    );
    if (resolved && resolved.value) return resolved.value;

    const resolved2 = findSystemModuleExport(
      ['chunks:///_virtual/GlobalData.ts', './GlobalData.ts'],
      'oops'
    );
    if (resolved2 && resolved2.value) return resolved2.value;
    return null;
  }

  function getItemManager() {
    const oops = resolveOops();
    if (oops && oops.itemM) return oops.itemM;
    throw new Error('oops.itemM not found');
  }

  function getOopsMessage() {
    const oops = resolveOops();
    if (oops && oops.message) return oops.message;
    throw new Error('oops.message not found');
  }

  function getProtobufDefault() {
    const oops = resolveOops();
    if (oops && oops.protobufDefault) return oops.protobufDefault;
    throw new Error('oops.protobufDefault not found');
  }

  function getNetWebSocket() {
    const oops = resolveOops();
    if (oops && oops.netWebSocket) return oops.netWebSocket;
    throw new Error('oops.netWebSocket not found');
  }

  /**
   * 获取背包中所有种子
   * sortMode: 1=按层级降序, 2=按稀有度降序, 3=按等级降序, 4=按id升序
   */
  function getAllSeeds(sortMode) {
    const itemM = getItemManager();
    if (typeof itemM.getAllSeeds !== 'function') throw new Error('itemM.getAllSeeds not found');
    return itemM.getAllSeeds(sortMode || 0);
  }

  function initSeedModel(seed) {
    if (!seed || typeof seed !== 'object') return seed;
    if (typeof seed.initPlantData === 'function') {
      try {
        seed.initPlantData();
      } catch (_) {}
    }
    return seed;
  }

  function summarizeSeedModel(seed) {
    if (!seed) return null;
    initSeedModel(seed);
    const detail = seed.detail || seed.tempData || {};
    const plantData = seed.plantData || {};
    return {
      itemId: seed.itemId || seed.id,
      seedId: seed.id,
      name: seed.name || '未知种子',
      count: Math.max(0, Number(seed.count) || 0),
      level: Number(detail.level || seed.level || 0),
      rarity: Number(detail.rarity || 0),
      layer: Number(detail.layer || seed.layerNum || 0),
      isMultiLandPlant: !!seed.isMultiLandPlant,
      plantSize: Math.max(1, Number(plantData.size) || 1),
      plantId: plantData.id == null ? null : plantData.id
    };
  }

  function getSeedModel(target, opts) {
    opts = opts || {};

    if (target && typeof target === 'object' && target.id != null) {
      return initSeedModel(target);
    }

    const seeds = getAllSeeds(opts.sortMode || 0);
    const targetId = toPositiveNumber(target);
    const targetName = normalizeMatchText(target);

    for (let i = 0; i < seeds.length; i++) {
      const seed = initSeedModel(seeds[i]);
      if (!seed) continue;

      const count = Math.max(0, Number(seed.count) || 0);
      if (!opts.includeZeroCount && count <= 0) continue;

      if (targetId != null) {
        if (toPositiveNumber(seed.id) === targetId) return seed;
        if (toPositiveNumber(seed.itemId) === targetId) return seed;
      }

      if (targetName && normalizeMatchText(seed.name) === targetName) {
        return seed;
      }
    }

    return null;
  }

  /**
   * 获取种子列表（供外部调用的精简版）
   */
  function getSeedList(opts) {
    opts = opts || {};
    const seeds = getAllSeeds(opts.sortMode || 3);
    const list = seeds
      .map(summarizeSeedModel)
      .filter(Boolean)
      .filter(function (s) {
        return !opts.availableOnly || s.count > 0;
      });
    return opts.silent ? list : out(list);
  }

  /**
   * 获取商店种子商品列表
   * 需要先请求商店数据（shop_id=2 是种子商店）
   */
  function readShopSeedList(opts) {
    opts = opts || {};
    const oops = resolveOops();
    if (!oops) throw new Error('oops not found');
    const farmEntity = oops.farm || (oops.ecs && oops.ecs.farm);
    const shop = farmEntity && farmEntity.shop ? farmEntity.shop : (oops.shop || null);
    if (!shop || !shop.ShopModelComp) throw new Error('ShopModelComp not found');
    const allGoods = shop.ShopModelComp.curGoodsList;
    if (!Array.isArray(allGoods)) return opts.silent ? [] : out([]);
    const seedGoods = allGoods.filter(function (g) {
      return g && g.isSeed && g.unlocked && !g.isBuyAll;
    });
    const list = seedGoods.map(function (g) {
      const tempModel = g.tempModel || null;
      if (tempModel && typeof tempModel.initPlantData === 'function') {
        try {
          tempModel.initPlantData();
        } catch (_) {}
      }
      const plantData = tempModel && tempModel.plantData ? tempModel.plantData : {};
      return {
        goodsId: g.id,
        itemId: g.itemId,
        name: g.name || '未知',
        price: g.price || 0,
        priceId: g.priceId || 0,
        unlockLevel: g.unlockLevel || 0,
        buyNum: g.buyNum || 0,
        limitCount: g.limitCount || 0,
        level: tempModel ? (tempModel.level || 0) : 0,
        rarity: tempModel && tempModel.detail ? (tempModel.detail.rarity || 0) : 0,
        layer: tempModel ? (tempModel.layerNum || 0) : 0,
        isMultiLandPlant: !!(tempModel && tempModel.isMultiLandPlant),
        plantSize: Math.max(1, Number(plantData.size) || 1),
        plantId: plantData.id == null ? null : plantData.id,
        source: 'shop'
      };
    });
    if (opts.sortByLevel) {
      list.sort(function (a, b) { return b.level - a.level; });
    }
    return opts.silent ? list : out(list);
  }

  async function getShopSeedList(opts) {
    opts = opts || {};
    const ensureData = opts.ensureData !== false;
    if (ensureData) {
      await requestShopData(opts.shopId || 2);
    }
    const list = readShopSeedList({
      silent: true,
      sortByLevel: opts.sortByLevel !== false
    }).filter(function (item) {
      return !opts.availableOnly || !item.isMultiLandPlant;
    });
    return opts.silent ? list : out(list);
  }

  /**
   * 请求商店数据（异步，需等待 ShopDataReady 事件）
   */
  async function requestShopData(shopId) {
    shopId = shopId || 2;
    const message = getOopsMessage();
    return new Promise(function (resolve) {
      const handler = function () {
        message.off('ShopDataReady', handler);
        resolve(true);
      };
      message.on('ShopDataReady', handler);
      message.dispatchEvent('RequestShopData', shopId);
      // 超时兜底
      setTimeout(function () {
        message.off('ShopDataReady', handler);
        resolve(false);
      }, 5000);
    });
  }

  /**
   * 购买商店商品
   */
  async function buyShopGoods(goodsId, num, price) {
    const message = getOopsMessage();
    return new Promise(function (resolve) {
      const handler = function (ev, itemId, count) {
        message.off('ShopBuySuccess', handler);
        resolve({ ok: true, itemId: itemId, count: count });
      };
      message.on('ShopBuySuccess', handler);
      message.dispatchEvent('ShopBuyGoods', goodsId, num, price);
      setTimeout(function () {
        message.off('ShopBuySuccess', handler);
        resolve({ ok: false, reason: 'timeout' });
      }, 5000);
    });
  }

  function compareSeedPriority(a, b, order) {
    const direction = order === 'asc' ? 1 : -1;
    const levelDiff = ((Number(a && a.level) || 0) - (Number(b && b.level) || 0)) * direction;
    if (levelDiff !== 0) return levelDiff;
    const layerDiff = ((Number(a && a.layer) || 0) - (Number(b && b.layer) || 0)) * direction;
    if (layerDiff !== 0) return layerDiff;
    const rarityDiff = ((Number(a && a.rarity) || 0) - (Number(b && b.rarity) || 0)) * direction;
    if (rarityDiff !== 0) return rarityDiff;
    return (Number(a && (a.itemId || a.seedId)) || 0) - (Number(b && (b.itemId || b.seedId)) || 0);
  }

  function sortSeedsByPriority(list, order) {
    const arr = Array.isArray(list) ? list.slice() : [];
    arr.sort(function (a, b) {
      return compareSeedPriority(a, b, order);
    });
    return arr;
  }

  function filterSingleLandSeeds(list) {
    return (Array.isArray(list) ? list : []).filter(function (item) {
      return item && !item.isMultiLandPlant;
    });
  }

  function findSeedInList(list, target) {
    const targetId = toPositiveNumber(target);
    const targetText = normalizeMatchText(target);
    const arr = Array.isArray(list) ? list : [];

    for (let i = 0; i < arr.length; i++) {
      const item = arr[i];
      if (!item) continue;
      if (targetId != null) {
        if (toPositiveNumber(item.seedId) === targetId) return item;
        if (toPositiveNumber(item.itemId) === targetId) return item;
        if (toPositiveNumber(item.goodsId) === targetId) return item;
      }
      if (targetText && normalizeMatchText(item.name) === targetText) {
        return item;
      }
    }

    return null;
  }

  function normalizeAutoPlantMode(mode) {
    const raw = String(mode || 'none').trim();
    if (!raw) return 'none';
    if (raw === 'backpack_first') return 'highest';
    if (raw === 'buy_highest') return 'highest';
    if (raw === 'buy_lowest') return 'lowest';
    if (raw === 'specific') return 'selected';
    return raw;
  }

  function normalizeAutoPlantSource(mode, source) {
    const rawMode = String(mode || '').trim();
    const rawSource = String(source || '').trim();
    if (rawSource === 'backpack' || rawSource === 'shop' || rawSource === 'auto') {
      return rawSource;
    }
    if (rawMode === 'backpack_first') return 'backpack';
    if (rawMode === 'buy_highest' || rawMode === 'buy_lowest') return 'shop';
    return 'auto';
  }

  async function getSeedCatalog(opts) {
    opts = opts || {};
    const availableOnly = opts.availableOnly !== false;
    const includeBackpack = opts.includeBackpack !== false;
    const includeShop = opts.includeShop !== false;
    const catalog = {
      fetchedAt: new Date().toISOString(),
      availableOnly: !!availableOnly,
      backpack: [],
      shop: [],
      errors: {}
    };

    if (includeBackpack) {
      try {
        catalog.backpack = filterSingleLandSeeds(getSeedList({
          silent: true,
          availableOnly: availableOnly,
          sortMode: opts.sortMode || 3
        }));
      } catch (error) {
        catalog.errors.backpack = error && error.message ? error.message : String(error);
      }
    }

    if (includeShop) {
      try {
        catalog.shop = filterSingleLandSeeds(await getShopSeedList({
          silent: true,
          ensureData: opts.ensureShopData !== false,
          shopId: opts.shopId || 2,
          sortByLevel: true
        }));
      } catch (error) {
        catalog.errors.shop = error && error.message ? error.message : String(error);
      }
    }

    catalog.all = []
      .concat((catalog.backpack || []).map(function (item) { return { ...item, source: 'backpack' }; }))
      .concat((catalog.shop || []).map(function (item) { return { ...item, source: 'shop' }; }));
    catalog.counts = {
      backpack: catalog.backpack.length,
      shop: catalog.shop.length,
      all: catalog.all.length
    };

    return opts.silent ? catalog : out(catalog);
  }

  function normalizeLandIds(landIds) {
    const list = Array.isArray(landIds) ? landIds : [landIds];
    const seen = new Set();
    const outArr = [];

    for (let i = 0; i < list.length; i++) {
      const landId = toPositiveNumber(list[i]);
      if (landId == null || seen.has(landId)) continue;
      seen.add(landId);
      outArr.push(landId);
    }

    return outArr;
  }

  function getGridInfoByLandId(landId) {
    const targetLandId = toPositiveNumber(landId);
    if (targetLandId == null) return null;

    const status = getFarmStatus({ includeGrids: true, includeLandIds: false, silent: true });
    const grids = Array.isArray(status && status.grids) ? status.grids : [];

    for (let i = 0; i < grids.length; i++) {
      const grid = grids[i];
      if (toPositiveNumber(grid && grid.landId) === targetLandId) return grid;
    }

    return null;
  }

  async function waitForLandPlantResult(landId, opts) {
    opts = opts || {};
    const timeoutMs = opts.timeoutMs == null ? 2500 : Math.max(0, Number(opts.timeoutMs) || 0);
    const pollMs = opts.pollMs == null ? 150 : Math.max(30, Number(opts.pollMs) || 30);
    const startedAt = Date.now();
    let last = null;

    while (true) {
      last = getGridInfoByLandId(landId);
      if (last && last.stageKind && last.stageKind !== 'empty') {
        return {
          ok: true,
          reason: 'planted',
          landId: toPositiveNumber(landId),
          elapsedMs: Date.now() - startedAt,
          after: last
        };
      }

      if (Date.now() - startedAt >= timeoutMs) {
        return {
          ok: false,
          reason: 'plant_timeout',
          landId: toPositiveNumber(landId),
          elapsedMs: Date.now() - startedAt,
          after: last
        };
      }

      await wait(pollMs);
    }
  }

  function dispatchSingleLandPlant(seed, landId) {
    const message = getOopsMessage();
    const payload = {
      land_id: landId,
      seed_id: seed.id
    };
    message.dispatchEvent('REQUEST_CREATE_NEW_PLANT', payload);
    return payload;
  }

  function dispatchMultiLandPlant(seed, landIds) {
    const message = getOopsMessage();
    const normalized = normalizeLandIds(landIds);
    const payload = {
      seed_id: seed.id,
      land_id: normalized[0],
      mutiPlantData: normalized
    };
    message.dispatchEvent('REQUEST_CREATE_NEW_MULTI_LAND_PLANT', payload);
    return payload;
  }

  async function plantSingleLand(seedIdOrItemId, landId, opts) {
    opts = opts || {};
    const targetLandId = toPositiveNumber(landId);
    if (targetLandId == null) throw new Error('landId required');

    const seed = getSeedModel(seedIdOrItemId, {
      sortMode: opts.sortMode || 3,
      includeZeroCount: !!opts.includeZeroCount
    });
    if (!seed) {
      return {
        ok: false,
        reason: 'seed_not_found',
        requestedSeed: seedIdOrItemId,
        landId: targetLandId
      };
    }

    const seedInfo = summarizeSeedModel(seed);
    const before = getGridInfoByLandId(targetLandId);
    if (!before) {
      return {
        ok: false,
        reason: 'land_not_found',
        landId: targetLandId,
        seed: seedInfo
      };
    }

    if (before.stageKind !== 'empty') {
      return {
        ok: false,
        reason: 'land_not_empty',
        landId: targetLandId,
        seed: seedInfo,
        before
      };
    }

    if (seedInfo.count <= 0 && !opts.includeZeroCount) {
      return {
        ok: false,
        reason: 'seed_count_empty',
        landId: targetLandId,
        seed: seedInfo,
        before
      };
    }

    if (seedInfo.isMultiLandPlant) {
      return {
        ok: false,
        reason: 'multi_land_seed_requires_multi_land_request',
        landId: targetLandId,
        seed: seedInfo,
        before
      };
    }

    const request = dispatchSingleLandPlant(seed, targetLandId);
    if (opts.waitForResult === false) {
      return {
        ok: true,
        action: 'plant_single',
        landId: targetLandId,
        seed: seedInfo,
        before,
        request,
        dispatched: true
      };
    }

    const verify = await waitForLandPlantResult(targetLandId, opts);
    return {
      ok: verify.ok,
      action: 'plant_single',
      landId: targetLandId,
      seed: seedInfo,
      before,
      after: verify.after,
      request,
      verify
    };
  }

  /**
   * 在指定空地上种植种子
   * 普通种子按单块地顺序种植；多地块作物才走 REQUEST_CREATE_NEW_MULTI_LAND_PLANT
   * landIds: 要种植的地块 id 数组
   */
  async function plantSeedsOnLands(seedIdOrItemId, landIds, opts) {
    opts = opts || {};
    const normalizedLandIds = normalizeLandIds(landIds);
    if (normalizedLandIds.length === 0) throw new Error('landIds required');

    const seed = getSeedModel(seedIdOrItemId, {
      sortMode: opts.sortMode || 3,
      includeZeroCount: !!opts.includeZeroCount
    });
    if (!seed) {
      return {
        ok: false,
        reason: 'seed_not_found',
        requestedSeed: seedIdOrItemId,
        landIds: normalizedLandIds
      };
    }

    const seedInfo = summarizeSeedModel(seed);
    if (seedInfo.count <= 0 && !opts.includeZeroCount) {
      return {
        ok: false,
        reason: 'seed_count_empty',
        seed: seedInfo,
        landIds: normalizedLandIds
      };
    }

    if (seedInfo.isMultiLandPlant) {
      const targetLandIds = normalizedLandIds.slice(0, seedInfo.plantSize);
      const before = targetLandIds.map(getGridInfoByLandId);
      if (targetLandIds.length < seedInfo.plantSize) {
        return {
          ok: false,
          reason: 'multi_land_ids_insufficient',
          seed: seedInfo,
          landIds: normalizedLandIds,
          requiredCount: seedInfo.plantSize
        };
      }
      if (before.some(function (grid) { return !grid || grid.stageKind !== 'empty'; })) {
        return {
          ok: false,
          reason: 'multi_land_target_not_empty',
          seed: seedInfo,
          landIds: targetLandIds,
          before
        };
      }

      const request = dispatchMultiLandPlant(seed, targetLandIds);
      if (opts.waitForResult === false) {
        return {
          ok: true,
          action: 'plant_multi_land',
          seed: seedInfo,
          landIds: targetLandIds,
          before,
          request,
          dispatched: true
        };
      }

      const verify = await waitForLandPlantResult(targetLandIds[0], opts);
      return {
        ok: verify.ok,
        action: 'plant_multi_land',
        seed: seedInfo,
        landIds: targetLandIds,
        before,
        after: targetLandIds.map(getGridInfoByLandId),
        request,
        verify
      };
    }

    const requestedLandIds = normalizedLandIds.slice();
    const maxAttempts = opts.ignoreSeedCountLimit
      ? requestedLandIds.length
      : Math.min(requestedLandIds.length, Math.max(0, seedInfo.count || 0));
    const attemptedLandIds = requestedLandIds.slice(0, maxAttempts);
    const skippedLandIds = requestedLandIds.slice(attemptedLandIds.length);
    const intervalMs = opts.intervalMs == null ? 300 : Math.max(0, Number(opts.intervalMs) || 0);
    const results = [];

    if (attemptedLandIds.length === 0) {
      return {
        ok: false,
        action: 'plant_single_batch',
        reason: 'seed_count_empty',
        seed: seedInfo,
        requestedLandIds,
        attemptedLandIds,
        skippedLandIds
      };
    }

    for (let i = 0; i < attemptedLandIds.length; i++) {
      const result = await plantSingleLand(seedInfo.seedId, attemptedLandIds[i], {
        ...opts,
        includeZeroCount: true
      });
      results.push(result);

      if (!result.ok && opts.stopOnError) break;
      if (i < attemptedLandIds.length - 1 && intervalMs > 0) {
        await wait(intervalMs);
      }
    }

    const plantedCount = results.filter(function (item) {
      return !!(item && item.ok);
    }).length;

    return {
      ok: plantedCount > 0,
      action: 'plant_single_batch',
      seed: seedInfo,
      requestedLandIds,
      attemptedLandIds,
      skippedLandIds,
      plantedCount,
      failedCount: results.length - plantedCount,
      results
    };
  }

  /**
   * 自动种植 — 综合接口
   * opts.mode: 'backpack_first' | 'buy_highest' | 'buy_lowest' | 'none'
   * opts.emptyLandIds: 空地ID数组（不传则自动检测）
   */
  async function autoPlant(opts) {
    opts = opts || {};
    const requestedMode = opts.mode || 'none';
    const mode = normalizeAutoPlantMode(requestedMode);
    const source = normalizeAutoPlantSource(requestedMode, opts.source);
    if (mode === 'none') return { ok: true, mode: mode, source: source, action: 'skip' };

    // 获取空地
    let emptyLandIds = opts.emptyLandIds;
    if (!Array.isArray(emptyLandIds) || emptyLandIds.length === 0) {
      const status = getFarmStatus({ includeGrids: true, includeLandIds: false, silent: true });
      if (!status || status.farmType !== 'own') {
        return { ok: false, mode: mode, reason: 'not_own_farm' };
      }
      emptyLandIds = [];
      const grids = Array.isArray(status.grids) ? status.grids : [];
      for (let i = 0; i < grids.length; i++) {
        const g = grids[i];
        if (g && g.stageKind === 'empty' && g.interactable !== false && g.landId != null) {
          emptyLandIds.push(g.landId);
        }
      }
    }
    if (emptyLandIds.length === 0) {
      return { ok: true, mode: mode, action: 'no_empty_lands', emptyCount: 0 };
    }

    let seedId = null;
    let seedName = null;
    let seedSource = null;
    let selectedSeed = null;
    const requestedSelected = opts.selectedSeedId != null
      ? opts.selectedSeedId
      : opts.selectedItemId != null
        ? opts.selectedItemId
        : opts.seedId != null
          ? opts.seedId
          : opts.itemId != null
            ? opts.itemId
            : opts.seedName;

    if (mode === 'selected' || source === 'backpack' || source === 'auto') {
      const backpackSeeds = filterSingleLandSeeds(getSeedList({
        silent: true,
        availableOnly: true,
        sortMode: 3
      }));

      if (mode === 'selected' && requestedSelected != null) {
        selectedSeed = findSeedInList(backpackSeeds, requestedSelected);
        if (selectedSeed) {
          seedId = selectedSeed.seedId;
          seedName = selectedSeed.name;
          seedSource = 'backpack';
        } else if (source === 'backpack') {
          return {
            ok: false,
            mode: mode,
            source: source,
            reason: 'selected_seed_not_found_in_backpack',
            requestedSeed: requestedSelected
          };
        }
      } else if (source === 'backpack' || source === 'auto') {
        const sorted = sortSeedsByPriority(backpackSeeds, mode === 'lowest' ? 'asc' : 'desc');
        if (sorted.length > 0) {
          seedId = sorted[0].seedId;
          seedName = sorted[0].name || 'unknown';
          seedSource = 'backpack';
        }
      }

      if (seedSource === 'backpack' && !seedId && backpackSeeds.length > 0) {
        return {
          ok: false,
          mode: mode,
          source: source,
          reason: 'seed_resolution_failed_in_backpack'
        };
      }
    }

    if (!seedId && (mode === 'selected' || source === 'shop' || source === 'auto')) {
      let shopSeeds;
      try {
        shopSeeds = filterSingleLandSeeds(await getShopSeedList({
          silent: true,
          ensureData: true,
          shopId: 2,
          sortByLevel: true
        }));
      } catch (e) {
        return {
          ok: false,
          mode: mode,
          source: source,
          reason: 'shop_data_error',
          error: e && e.message ? e.message : String(e)
        };
      }

      let target = null;
      if (mode === 'selected' && requestedSelected != null) {
        target = findSeedInList(shopSeeds, requestedSelected);
        if (!target && source === 'shop') {
          return {
            ok: false,
            mode: mode,
            source: source,
            reason: 'selected_seed_not_found_in_shop',
            requestedSeed: requestedSelected
          };
        }
      } else {
        const sorted = sortSeedsByPriority(shopSeeds, mode === 'lowest' ? 'asc' : 'desc');
        target = sorted.length > 0 ? sorted[0] : null;
      }

      if (target) {
        const buyCount = emptyLandIds.length;
        const buyResult = await buyShopGoods(target.goodsId, buyCount, target.price);
        if (!buyResult.ok) {
          return {
            ok: false,
            mode: mode,
            source: source,
            reason: 'buy_failed',
            buyResult: buyResult,
            targetSeed: target
          };
        }
        seedId = target.itemId;
        seedName = target.name;
        seedSource = 'shop';
      } else if (source === 'shop') {
        return {
          ok: false,
          mode: mode,
          source: source,
          reason: 'no_seeds_in_shop'
        };
      }
      const buyWaitMs = opts.buyWaitMs == null ? 200 : Math.max(0, Number(opts.buyWaitMs) || 0);
      if (buyWaitMs > 0) {
        await wait(buyWaitMs);
      }
    }

    if (!seedId && source === 'backpack') {
      return { ok: false, mode: mode, source: source, reason: 'no_seeds_in_backpack' };
    }
    if (!seedId && source === 'shop') {
      return { ok: false, mode: mode, source: source, reason: 'no_seeds_in_shop' };
    }
    if (!seedId && source === 'auto') {
      if (mode === 'selected') {
        return {
          ok: false,
          mode: mode,
          source: source,
          reason: 'selected_seed_not_found',
          requestedSeed: requestedSelected
        };
      }
      return {
        ok: false,
        mode: mode,
        source: source,
        reason: 'no_seed_available'
      };
    }

    if (!seedId) {
      return { ok: false, mode: mode, source: source, reason: 'no_seed_resolved' };
    }

    const plantResult = await plantSeedsOnLands(seedId, emptyLandIds, {
      waitForResult: opts.waitForResult !== false,
      timeoutMs: opts.timeoutMs,
      pollMs: opts.pollMs,
      intervalMs: opts.intervalMs,
      stopOnError: !!opts.stopOnError
    });
    return {
      ok: !!(plantResult && plantResult.ok),
      mode: mode,
      source: source,
      action: plantResult && plantResult.action ? plantResult.action : 'planted',
      seedId: seedId,
      seedName: seedName,
      seedSource: seedSource,
      emptyCount: emptyLandIds.length,
      plantResult: plantResult
    };
  }

  function openLandInteraction(pathOrNode) {
    const gridComp = getGridComponent(pathOrNode);

    if (typeof gridComp.handleValidLandClick === 'function') {
      return gridComp.handleValidLandClick();
    }
    if (typeof gridComp.triggerLandClick === 'function') {
      return gridComp.triggerLandClick();
    }
    if (typeof gridComp.onLandClick === 'function') {
      return gridComp.onLandClick();
    }
    if (typeof gridComp.dispatchLandClickEvent === 'function') {
      return gridComp.dispatchLandClickEvent();
    }

    throw new Error('No usable land interaction method on grid controller');
  }

  async function openLandAndDiffButtons(pathOrNode, opts) {
    opts = opts || {};
    const waitAfter = opts.waitAfter == null ? 300 : Number(opts.waitAfter);
    const before = allButtons({ activeOnly: true });
    const beforeMap = new Map(before.map(item => [item.path, JSON.stringify(item)]));
    const ret = openLandInteraction(pathOrNode);
    await wait(waitAfter);
    const after = allButtons({ activeOnly: true });

    const added = after.filter(item => !beforeMap.has(item.path));
    const changed = after.filter(item => beforeMap.has(item.path) && beforeMap.get(item.path) !== JSON.stringify(item));

    return out({
      action: 'openLandAndDiffButtons',
      path: typeof pathOrNode === 'string' ? pathOrNode : fullPath(pathOrNode),
      ret,
      added,
      changed,
      afterCount: after.length
    });
  }

  function normalizeKeywords(keyword) {
    if (keyword == null) return [];
    if (Array.isArray(keyword)) return keyword.map(x => String(x).toLowerCase()).filter(Boolean);
    return String(keyword)
      .split(/[,\s]+/)
      .map(x => x.trim().toLowerCase())
      .filter(Boolean);
  }

  function matchesKeywords(texts, keywords) {
    if (!keywords || keywords.length === 0) return true;
    const joined = (Array.isArray(texts) ? texts : [texts])
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    for (let i = 0; i < keywords.length; i++) {
      if (joined.indexOf(keywords[i]) >= 0) return true;
    }
    return false;
  }

  function rectArea(rect) {
    return rect ? Math.max(0, Number(rect.width) || 0) * Math.max(0, Number(rect.height) || 0) : 0;
  }

  function pointInRect(point, rect) {
    if (!point || !rect) return false;
    return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
  }

  function buildOverlayCloseButtons(node, closeKeywords, camera) {
    return walk(node)
      .filter(child => !!(child && child.activeInHierarchy && child.getComponent))
      .map(child => {
        const btn = child.getComponent(cc.Button);
        if (!btn || !btn.interactable || !btn.enabledInHierarchy) return null;
        const texts = getNodeTextList(child, { maxDepth: 2 });
        const handlers = getHandlers(btn).map(item => item.text);
        const info = describeNode(child, { camera });
        const haystack = [info.path, info.relativePath, info.name].concat(info.components || [], texts, handlers);
        if (!matchesKeywords(haystack, closeKeywords)) return null;
        const rect = getNodeScreenRect(child, { camera });
        return {
          path: info.path,
          relativePath: info.relativePath,
          name: info.name,
          texts,
          handlers,
          rect
        };
      })
      .filter(Boolean)
      .sort((a, b) => rectArea(a.rect) - rectArea(b.rect))
      .slice(0, 6);
  }

  function buildOverlayBlankTapPoint(node, overlayRect, viewport, camera) {
    if (!overlayRect || !viewport || !viewport.width || !viewport.height) return null;

    const overlayArea = rectArea(overlayRect);
    const descendants = walk(node)
      .slice(1)
      .filter(child => !!(child && child.activeInHierarchy))
      .map(child => ({
        node: child,
        rect: getNodeScreenRect(child, { camera })
      }))
      .filter(item => item.rect)
      .filter(item => rectArea(item.rect) >= overlayArea * 0.08)
      .filter(item => rectArea(item.rect) <= overlayArea * 0.92)
      .sort((a, b) => rectArea(b.rect) - rectArea(a.rect));

    const blockingRects = descendants.slice(0, 8).map(item => item.rect);
    const panelRect = blockingRects.length > 0 ? blockingRects[0] : null;
    const margin = 24;
    const points = [];

    function pushPoint(x, y, reason) {
      const point = {
        x: roundNum(x),
        y: roundNum(y),
        reason
      };
      if (!pointInRect(point, overlayRect)) return;
      for (let i = 0; i < blockingRects.length; i++) {
        if (pointInRect(point, blockingRects[i])) return;
      }
      points.push(point);
    }

    if (panelRect) {
      pushPoint(overlayRect.centerX, Math.max(overlayRect.top + margin, roundNum((overlayRect.top + panelRect.top) / 2)), 'above_panel');
      pushPoint(overlayRect.centerX, Math.min(overlayRect.bottom - margin, roundNum((panelRect.bottom + overlayRect.bottom) / 2)), 'below_panel');
      pushPoint(Math.max(overlayRect.left + margin, roundNum((overlayRect.left + panelRect.left) / 2)), overlayRect.centerY, 'left_of_panel');
      pushPoint(Math.min(overlayRect.right - margin, roundNum((panelRect.right + overlayRect.right) / 2)), overlayRect.centerY, 'right_of_panel');
    }

    pushPoint(overlayRect.left + margin, overlayRect.top + margin, 'top_left');
    pushPoint(overlayRect.right - margin, overlayRect.top + margin, 'top_right');
    pushPoint(overlayRect.left + margin, overlayRect.bottom - margin, 'bottom_left');
    pushPoint(overlayRect.right - margin, overlayRect.bottom - margin, 'bottom_right');

    return points.length > 0 ? points[0] : null;
  }

  function detectActiveOverlays(opts) {
    opts = opts || {};
    const root = scene();
    const camera = getCamera();
    const viewport = getViewportInfo();
    const viewportArea = Math.max(1, viewport.width * viewport.height);
    const overlayKeywords = normalizeKeywords(opts.keywords || opts.keyword || [
      'mask', 'overlay', 'popup', 'dialog', 'modal', 'reward', 'award', 'prize', 'gift', 'panel',
      '获得', '奖励', '道具', '礼包', '弹窗', '蒙层', '遮罩'
    ]);
    const excludeKeywords = normalizeKeywords(opts.excludeKeywords || [
      'farm_scene', 'farm_scene_v3', 'gridorigin', 'plantorigin', 'main_ui_v2', 'layerui',
      'mainmenucomp', 'mainuicomp', 'oneclickoperationtools', 'node_warehouse', 'menu', 'foot', 'root'
    ]);
    const closeKeywords = normalizeKeywords(opts.closeKeywords || [
      'close', 'btn_close', 'cancel', 'ok', 'confirm', 'sure', 'back', 'x',
      '关闭', '取消', '确定', '知道了', '收下'
    ]);
    const minAreaRatio = opts.minAreaRatio == null ? 0.12 : Math.max(0, Number(opts.minAreaRatio) || 0);
    const minScore = opts.minScore == null ? 4 : Number(opts.minScore) || 0;
    const limit = opts.limit == null ? 8 : Math.max(1, Number(opts.limit) || 1);

    const rawCandidates = walk(root)
      .filter(node => !!(node && node.activeInHierarchy && node !== root && node.getComponent))
      .map(node => {
        const info = describeNode(node, { baseNode: root, camera });
        const rect = getNodeScreenRect(node, { camera });
        if (!rect || rect.width <= 0 || rect.height <= 0) return null;

        const areaRatio = rectArea(rect) / viewportArea;
        if (areaRatio < minAreaRatio) return null;

        const texts = getNodeTextList(node, { maxDepth: 2 });
        const haystack = [info.path, info.relativePath, info.name].concat(info.components || [], texts);
        let score = 0;
        const reasons = [];

        if (areaRatio >= 0.7) {
          score += 4;
          reasons.push('fullscreen');
        } else if (areaRatio >= 0.4) {
          score += 3;
          reasons.push('large_area');
        } else {
          score += 1;
          reasons.push('area');
        }

        if (matchesKeywords(haystack, overlayKeywords)) {
          score += 3;
          reasons.push('keyword');
        }

        if (matchesKeywords(info.components || [], ['blockinputevents'])) {
          score += 4;
          reasons.push('block_input');
        }

        if (matchesKeywords(info.components || [], ['button'])) {
          score += 1;
          reasons.push('button_component');
        }

        if (info.depth >= 5) {
          score += 1;
          reasons.push('deep_ui');
        }

        if (matchesKeywords([info.name].concat(info.components || []), excludeKeywords)) {
          score -= 4;
          reasons.push('common_ui_penalty');
        }

        if (info.depth <= 2) {
          score -= 2;
          reasons.push('shallow_penalty');
        }

        if (info.childCount > 80) {
          score -= 2;
          reasons.push('too_many_children_penalty');
        }

        if (score < minScore) return null;

        return {
          node,
          info,
          rect,
          texts,
          areaRatio: roundNum(areaRatio),
          score,
          reasons
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (b.areaRatio !== a.areaRatio) return b.areaRatio - a.areaRatio;
        return b.info.depth - a.info.depth;
      })
      .slice(0, limit);

    const list = rawCandidates.map(item => {
      const closeButtons = buildOverlayCloseButtons(item.node, closeKeywords, camera);
      const blankTapPoint = buildOverlayBlankTapPoint(item.node, item.rect, viewport, camera);
      return {
        path: item.info.path,
        relativePath: item.info.relativePath,
        name: item.info.name,
        depth: item.info.depth,
        childCount: item.info.childCount,
        components: item.info.components,
        texts: item.texts,
        rect: item.rect,
        areaRatio: item.areaRatio,
        score: item.score,
        reasons: item.reasons,
        closeButtons,
        closeButtonCount: closeButtons.length,
        blankTapPoint
      };
    });

    const payload = {
      viewport,
      count: list.length,
      list
    };
    return opts.silent ? payload : out(payload);
  }

  async function dismissActiveOverlay(opts) {
    opts = opts || {};
    const hold = opts.hold == null ? 32 : Number(opts.hold);
    const waitAfter = opts.waitAfter == null ? 300 : Number(opts.waitAfter);
    const detected = detectActiveOverlays({
      ...opts,
      silent: true,
      limit: opts.limit == null ? 1 : opts.limit
    });
    const target = detected && Array.isArray(detected.list) && detected.list.length > 0 ? detected.list[0] : null;
    if (!target) {
      const miss = { ok: false, reason: 'overlay_not_found', detected };
      return opts.silent ? miss : out(miss);
    }

    let action = null;
    if (target.closeButtons && target.closeButtons.length > 0) {
      action = {
        type: 'close_button',
        button: target.closeButtons[0],
        result: smartClick(target.closeButtons[0].path)
      };
    } else if (target.blankTapPoint) {
      action = {
        type: 'blank_tap',
        point: target.blankTapPoint,
        result: tap(target.blankTapPoint.x, target.blankTapPoint.y, hold)
      };
    } else {
      const miss = { ok: false, reason: 'dismiss_target_not_found', target };
      return opts.silent ? miss : out(miss);
    }

    if (waitAfter > 0) {
      await wait(waitAfter);
    }

    const after = detectActiveOverlays({
      ...opts,
      silent: true,
      limit: opts.limit == null ? 3 : opts.limit
    });

    const payload = {
      ok: true,
      target,
      action,
      after
    };
    return opts.silent ? payload : out(payload);
  }

  function farmNodes(opts) {
    opts = opts || {};
    const root = findFarmRoot(opts.root || opts.path);
    if (!root) throw new Error('Farm root not found');

    const activeOnly = opts.activeOnly !== false;
    const leafOnly = !!opts.leafOnly;
    const minWidth = opts.minWidth == null ? null : Number(opts.minWidth);
    const minHeight = opts.minHeight == null ? null : Number(opts.minHeight);
    const keywords = normalizeKeywords(opts.keyword || opts.keywords);
    const camera = getCamera();

    return walk(root)
      .filter(node => !activeOnly || node.activeInHierarchy)
      .filter(node => !leafOnly || !node.children || node.children.length === 0)
      .map(node => describeNode(node, { baseNode: root, camera }))
      .filter(info => {
        if (minWidth != null && (!info.size || info.size.width < minWidth)) return false;
        if (minHeight != null && (!info.size || info.size.height < minHeight)) return false;
        if (!matchesKeywords([info.path, info.relativePath, info.name].concat(info.components || []), keywords)) return false;
        return true;
      });
  }

  function dumpFarmNodes(keyword, opts) {
    if (keyword && typeof keyword === 'object') {
      opts = keyword;
      keyword = opts.keyword || opts.keywords;
    }
    opts = opts || {};
    if (keyword != null) opts.keyword = keyword;
    return out(farmNodes(opts));
  }

  function guessFarmCandidates(opts) {
    opts = opts || {};
    const nameKeywords = normalizeKeywords(
      opts.keywords || opts.keyword || [
        'land', 'plant', 'crop', 'fruit', 'soil', 'farm', 'plot',
        'harvest', 'mature', 'ripe', 'collect', 'pick'
      ]
    );
    const componentKeywords = normalizeKeywords(
      opts.componentKeywords || ['plant', 'land', 'farm', 'crop', 'fruit']
    );

    return farmNodes({
      ...opts,
      keyword: null,
      activeOnly: opts.activeOnly !== false,
      leafOnly: !!opts.leafOnly
    }).filter(info => {
      if (opts.excludeButtons !== false && info.button) return false;
      if (opts.requireSize !== false && (!info.size || !info.size.width || !info.size.height)) return false;
      if (opts.maxChildCount != null && info.childCount > opts.maxChildCount) return false;

      const hitName = matchesKeywords([info.path, info.relativePath, info.name], nameKeywords);
      const hitComp = matchesKeywords(info.components || [], componentKeywords);
      return hitName || hitComp;
    });
  }

  function dumpFarmCandidates(keyword, opts) {
    if (keyword && typeof keyword === 'object') {
      opts = keyword;
      keyword = opts.keyword || opts.keywords;
    }
    opts = opts || {};
    if (keyword != null) opts.keyword = keyword;
    return out(guessFarmCandidates(opts));
  }

  function isPlainObject(value) {
    if (!value || typeof value !== 'object') return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  }

  function summarizeSpecialObject(value) {
    if (!value || typeof value !== 'object') return null;
    if (value instanceof cc.Node) {
      return { __type: 'Node', path: fullPath(value) };
    }
    if (value instanceof cc.Component) {
      return {
        __type: value.constructor ? value.constructor.name : 'Component',
        node: value.node ? fullPath(value.node) : null
      };
    }

    const ctorName = value.constructor && value.constructor.name;
    if (!ctorName) return null;

    const scalarKeys = ['x', 'y', 'z', 'w', 'width', 'height', 'r', 'g', 'b', 'a'];
    let hit = false;
    const picked = { __type: ctorName };
    for (let i = 0; i < scalarKeys.length; i++) {
      const key = scalarKeys[i];
      if (typeof value[key] === 'number' && isFinite(value[key])) {
        picked[key] = roundNum(value[key]);
        hit = true;
      }
    }
    return hit ? picked : null;
  }

  function serializeValue(value, depth, seen) {
    if (value == null) return value;
    const t = typeof value;
    if (t === 'string' || t === 'boolean') return value;
    if (t === 'number') return isFinite(value) ? roundNum(value) : String(value);
    if (t === 'bigint') return String(value);
    if (t === 'function' || t === 'symbol') return undefined;

    const special = summarizeSpecialObject(value);
    if (special) return special;

    if (depth <= 0) {
      const ctorName = value && value.constructor && value.constructor.name;
      return ctorName ? { __type: ctorName } : undefined;
    }

    if (seen.has(value)) return { __type: 'Circular' };
    seen.add(value);

    if (Array.isArray(value)) {
      const arr = [];
      for (let i = 0; i < value.length && i < 10; i++) {
        const item = serializeValue(value[i], depth - 1, seen);
        if (item !== undefined) arr.push(item);
      }
      return arr;
    }

    if (!isPlainObject(value)) {
      const ctorName = value && value.constructor && value.constructor.name;
      return ctorName ? { __type: ctorName } : undefined;
    }

    const keys = Object.keys(value).sort().slice(0, 20);
    const outObj = {};
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const item = serializeValue(value[key], depth - 1, seen);
      if (item !== undefined) outObj[key] = item;
    }
    return Object.keys(outObj).length > 0 ? outObj : undefined;
  }

  function snapshotNode(pathOrNode, opts) {
    opts = opts || {};
    const node = toNode(pathOrNode);
    if (!node) throw new Error('Node not found: ' + pathOrNode);

    const componentDepth = opts.componentDepth == null ? 1 : Number(opts.componentDepth);
    const skipKeys = opts.skipKeys || ['_eventProcessor', '_uiProps', '__eventTargets', 'hideFlags'];
    const info = describeNode(node);
    const snapshot = {
      capturedAt: Date.now(),
      path: fullPath(node),
      summary: info,
      nodeState: {
        active: !!node.active,
        activeInHierarchy: !!node.activeInHierarchy,
        layer: node.layer == null ? null : node.layer,
        childCount: info.childCount
      },
      components: []
    };

    const components = node.components || [];
    for (let i = 0; i < components.length; i++) {
      const comp = components[i];
      const entry = {
        index: i,
        name: comp && comp.constructor ? comp.constructor.name : String(comp),
        enabled: comp && comp.enabled != null ? !!comp.enabled : null,
        props: {}
      };

      const keys = Object.keys(comp || {}).sort();
      for (let k = 0; k < keys.length; k++) {
        const key = keys[k];
        if (skipKeys.indexOf(key) >= 0) continue;
        let value;
        try {
          value = comp[key];
        } catch (_) {
          continue;
        }
        const serialized = serializeValue(value, componentDepth, new WeakSet());
        if (serialized !== undefined) entry.props[key] = serialized;
      }

      snapshot.components.push(entry);
    }

    snapshot.flat = flattenSnapshot(snapshot);
    return out(snapshot);
  }

  function flattenValue(prefix, value, outMap) {
    if (value == null || typeof value !== 'object') {
      outMap[prefix] = value;
      return;
    }

    if (Array.isArray(value)) {
      if (value.length === 0) {
        outMap[prefix] = [];
        return;
      }
      for (let i = 0; i < value.length; i++) {
        flattenValue(prefix + '[' + i + ']', value[i], outMap);
      }
      return;
    }

    const keys = Object.keys(value);
    if (keys.length === 0) {
      outMap[prefix] = {};
      return;
    }

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      flattenValue(prefix ? prefix + '.' + key : key, value[key], outMap);
    }
  }

  function flattenSnapshot(snapshot) {
    const outMap = {};
    flattenValue('', {
      path: snapshot.path,
      summary: snapshot.summary,
      nodeState: snapshot.nodeState,
      components: snapshot.components
    }, outMap);
    return outMap;
  }

  function diffSnapshots(before, after, opts) {
    opts = opts || {};
    const ignoreKeys = normalizeKeywords(opts.ignoreKeys || ['capturedat']);
    const beforeFlat = before && before.flat ? before.flat : flattenSnapshot(before || {});
    const afterFlat = after && after.flat ? after.flat : flattenSnapshot(after || {});
    const keys = Array.from(new Set(Object.keys(beforeFlat).concat(Object.keys(afterFlat)))).sort();
    const changes = [];

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (matchesKeywords(key, ignoreKeys)) continue;
      const a = beforeFlat[key];
      const b = afterFlat[key];
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        changes.push({ key, before: a, after: b });
      }
    }

    return out(changes);
  }

  async function tapAndSnapshot(pathOrNode, opts) {
    opts = opts || {};
    const hold = opts.hold == null ? 32 : Number(opts.hold);
    const waitAfterTap = opts.waitAfterTap == null ? 250 : Number(opts.waitAfterTap);
    const before = snapshotNode(pathOrNode, opts.snapshotOptions);
    tapNode(pathOrNode, hold);
    await wait(waitAfterTap);
    const after = snapshotNode(pathOrNode, opts.snapshotOptions);
    return out({
      path: before.path,
      before,
      after,
      changes: diffSnapshots(before, after, opts.diffOptions)
    });
  }

  async function batchTap(pathsOrNodes, opts) {
    opts = opts || {};
    const hold = opts.hold == null ? 32 : Number(opts.hold);
    const interval = opts.interval == null ? 180 : Number(opts.interval);
    const dryRun = !!opts.dryRun;
    const stopOnError = !!opts.stopOnError;
    const limit = opts.limit == null ? Infinity : Number(opts.limit);
    const seen = new Set();
    const rawList = Array.isArray(pathsOrNodes) ? pathsOrNodes : [pathsOrNodes];
    const list = rawList
      .map(item => {
        if (!item) return null;
        if (typeof item === 'string') return item;
        if (item.path) return item.path;
        return fullPath(item);
      })
      .filter(Boolean);
    const results = [];

    for (let i = 0; i < list.length && results.length < limit; i++) {
      const path = list[i];
      if (seen.has(path)) continue;
      seen.add(path);

      try {
        const node = findNode(path);
        if (!node) throw new Error('Node not found');

        const point = nodeToClient(node);
        if (!dryRun) tapNode(node, hold);
        results.push({
          index: results.length,
          path,
          x: point.x,
          y: point.y,
          action: dryRun ? 'skip-tap(dry-run)' : 'tap'
        });
      } catch (e) {
        results.push({
          index: results.length,
          path,
          error: e && e.message ? e.message : String(e)
        });
        if (stopOnError) break;
      }

      if (i < list.length - 1 && interval > 0) {
        await wait(interval);
      }
    }

    return out({
      action: 'batchTap',
      dryRun,
      hold,
      interval,
      count: results.length,
      results
    });
  }

  async function tapFarmCandidates(keyword, opts) {
    if (keyword && typeof keyword === 'object') {
      opts = keyword;
      keyword = opts.keyword || opts.keywords;
    }
    opts = opts || {};
    if (keyword != null) opts.keyword = keyword;

    const candidates = guessFarmCandidates(opts);
    const sliced = opts.limit == null ? candidates : candidates.slice(0, Number(opts.limit));

    return out({
      candidates: sliced,
      batch: await batchTap(sliced.map(x => x.path), opts)
    });
  }

  G.gameCtl = {
    cc,
    wait,
    scene,
    walk,
    fullPath,
    relativePath,
    relativePathFrom,
    findNode,
    toNode,
    nodeInfo,
    allButtons,
    dumpButtons,
    buttonInfo,
    triggerButton,
    tap,
    getViewportInfo,
    nodeToClient,
    getNodeScreenRect,
    tapNode,
    smartClick,
    findFarmRoot,
    findGridOrigin,
    findPlantOrigin,
    findMainUIComp,
    findMainMenuComp,
    getFarmOwnership,
    getFriendList,
    getSelfGid,
    enterFarmByGid,
    enterOwnFarm,
    enterFriendFarm,
    getFarmEntity,
    getFarmModel,
    getFarmWorkSummary,
    getFarmStatus,
    farmNodes,
    dumpFarmNodes,
    guessFarmCandidates,
    dumpFarmCandidates,
    getGridComponent,
    getPlantComponent,
    getGridCoords,
    getPlantNodeByGrid,
    getGridNodeByPlant,
    parseGrowPhases,
    getPlantRuntime,
    getPlantStageSummary,
    getGridState,
    PlantStage,
    summarizeAllGrids,
    findHarvestableGrids,
    findMatureGrids,
    findActionableGrids,
    findWaterableGrids,
    findEraseGrassGrids,
    findKillBugGrids,
    findDeadGrids,
    inspectOneClickToolNodes,
    findOneClickManager,
    getOneClickManagerState,
    triggerOneClickOperation,
    triggerOneClickHarvest,
    getSeedList,
    getShopSeedList,
    getSeedCatalog,
    plantSingleLand,
    plantSeedsOnLands,
    autoPlant,
    openLandInteraction,
    openLandAndDiffButtons,
    detectActiveOverlays,
    dismissActiveOverlay,
    snapshotNode,
    diffSnapshots,
    tapAndSnapshot,
    batchTap,
    tapFarmCandidates
  };

  out({
    ready: true,
    scene: scene() ? scene().name : null,
    farmRoot: (findFarmRoot() && fullPath(findFarmRoot())) || null,
    api: [
      'gameCtl.dumpButtons(keyword, opts)',
      'gameCtl.smartClick(path, index)',
      'gameCtl.detectActiveOverlays(opts)',
      'gameCtl.dismissActiveOverlay(opts)',
      'gameCtl.dumpFarmNodes(keyword, opts)',
      'gameCtl.dumpFarmCandidates(keyword, opts)',
      'gameCtl.getFarmOwnership()',
      'gameCtl.getFriendList(opts)',
      'gameCtl.enterOwnFarm(opts)',
      'gameCtl.enterFriendFarm(target, opts)',
      'gameCtl.getFarmWorkSummary()',
      'gameCtl.getFarmStatus()',
      'gameCtl.getGridState(path)',
      'gameCtl.summarizeAllGrids({ includePaths: true })',
      'gameCtl.findHarvestableGrids(opts)',
      'gameCtl.findMatureGrids(opts)',
      'gameCtl.findWaterableGrids(opts)',
      'gameCtl.findEraseGrassGrids(opts)',
      'gameCtl.findKillBugGrids(opts)',
      'gameCtl.findDeadGrids(opts)',
      'gameCtl.inspectOneClickToolNodes()',
      'gameCtl.getOneClickManagerState()',
      'gameCtl.triggerOneClickHarvest()',
      'gameCtl.getSeedList({ availableOnly: true })',
      'gameCtl.getShopSeedList({ ensureData: true })',
      'gameCtl.getSeedCatalog({ availableOnly: true })',
      'gameCtl.plantSingleLand(seedId, landId, opts)',
      'gameCtl.plantSeedsOnLands(seedId, landIds, opts)',
      'gameCtl.openLandInteraction(path)',
      'gameCtl.openLandAndDiffButtons(path, opts)',
      'gameCtl.snapshotNode(path, opts)',
      'gameCtl.tapAndSnapshot(path, opts)',
      'gameCtl.batchTap(paths, opts)',
      'gameCtl.tapFarmCandidates(keyword, opts)'
    ]
  });
})();
