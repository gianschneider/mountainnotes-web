# App icon and splash

Sources of the app icon (colours of the "Alpingrün" theme). The PWA icons in `src/assets/icon/icon-{180,192,512}.png` were scaled from the 1024 px iOS icon with `sips -z`.

- `icon.svg` → `AppIcon.appiconset/AppIcon-512@2x.png` (1024 × 1024, no alpha channel)
- `splash.svg` → `Splash.imageset/splash-2732x2732*.png` (2732 × 2732)

Render with headless Chrome, then remove the alpha channel (the App Store rejects icons with alpha):

```bash
chrome --headless=new --window-size=1024,1024 --screenshot=icon-raw.png icon.html   # icon.html shows icon.svg at 1024 px
sips -s format jpeg icon-raw.png --out icon.jpg && sips -s format png icon.jpg --out AppIcon-512@2x.png
```
