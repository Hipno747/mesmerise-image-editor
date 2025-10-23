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
let debounceTimer = null;
let animationFrameId = null;

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
    
    // Pre-calculate factors
    const brightnessFactor = effects.brightness * 2.55;
    const contrastFactor = (259 * (effects.contrast + 255)) / (255 * (259 - effects.contrast));
    const saturationFactor = 1 + (effects.saturation / 100);
    const grainStrength = effects.grain * 2.55;
    
    // Pre-calculate vignette values if needed
    const width = canvas.width;
    const height = canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;
    const maxDistance = Math.sqrt(centerX * centerX + centerY * centerY);
    const vignetteStrength = effects.vignette / 100;
    
    // Apply all effects in a single pass
    for (let i = 0; i < data.length; i += 4) {
        let r = data[i];
        let g = data[i + 1];
        let b = data[i + 2];
        
        // Brightness
        r += brightnessFactor;
        g += brightnessFactor;
        b += brightnessFactor;
        
        // Contrast
        r = contrastFactor * (r - 128) + 128;
        g = contrastFactor * (g - 128) + 128;
        b = contrastFactor * (b - 128) + 128;
        
        // Saturation
        const gray = 0.2989 * r + 0.5870 * g + 0.1140 * b;
        r = gray + saturationFactor * (r - gray);
        g = gray + saturationFactor * (g - gray);
        b = gray + saturationFactor * (b - gray);
        
        // Vignette (inline calculation)
        if (effects.vignette > 0) {
            const pixelIndex = i / 4;
            const x = pixelIndex % width;
            const y = Math.floor(pixelIndex / width);
            const dx = x - centerX;
            const dy = y - centerY;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const vignetteFactor = 1 - (distance / maxDistance) * vignetteStrength;
            r *= vignetteFactor;
            g *= vignetteFactor;
            b *= vignetteFactor;
        }
        
        // Grain (optimized random calculation)
        if (effects.grain > 0) {
            const noise = (Math.random() - 0.5) * grainStrength;
            r += noise;
            g += noise;
            b += noise;
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
