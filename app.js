// State
let originalImage = null;
let canvas = null;
let ctx = null;
let activeEffects = []; // Array to maintain order of effect instances: {id, name}
let effectValues = {}; // Object to store effect values keyed by instance id
let effectCounter = 0; // unique instance id counter
let debounceTimer = null;
let animationFrameId = null;

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
    halftone: { 
        name: 'Halftone', 
        type: 'custom',
        defaults: {
            shape: 'circle',
            size: 'medium',
            mode: 'monochrome'
        }
    }
    ,
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
    
    // Event Listeners
    document.getElementById('imageUpload').addEventListener('change', handleImageUpload);
    document.getElementById('downloadBtn').addEventListener('click', downloadImage);
    document.getElementById('resetBtn').addEventListener('click', resetEffects);
    document.getElementById('addEffectBtn').addEventListener('click', toggleDropdown);
    
    // Dropdown items
    document.querySelectorAll('.dropdown-item').forEach(item => {
        // Respect disabled state so resolution can't be added twice
        item.addEventListener('click', (e) => {
            if (item.classList.contains('disabled')) return;
            addEffect(item.dataset.effect);
        });
    });
    
    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.effects-panel')) {
            document.getElementById('dropdownMenu').classList.remove('show');
        }
    });
    // Initialize crop overlay UI (hidden until used)
    initCropOverlay();
});

// Handle image upload
function handleImageUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
            originalImage = img;
            resetEffects();
            document.getElementById('placeholder').style.display = 'none';
            canvas.classList.add('active');
            // Show crop controls (start state)
            const applyBtn = document.getElementById('applyCropBtn');
            const cancelBtn = document.getElementById('cancelCropBtn');
            if (applyBtn) { applyBtn.style.display = 'inline-block'; applyBtn.textContent = 'Start Crop'; }
            if (cancelBtn) { cancelBtn.style.display = 'none'; }
            applyEffects();
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
}

// Toggle dropdown menu
function toggleDropdown(e) {
    e.stopPropagation();
    const dropdown = document.getElementById('dropdownMenu');
    dropdown.classList.toggle('show');
    updateDropdownItems();
}

// Update dropdown to disable already added effects
function updateDropdownItems() {
    // Disable resolution if it's already present (only one allowed)
    const hasResolution = activeEffects.some(e => e.name === 'resolution');
    document.querySelectorAll('.dropdown-item').forEach(item => {
        if (item.dataset.effect === 'resolution') {
            if (hasResolution) {
                item.classList.add('disabled');
            } else {
                item.classList.remove('disabled');
            }
        } else {
            item.classList.remove('disabled');
        }
    });
}

// Add effect instance to the panel (allows duplicates)
function addEffect(effectName) {
    // Close dropdown
    document.getElementById('dropdownMenu').classList.remove('show');

    // Prevent adding a second resolution instance
    if (effectName === 'resolution') {
        const exists = activeEffects.some(e => e.name === 'resolution');
        if (exists) {
            // Optionally give user feedback
            try { alert('Resolution can only be applied once.'); } catch (e) {}
            return;
        }
    }

    // Create unique instance id
    effectCounter += 1;
    const instanceId = `eff${effectCounter}`;

    // Add instance to active effects array
    activeEffects.push({ id: instanceId, name: effectName });

    // Set default value based on effect type
    const def = effectDefinitions[effectName];
    if (def && def.type === 'custom' && def.defaults) {
        effectValues[instanceId] = { ...def.defaults };
    } else if (def) {
        effectValues[instanceId] = def.default;
    } else {
        effectValues[instanceId] = 0;
    }

    // Create effect control element
    const effectControl = createEffectControl(effectName, instanceId);

    // Insert before the add button
    const addButton = document.getElementById('addEffectBtn');
    addButton.parentNode.insertBefore(effectControl, addButton);

    // Apply effects if image is loaded
    if (originalImage) {
        applyEffects();
    }
}

