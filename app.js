// State
let canvas = null;
let ctx = null;
// Layers: each layer = { id, img (Image), naturalWidth, naturalHeight, x, y, width, height, activeEffects: [{id,name}], layerEffectsValues: {} }
let layers = [];
let layerCounter = 0;
let selectedLayerId = null;
let effectCounter = 0; // unique instance id counter (for effect instances across layers)
let effectValues = {}; // store effect instance values keyed by instance id
let debounceTimer = null;
let animationFrameId = null;
// Render scheduling flag to coalesce frequent redraws
let _pendingRender = false;

function scheduleApplyLayersToCanvas() {
    if (_pendingRender) return;
    _pendingRender = true;
    requestAnimationFrame(() => {
        _pendingRender = false;
        applyLayersToCanvas();
    });
}

function findLayerByEffectInstance(instanceId) {
    for (const l of layers) {
        if ((l.activeEffects || []).some(e => e.id === instanceId)) return l;
    }
    return null;
}

function markLayerDirty(layer) {
    if (!layer) return;
    layer._dirty = true;
}

// Create or return a cached processed canvas for a layer (applies effects when needed)
function getProcessedLayerCanvas(layer) {
    // If layer has a cached canvas at the same size and isn't dirty, reuse it.
    if (layer._processedCanvas && layer._processedW === layer.naturalWidth && layer._processedH === layer.naturalHeight && !layer._dirty) {
        return layer._processedCanvas;
    }

    const off = document.createElement('canvas');
    off.width = Math.max(1, Math.round(layer.naturalWidth));
    off.height = Math.max(1, Math.round(layer.naturalHeight));
    const offCtx = off.getContext('2d');
    offCtx.imageSmoothingEnabled = false;
    offCtx.clearRect(0, 0, off.width, off.height);

    // Draw the source image scaled to the layer's natural size
    try {
        offCtx.drawImage(layer.img, 0, 0, layer.img.width, layer.img.height, 0, 0, off.width, off.height);
    } catch (e) {
        try { offCtx.drawImage(layer.img, 0, 0); } catch (er) {}
    }

    // Only process pixels if the layer has effects
    if (layer.activeEffects && layer.activeEffects.length > 0) {
        try {
            const imd = offCtx.getImageData(0, 0, off.width, off.height);
            applyEffectsToImageData(imd, layer.activeEffects);
            offCtx.putImageData(imd, 0, 0);
        } catch (e) {
            // If getImageData fails (CORS etc.), just continue with unprocessed pixels
            console.debug('applyEffectsToImageData failed for layer', layer.id, e);
        }
    }

    // Cache
    layer._processedCanvas = off;
    layer._processedW = off.width;
    layer._processedH = off.height;
    layer._dirty = false;
    return off;
}

// Effect definitions
const effectDefinitions = {
    brightness: { name: 'Brightness', min: -100, max: 100, default: 0, step: 1 },
    contrast: { name: 'Contrast', min: -100, max: 100, default: 0, step: 1 },
    saturation: { name: 'Saturation', min: -100, max: 100, default: 0, step: 1 },
    vignette: { name: 'Vignette', min: 0, max: 100, default: 0, step: 1 },
    grain: { name: 'Camera Grain', min: 0, max: 100, default: 0, step: 1 },
    resolution: { name: 'Resolution', min: 10, max: 100, default: 100, step: 5 },
    invert: { name: 'Invert', min: 0, max: 100, default: 0, step: 1 },
    duotone: {
        name: 'Duotone',
        type: 'custom',
        defaults: {
            colorA: '#0b3d91', // shadow color
            colorB: '#ffd166', // highlight color
            mix: 100,
            mode: 'replace'
        }
    },
    sharpen: { name: 'Sharpen', min: 0, max: 200, default: 0, step: 1 },
    sepia: { name: 'Sepia', min: 0, max: 100, default: 0, step: 1 },
    tint: {
        name: 'Color Tint',
        type: 'custom',
        defaults: {
            color: '#ff0000',
            mix: 30
        }
    }
};

// Helper: parse hex color to [r,g,b]
function parseHexColor(hex) {
    const h = (hex || '#000000').replace('#', '');
    const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
    const bigint = parseInt(full, 16) || 0;
    return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255];
}

// Helper: simple convolution for Sharpen
function applyConvolution(imageData, kernel) {
    const src = imageData.data;
    const w = imageData.width;
    const h = imageData.height;
    const output = new Uint8ClampedArray(src.length);
    const kSize = Math.sqrt(kernel.length) | 0;
    const half = Math.floor(kSize / 2);
    const kernelSum = kernel.reduce((s, v) => s + v, 0) || 1;

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let r = 0, g = 0, b = 0;
            for (let ky = 0; ky < kSize; ky++) {
                for (let kx = 0; kx < kSize; kx++) {
                    const px = Math.min(w - 1, Math.max(0, x + kx - half));
                    const py = Math.min(h - 1, Math.max(0, y + ky - half));
                    const srcIdx = (py * w + px) * 4;
                    const kval = kernel[ky * kSize + kx];
                    r += src[srcIdx] * kval;
                    g += src[srcIdx + 1] * kval;
                    b += src[srcIdx + 2] * kval;
                }
            }
            const dstIdx = (y * w + x) * 4;
            output[dstIdx]     = Math.max(0, Math.min(255, r / kernelSum));
            output[dstIdx + 1] = Math.max(0, Math.min(255, g / kernelSum));
            output[dstIdx + 2] = Math.max(0, Math.min(255, b / kernelSum));
            output[dstIdx + 3] = src[dstIdx + 3];
        }
    }
    src.set(output);
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    canvas = document.getElementById('imageCanvas');
    ctx = canvas.getContext('2d');

    // Layers UI bindings
    const layerUpload = document.getElementById('layerUpload');
    const addLayerBtn = document.getElementById('addLayerBtn');
    const layersList = document.getElementById('layersList');

    if (addLayerBtn && layerUpload) {
        addLayerBtn.addEventListener('click', (e) => {
            // Prevent adding layers while crop/resize mode active
            if (document.body.classList.contains('crop-active') || document.body.classList.contains('resize-active')) return;
            layerUpload.click();
        });
        layerUpload.addEventListener('change', handleLayerUpload);
    }

    // Use event delegation for layer selection to avoid attaching many handlers
    // on each render which caused performance regressions. Clicking a row
    // selects the layer; buttons inside the row should stopPropagation when needed.
    if (layersList) {
        layersList.addEventListener('click', (ev) => {
            // Don't allow layer selection while crop/resize is active
            if (document.body.classList.contains('crop-active') || document.body.classList.contains('resize-active')) return;
            const li = ev.target.closest && ev.target.closest('li');
            if (!li) return;
            const lid = li.dataset.layerId;
            if (!lid) return;
            // If the click originated from a control that called stopPropagation()
            // then this won't run. Otherwise select.
            selectLayer(lid);
        });
    }

    // Effects and other controls
    document.getElementById('downloadBtn').addEventListener('click', downloadImage);
    document.getElementById('resetBtn').addEventListener('click', resetAll);
    document.getElementById('addEffectBtn').addEventListener('click', toggleDropdown);

    // Header "Resize Layer" button (will act on currently selected non-base layer)
    const resizeBtn = document.getElementById('resizeLayerBtn');
    if (resizeBtn) {
        resizeBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            if (!selectedLayerId) return;
            const base = layers[0];
            // Don't allow resize if selected is base (button should be hidden in that case)
            if (base && selectedLayerId === base.id) return;
            // Start interactive resize mode instead of prompt-driven resize
            startResizeMode(selectedLayerId);
        });
    }

    // Dropdown items: add effect to currently selected layer
    document.querySelectorAll('.dropdown-item').forEach(item => {
        item.addEventListener('click', (e) => {
            // prevent adding effects while cropping/resizing
            if (document.body.classList.contains('crop-active') || document.body.classList.contains('resize-active')) return;
            if (item.classList.contains('disabled')) return;
            if (!selectedLayerId) {
                try { alert('Select a layer first.'); } catch (e) {}
                return;
            }
            addEffectToLayer(item.dataset.effect, selectedLayerId);
        });
    });

    // Close dropdown when clicking outside effects panel
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.effects-panel')) {
            document.getElementById('dropdownMenu').classList.remove('show');
        }
    });

    // Init crop overlay
    initCropOverlay();

    // Canvas layer dragging
    setupCanvasLayerDragging();
    // selection overlay for resizing
    initLayerSelectionOverlay();
});

// Handle image upload
// Handle adding a new layer from a file input
function handleLayerUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
            addLayer(img);
            // clear file input value so same file can be re-added if needed
            try { e.target.value = ''; } catch (er) {}
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
}

// Add a new layer object and update UI
function addLayer(img) {
    layerCounter += 1;
    const id = `layer${layerCounter}`;
    const naturalWidth = img.width;
    const naturalHeight = img.height;
    // Default placement: centered on base area (or canvas if first)
    const layer = {
        id,
        img,
        naturalWidth,
        naturalHeight,
        x: 0,
        y: 0,
        width: naturalWidth,
        height: naturalHeight,
        activeEffects: [],
        justAdded: true,
    };

    layers.push(layer);
    // mark cache state
    layer._processedCanvas = null;
    layer._dirty = true;
    // Ensure largest image stays as base: move largest to index 0
    // choose newly added layer
    selectedLayerId = id;
    renderLayersList();
    updatePlaceholderVisibility();
    scheduleApplyLayersToCanvas();
    updateSelectionOverlay();
}

