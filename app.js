// State
let originalImage = null;
let canvas = null;
let ctx = null;
let effects = {
    brightness: 0,
    contrast: 0,
    saturation: 0,
    vignette: 0,
    grain: 0
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    canvas = document.getElementById('imageCanvas');
    ctx = canvas.getContext('2d');
    
    // Event Listeners
    document.getElementById('imageUpload').addEventListener('change', handleImageUpload);
    document.getElementById('downloadBtn').addEventListener('click', downloadImage);
    document.getElementById('resetBtn').addEventListener('click', resetEffects);
    
    // Effect sliders
    document.getElementById('brightness').addEventListener('input', (e) => updateEffect('brightness', e.target.value));
    document.getElementById('contrast').addEventListener('input', (e) => updateEffect('contrast', e.target.value));
    document.getElementById('saturation').addEventListener('input', (e) => updateEffect('saturation', e.target.value));
    document.getElementById('vignette').addEventListener('input', (e) => updateEffect('vignette', e.target.value));
    document.getElementById('grain').addEventListener('input', (e) => updateEffect('grain', e.target.value));
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

// Update effect value
function updateEffect(effectName, value) {
    effects[effectName] = parseFloat(value);
    document.getElementById(effectName + 'Value').textContent = value;
    applyEffects();
}

// Reset all effects
function resetEffects() {
    effects = {
        brightness: 0,
        contrast: 0,
        saturation: 0,
        vignette: 0,
        grain: 0
    };
    
    document.getElementById('brightness').value = 0;
    document.getElementById('contrast').value = 0;
    document.getElementById('saturation').value = 0;
    document.getElementById('vignette').value = 0;
    document.getElementById('grain').value = 0;
    
    document.getElementById('brightnessValue').textContent = '0';
    document.getElementById('contrastValue').textContent = '0';
    document.getElementById('saturationValue').textContent = '0';
    document.getElementById('vignetteValue').textContent = '0';
    document.getElementById('grainValue').textContent = '0';
    
    if (originalImage) {
        applyEffects();
    }
}

// Apply all effects
function applyEffects() {
    if (!originalImage) return;
    
    // Set canvas size to match image
    canvas.width = originalImage.width;
    canvas.height = originalImage.height;
    
    // Draw original image
    ctx.drawImage(originalImage, 0, 0);
    
    // Get image data
    let imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let data = imageData.data;
    
    // Apply brightness, contrast, and saturation
    for (let i = 0; i < data.length; i += 4) {
        let r = data[i];
        let g = data[i + 1];
        let b = data[i + 2];
        
        // Brightness
        r += effects.brightness * 2.55;
        g += effects.brightness * 2.55;
        b += effects.brightness * 2.55;
        
        // Contrast
        const contrastFactor = (259 * (effects.contrast + 255)) / (255 * (259 - effects.contrast));
        r = contrastFactor * (r - 128) + 128;
        g = contrastFactor * (g - 128) + 128;
        b = contrastFactor * (b - 128) + 128;
        
        // Saturation
        const gray = 0.2989 * r + 0.5870 * g + 0.1140 * b;
        const saturationFactor = 1 + (effects.saturation / 100);
        r = gray + saturationFactor * (r - gray);
        g = gray + saturationFactor * (g - gray);
        b = gray + saturationFactor * (b - gray);
        
        // Clamp values
        data[i] = Math.max(0, Math.min(255, r));
        data[i + 1] = Math.max(0, Math.min(255, g));
        data[i + 2] = Math.max(0, Math.min(255, b));
    }
    
    // Put modified image data back
    ctx.putImageData(imageData, 0, 0);
    
    // Apply vignette effect
    if (effects.vignette > 0) {
        applyVignette();
    }
    
    // Apply grain effect
    if (effects.grain > 0) {
        applyGrain();
    }
}

// Apply vignette effect
function applyVignette() {
    const width = canvas.width;
    const height = canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;
    const maxDistance = Math.sqrt(centerX * centerX + centerY * centerY);
    
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const dx = x - centerX;
            const dy = y - centerY;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const vignetteFactor = 1 - (distance / maxDistance) * (effects.vignette / 100);
            
            const i = (y * width + x) * 4;
            data[i] *= vignetteFactor;
            data[i + 1] *= vignetteFactor;
            data[i + 2] *= vignetteFactor;
        }
    }
    
    ctx.putImageData(imageData, 0, 0);
}

// Apply camera grain effect
function applyGrain() {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const grainStrength = effects.grain * 2.55;
    
    for (let i = 0; i < data.length; i += 4) {
        const noise = (Math.random() - 0.5) * grainStrength;
        data[i] = Math.max(0, Math.min(255, data[i] + noise));
        data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise));
        data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise));
    }
    
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