// Create effect control element
// Create effect control element for a specific instance
function createEffectControl(effectName, instanceId) {
    const def = effectDefinitions[effectName];
    const div = document.createElement('div');
    div.className = 'effect-control';
    div.dataset.effect = effectName;
    div.dataset.instanceId = instanceId;
    
    // Handle halftone custom control
    if (effectName === 'halftone') {
        div.innerHTML = `
            <button class="remove-effect-btn" onclick="removeEffect('${instanceId}')">×</button>
            <label>
                <span class="effect-name">${def.name}</span>
            </label>
            <div class="halftone-controls">
                <div class="halftone-control-group">
                    <label for="${instanceId}-Shape">Shape</label>
                    <select id="${instanceId}-Shape" class="halftone-select">
                        <option value="circle">Circles</option>
                        <option value="square">Squares</option>
                        <option value="triangle">Triangles</option>
                        <option value="line">Lines</option>
                    </select>
                </div>
                <div class="halftone-control-group">
                    <label for="${instanceId}-Size">Size</label>
                    <select id="${instanceId}-Size" class="halftone-select">
                        <option value="small">Small</option>
                        <option value="medium" selected>Medium</option>
                        <option value="large">Large</option>
                    </select>
                </div>
                <div class="halftone-control-group">
                    <label for="${instanceId}-Mode">Mode</label>
                    <select id="${instanceId}-Mode" class="halftone-select">
                        <option value="monochrome" selected>Monochrome</option>
                        <option value="color">Color</option>
                    </select>
                </div>
            </div>
        `;
        
        // Add event listeners
        const shapeSelect = div.querySelector(`#${instanceId}-Shape`);
        const sizeSelect = div.querySelector(`#${instanceId}-Size`);
        const modeSelect = div.querySelector(`#${instanceId}-Mode`);
        
        shapeSelect.addEventListener('change', (e) => {
            effectValues[instanceId].shape = e.target.value;
            if (originalImage) applyEffects();
        });
        
        sizeSelect.addEventListener('change', (e) => {
            effectValues[instanceId].size = e.target.value;
            if (originalImage) applyEffects();
        });
        
        modeSelect.addEventListener('change', (e) => {
            effectValues[instanceId].mode = e.target.value;
            if (originalImage) applyEffects();
        });
    } else {
        
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
                // debounce heavy rerender while user drags the color picker
                scheduleApplyEffects(120);
            });
            cB.addEventListener('input', (e) => {
                effectValues[instanceId].colorB = e.target.value;
                // debounce heavy rerender while user drags the color picker
                scheduleApplyEffects(120);
            });
            mix.addEventListener('input', (e) => {
                const v = parseInt(e.target.value, 10);
                effectValues[instanceId].mix = v;
                if (mixVal) mixVal.textContent = v;
                // mix slider can be frequent; debounce
                scheduleApplyEffects(60);
            });
            modeSel.addEventListener('change', (e) => {
                effectValues[instanceId].mode = e.target.value;
                // mode change is infrequent; apply immediately
                if (originalImage) applyEffects();
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
    }
    
    return div;
}

// Remove effect instance from the panel
function removeEffect(instanceId) {
    // Remove from active effects by id
    const index = activeEffects.findIndex(e => e.id === instanceId);
    if (index > -1) {
        activeEffects.splice(index, 1);
    }
    delete effectValues[instanceId];
    
    // Remove DOM element
    const effectControl = document.querySelector(`.effect-control[data-instance-id="${instanceId}"]`);
    if (effectControl) {
        effectControl.remove();
    }
    
    // Update dropdown (no disabling for duplicates)
    updateDropdownItems();
    
    // Reapply effects if image is loaded
    if (originalImage) {
        applyEffects();
    }
}

// Update effect instance value
function updateEffect(instanceId, value) {
    // Update stored value (number) and UI
    const parsed = parseFloat(value);
    effectValues[instanceId] = parsed;
    const valueEl = document.getElementById(instanceId + 'Value');
    if (valueEl) valueEl.textContent = value;
    
    // Debounce effect application for performance
    if (debounceTimer) {
        clearTimeout(debounceTimer);
    }
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
    }
    
    debounceTimer = setTimeout(() => {
        animationFrameId = requestAnimationFrame(applyEffects);
    }, 16); // ~60fps
}

// Schedule applying effects with debounce (used by controls that update frequently, like color pickers)
function scheduleApplyEffects(delay = 120) {
    if (!originalImage) return;
    if (debounceTimer) {
        clearTimeout(debounceTimer);
    }
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
    }
    debounceTimer = setTimeout(() => {
        animationFrameId = requestAnimationFrame(applyEffects);
    }, delay);
}

// Reset all effects
function resetEffects() {
    // Remove all effect controls
    document.querySelectorAll('.effect-control').forEach(control => control.remove());
    
    // Reset state
    activeEffects = [];
    effectValues = {};
    
    // Update dropdown
    updateDropdownItems();
    
    if (originalImage) {
        applyEffects();
    }
}

