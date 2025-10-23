// State
let originalImage = null;
let canvas = null;
let ctx = null;
let activeEffects = []; // Array to maintain order of effects
let effectValues = {}; // Object to store effect values
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
    edgeGlow: { name: 'Edge Glow', min: 0, max: 100, default: 0, step: 1 },
    halftone: { 
        name: 'Halftone', 
        type: 'custom',
        defaults: {
            shape: 'circle',
            size: 'medium'
        }
    }
};

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
        item.addEventListener('click', () => addEffect(item.dataset.effect));
    });
    
    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.effects-panel')) {
            document.getElementById('dropdownMenu').classList.remove('show');
        }
    });
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
    document.querySelectorAll('.dropdown-item').forEach(item => {
        const effect = item.dataset.effect;
        if (activeEffects.includes(effect)) {
            item.classList.add('disabled');
        } else {
            item.classList.remove('disabled');
        }
    });
}

// Add effect to the panel
function addEffect(effectName) {
    if (activeEffects.includes(effectName)) return;
    
    // Close dropdown
    document.getElementById('dropdownMenu').classList.remove('show');
    
    // Add to active effects
    activeEffects.push(effectName);
    
    // Set default value based on effect type
    const def = effectDefinitions[effectName];
    if (def.type === 'custom' && def.defaults) {
        effectValues[effectName] = { ...def.defaults };
    } else {
        effectValues[effectName] = def.default;
    }
    
    // Create effect control element
    const effectControl = createEffectControl(effectName);
    
    // Insert before the add button
    const addButton = document.getElementById('addEffectBtn');
    addButton.parentNode.insertBefore(effectControl, addButton);
    
    // Apply effects if image is loaded
    if (originalImage) {
        applyEffects();
    }
}

// Create effect control element
function createEffectControl(effectName) {
    const def = effectDefinitions[effectName];
    const div = document.createElement('div');
    div.className = 'effect-control';
    div.dataset.effect = effectName;
    
    // Handle halftone custom control
    if (effectName === 'halftone') {
        div.innerHTML = `
            <button class="remove-effect-btn" onclick="removeEffect('${effectName}')">×</button>
            <label>
                <span class="effect-name">${def.name}</span>
            </label>
            <div class="halftone-controls">
                <div class="halftone-control-group">
                    <label for="${effectName}Shape">Shape</label>
                    <select id="${effectName}Shape" class="halftone-select">
                        <option value="circle">Circles</option>
                        <option value="square">Squares</option>
                        <option value="triangle">Triangles</option>
                        <option value="line">Lines</option>
                    </select>
                </div>
                <div class="halftone-control-group">
                    <label for="${effectName}Size">Size</label>
                    <select id="${effectName}Size" class="halftone-select">
                        <option value="small">Small</option>
                        <option value="medium" selected>Medium</option>
                        <option value="large">Large</option>
                    </select>
                </div>
            </div>
        `;
        
        // Add event listeners
        const shapeSelect = div.querySelector(`#${effectName}Shape`);
        const sizeSelect = div.querySelector(`#${effectName}Size`);
        
        shapeSelect.addEventListener('change', (e) => {
            effectValues[effectName].shape = e.target.value;
            if (originalImage) applyEffects();
        });
        
        sizeSelect.addEventListener('change', (e) => {
            effectValues[effectName].size = e.target.value;
            if (originalImage) applyEffects();
        });
    } else {
        // Standard slider control
        div.innerHTML = `
            <button class="remove-effect-btn" onclick="removeEffect('${effectName}')">×</button>
            <label for="${effectName}">
                <span class="effect-name">${def.name}</span>
                <span class="effect-value" id="${effectName}Value">${def.default}</span>
            </label>
            <input type="range" id="${effectName}" min="${def.min}" max="${def.max}" value="${def.default}" step="${def.step}">
        `;
        
        // Add event listener to the slider
        const slider = div.querySelector('input[type="range"]');
        slider.addEventListener('input', (e) => updateEffect(effectName, e.target.value));
    }
    
    return div;
}

// Remove effect from the panel
function removeEffect(effectName) {
    // Remove from active effects
    const index = activeEffects.indexOf(effectName);
    if (index > -1) {
        activeEffects.splice(index, 1);
    }
    delete effectValues[effectName];
    
    // Remove DOM element
    const effectControl = document.querySelector(`.effect-control[data-effect="${effectName}"]`);
    if (effectControl) {
        effectControl.remove();
    }
    
    // Update dropdown
    updateDropdownItems();
    
    // Reapply effects if image is loaded
    if (originalImage) {
        applyEffects();
    }
}

