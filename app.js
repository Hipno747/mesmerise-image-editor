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
    grain: { name: 'Camera Grain', min: 0, max: 100, default: 0, step: 1 }
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
    effectValues[effectName] = effectDefinitions[effectName].default;
    
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
    
    // Set canvas size to match image
    canvas.width = originalImage.width;
    canvas.height = originalImage.height;
    
    // Draw original image
    ctx.drawImage(originalImage, 0, 0);
    
    // If no effects, just return
    if (activeEffects.length === 0) return;
    
    // Get image data
    let imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let data = imageData.data;
    
    // Pre-calculate values for all active effects
    const width = canvas.width;
    const height = canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;
    const maxDistance = Math.sqrt(centerX * centerX + centerY * centerY);
    
    // Apply effects in order
    for (let i = 0; i < data.length; i += 4) {
        let r = data[i];
        let g = data[i + 1];
        let b = data[i + 2];
        
        // Apply each active effect in order
        for (const effectName of activeEffects) {
            const value = effectValues[effectName] || 0;
            
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