function updatePlaceholderVisibility() {
    const placeholder = document.getElementById('placeholder');
    if (!placeholder) return;
    if (layers.length === 0) {
        placeholder.style.display = '';
        canvas.classList.remove('active');
        // hide crop button when no layers
        try { document.getElementById('applyCropBtn').style.display = 'none'; } catch (e) {}
    } else {
        placeholder.style.display = 'none';
        canvas.classList.add('active');
        // show crop button when layers exist
        try { document.getElementById('applyCropBtn').style.display = ''; } catch (e) {}
    }
}

// Toggle dropdown menu
function toggleDropdown(e) {
    e.stopPropagation();
    // prevent opening while crop/resize overlays active
    if (document.body.classList.contains('crop-active') || document.body.classList.contains('resize-active')) return;
    const dropdown = document.getElementById('dropdownMenu');
    dropdown.classList.toggle('show');
    updateDropdownItems();
}

// Update dropdown to disable already added effects
function updateDropdownItems() {
    // Disable resolution if any layer already has a resolution effect (only one allowed globally)
    const hasResolution = layers.some(layer => layer.activeEffects.some(e => e.name === 'resolution'));
    document.querySelectorAll('.dropdown-item').forEach(item => {
        if (item.dataset.effect === 'resolution') {
            if (hasResolution) item.classList.add('disabled'); else item.classList.remove('disabled');
        } else {
            item.classList.remove('disabled');
        }
    });
}

// Add effect instance to the panel (allows duplicates)
// Add an effect instance to a specific layer
function addEffectToLayer(effectName, layerId) {
    document.getElementById('dropdownMenu').classList.remove('show');
    const layer = layers.find(l => l.id === layerId);
    if (!layer) return;

    // Prevent adding a second resolution globally
    if (effectName === 'resolution') {
        const exists = layers.some(l => l.activeEffects.some(e => e.name === 'resolution'));
        if (exists) { try { alert('Resolution can only be applied once.'); } catch (e) {} ; return; }
    }

    effectCounter += 1;
    const instanceId = `eff${effectCounter}`;
    layer.activeEffects.push({ id: instanceId, name: effectName });

    const def = effectDefinitions[effectName];
    if (def && def.type === 'custom' && def.defaults) effectValues[instanceId] = { ...def.defaults };
    else if (def) effectValues[instanceId] = def.default;
    else effectValues[instanceId] = 0;

    const control = createEffectControl(effectName, instanceId, layerId);
    const addButton = document.getElementById('addEffectBtn');
    addButton.parentNode.insertBefore(control, addButton);

    // only show controls for selected layer
    renderEffectsForSelectedLayer();
    // mark the layer dirty and schedule re-render
    markLayerDirty(layer);
    scheduleApplyLayersToCanvas();
}

// Create effect control element
// Create effect control element for a specific instance
function createEffectControl(effectName, instanceId, layerId = null) {
    const def = effectDefinitions[effectName];
    const div = document.createElement('div');
    div.className = 'effect-control';
    if (layerId) div.dataset.layerId = layerId;
    div.dataset.effect = effectName;
    div.dataset.instanceId = instanceId;
    
    // (Halftone removed) handle other effect control types below
        
        // Tint custom control (single color + mix)
            if (effectName === 'tint') {
                div.innerHTML = `
                <button class="remove-effect-btn" onclick="removeEffect('${instanceId}')">×</button>
                <label>
                    <span class="effect-name">${def.name}</span>
                </label>
                <div class="halftone-controls">
                    <div class="halftone-control-group">
                        <label for="${instanceId}-Color">Tint Color</label>
                        <input type="color" id="${instanceId}-Color" value="${effectValues[instanceId] && effectValues[instanceId].color ? effectValues[instanceId].color : def.defaults.color}">
                    </div>
                    <div class="halftone-control-group">
                        <label for="${instanceId}-Mix">Mix</label>
                        <input type="range" id="${instanceId}-Mix" min="0" max="100" value="${effectValues[instanceId] && typeof effectValues[instanceId].mix !== 'undefined' ? effectValues[instanceId].mix : def.defaults.mix}" step="1">
                        <span class="effect-value" id="${instanceId}MixValue">${effectValues[instanceId] && typeof effectValues[instanceId].mix !== 'undefined' ? effectValues[instanceId].mix : def.defaults.mix}</span>
                    </div>
                </div>
                `;

                const colorInput = div.querySelector(`#${instanceId}-Color`);
                const mix = div.querySelector(`#${instanceId}-Mix`);
                const mixVal = div.querySelector(`#${instanceId}MixValue`);

                colorInput.addEventListener('input', (e) => {
                    effectValues[instanceId].color = e.target.value;
                    scheduleApplyEffects(120);
                });
                mix.addEventListener('input', (e) => {
                    const v = parseInt(e.target.value, 10);
                    effectValues[instanceId].mix = v;
                    if (mixVal) mixVal.textContent = v;
                    scheduleApplyEffects(60);
                });

                return div;
            }

        // Duotone custom control (colors + mix)
            if (effectName === 'duotone') {
            div.innerHTML = `
            <button class="remove-effect-btn" onclick="removeEffect('${instanceId}')">×</button>
            <label>
                <span class="effect-name">${def.name}</span>
            </label>
            <div class="halftone-controls">
                <div class="halftone-control-group">
                    <label for="${instanceId}-ColorA">Shadow Color</label>
                    <input type="color" id="${instanceId}-ColorA" value="${effectValues[instanceId] && effectValues[instanceId].colorA ? effectValues[instanceId].colorA : def.defaults.colorA}">
                </div>
                <div class="halftone-control-group">
                    <label for="${instanceId}-ColorB">Highlight Color</label>
                    <input type="color" id="${instanceId}-ColorB" value="${effectValues[instanceId] && effectValues[instanceId].colorB ? effectValues[instanceId].colorB : def.defaults.colorB}">
                </div>
                <div class="halftone-control-group">
                    <label for="${instanceId}-Mix">Mix</label>
                    <input type="range" id="${instanceId}-Mix" min="0" max="100" value="${effectValues[instanceId] && typeof effectValues[instanceId].mix !== 'undefined' ? effectValues[instanceId].mix : def.defaults.mix}" step="1">
                    <span class="effect-value" id="${instanceId}MixValue">${effectValues[instanceId] && typeof effectValues[instanceId].mix !== 'undefined' ? effectValues[instanceId].mix : def.defaults.mix}</span>
                </div>
                <div class="halftone-control-group">
                    <label for="${instanceId}-Mode">Mode</label>
                    <select id="${instanceId}-Mode" class="halftone-select">
                        <option value="replace" ${effectValues[instanceId] && effectValues[instanceId].mode === 'replace' ? 'selected' : ''}>Replace</option>
                        <option value="overlay" ${effectValues[instanceId] && effectValues[instanceId].mode === 'overlay' ? 'selected' : ''}>Overlay</option>
                    </select>
                </div>
            </div>
            `;

            // Wire up duotone controls
            const cA = div.querySelector(`#${instanceId}-ColorA`);
            const cB = div.querySelector(`#${instanceId}-ColorB`);
            const mix = div.querySelector(`#${instanceId}-Mix`);
            const mixVal = div.querySelector(`#${instanceId}MixValue`);
            const modeSel = div.querySelector(`#${instanceId}-Mode`);

            cA.addEventListener('input', (e) => {
                effectValues[instanceId].colorA = e.target.value;
                scheduleApplyEffects(120);
            });
            cB.addEventListener('input', (e) => {
                effectValues[instanceId].colorB = e.target.value;
                scheduleApplyEffects(120);
            });
            mix.addEventListener('input', (e) => {
                const v = parseInt(e.target.value, 10);
                effectValues[instanceId].mix = v;
                if (mixVal) mixVal.textContent = v;
                scheduleApplyEffects(60);
            });
            modeSel.addEventListener('change', (e) => {
                effectValues[instanceId].mode = e.target.value;
                scheduleApplyEffects(60);
            });

            return div;
        }

        // Standard slider control
        const valueDisplayId = `${instanceId}Value`;
        const sliderId = `${instanceId}`;

        div.innerHTML = `
            <button class="remove-effect-btn" onclick="removeEffect('${instanceId}')">×</button>
            <label for="${sliderId}">
                <span class="effect-name">${def.name}</span>
                <span class="effect-value" id="${valueDisplayId}">${def.default}</span>
            </label>
            <input type="range" id="${sliderId}" min="${def.min}" max="${def.max}" value="${def.default}" step="${def.step}">
        `;
        
        // Add event listener to the slider
        const slider = div.querySelector('input[type="range"]');
        slider.addEventListener('input', (e) => updateEffect(instanceId, e.target.value));
    
    return div;
}

// Remove effect instance from the panel
function removeEffect(instanceId) {
    // remove from whichever layer contains it, capturing the affected layer
    let affectedLayer = null;
    for (const layer of layers) {
        if (!layer.activeEffects) continue;
        const idx = layer.activeEffects.findIndex(e => e.id === instanceId);
        if (idx !== -1) {
            affectedLayer = layer;
            layer.activeEffects.splice(idx, 1);
            break;
        }
    }

    // remove stored effect values
    if (effectValues && effectValues.hasOwnProperty(instanceId)) delete effectValues[instanceId];

    // remove the UI control if present
    const effectControl = document.querySelector(`.effect-control[data-instance-id="${instanceId}"]`);
    if (effectControl) effectControl.remove();

    // refresh UI and dropdown state
    renderEffectsForSelectedLayer();
    updateDropdownItems();

    // mark the affected layer dirty (so cached processed canvas is recomputed)
    if (affectedLayer) markLayerDirty(affectedLayer);

    // finally schedule a coalesced re-render
    scheduleApplyLayersToCanvas();
}