// Apply all effects in the order they were added
function applyEffects() {
    if (!originalImage) return;
    // Start from the original image on the canvas
    canvas.width = originalImage.width;
    canvas.height = originalImage.height;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(originalImage, 0, 0);

    // If there are no effects, we're done
    if (activeEffects.length === 0) return;

    // Process effects in sequence (each instance mutates the canvas)
    let resolutionApplied = false;
    for (const inst of activeEffects) {
        const name = inst.name;
        const value = effectValues[inst.id];

        

        // Sharpen: apply a small convolution kernel based on amount
        if (name === 'sharpen') {
            const amount = (typeof value === 'number') ? value : 0;
            if (amount > 0) {
                const strength = Math.min(1, Math.max(0, amount / 100));
                const base = [
                    -1, -1, -1,
                    -1,  9, -1,
                    -1, -1, -1
                ];
                const identity = [0,0,0,0,1,0,0,0,0];
                const kernel = base.map((v, i) => identity[i] * (1 - strength) + v * strength);
                const imd = ctx.getImageData(0, 0, canvas.width, canvas.height);
                applyConvolution(imd, kernel);
                ctx.putImageData(imd, 0, 0);
            }
            continue;
        }

        // Resolution: downscale then draw back (pixelate) using current canvas as source
        if (name === 'resolution') {
            if (resolutionApplied) {
                // Defensive: skip any extra resolution instances
                try { console.debug('Skipping extra resolution instance', inst.id); } catch (e) {}
                continue;
            }
            resolutionApplied = true;
            const resVal = (typeof value === 'number') ? value : 100;
            const scale = resVal / 100;
            const sw = Math.max(1, Math.round(canvas.width * scale));
            const sh = Math.max(1, Math.round(canvas.height * scale));

            const off = document.createElement('canvas');
            off.width = sw;
            off.height = sh;
            const offCtx = off.getContext('2d');
            offCtx.imageSmoothingEnabled = false;
            offCtx.drawImage(canvas, 0, 0, sw, sh);

            // draw back to main canvas
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
            continue;
        }

        // Halftone: sample the current canvas pixels and composite halftone on top
        if (name === 'halftone') {
            const sample = ctx.getImageData(0, 0, canvas.width, canvas.height);
            applyHalftoneEffect(inst, { overlay: true, sampleImageData: sample });
            continue;
        }

        // Pixel-based effects: apply the single effect to the current canvas pixels
        let imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        let data = imageData.data;
        const width = canvas.width;
        const height = canvas.height;
        const centerX = width / 2;
        const centerY = height / 2;
        const maxDistance = Math.sqrt(centerX * centerX + centerY * centerY);

        for (let i = 0; i < data.length; i += 4) {
            let r = data[i];
            let g = data[i + 1];
            let b = data[i + 2];

            switch (name) {
                case 'brightness':
                    const brightnessFactor = value * 2.55;
                    r += brightnessFactor;
                    g += brightnessFactor;
                    b += brightnessFactor;
                    break;

                case 'contrast':
                    const contrastFactor = (259 * (value + 255)) / (255 * (259 - value));
                    r = contrastFactor * (r - 128) + 128;
                    g = contrastFactor * (g - 128) + 128;
                    b = contrastFactor * (b - 128) + 128;
                    break;

                case 'saturation':
                    const saturationFactor = 1 + (value / 100);
                    const gray = 0.2989 * r + 0.5870 * g + 0.1140 * b;
                    r = gray + saturationFactor * (r - gray);
                    g = gray + saturationFactor * (g - gray);
                    b = gray + saturationFactor * (b - gray);
                    break;

                case 'sepia':
                    // value: 0..100 intensity
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

                case 'duotone':
                    // value is an object: { colorA, colorB, mix, mode }
                    if (value && typeof value === 'object') {
                        // luminance 0..1
                        const lum = Math.max(0, Math.min(1, (0.299 * r + 0.587 * g + 0.114 * b) / 255));

                        const parseHex = (hex) => {
                            const h = (hex || '#000000').replace('#', '');
                            const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
                            const bigint = parseInt(full, 16) || 0;
                            return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255];
                        };

                        const ca = parseHex(value.colorA);
                        const cb = parseHex(value.colorB);

                        const dr = ca[0] + (cb[0] - ca[0]) * lum;
                        const dg = ca[1] + (cb[1] - ca[1]) * lum;
                        const db = ca[2] + (cb[2] - ca[2]) * lum;

                        const mix = (typeof value.mix === 'number') ? (value.mix / 100) : 1;

                        // Replace and overlay both do a simple mix with original for now
                        r = r * (1 - mix) + dr * mix;
                        g = g * (1 - mix) + dg * mix;
                        b = b * (1 - mix) + db * mix;
                    }
                    break;

                case 'tint':
                    // value is an object: { color, mix }
                    if (value && typeof value === 'object') {
                        const mix = (typeof value.mix === 'number') ? (value.mix / 100) : 0;
                        if (mix > 0) {
                            const tc = parseHexColor(value.color || '#000000');
                            const tr = tc[0], tg = tc[1], tb = tc[2];
                            // preserve luminance while applying tint color
                            const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
                            r = r * (1 - mix) + (tr * lum) * mix;
                            g = g * (1 - mix) + (tg * lum) * mix;
                            b = b * (1 - mix) + (tb * lum) * mix;
                        }
                    }
                    break;

                case 'vignette':
                    if (value > 0) {
                        const pixelIndex = i / 4;
                        const x = pixelIndex % width;
                        const y = Math.floor(pixelIndex / width);
                        const dx = x - centerX;
                        const dy = y - centerY;
                        const distance = Math.sqrt(dx * dx + dy * dy);
                        const vignetteStrength = value / 100;
                        const vignetteFactor = 1 - (distance / maxDistance) * vignetteStrength;
                        r *= vignetteFactor;
                        g *= vignetteFactor;
                        b *= vignetteFactor;
                    }
                    break;

                case 'grain':
                    if (value > 0) {
                        const grainStrength = value * 2.55;
                        const noise = (Math.random() - 0.5) * grainStrength;
                        r += noise;
                        g += noise;
                        b += noise;
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

            // Clamp
            data[i] = Math.max(0, Math.min(255, r));
            data[i + 1] = Math.max(0, Math.min(255, g));
            data[i + 2] = Math.max(0, Math.min(255, b));
        }

        ctx.putImageData(imageData, 0, 0);
    }
}

// Helper function to draw halftone shape
function drawHalftoneShape(halftoneCtx, shape, centerX, centerY, shapeSize) {
    halftoneCtx.beginPath();
    
    switch (shape) {
        case 'circle':
            halftoneCtx.arc(centerX, centerY, shapeSize / 2, 0, Math.PI * 2);
            halftoneCtx.fill();
            break;
            
        case 'square':
            halftoneCtx.rect(centerX - shapeSize / 2, centerY - shapeSize / 2, shapeSize, shapeSize);
            halftoneCtx.fill();
            break;
            
        case 'triangle':
            const height = shapeSize * 0.866; // equilateral triangle height
            halftoneCtx.moveTo(centerX, centerY - height / 2);
            halftoneCtx.lineTo(centerX - shapeSize / 2, centerY + height / 2);
            halftoneCtx.lineTo(centerX + shapeSize / 2, centerY + height / 2);
            halftoneCtx.closePath();
            halftoneCtx.fill();
            break;
            
        case 'line':
            halftoneCtx.moveTo(centerX - shapeSize / 2, centerY);
            halftoneCtx.lineTo(centerX + shapeSize / 2, centerY);
            // Ensure stroke color matches fill color for consistency
            if (!halftoneCtx.strokeStyle) halftoneCtx.strokeStyle = halftoneCtx.fillStyle || 'black';
            halftoneCtx.lineWidth = Math.max(1, shapeSize / 3);
            halftoneCtx.stroke();
            break;
    }
}

// Apply halftone effect
function applyHalftoneEffect(halftoneInstance, options = {}) {
    // options: { overlay: boolean, sampleImageData: ImageData }
    // Support being called with the instance object; fallback to first config if not provided
    let halftoneConfig;
    if (halftoneInstance && halftoneInstance.id) {
        halftoneConfig = effectValues[halftoneInstance.id];
    } else {
        // find any halftone config
        const inst = activeEffects.find(e => e.name === 'halftone');
        halftoneConfig = inst ? effectValues[inst.id] : null;
    }
    if (!halftoneConfig) return;

    const { shape, size, mode } = halftoneConfig;
    // Debug log
    try {
        console.debug('applyHalftoneEffect', { id: halftoneInstance && halftoneInstance.id, shape, size, mode, options });
    } catch (e) {}
    
    // Determine dot size based on selection
    let dotSize;
    switch (size) {
        case 'small':
            dotSize = 4;
            break;
        case 'medium':
            dotSize = 8;
            break;
        case 'large':
            dotSize = 12;
            break;
        default:
            dotSize = 8;
    }
    
    // Determine which image data to sample: options.sampleImageData (processed pixels) or current canvas
    const sampleImageData = options.sampleImageData || ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = sampleImageData.data;

    // Create a new canvas for halftone
    const halftoneCanvas = document.createElement('canvas');
    halftoneCanvas.width = canvas.width;
    halftoneCanvas.height = canvas.height;
    const halftoneCtx = halftoneCanvas.getContext('2d');
    // Ensure normal compositing
    halftoneCtx.globalCompositeOperation = 'source-over';

    // Fill with white background (halftone is intended to be on white)
    halftoneCtx.fillStyle = 'white';
    halftoneCtx.fillRect(0, 0, canvas.width, canvas.height);

    // Default fillStyle in case not set by mode inside loop
    halftoneCtx.fillStyle = 'black';
    
    // Create halftone pattern
    let shapesDrawn = 0;
    for (let y = 0; y < canvas.height; y += dotSize) {
        for (let x = 0; x < canvas.width; x += dotSize) {
            // Sample the center of the cell
            const sampleX = Math.min(x + Math.floor(dotSize / 2), canvas.width - 1);
            const sampleY = Math.min(y + Math.floor(dotSize / 2), canvas.height - 1);
            const index = (sampleY * canvas.width + sampleX) * 4;
            
            const r = data[index];
            const g = data[index + 1];
            const b = data[index + 2];
            
            // Calculate brightness and shape size
            const brightness = (r + g + b) / 3;
            const norm = Math.max(0, Math.min(1, brightness / 255));
            // Emphasize dark areas but ensure a small minimum dot so something is visible
            const darkness = Math.pow(1 - norm, 0.9);
            const shapeSize = Math.max(dotSize * 0.05, dotSize * darkness * 0.9);
            
            if (shapeSize > 0.5) {
                const centerX = x + dotSize / 2;
                const centerY = y + dotSize / 2;
                
                // Set color based on mode
                if (mode === 'color') {
                    halftoneCtx.fillStyle = `rgb(${r}, ${g}, ${b})`;
                } else {
                    halftoneCtx.fillStyle = 'black';
                }
                
                // Draw the shape
                drawHalftoneShape(halftoneCtx, shape, centerX, centerY, shapeSize);
                shapesDrawn++;
            }
        }
    }
    try { console.debug('applyHalftoneEffect shapesDrawn:', shapesDrawn); } catch (e) {}

    // If nothing was drawn (very bright image or calculation), draw a minimal dot grid as fallback
    if (shapesDrawn === 0) {
        const fallbackSize = Math.max(1, Math.floor(dotSize * 0.15));
        for (let y = 0; y < canvas.height; y += dotSize) {
            for (let x = 0; x < canvas.width; x += dotSize) {
                const centerX = x + dotSize / 2;
                const centerY = y + dotSize / 2;
                // use a subtle gray fallback so it's visible
                halftoneCtx.fillStyle = (mode === 'color') ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.3)';
                drawHalftoneShape(halftoneCtx, shape, centerX, centerY, fallbackSize);
            }
        }
        try { console.debug('applyHalftoneEffect fallback shapesDrawn'); } catch (e) {}
    }
    
    // Composite halftone canvas over the main canvas
    if (options.overlay) {
        // draw halftone on top preserving existing pixels
        ctx.drawImage(halftoneCanvas, 0, 0);
    } else {
        // replace main canvas (fallback)
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(halftoneCanvas, 0, 0);
    }
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

    // Global pointer move/up handlers
    window.addEventListener('pointermove', (e) => {
        if (!cropState.dragging || !cropElements) return;
        const rectCanvas = canvas.getBoundingClientRect();
        const dx = e.clientX - cropState.startClientX;
        const dy = e.clientY - cropState.startClientY;

        // Convert movement to canvas pixels
        if (cropState.dragging === 'left' || cropState.dragging === 'right') {
            const delta = Math.round((dx / rectCanvas.width) * canvas.width);
            if (cropState.dragging === 'left') {
                cropState.left = Math.max(0, Math.min(canvas.width - cropState.right - 1, cropState.startValue + delta));
            } else {
                cropState.right = Math.max(0, Math.min(canvas.width - cropState.left - 1, cropState.startValue - delta));
            }
        } else {
            const delta = Math.round((dy / rectCanvas.height) * canvas.height);
            if (cropState.dragging === 'top') {
                cropState.top = Math.max(0, Math.min(canvas.height - cropState.bottom - 1, cropState.startValue + delta));
            } else {
                cropState.bottom = Math.max(0, Math.min(canvas.height - cropState.top - 1, cropState.startValue - delta));
            }
        }

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

function startCropMode() {
    if (!originalImage || !cropElements) return;
    // Show overlay and initialize crop rectangle (10% inset)
    cropState.active = true;
    cropState.left = Math.round(canvas.width * 0.1);
    cropState.top = Math.round(canvas.height * 0.1);
    cropState.right = Math.round(canvas.width * 0.1);
    cropState.bottom = Math.round(canvas.height * 0.1);
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

    const leftPx = Math.round(cropState.left * scaleX);
    const topPx = Math.round(cropState.top * scaleY);
    const rightPx = Math.round(cropState.right * scaleX);
    const bottomPx = Math.round(cropState.bottom * scaleY);

    // Position the crop rect within the overlay
    const r = cropElements.rect;
    r.style.left = leftPx + 'px';
    r.style.top = topPx + 'px';
    r.style.width = Math.max(2, Math.round(rectCanvas.width - leftPx - rightPx)) + 'px';
    r.style.height = Math.max(2, Math.round(rectCanvas.height - topPx - bottomPx)) + 'px';

    // Update bar value labels
    cropElements.bars.left.val.textContent = `${Math.round((cropState.left / canvas.width) * 100)}%`;
    cropElements.bars.right.val.textContent = `${Math.round((cropState.right / canvas.width) * 100)}%`;
    cropElements.bars.top.val.textContent = `${Math.round((cropState.top / canvas.height) * 100)}%`;
    cropElements.bars.bottom.val.textContent = `${Math.round((cropState.bottom / canvas.height) * 100)}%`;

    // Position bars (top/bottom as horizontal, left/right as vertical)
    try {
        const topBar = cropElements.bars.top.bar;
        const bottomBar = cropElements.bars.bottom.bar;
        const leftBar = cropElements.bars.left.bar;
        const rightBar = cropElements.bars.right.bar;

        topBar.style.top = '-6px';
        bottomBar.style.bottom = '-6px';
        leftBar.style.left = '-6px';
        rightBar.style.right = '-6px';
    } catch (e) {}
}

function hideCropOverlay() {
    if (!cropElements) return;
    cropElements.overlay.style.display = 'none';
    cropState.active = false;
    document.getElementById('applyCropBtn').textContent = 'Start Crop';
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
    if (!originalImage || !cropElements) return;

    const sx = cropState.left;
    const sy = cropState.top;
    const sw = Math.max(1, canvas.width - cropState.left - cropState.right);
    const sh = Math.max(1, canvas.height - cropState.top - cropState.bottom);

    // Aspect ratio check: preserve only if cropped area has same ratio as original canvas
    const origRatio = canvas.width / canvas.height;
    const cropRatio = sw / sh;
    const tolerance = 0.01; // allow small rounding differences

    const off = document.createElement('canvas');
    off.width = sw;
    off.height = sh;
    const offCtx = off.getContext('2d');
    offCtx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);

    if (Math.abs(cropRatio - origRatio) < tolerance) {
        // Aspect ratio preserved -> scale cropped region to fill current canvas (zoom)
        try {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
        } catch (e) {
            try { console.debug('Crop apply drawImage failed', e); } catch (ee) {}
        }
    } else {
        // Not preserved -> replace canvas with cropped size (no distortion)
        canvas.width = sw;
        canvas.height = sh;
        try {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(off, 0, 0);
        } catch (e) {
            try { console.debug('Crop apply drawImage failed', e); } catch (ee) {}
        }
    }

    // Update originalImage to the new cropped image so further effects apply to it
    const dataUrl = canvas.toDataURL();
    const img = new Image();
    img.onload = () => {
        originalImage = img;
        // Re-render effects on the new original image
        applyEffects();
    };
    img.src = dataUrl;

    hideCropOverlay();
}

// Download image
function downloadImage() {
    if (!originalImage) {
        alert('Please load an image first!');
        return;
    }
    
    const link = document.createElement('a');
    link.download = 'mesmerise-edited-image.png';
    link.href = canvas.toDataURL();
    link.click();
}
