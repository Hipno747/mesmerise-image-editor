# Mesmerise Image Editor

An intuitive and easy-to-use web-based image editor with real-time photo effects.

## Features

- **Image Import**: Upload any image from your device
- **Real-time Preview**: See changes instantly on the left panel
- **Adjustable Effects**:
  - 🔆 **Brightness**: Adjust image brightness (-100 to +100)
  - 🎨 **Contrast**: Enhance or reduce contrast (-100 to +100)
  - 🌈 **Saturation**: Control color intensity (-100 to +100)
  - 🟤 **Sepia**: Classic warm sepia toning with adjustable intensity
  - 🎨 **Color Tint**: Apply a color tint (any RGB) with adjustable mix
  - 🔧 **Sharpen**: Image sharpening via a configurable convolution-based filter
  - 🎭 **Vignette**: Add artistic darkening at the edges (0 to 100)
  - 📷 **Camera Grain**: Add film-like grain effect (0 to 100)
  - 🔍 **Resolution**: Change image resolution (10% to 100%)
  - 🎯 **Halftone**: Classic halftone effect with customizable shapes (circles, squares, triangles, lines) and sizes (small, medium, large)
  - ✂️ **Interactive Crop Overlay**: Start an interactive crop mode with draggable edge bars. Apply will zoom the cropped area to fill the canvas only when the crop preserves the original aspect ratio; otherwise the cropped region replaces the canvas at its natural size. Cancel discards the crop.
- **Scrollable Effects Panel**: Easily navigate through all effects
- **Download**: Save your edited image
- **Reset**: Quickly reset all effects to default

## How to Use

1. Open `index.html` in a web browser
2. Click "Choose Image" to upload an image
3. Use the sliders in the right panel to adjust effects
4. Click "Download" to save your edited image
5. Click "Reset" to remove all effects
6. Crop: click "Start Crop" (top header) to enable draggable crop bars, then drag edges and click "Apply Crop" to confirm or "Cancel Crop" to discard.

## Technology

- Pure HTML5, CSS3, and JavaScript
- Canvas API for image processing
- No external dependencies required

## Browser Support

Works best in modern browsers:
- Chrome 60+
- Firefox 55+
- Safari 11+
- Edge 79+

MADE WITH AI