// Update effect instance value
function updateEffect(instanceId, value) {
    const parsed = parseFloat(value);
    effectValues[instanceId] = parsed;
    // mark the owning layer dirty so the processed cache is refreshed
    const _layerForEffect = findLayerByEffectInstance(instanceId);
    if (_layerForEffect) markLayerDirty(_layerForEffect);
    const valueEl = document.getElementById(instanceId + 'Value');
    if (valueEl) valueEl.textContent = value;
    if (debounceTimer) clearTimeout(debounceTimer);
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    debounceTimer = setTimeout(() => {
        // schedule a coalesced render
        scheduleApplyLayersToCanvas();
    }, 16);
}

// Schedule applying effects with debounce (used by controls that update frequently, like color pickers)
function scheduleApplyEffects(delay = 120) {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    // mark all layers dirty (effects may apply to any layer); coarse but safe
    layers.forEach(l => markLayerDirty(l));
    debounceTimer = setTimeout(() => {
        scheduleApplyLayersToCanvas();
    }, delay);
}

// Reset all effects
function resetAll() {
    // remove all layers and effects
    layers = [];
    effectValues = {};
    layerCounter = 0;
    effectCounter = 0;
    selectedLayerId = null;
    document.querySelectorAll('.effect-control').forEach(c => c.remove());
    renderLayersList();
    updatePlaceholderVisibility();
    applyLayersToCanvas();
}

// Apply all effects in the order they were added
// Apply all layers and their effects to the main canvas
function applyLayersToCanvas() {
    if (layers.length === 0) {
        // clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
    }

    // Determine base layer (largest natural area). ensure it's first
    ensureLargestAtBack();
    const base = layers[0];
    if (!base) return;

    // Set canvas size to base size
    canvas.width = base.naturalWidth;
    canvas.height = base.naturalHeight;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw each layer in order (base first) using cached processed canvases when possible
    for (let li = 0; li < layers.length; li++) {
        const layer = layers[li];

        // Default position for new layers: center on base
        if (typeof layer.x !== 'number' || typeof layer.y !== 'number' || (layer.justAdded)) {
            layer.x = Math.round((canvas.width - layer.naturalWidth) / 2);
            layer.y = Math.round((canvas.height - layer.naturalHeight) / 2);
            delete layer.justAdded;
        }

        // Ensure processed canvas exists (applies effects when needed)
        const processed = getProcessedLayerCanvas(layer);
        try {
            ctx.drawImage(processed, layer.x, layer.y, layer.naturalWidth, layer.naturalHeight);
        } catch (e) {
            // Fallback: try drawing the raw image directly
            try { ctx.drawImage(layer.img, layer.x, layer.y, layer.naturalWidth, layer.naturalHeight); } catch (er) {}
        }
    }

    // update crop overlay and other UI if needed
    updateCropOverlay();
}

// Apply a list of effect instances to an ImageData object (mutates it)
function applyEffectsToImageData(imageData, effectsList) {
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    const centerX = width / 2;
    const centerY = height / 2;
    const maxDistance = Math.sqrt(centerX * centerX + centerY * centerY);

    // Apply effects sequentially
    for (const inst of effectsList) {
        const name = inst.name;
        const value = effectValues[inst.id];

        if (name === 'sharpen') {
            const amount = (typeof value === 'number') ? value : 0;
            if (amount > 0) {
                const strength = Math.min(1, Math.max(0, amount / 100));
                const base = [ -1, -1, -1, -1, 9, -1, -1, -1, -1 ];
                const identity = [0,0,0,0,1,0,0,0,0];
                const kernel = base.map((v, i) => identity[i] * (1 - strength) + v * strength);
                applyConvolution(imageData, kernel);
            }
            continue;
        }

        if (name === 'resolution') {
            // skip per-layer resolution for now (global pixelate unsupported in per-layer simple pipeline)
            continue;
        }

        

        // Pixel loop for common effects
        for (let i = 0; i < data.length; i += 4) {
            let r = data[i];
            let g = data[i+1];
            let b = data[i+2];

            switch (name) {
                case 'brightness':
                    const brightnessFactor = (typeof value === 'number' ? value : 0) * 2.55;
                    r += brightnessFactor; g += brightnessFactor; b += brightnessFactor;
                    break;
                case 'contrast':
                    const v = (typeof value === 'number') ? value : 0;
                    const contrastFactor = (259 * (v + 255)) / (255 * (259 - v));
                    r = contrastFactor * (r - 128) + 128;
                    g = contrastFactor * (g - 128) + 128;
                    b = contrastFactor * (b - 128) + 128;
                    break;
                case 'saturation':
                    const sf = 1 + (((typeof value === 'number') ? value : 0) / 100);
                    const gray = 0.2989 * r + 0.5870 * g + 0.1140 * b;
                    r = gray + sf * (r - gray);
                    g = gray + sf * (g - gray);
                    b = gray + sf * (b - gray);
                    break;
                case 'sepia':
                    if (typeof value === 'number' && value > 0) {
                        const t = Math.max(0, Math.min(1, value / 100));
                        const sr = (r * 0.393) + (g * 0.769) + (b * 0.189);
                        const sg = (r * 0.349) + (g * 0.686) + (b * 0.168);
                        const sb = (r * 0.272) + (g * 0.534) + (b * 0.131);
                        r = r * (1 - t) + sr * t;
                        g = g * (1 - t) + sg * t;
                        b = b * (1 - t) + sb * t;
                    }
                    break;
                case 'tint':
                    if (value && typeof value === 'object') {
                        const mix = (typeof value.mix === 'number') ? (value.mix / 100) : 0;
                        if (mix > 0) {
                            const tc = parseHexColor(value.color || '#000000');
                            const tr = tc[0], tg = tc[1], tb = tc[2];
                            const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
                            r = r * (1 - mix) + (tr * lum) * mix;
                            g = g * (1 - mix) + (tg * lum) * mix;
                            b = b * (1 - mix) + (tb * lum) * mix;
                        }
                    }
                    break;
                case 'duotone':
                    if (value && typeof value === 'object') {
                        const lum2 = Math.max(0, Math.min(1, (0.299 * r + 0.587 * g + 0.114 * b) / 255));
                        const ca = parseHexColor(value.colorA);
                        const cb = parseHexColor(value.colorB);
                        const dr = ca[0] + (cb[0] - ca[0]) * lum2;
                        const dg = ca[1] + (cb[1] - ca[1]) * lum2;
                        const db = ca[2] + (cb[2] - ca[2]) * lum2;
                        const mix2 = (typeof value.mix === 'number') ? (value.mix / 100) : 1;
                        r = r * (1 - mix2) + dr * mix2;
                        g = g * (1 - mix2) + dg * mix2;
                        b = b * (1 - mix2) + db * mix2;
                    }
                    break;
                case 'vignette':
                    if (value > 0) {
                        const pixelIndex = i / 4;
                        const x = pixelIndex % width;
                        const y = Math.floor(pixelIndex / width);
                        const dx = x - centerX; const dy = y - centerY;
                        const distance = Math.sqrt(dx*dx + dy*dy);
                        const vignetteStrength = value / 100;
                        const vignetteFactor = 1 - (distance / maxDistance) * vignetteStrength;
                        r *= vignetteFactor; g *= vignetteFactor; b *= vignetteFactor;
                    }
                    break;
                case 'grain':
                    if (value > 0) {
                        const grainStrength = value * 2.55;
                        const noise = (Math.random() - 0.5) * grainStrength;
                        r += noise; g += noise; b += noise;
                    }
                    break;
                case 'invert':
                    if (value > 0) {
                        const invertStrength = value / 100;
                        r = r + (255 - 2 * r) * invertStrength;
                        g = g + (255 - 2 * g) * invertStrength;
                        b = b + (255 - 2 * b) * invertStrength;
                    }
                    break;
            }

            data[i] = Math.max(0, Math.min(255, r));
            data[i+1] = Math.max(0, Math.min(255, g));
            data[i+2] = Math.max(0, Math.min(255, b));
        }
    }
}

