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
  - ✂️ **Interactive Crop Overlay**: Start an interactive crop mode with draggable edge bars. Apply will zoom the cropped area to fill the canvas only when the crop preserves the original aspect ratio; otherwise the cropped region replaces the canvas at its natural size. Cancel discards the crop.
  - 🧩 **Layer System**: Add, reorder, select, rename, and remove image layers. Each layer can have its own stack of effects and positioning; the editor picks the largest layer as the base (canvas size). Non-base layers can be moved and resized within the base layer bounds.
  - 📐 **Resize (Layer Resample)**: Resize individual layers (resample) to new dimensions. The UI offers a Resize Mode that previews changes and lets you accept or cancel the resample. Resizing an individual layer updates its internal pixel data.
- **Scrollable Effects Panel**: Easily navigate through all effects
- **Download**: Save your edited image
- **Reset**: Quickly reset all effects to default

## How to Use

1. Open `index.html` in a web browser
2. Use the Layers panel (left) to add images as layers. Click "Add Layer" and choose an image. Layers appear in the list where you can select, reorder (drag), make a layer the base (index 0), or remove a layer.
3. Select the layer you want to edit. Effects you add from the right panel are applied to the currently selected layer and listed as individual effect instances. You can add multiple instances and remove them as needed.
4. Move and resize non-base layers directly on the canvas using the selection overlay. The selection overlay shows handles for resizing and allows dragging to reposition.
5. Resize a layer (resample): when a layer is selected, use the "Resize Layer" control in the header to enter Resize Mode. Adjust the overlay to the desired output size, then click "Apply Resize" to resample the layer's pixel data or "Cancel Resize" to discard.
6. Crop the composition (or a specific layer): click "Start Crop" to enable interactive crop bars. Drag edges or corners to select a crop region. Click "Apply Crop" to commit the crop (applies to the target layer or the composite as described in the UI) or "Cancel Crop" to discard.
7. Use the sliders in the right panel to adjust effects for the selected layer
8. Click "Download" to save your edited image
9. Click "Reset" to remove all layers and effects

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