// Update effect value
function updateEffect(effectName, value) {
    effectValues[effectName] = parseFloat(value);
    document.getElementById(effectName + 'Value').textContent = value;
    
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
    
    // Check if halftone is active - handle it separately and return early
    // (halftone replaces the entire canvas and shouldn't be combined with other effects)
    if (activeEffects.includes('halftone')) {
        // Set canvas to original size for halftone
        canvas.width = originalImage.width;
        canvas.height = originalImage.height;
        ctx.drawImage(originalImage, 0, 0);
        applyHalftoneEffect();
        return;
    }
    
    // Handle resolution effect (use 100% if resolution effect is not active)
    let resolutionValue = 100;
    
    if (activeEffects.includes('resolution')) {
        resolutionValue = effectValues['resolution'];
    }
    
    // Calculate scaled dimensions based on resolution
    const scale = resolutionValue / 100;
    const scaledWidth = Math.max(1, Math.round(originalImage.width * scale));
    const scaledHeight = Math.max(1, Math.round(originalImage.height * scale));
    
    // Set canvas size
    canvas.width = scaledWidth;
    canvas.height = scaledHeight;
    
    // Draw scaled image
    ctx.drawImage(originalImage, 0, 0, scaledWidth, scaledHeight);
    
    // If no other effects, just return
    if (activeEffects.length === 0 || (activeEffects.length === 1 && activeEffects[0] === 'resolution')) return;
    
    // Get image data for pixel-based effects
    let imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let data = imageData.data;
    
    // Pre-calculate values for all active effects
    const width = canvas.width;
    const height = canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;
    const maxDistance = Math.sqrt(centerX * centerX + centerY * centerY);
    
    // Filter out resolution and halftone from pixel-based effects
    // (resolution is handled via canvas scaling, halftone is handled separately)
    const pixelEffects = activeEffects.filter(e => e !== 'resolution' && e !== 'halftone');
    
    // Apply pixel-based effects in order
    for (let i = 0; i < data.length; i += 4) {
        let r = data[i];
        let g = data[i + 1];
        let b = data[i + 2];
        
        // Apply each active effect in order
        for (const effectName of pixelEffects) {
            const value = effectValues[effectName];
            
            switch (effectName) {
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
                    
                case 'edgeGlow':
                    if (value > 0) {
                        const pixelIndex = i / 4;
                        const x = pixelIndex % width;
                        const y = Math.floor(pixelIndex / width);
                        
                        // Simple edge detection using Sobel-like approach
                        if (x > 0 && x < width - 1 && y > 0 && y < height - 1) {
                            // Get surrounding pixels for edge detection
                            const getPixelBrightness = (idx) => {
                                return (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
                            };
                            
                            const top = getPixelBrightness(i - width * 4);
                            const bottom = getPixelBrightness(i + width * 4);
                            const left = getPixelBrightness(i - 4);
                            const right = getPixelBrightness(i + 4);
                            
                            // Calculate edge strength
                            const horizontalGradient = Math.abs(right - left);
                            const verticalGradient = Math.abs(bottom - top);
                            const edgeStrength = Math.sqrt(horizontalGradient * horizontalGradient + verticalGradient * verticalGradient);
                            
                            // Apply glow to edges
                            if (edgeStrength > 20) {
                                const glowStrength = (value / 100) * (edgeStrength / 255) * 100;
                                r += glowStrength;
                                g += glowStrength;
                                b += glowStrength;
                            }
                        }
                    }
                    break;
            }
        }
        
        // Clamp values
        data[i] = Math.max(0, Math.min(255, r));
        data[i + 1] = Math.max(0, Math.min(255, g));
        data[i + 2] = Math.max(0, Math.min(255, b));
    }
    
    // Put modified image data back (single operation)
    ctx.putImageData(imageData, 0, 0);
}

// Apply halftone effect
function applyHalftoneEffect() {
    const halftoneConfig = effectValues['halftone'];
    if (!halftoneConfig) return;
    
    const { shape, size } = halftoneConfig;
    
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
    
    // Get current canvas data
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    
    // Create a new canvas for halftone
    const halftoneCanvas = document.createElement('canvas');
    halftoneCanvas.width = canvas.width;
    halftoneCanvas.height = canvas.height;
    const halftoneCtx = halftoneCanvas.getContext('2d');
    
    // Fill with white background
    halftoneCtx.fillStyle = 'white';
    halftoneCtx.fillRect(0, 0, canvas.width, canvas.height);
    halftoneCtx.fillStyle = 'black';
    
    // Create halftone pattern
    for (let y = 0; y < canvas.height; y += dotSize) {
        for (let x = 0; x < canvas.width; x += dotSize) {
            // Sample the center of the cell
            const sampleX = Math.min(x + Math.floor(dotSize / 2), canvas.width - 1);
            const sampleY = Math.min(y + Math.floor(dotSize / 2), canvas.height - 1);
            const index = (sampleY * canvas.width + sampleX) * 4;
            
            // Calculate brightness (inverted for halftone)
            const brightness = (data[index] + data[index + 1] + data[index + 2]) / 3;
            const darkness = 1 - (brightness / 255);
            
            // Calculate shape size based on darkness
            const shapeSize = dotSize * darkness * 0.9;
            
            if (shapeSize > 0.5) {
                const centerX = x + dotSize / 2;
                const centerY = y + dotSize / 2;
                
                halftoneCtx.beginPath();
                
                switch (shape) {
                    case 'circle':
                        halftoneCtx.arc(centerX, centerY, shapeSize / 2, 0, Math.PI * 2);
                        break;
                        
                    case 'square':
                        halftoneCtx.rect(centerX - shapeSize / 2, centerY - shapeSize / 2, shapeSize, shapeSize);
                        break;
                        
                    case 'triangle':
                        const height = shapeSize * 0.866; // equilateral triangle height
                        halftoneCtx.moveTo(centerX, centerY - height / 2);
                        halftoneCtx.lineTo(centerX - shapeSize / 2, centerY + height / 2);
                        halftoneCtx.lineTo(centerX + shapeSize / 2, centerY + height / 2);
                        halftoneCtx.closePath();
                        break;
                        
                    case 'line':
                        halftoneCtx.moveTo(centerX - shapeSize / 2, centerY);
                        halftoneCtx.lineTo(centerX + shapeSize / 2, centerY);
                        halftoneCtx.lineWidth = Math.max(1, shapeSize / 3);
                        halftoneCtx.stroke();
                        continue; // Skip fill for lines
                }
                
                halftoneCtx.fill();
            }
        }
    }
    
    // Draw halftone result back to main canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(halftoneCanvas, 0, 0);
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