// UI: render layers list
function renderLayersList() {
    const list = document.getElementById('layersList');
    if (!list) return;
    // clear
    list.innerHTML = '';

    layers.forEach((layer, idx) => {
        const li = document.createElement('li');
        // Prevent dragging/reordering of the base (index 0). Only non-base layers are draggable.
        li.draggable = (idx !== 0);
        li.dataset.layerId = layer.id;
        const name = document.createElement('div');
        name.className = 'layer-name';
        name.textContent = `Layer ${idx + 1}`;
    if (idx === 0) { name.textContent += ' (Base)'; li.classList.add('base-layer'); }

        // highlight selected layer
        if (selectedLayerId === layer.id) {
            li.classList.add('selected');
        }

        const actions = document.createElement('div');
        actions.className = 'layer-actions';

        // Remove button: stop propagation so clicking remove doesn't also select the layer
    const removeBtn = document.createElement('button');
    removeBtn.className = 'layer-remove-btn reset-btn';
    removeBtn.textContent = 'Remove';
    // stopPropagation so clicking remove doesn't also select the layer
    removeBtn.addEventListener('click', (e) => { 
        e.stopPropagation();
        // Prevent removing during crop/resize
        if (document.body.classList.contains('crop-active') || document.body.classList.contains('resize-active')) return;
        removeLayer(layer.id); 
    });

        // We intentionally DO NOT create per-layer Select or Resize buttons here.
        // Selection is handled by clicking the layer row (li). The header-level
        // Resize controls are used for resizing non-base layers.

        actions.appendChild(removeBtn);

    li.appendChild(name);
    li.appendChild(actions);

        // Drag handlers for reordering
        {
            // Drag start only matters for draggable (non-base) items
            li.addEventListener('dragstart', (ev) => {
                if (!li.draggable) return;
                // Prevent dragging while crop/resize active
                if (document.body.classList.contains('crop-active') || document.body.classList.contains('resize-active')) {
                    ev.preventDefault();
                    return;
                }
                li.classList.add('dragging');
                ev.dataTransfer.setData('text/plain', layer.id);
            });
            li.addEventListener('dragend', () => li.classList.remove('dragging'));
            li.addEventListener('dragover', (ev) => { ev.preventDefault(); });
            li.addEventListener('drop', (ev) => {
                ev.preventDefault();
                const draggedId = ev.dataTransfer.getData('text/plain');
                if (!draggedId) return;
                const fromIndex = layers.findIndex(l => l.id === draggedId);
                const toIndex = layers.findIndex(l => l.id === layer.id);
                // Prevent moving the base (index 0) or dropping items onto the base position.
                if (fromIndex === 0 || toIndex === 0) return;
                if (fromIndex > -1 && toIndex > -1 && fromIndex !== toIndex) {
                    const [moved] = layers.splice(fromIndex, 1);
                    layers.splice(toIndex, 0, moved);
                    renderLayersList();
                    applyLayersToCanvas();
                }
            });
        }

        list.appendChild(li);
    });

    // ensure selected layer is valid (keep insertion order: layer1 is back, later layers are front)
    if (!layers.find(l => l.id === selectedLayerId)) selectedLayerId = layers.length ? layers[layers.length - 1].id : null;
    renderEffectsForSelectedLayer();
    updateSelectionOverlay();

    // Show/hide the header "Resize Layer" button based on whether the selected layer is the base
    try {
        const resizeBtn = document.getElementById('resizeLayerBtn');
        if (resizeBtn) {
            if (!selectedLayerId || layers.length === 0) {
                resizeBtn.style.display = 'none';
            } else {
                const base = layers[0];
                // If selected is base, hide button; otherwise show it
                resizeBtn.style.display = (base && selectedLayerId === base.id) ? 'none' : 'inline-block';
            }
        }
    } catch (e) {
        // safe-ignore
    }
}

function selectLayer(layerId) {
    selectedLayerId = layerId;
    renderLayersList();
    updateSelectionOverlay();
}

function removeLayer(layerId) {
    const idx = layers.findIndex(l => l.id === layerId);
    if (idx === -1) return;
    layers.splice(idx, 1);
    // after removal ensure largest back
    ensureLargestAtBack();
    if (selectedLayerId === layerId) selectedLayerId = layers.length ? layers[0].id : null;
    renderLayersList();
    updatePlaceholderVisibility();
    applyLayersToCanvas();
}

// Note: base selection is now determined by layer order in the layers list (index 0 is base).
// Layers can be reordered by dragging in the Layers panel; moving a layer to index 0 makes it the base.

// Resize a layer (prompts for width/height). Resamples image data for the layer.
function resizeLayer(layerId) {
    const layer = layers.find(l => l.id === layerId);
    if (!layer) return;
    const idx = layers.findIndex(l => l.id === layerId);
    // Prevent resizing the base layer via the prompt-based flow
    if (idx === 0) {
        try { alert('The base layer cannot be resized. Use the interactive handles to resize other layers.'); } catch (e) {}
        return;
    }
    const currentW = layer.naturalWidth;
    const currentH = layer.naturalHeight;
    // prompt for new size (pre-fill current dimensions)
    const wStr = prompt('New width in pixels (leave blank to keep aspect ratio):', String(currentW));
    if (wStr === null) return; // cancelled
    const hStr = prompt('New height in pixels (leave blank to keep aspect ratio):', String(currentH));
    if (hStr === null) return;
    let newW = parseInt(wStr, 10);
    let newH = parseInt(hStr, 10);
    if (isNaN(newW) && isNaN(newH)) return;
    if (isNaN(newW)) {
        // compute from aspect
        newW = Math.round(currentW * (newH / currentH));
    }
    if (isNaN(newH)) {
        newH = Math.round(currentH * (newW / currentW));
    }
    newW = Math.max(1, newW);
    newH = Math.max(1, newH);

    // Resample layer image to new dimensions
    const off = document.createElement('canvas');
    off.width = newW;
    off.height = newH;
    const offCtx = off.getContext('2d');
    offCtx.imageSmoothingEnabled = true;
    offCtx.clearRect(0, 0, newW, newH);
    try {
        offCtx.drawImage(layer.img, 0, 0, newW, newH);
    } catch (e) {
        console.error('resize draw failed', e);
        return;
    }
    const dataUrl = off.toDataURL();
    const newImg = new Image();
    newImg.onload = () => {
        layer.img = newImg;
        layer.naturalWidth = newW;
        layer.naturalHeight = newH;

        // If base resized, adjust canvas size and clamp other layers
        if (idx === 0) {
            // update canvas via applyLayersToCanvas (which uses base size)
            // clamp other layers positions to allow negative offsets correctly
            for (let i = 1; i < layers.length; i++) {
                const lw = layers[i].naturalWidth;
                const lh = layers[i].naturalHeight;
                const minX = Math.min(0, newW - lw);
                const maxX = Math.max(0, newW - lw);
                const minY = Math.min(0, newH - lh);
                const maxY = Math.max(0, newH - lh);
                layers[i].x = Math.min(Math.max(minX, layers[i].x), maxX);
                layers[i].y = Math.min(Math.max(minY, layers[i].y), maxY);
            }
        } else {
            // For non-base, ensure x/y are clamped to base bounds
            const base = layers[0];
            if (base) {
                const minX = Math.min(0, base.naturalWidth - layer.naturalWidth);
                const maxX = Math.max(0, base.naturalWidth - layer.naturalWidth);
                const minY = Math.min(0, base.naturalHeight - layer.naturalHeight);
                const maxY = Math.max(0, base.naturalHeight - layer.naturalHeight);
                layer.x = Math.min(Math.max(minX, layer.x), maxX);
                layer.y = Math.min(Math.max(minY, layer.y), maxY);
            }
        }

        applyLayersToCanvas();
        updateSelectionOverlay();
    };
    newImg.src = dataUrl;
}

function ensureLargestAtBack() {
    // No-op: keep insertion order so layer1 (first added) stays at back and later layers are in front.
    return;
}

function renderEffectsForSelectedLayer() {
    // show/hide effect control panels based on data-layer-id
    document.querySelectorAll('.effect-control').forEach(el => {
        const lid = el.dataset.layerId || null;
        if (lid === selectedLayerId) el.style.display = '';
        else el.style.display = 'none';
    });
    // update layers list UI selection text
    const list = document.getElementById('layersList');
    if (list) {
        // selection UI is handled in renderLayersList() which adds the `selected` class
        // to the currently selected row. No per-row select button text to update anymore.
    }
}

// Canvas pointer dragging for layers (move non-base layers within base bounds)
function setupCanvasLayerDragging() {
    let dragging = null;
    let startX = 0, startY = 0, origX = 0, origY = 0;

    canvas.addEventListener('pointerdown', (e) => {
        if (layers.length === 0) return;
        const rect = canvas.getBoundingClientRect();
        const px = Math.round((e.clientX - rect.left) * (canvas.width / rect.width));
        const py = Math.round((e.clientY - rect.top) * (canvas.height / rect.height));

        // If the selected layer has handles and pointer is on a handle, begin resize
        if (selectionElements && selectionElements.handles) {
            for (const h of Object.keys(selectionElements.handles)) {
                const el = selectionElements.handles[h];
                const r = el.getBoundingClientRect();
                if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
                    // start resizing
                    selectionState.resizing = true;
                    selectionState.resizingHandle = h;
                    selectionState.startClientX = e.clientX;
                    selectionState.startClientY = e.clientY;
                    const layer = layers.find(l => l.id === selectionState.layerId);
                    if (layer) {
                        selectionState.startW = layer.naturalWidth;
                        selectionState.startH = layer.naturalHeight;
                    }
                    canvas.setPointerCapture(e.pointerId);
                    return;
                }
            }
        }

        // iterate topmost first to pick layer for moving
        for (let i = layers.length - 1; i >= 0; i--) {
            const layer = layers[i];
            // allow moving for non-base layers (index 0 is base)
            if (i === 0) continue;
            const lx = layer.x, ly = layer.y, lw = layer.naturalWidth, lh = layer.naturalHeight;
            if (px >= lx && px <= lx + lw && py >= ly && py <= ly + lh) {
                dragging = layer.id;
                startX = px; startY = py; origX = layer.x; origY = layer.y;
                selectedLayerId = layer.id;
                renderLayersList();
                // show selection overlay for this layer
                updateSelectionOverlay();
                canvas.setPointerCapture(e.pointerId);
                break;
            }
        }
    });

    canvas.addEventListener('pointermove', (e) => {
        // Resizing has priority
        if (selectionState.resizing) {
            const layer = layers.find(l => l.id === selectionState.layerId);
            if (!layer) return;
            const rect = canvas.getBoundingClientRect();
            const px = Math.round((e.clientX - rect.left) * (canvas.width / rect.width));
            const py = Math.round((e.clientY - rect.top) * (canvas.height / rect.height));
            const dx = px - Math.round((selectionState.startClientX - rect.left) * (canvas.width / rect.width));
            const dy = py - Math.round((selectionState.startClientY - rect.top) * (canvas.height / rect.height));
            const handle = selectionState.resizingHandle;
            let newW = selectionState.startW;
            let newH = selectionState.startH;
            let newX = selectionState.startX;
            let newY = selectionState.startY;

            // maintain aspect ratio
            const aspect = selectionState.startW / selectionState.startH || 1;

            if (handle === 'se') {
                newW = Math.max(10, selectionState.startW + dx);
                newH = Math.max(10, Math.round(newW / aspect));
            } else if (handle === 'sw') {
                newW = Math.max(10, selectionState.startW - dx);
                newH = Math.max(10, Math.round(newW / aspect));
                newX = selectionState.startX + (selectionState.startW - newW);
            } else if (handle === 'ne') {
                newW = Math.max(10, selectionState.startW + dx);
                newH = Math.max(10, Math.round(newW / aspect));
                newY = selectionState.startY + (selectionState.startH - newH);
            } else if (handle === 'nw') {
                newW = Math.max(10, selectionState.startW - dx);
                newH = Math.max(10, Math.round(newW / aspect));
                newX = selectionState.startX + (selectionState.startW - newW);
                newY = selectionState.startY + (selectionState.startH - newH);
            }

            // clamp to base bounds (allow negative position when layer is larger)
            const base = layers[0];
            if (base) {
                const minX2 = Math.min(0, canvas.width - newW);
                const maxX2 = Math.max(0, canvas.width - newW);
                const minY2 = Math.min(0, canvas.height - newH);
                const maxY2 = Math.max(0, canvas.height - newH);
                newX = Math.min(Math.max(minX2, newX), maxX2);
                newY = Math.min(Math.max(minY2, newY), maxY2);
                // keep reasonable minimum sizes
                newW = Math.max(10, Math.min(newW, 10000));
                newH = Math.max(10, Math.min(newH, 10000));
            }

            layer.naturalWidth = Math.round(newW);
            layer.naturalHeight = Math.round(newH);
            layer.x = Math.round(newX);
            layer.y = Math.round(newY);
            scheduleApplyLayersToCanvas();
            updateSelectionOverlay();
            return;
        }

        if (!dragging) return;
        const rect = canvas.getBoundingClientRect();
        const px = Math.round((e.clientX - rect.left) * (canvas.width / rect.width));
        const py = Math.round((e.clientY - rect.top) * (canvas.height / rect.height));
        const dx = px - startX; const dy = py - startY;
        const layer = layers.find(l => l.id === dragging);
        if (!layer) return;
    // clamp within base bounds (allow negative positions when layer is larger than base)
    const base = layers[0];
    const minX = Math.min(0, canvas.width - layer.naturalWidth);
    const maxX = Math.max(0, canvas.width - layer.naturalWidth);
    const minY = Math.min(0, canvas.height - layer.naturalHeight);
    const maxY = Math.max(0, canvas.height - layer.naturalHeight);
    const newX = Math.min(Math.max(minX, origX + dx), maxX);
    const newY = Math.min(Math.max(minY, origY + dy), maxY);
    layer.x = newX; layer.y = newY;
    scheduleApplyLayersToCanvas(); // coalesced redraw for updated layer positions
        updateSelectionOverlay();
    });

    canvas.addEventListener('pointerup', (e) => {
        try { canvas.releasePointerCapture(e.pointerId); } catch (er) {}
        dragging = null;
        if (selectionState.resizing) {
            // capture which layer was resized
            const resizedId = selectionState.layerId;
            selectionState.resizing = false;
            selectionState.resizingHandle = null;

            // Resample the layer image to its new natural size so the resize becomes the new intrinsic pixels
            const layer = layers.find(l => l.id === resizedId);
            if (layer) {
                const newW = Math.max(1, Math.round(layer.naturalWidth));
                const newH = Math.max(1, Math.round(layer.naturalHeight));
                // Don't resample the base here (base is immutable for size per requirement)
                const idx = layers.findIndex(l => l.id === layer.id);
                if (idx !== 0) {
                    const off = document.createElement('canvas');
                    off.width = newW;
                    off.height = newH;
                    const offCtx = off.getContext('2d');
                    offCtx.imageSmoothingEnabled = true;
                    try {
                        offCtx.drawImage(layer.img, 0, 0, layer.img.width, layer.img.height, 0, 0, newW, newH);
                        const dataUrl = off.toDataURL();
                        const newImg = new Image();
                        newImg.onload = () => {
                            layer.img = newImg;
                            layer.naturalWidth = newW;
                            layer.naturalHeight = newH;
                            applyLayersToCanvas();
                            updateSelectionOverlay();
                        };
                        newImg.src = dataUrl;
                    } catch (err) {
                        console.error('resample after interactive resize failed', err);
                        applyLayersToCanvas();
                        updateSelectionOverlay();
                    }
                } else {
                    // If somehow base was attempted to be resized, just restore canvas
                    applyLayersToCanvas();
                    updateSelectionOverlay();
                }
            }
        }
    });
}



// ----------------------
// Crop overlay (interactive) implementation
// ----------------------
let cropState = {
    active: false,
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    dragging: null,
    startClientX: 0,
    startClientY: 0,
    startValue: 0
};

let cropElements = null;

// Which layer is the target of the current crop session (layer id). If null, crop the base/composite.
let cropTargetLayerId = null;

// Resize overlay state (separate from crop)
let resizeState = {
    active: false,
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    dragging: null,
    startClientX: 0,
    startClientY: 0,
    startValue: 0
};

let resizeElements = null;
let resizeTargetLayerId = null;

// Selection / resize overlay state
let selectionElements = null;
let selectionState = {
    active: false,
    resizing: false,
    resizingHandle: null,
    moving: false,
    startClientX: 0,
    startClientY: 0,
    startX: 0,
    startY: 0,
    startW: 0,
    startH: 0,
    layerId: null
};

function initCropOverlay() {
    const container = document.querySelector('.canvas-container');
    if (!container) return;

    // Overlay wrapper
    const overlay = document.createElement('div');
    overlay.className = 'crop-overlay';
    overlay.style.display = 'none';

    // Crop rect and bars
    const rect = document.createElement('div');
    rect.className = 'crop-rect';

    const bars = {};
    ['top', 'right', 'bottom', 'left'].forEach(side => {
        const bar = document.createElement('div');
        bar.className = `crop-bar ${side === 'top' || side === 'bottom' ? 'horizontal' : 'vertical'}`;
        bar.dataset.side = side;
        const val = document.createElement('div');
        val.className = 'crop-value';
        val.textContent = '';
        bar.appendChild(val);
        rect.appendChild(bar);
        bars[side] = { bar, val };

        // Pointer events
        bar.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            bar.setPointerCapture(e.pointerId);
            cropState.dragging = side;
            cropState.startClientX = e.clientX;
            cropState.startClientY = e.clientY;
            cropState.startValue = cropState[side];
        });
    });

    overlay.appendChild(rect);
    container.appendChild(overlay);

    // Store elements
    cropElements = { overlay, rect, bars };

    // Observe overlay's display style so we can toggle a body-level class
    // This allows CSS to hide other header buttons while crop is active without
    // changing other JS logic that shows/hides the overlay.
    try {
        const observer = new MutationObserver(() => {
            const isVisible = overlay.style.display !== 'none';
            document.body.classList.toggle('crop-active', isVisible);
        });
        observer.observe(overlay, { attributes: true, attributeFilter: ['style'] });
    } catch (e) {
        // MutationObserver may not be available in some environments; safe-ignore
    }

    // Global pointer move/up handlers
    window.addEventListener('pointermove', (e) => {
        if (!cropState.dragging || !cropElements) return;
        const rectCanvas = canvas.getBoundingClientRect();
        const dx = e.clientX - cropState.startClientX;
        const dy = e.clientY - cropState.startClientY;

        // Convert movement to canvas pixels
        const deltaX = Math.round((dx / rectCanvas.width) * canvas.width);
        const deltaY = Math.round((dy / rectCanvas.height) * canvas.height);

        // Current crop rect in canvas coords
        let left = cropState.left;
        let right = canvas.width - cropState.right;
        let top = cropState.top;
        let bottom = canvas.height - cropState.bottom;

        if (cropState.dragging === 'left') {
            left = cropState.startValue + deltaX;
        } else if (cropState.dragging === 'right') {
            // startValue for right was cropState.right (distance from right edge)
            const newRightDistance = cropState.startValue - deltaX;
            right = canvas.width - newRightDistance;
        } else if (cropState.dragging === 'top') {
            top = cropState.startValue + deltaY;
        } else if (cropState.dragging === 'bottom') {
            const newBottomDistance = cropState.startValue - deltaY;
            bottom = canvas.height - newBottomDistance;
        }

        // If we're cropping a specific layer, constrain the crop rect to that layer's bounds
        if (cropTargetLayerId) {
            const targetIdx = layers.findIndex(l => l.id === cropTargetLayerId);
            if (targetIdx > -1) {
                const layer = layers[targetIdx];
                const lBound = layer.x;
                const tBound = layer.y;
                const rBound = layer.x + layer.naturalWidth;
                const bBound = layer.y + layer.naturalHeight;

                // Clamp and ensure min size of 1px
                left = Math.max(lBound, Math.min(left, rBound - 1));
                right = Math.max(lBound + 1, Math.min(right, rBound));
                top = Math.max(tBound, Math.min(top, bBound - 1));
                bottom = Math.max(tBound + 1, Math.min(bottom, bBound));
            }
        } else {
            // Default: clamp to canvas
            left = Math.max(0, Math.min(left, canvas.width - 1));
            right = Math.max(1, Math.min(right, canvas.width));
            top = Math.max(0, Math.min(top, canvas.height - 1));
            bottom = Math.max(1, Math.min(bottom, canvas.height));
        }

        // Ensure valid rect
        if (right <= left) right = left + 1;
        if (bottom <= top) bottom = top + 1;

        // Write back into cropState as distances
        cropState.left = Math.round(left);
        cropState.right = Math.round(canvas.width - right);
        cropState.top = Math.round(top);
        cropState.bottom = Math.round(canvas.height - bottom);

        updateCropOverlay();
    });

    window.addEventListener('pointerup', (e) => {
        if (!cropState.dragging) return;
        try { const bar = cropElements.bars[cropState.dragging].bar; bar.releasePointerCapture(e.pointerId); } catch (er) {}
        cropState.dragging = null;
    });

    // Wire header buttons
    const applyBtn = document.getElementById('applyCropBtn');
    const cancelBtn = document.getElementById('cancelCropBtn');

    applyBtn.addEventListener('click', () => {
        if (!cropState.active) {
            startCropMode();
        } else {
            applyCrop();
        }
    });
    cancelBtn.addEventListener('click', () => {
        cancelCrop();
    });
}

// Initialize the resize overlay (visually similar to crop)
function initResizeOverlay() {
    const container = document.querySelector('.canvas-container');
    if (!container) return;

    const overlay = document.createElement('div');
    overlay.className = 'resize-overlay';
    overlay.style.display = 'none';

    const rect = document.createElement('div');
    rect.className = 'resize-rect';

    const bars = {};
    ['top','right','bottom','left'].forEach(side => {
        const b = document.createElement('div');
        b.className = `crop-bar ${side === 'top' || side === 'bottom' ? 'horizontal' : 'vertical'}`;
        b.dataset.side = side;
        b.style.position = 'absolute';
        rect.appendChild(b);
        bars[side] = b;
        // pointerdown handler
        b.addEventListener('pointerdown', (ev) => {
            ev.stopPropagation();
            ev.preventDefault();
            resizeState.dragging = side;
            resizeState.startClientX = ev.clientX;
            resizeState.startClientY = ev.clientY;
            resizeState.startValue = resizeState[side];
            window.addEventListener('pointermove', onResizePointerMove);
            window.addEventListener('pointerup', onResizePointerUp);
        });
    });

    overlay.appendChild(rect);
    container.appendChild(overlay);

    resizeElements = { overlay, rect, bars };

    // Mutation observer to toggle body.resize-active for CSS
    try {
        const observer = new MutationObserver(() => {
            const isVisible = overlay.style.display !== 'none';
            document.body.classList.toggle('resize-active', isVisible);
        });
        observer.observe(overlay, { attributes: true, attributeFilter: ['style'] });
    } catch (e) {}

    // Wire header apply/cancel resize buttons
    const applyBtn = document.getElementById('applyResizeBtn');
    const cancelBtn = document.getElementById('cancelResizeBtn');
    if (applyBtn) applyBtn.addEventListener('click', applyResize);
    if (cancelBtn) cancelBtn.addEventListener('click', hideResizeOverlay);
}

function onResizePointerMove(ev) {
    if (!resizeState.dragging || !resizeElements) return;
    const rectCanvas = canvas.getBoundingClientRect();
    const container = document.querySelector('.canvas-container');
    const containerRect = container ? container.getBoundingClientRect() : rectCanvas;
    const scaleX = canvas.width / rectCanvas.width;
    const scaleY = canvas.height / rectCanvas.height;

    const dx = (ev.clientX - resizeState.startClientX) * scaleX;
    const dy = (ev.clientY - resizeState.startClientY) * scaleY;

    switch (resizeState.dragging) {
        case 'left':
            resizeState.left = Math.min(resizeState.startValue + dx, resizeState.right - 1);
            break;
        case 'right':
            resizeState.right = Math.max(resizeState.startValue + dx, resizeState.left + 1);
            break;
        case 'top':
            resizeState.top = Math.min(resizeState.startValue + dy, resizeState.bottom - 1);
            break;
        case 'bottom':
            resizeState.bottom = Math.max(resizeState.startValue + dy, resizeState.top + 1);
            break;
    }
    updateResizeOverlay();
}

function onResizePointerUp(ev) {
    resizeState.dragging = null;
    window.removeEventListener('pointermove', onResizePointerMove);
    window.removeEventListener('pointerup', onResizePointerUp);
}

function startResizeMode(targetLayerId = null) {
    if (!canvas) return;
    // Resolve the effective target id (explicit argument wins, otherwise current selection)
    const targetId = targetLayerId || selectedLayerId;
    const layer = layers.find(l => l.id === targetId);
    if (!layer) return;
    // Prevent starting resize on base
    const idx = layers.findIndex(l => l.id === layer.id);
    if (idx === 0) return;

    resizeTargetLayerId = layer.id;
    resizeState.active = true;
    // initialize in canvas pixel coords
    // use naturalWidth/naturalHeight (the codebase uses these as the authoritative sizes)
    resizeState.left = layer.x;
    resizeState.top = layer.y;
    resizeState.right = layer.x + layer.naturalWidth;
    resizeState.bottom = layer.y + layer.naturalHeight;

    if (!resizeElements) initResizeOverlay();
    if (!resizeElements) return;
    resizeElements.overlay.style.display = 'block';
    updateResizeOverlay();
    // show header apply/cancel for resize; MutationObserver will set body class
    const applyBtn = document.getElementById('applyResizeBtn');
    const cancelBtn = document.getElementById('cancelResizeBtn');
    if (applyBtn) applyBtn.style.display = 'inline-block';
    if (cancelBtn) cancelBtn.style.display = 'inline-block';

    // Style the buttons to match crop mode (apply green, cancel red)
    try {
        if (applyBtn) {
            applyBtn.style.background = '#28a745';
            applyBtn.style.color = '#ffffff';
            applyBtn.style.border = 'none';
        }
        if (cancelBtn) {
            cancelBtn.style.background = '#ff4757';
            cancelBtn.style.color = '#ffffff';
            cancelBtn.style.border = 'none';
        }
    } catch (e) {}
}

function updateResizeOverlay() {
    if (!resizeElements) return;
    const rectEl = resizeElements.rect;
    const rectCanvas = canvas.getBoundingClientRect();
    const container = document.querySelector('.canvas-container');
    const containerRect = container ? container.getBoundingClientRect() : rectCanvas;
    const scaleX = rectCanvas.width / canvas.width;
    const scaleY = rectCanvas.height / canvas.height;

    // compute container-relative coordinates
    const left = containerRect.left + (resizeState.left * scaleX) - containerRect.left;
    const top = containerRect.top + (resizeState.top * scaleY) - containerRect.top;
    const width = Math.max(1, (resizeState.right - resizeState.left) * scaleX);
    const height = Math.max(1, (resizeState.bottom - resizeState.top) * scaleY);

    rectEl.style.left = `${(resizeState.left * scaleX) + (rectCanvas.left - containerRect.left)}px`;
    rectEl.style.top = `${(resizeState.top * scaleY) + (rectCanvas.top - containerRect.top)}px`;
    rectEl.style.width = `${width}px`;
    rectEl.style.height = `${height}px`;

    // position bars inside rect (use same approach as crop overlay)
    const bars = resizeElements.bars;
    if (bars.top) { bars.top.style.left = '0'; bars.top.style.top = '-6px'; bars.top.style.right = '0'; }
    if (bars.bottom) { bars.bottom.style.left = '0'; bars.bottom.style.bottom = '-6px'; bars.bottom.style.right = '0'; }
    if (bars.left) { bars.left.style.top = '0'; bars.left.style.left = '-6px'; bars.left.style.bottom = '0'; }
    if (bars.right) { bars.right.style.top = '0'; bars.right.style.right = '-6px'; bars.right.style.bottom = '0'; }
}

function hideResizeOverlay() {
    if (!resizeElements) return;
    resizeElements.overlay.style.display = 'none';
    resizeTargetLayerId = null;
    resizeState.active = false;
    // hide header apply/cancel resize
    const applyBtn = document.getElementById('applyResizeBtn');
    const cancelBtn = document.getElementById('cancelResizeBtn');
    if (applyBtn) applyBtn.style.display = 'none';
    if (cancelBtn) cancelBtn.style.display = 'none';
    // restore button styles to defaults
    try {
        if (applyBtn) {
            applyBtn.style.background = '';
            applyBtn.style.color = '';
            applyBtn.style.border = '';
        }
        if (cancelBtn) {
            cancelBtn.style.background = '';
            cancelBtn.style.color = '';
            cancelBtn.style.border = '';
        }
    } catch (e) {}
}

function applyResize() {
    if (!resizeTargetLayerId) return;
    const layer = layers.find(l => l.id === resizeTargetLayerId);
    if (!layer) return;

    const newW = Math.max(1, Math.round(resizeState.right - resizeState.left));
    const newH = Math.max(1, Math.round(resizeState.bottom - resizeState.top));

    // Create offscreen canvas and resample the layer image into new dimensions
    const off = document.createElement('canvas');
    off.width = newW;
    off.height = newH;
    const offCtx = off.getContext('2d');
    offCtx.imageSmoothingEnabled = true;
    offCtx.clearRect(0,0,newW,newH);
    try {
        offCtx.drawImage(layer.img, 0, 0, layer.naturalWidth, layer.naturalHeight, 0, 0, newW, newH);
    } catch (e) {
        console.error('Resize drawImage failed', e);
        return;
    }

    const dataUrl = off.toDataURL();
    const newImg = new Image();
    newImg.onload = () => {
        // Replace layer image and update geometry
        layer.img = newImg;
        layer.naturalWidth = newImg.width;
        layer.naturalHeight = newImg.height;
        layer.width = newW;
        layer.height = newH;
        layer.x = Math.round(resizeState.left);
        layer.y = Math.round(resizeState.top);
        // re-render
        hideResizeOverlay();
        renderLayersList();
        applyLayersToCanvas();
        updateSelectionOverlay();
    };
    newImg.src = dataUrl;
}

function initLayerSelectionOverlay() {
    const container = document.querySelector('.canvas-container');
    if (!container) return;

    // selection wrapper
    const overlay = document.createElement('div');
    overlay.className = 'selection-overlay';
    overlay.style.display = 'none';
    overlay.style.position = 'absolute';
    overlay.style.left = '0';
    overlay.style.top = '0';
    overlay.style.right = '0';
    overlay.style.bottom = '0';
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = 2000;

    const rect = document.createElement('div');
    rect.className = 'selection-rect';
    rect.style.position = 'absolute';
    rect.style.border = '2px dashed rgba(102,126,234,0.9)';
    rect.style.pointerEvents = 'none';

    // handles
    const handles = {};
    ['nw','ne','sw','se'].forEach(pos => {
        const h = document.createElement('div');
        h.className = `sel-handle sel-handle-${pos}`;
        h.style.position = 'absolute';
        h.style.width = '12px';
        h.style.height = '12px';
        h.style.background = '#fff';
        h.style.border = '2px solid #667eea';
        h.style.borderRadius = '3px';
        h.style.boxSizing = 'border-box';
        h.style.pointerEvents = 'auto';
        overlay.appendChild(h);
        handles[pos] = h;
    });

    overlay.appendChild(rect);
    container.appendChild(overlay);

    selectionElements = { overlay, rect, handles };

    // click selection: when clicking on canvas, show selection for selectedLayer
    container.addEventListener('pointerdown', (e) => {
        // pointer down handled in canvas pointer handlers
    });

    // wire handle pointerdown events to start resizing
    Object.keys(handles).forEach((pos) => {
        const h = handles[pos];
        h.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            // Only allow interactive resizing for non-base layers
            const layer = layers.find(l => l.id === selectedLayerId);
            const idx = layer ? layers.findIndex(l => l.id === layer.id) : -1;
            if (!layer || idx === 0) {
                // don't start resize for base or missing selection
                return;
            }
            selectionState.resizing = true;
            selectionState.resizingHandle = pos;
            selectionState.startClientX = e.clientX;
            selectionState.startClientY = e.clientY;
            selectionState.startX = layer.x;
            selectionState.startY = layer.y;
            selectionState.startW = layer.naturalWidth;
            selectionState.startH = layer.naturalHeight;
            selectionState.layerId = layer.id;
            try { h.setPointerCapture(e.pointerId); } catch (er) {}
        });
    });

    // end resize on pointerup anywhere
    window.addEventListener('pointerup', (e) => {
        if (selectionState.resizing) {
            selectionState.resizing = false;
            selectionState.resizingHandle = null;
        }
    });
}

// update selection UI to follow the currently selected layer
function updateSelectionOverlay() {
    if (!selectionElements) return;
    const sel = selectionElements;
    const layer = layers.find(l => l.id === selectedLayerId);
    if (!layer) {
        sel.overlay.style.display = 'none';
        selectionState.layerId = null;
        return;
    }
    // only show overlay for non-base layers (allow selecting base too if desired)
    const idx = layers.findIndex(l => l.id === layer.id);
    if (idx === 0) {
        // hide overlay for base
        sel.overlay.style.display = 'none';
        selectionState.layerId = null;
        return;
    }

    const rectCanvas = canvas.getBoundingClientRect();
    const container = document.querySelector('.canvas-container');
    const containerRect = container ? container.getBoundingClientRect() : rectCanvas;
    const scaleX = rectCanvas.width / canvas.width;
    const scaleY = rectCanvas.height / canvas.height;

    // compute position relative to the container
    const leftPx = Math.round(layer.x * scaleX) + (rectCanvas.left - containerRect.left);
    const topPx = Math.round(layer.y * scaleY) + (rectCanvas.top - containerRect.top);
    const wPx = Math.round(layer.naturalWidth * scaleX);
    const hPx = Math.round(layer.naturalHeight * scaleY);

    sel.rect.style.left = leftPx + 'px';
    sel.rect.style.top = topPx + 'px';
    sel.rect.style.width = Math.max(6, wPx) + 'px';
    sel.rect.style.height = Math.max(6, hPx) + 'px';
    sel.overlay.style.display = '';
    selectionState.layerId = layer.id;

    // position handles
    const offsetLeft = rectCanvas.left;
    const offsetTop = rectCanvas.top;
    // nw
    sel.handles.nw.style.left = (leftPx - 6) + 'px';
    sel.handles.nw.style.top = (topPx - 6) + 'px';
    // ne
    sel.handles.ne.style.left = (leftPx + wPx - 6) + 'px';
    sel.handles.ne.style.top = (topPx - 6) + 'px';
    // sw
    sel.handles.sw.style.left = (leftPx - 6) + 'px';
    sel.handles.sw.style.top = (topPx + hPx - 6) + 'px';
    // se
    sel.handles.se.style.left = (leftPx + wPx - 6) + 'px';
    sel.handles.se.style.top = (topPx + hPx - 6) + 'px';

    // ensure handles are above canvas
    Object.values(sel.handles).forEach(h => { h.style.zIndex = 1200; });
    sel.rect.style.zIndex = 1199;
}

function startCropMode(targetLayerId = null) {
    if (layers.length === 0 || !cropElements) return;
    // Determine the crop target: selected layer if provided, else passed target, else base
    const targetId = targetLayerId || selectedLayerId || (layers[0] && layers[0].id) || null;
    cropTargetLayerId = targetId;

    // If cropping a non-base layer, initialize the crop rect to that layer's bounds.
    if (cropTargetLayerId && layers.length > 0) {
        const targetIdx = layers.findIndex(l => l.id === cropTargetLayerId);
        if (targetIdx > -1 && targetIdx !== 0) {
            const layer = layers[targetIdx];
            // Clamp to canvas
            // Use the exact layer bounds (allow negative values if the layer extends outside the canvas)
            const left = Math.round(layer.x);
            const top = Math.round(layer.y);
            const right = Math.round(canvas.width - (layer.x + layer.naturalWidth));
            const bottom = Math.round(canvas.height - (layer.y + layer.naturalHeight));
            cropState.left = left;
            cropState.top = top;
            cropState.right = right;
            cropState.bottom = bottom;
        } else {
            // If target is base (or composite), initialize crop to the image edges
            // so the crop rect begins on the image outline rather than inset.
            cropState.left = 0;
            cropState.top = 0;
            cropState.right = 0;
            cropState.bottom = 0;
        }
    }

    cropState.active = true;
    updateCropOverlay();
    cropElements.overlay.style.display = 'block';
    const applyBtn = document.getElementById('applyCropBtn');
    const cancelBtn = document.getElementById('cancelCropBtn');
    if (applyBtn) {
        applyBtn.textContent = 'Apply Crop';
        // make apply green while cropping
        applyBtn.style.background = '#28a745';
        applyBtn.style.color = '#ffffff';
        applyBtn.style.border = 'none';
    }
    if (cancelBtn) {
        cancelBtn.style.display = 'inline-block';
        // make cancel red while cropping
        cancelBtn.style.background = '#ff4757';
        cancelBtn.style.color = '#ffffff';
        cancelBtn.style.border = 'none';
    }

    // Hide percentage labels while cropping
    try {
        Object.values(cropElements.bars).forEach(({ val }) => {
            if (val && val.style) val.style.display = 'none';
        });
    } catch (e) {}
}


function updateCropOverlay() {
    if (!cropElements) return;
    const rectCanvas = canvas.getBoundingClientRect();
    const scaleX = rectCanvas.width / canvas.width;
    const scaleY = rectCanvas.height / canvas.height;

    // Get container offset so overlay coordinates align with the canvas inside the container
    const container = document.querySelector('.canvas-container');
    const containerRect = container ? container.getBoundingClientRect() : rectCanvas;
    const offsetLeft = Math.round(rectCanvas.left - containerRect.left);
    const offsetTop = Math.round(rectCanvas.top - containerRect.top);

    // Compute crop edges in canvas-display pixels, then translate to container coordinates
    const leftCanvasPx = Math.round(cropState.left * scaleX);
    const topCanvasPx = Math.round(cropState.top * scaleY);
    const rightCanvasPx = Math.round(cropState.right * scaleX);
    const bottomCanvasPx = Math.round(cropState.bottom * scaleY);

    const rectLeft = offsetLeft + leftCanvasPx;
    const rectTop = offsetTop + topCanvasPx;
    const rectW = Math.max(2, Math.round(rectCanvas.width - leftCanvasPx - rightCanvasPx));
    const rectH = Math.max(2, Math.round(rectCanvas.height - topCanvasPx - bottomCanvasPx));

    // Position the crop rect within the overlay (container-relative coordinates)
    const r = cropElements.rect;
    r.style.left = rectLeft + 'px';
    r.style.top = rectTop + 'px';
    r.style.width = rectW + 'px';
    r.style.height = rectH + 'px';

    // Update bar value labels
    cropElements.bars.left.val.textContent = `${Math.round((cropState.left / canvas.width) * 100)}%`;
    cropElements.bars.right.val.textContent = `${Math.round((cropState.right / canvas.width) * 100)}%`;
    cropElements.bars.top.val.textContent = `${Math.round((cropState.top / canvas.height) * 100)}%`;
    cropElements.bars.bottom.val.textContent = `${Math.round((cropState.bottom / canvas.height) * 100)}%`;

    // Position bars (top/bottom as horizontal, left/right as vertical).
    // Bars are children of the crop rect, so position them relative to the rect (0..rectW/rectH).
    try {
        const topBar = cropElements.bars.top.bar;
        const bottomBar = cropElements.bars.bottom.bar;
        const leftBar = cropElements.bars.left.bar;
        const rightBar = cropElements.bars.right.bar;

        // Ensure absolute positioning
        [topBar, bottomBar, leftBar, rightBar].forEach(b => b.style.position = 'absolute');

        // top bar spans the rect width (y = -6px to overlap border)
        topBar.style.left = '0px';
        topBar.style.width = rectW + 'px';
        topBar.style.top = '-6px';

        // bottom bar (placed at rect height - 6 to overlap border)
        bottomBar.style.left = '0px';
        bottomBar.style.width = rectW + 'px';
        bottomBar.style.top = (rectH - 6) + 'px';

        // left bar spans the rect height
        leftBar.style.top = '0px';
        leftBar.style.height = rectH + 'px';
        leftBar.style.left = '-6px';

        // right bar at rect width - 6
        rightBar.style.top = '0px';
        rightBar.style.height = rectH + 'px';
        rightBar.style.left = (rectW - 6) + 'px';
    } catch (e) {}
}

function hideCropOverlay() {
    if (!cropElements) return;
    cropElements.overlay.style.display = 'none';
    cropState.active = false;
    cropTargetLayerId = null;
    document.getElementById('applyCropBtn').textContent = 'Crop Layer';
    document.getElementById('cancelCropBtn').style.display = 'none';

    // Restore button styles to defaults
    try {
        const applyBtn = document.getElementById('applyCropBtn');
        const cancelBtn = document.getElementById('cancelCropBtn');
        if (applyBtn) {
            applyBtn.style.background = '';
            applyBtn.style.color = '';
            applyBtn.style.border = '';
        }
        if (cancelBtn) {
            cancelBtn.style.background = '';
            cancelBtn.style.color = '';
            cancelBtn.style.border = '';
        }
    } catch (e) {}

    // Restore percentage labels so they're visible next time crop is started
    try {
        Object.values(cropElements.bars).forEach(({ val }) => {
            if (val && val.style) val.style.display = '';
        });
    } catch (e) {}
}

function cancelCrop() {
    // Simply hide overlay and reset
    hideCropOverlay();
}

function applyCrop() {
    if (layers.length === 0 || !cropElements) return;
    const sx = cropState.left;
    const sy = cropState.top;
    const sw = Math.max(1, canvas.width - cropState.left - cropState.right);
    const sh = Math.max(1, canvas.height - cropState.top - cropState.bottom);

    // If cropping the base (or no target specified), crop the composite like before
    const targetId = cropTargetLayerId || (layers[0] && layers[0].id);
    const baseId = layers[0] && layers[0].id;

    if (!targetId || targetId === baseId) {
        // Crop only the base layer's image (do NOT include front layers)
        const baseLayer = layers[0];
        if (!baseLayer) return;

        // Map crop rect (sx,sy,sw,sh) in canvas coordinates to the base image's source coordinates
        const srcScaleX = (baseLayer.img.width || baseLayer.naturalWidth) / baseLayer.naturalWidth;
        const srcScaleY = (baseLayer.img.height || baseLayer.naturalHeight) / baseLayer.naturalHeight;
        const srcX = Math.round(sx * srcScaleX);
        const srcY = Math.round(sy * srcScaleY);
        const srcW = Math.max(1, Math.round(sw * srcScaleX));
        const srcH = Math.max(1, Math.round(sh * srcScaleY));

        const off = document.createElement('canvas');
        off.width = sw;
        off.height = sh;
        const offCtx = off.getContext('2d');
        try {
            offCtx.drawImage(baseLayer.img, srcX, srcY, srcW, srcH, 0, 0, sw, sh);
        } catch (err) {
            console.error('base crop drawImage failed, falling back to composite sample', err);
            // fallback to sampling composite if direct base draw fails
            offCtx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
        }

        const dataUrl = off.toDataURL();
        const img = new Image();
        img.onload = () => {
            // update base layer image and size
            baseLayer.img = img;
            baseLayer.naturalWidth = sw;
            baseLayer.naturalHeight = sh;
            // adjust other layers' positions by subtracting sx,sy so they remain in the same canvas-relative place
            for (let i = 1; i < layers.length; i++) {
                const lw = layers[i].naturalWidth;
                const lh = layers[i].naturalHeight;
                let nx = layers[i].x - sx;
                let ny = layers[i].y - sy;
                const minX = Math.min(0, sw - lw);
                const maxX = Math.max(0, sw - lw);
                const minY = Math.min(0, sh - lh);
                const maxY = Math.max(0, sh - lh);
                layers[i].x = Math.min(Math.max(minX, nx), maxX);
                layers[i].y = Math.min(Math.max(minY, ny), maxY);
            }
            applyLayersToCanvas();
        };
        img.src = dataUrl;
    } else {
        // Crop only the target non-base layer's image according to the intersection
        const layerIdx = layers.findIndex(l => l.id === targetId);
        if (layerIdx === -1) {
            hideCropOverlay();
            return;
        }
        const layer = layers[layerIdx];

        // Compute intersection between crop rect and layer bounds (in canvas coordinates)
        const layerLeft = layer.x;
        const layerTop = layer.y;
        const layerRight = layer.x + layer.naturalWidth;
        const layerBottom = layer.y + layer.naturalHeight;

        const intLeft = Math.max(sx, layerLeft);
        const intTop = Math.max(sy, layerTop);
        const intRight = Math.min(sx + sw, layerRight);
        const intBottom = Math.min(sy + sh, layerBottom);

        const intW = Math.max(0, Math.round(intRight - intLeft));
        const intH = Math.max(0, Math.round(intBottom - intTop));

        if (intW === 0 || intH === 0) {
            // nothing to crop for this layer
            hideCropOverlay();
            return;
        }

        // Map intersection to source image coordinates (layer.img may have intrinsic size == layer.naturalWidth/Height if previously resampled)
        const srcScaleX = (layer.img.width || layer.naturalWidth) / layer.naturalWidth;
        const srcScaleY = (layer.img.height || layer.naturalHeight) / layer.naturalHeight;
        const srcX = Math.round((intLeft - layerLeft) * srcScaleX);
        const srcY = Math.round((intTop - layerTop) * srcScaleY);
        const srcW = Math.max(1, Math.round(intW * srcScaleX));
        const srcH = Math.max(1, Math.round(intH * srcScaleY));

        const off = document.createElement('canvas');
        off.width = intW;
        off.height = intH;
        const offCtx = off.getContext('2d');
        try {
            // draw the relevant portion of the layer's image into the offscreen canvas and scale to the new cropped size
            offCtx.drawImage(layer.img, srcX, srcY, srcW, srcH, 0, 0, intW, intH);
        } catch (err) {
            console.error('layer crop drawImage failed', err);
            hideCropOverlay();
            return;
        }

        const dataUrl = off.toDataURL();
        const newImg = new Image();
        newImg.onload = () => {
            // replace layer image and update its size and position so the cropped portion remains in the same canvas place
            layer.img = newImg;
            layer.naturalWidth = intW;
            layer.naturalHeight = intH;
            // set new top-left to the intersection top-left
            layer.x = intLeft;
            layer.y = intTop;
            applyLayersToCanvas();
        };
        newImg.src = dataUrl;
    }

    hideCropOverlay();
}

// Download image
function downloadImage() {
    if (layers.length === 0) {
        alert('Please add at least one layer/image first!');
        return;
    }
    const link = document.createElement('a');
    link.download = 'mesmerise-edited-image.png';
    link.href = canvas.toDataURL();
    link.click();
}
