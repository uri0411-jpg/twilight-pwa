# Sunset Pool — fallback images

Drop high-quality CC-BY/CC0 sunset/landscape JPEGs here with the **exact** filenames listed in `credits.json`. The app picks one deterministically per spot when no real Wikimedia photo can be found.

## Required filenames (12 images)

| Filename | Theme |
|----------|-------|
| `beach-1.jpg`, `beach-2.jpg`     | Sunset over sea |
| `peak-1.jpg`, `peak-2.jpg`       | Mountain panorama at golden hour |
| `desert-1.jpg`, `desert-2.jpg`   | Negev / desert sunset (warm reds) |
| `forest-1.jpg`, `forest-2.jpg`   | Forested hill or grove at dusk |
| `urban-1.jpg`, `urban-2.jpg`     | Sunset over a cityscape (Tel Aviv, Haifa, Jerusalem) |
| `generic-1.jpg`, `generic-2.jpg` | Pure horizon sunset, no specific landmark |

## Specs

- **Dimensions**: 800×450 (16:9). Larger is fine; the browser will downscale.
- **Format**: JPEG, quality ~80.
- **Size budget**: ~80–120 KB per image. Total pool ≈ 1.2 MB.
- **License**: ONLY CC-BY 4.0, CC-BY-SA 4.0, or CC0. No "all rights reserved".

## Recommended sources

- [Wikimedia Commons — Featured Pictures of Sunsets](https://commons.wikimedia.org/wiki/Category:Featured_pictures_of_sunsets)
- [Pexels Sunset Collection](https://www.pexels.com/search/sunset/) — all CC0
- [Unsplash Sunsets](https://unsplash.com/s/photos/sunset) — all CC0

## After adding an image

Edit `credits.json` to fill in the `author`, `source` (URL to the original page), and `license` fields. The UI will display these under the photo.

## Graceful degradation

The code tolerates missing files: if (e.g.) `desert-1.jpg` is absent, the chain falls through to `generic-1.jpg` → `generic-2.jpg` → SVG cartoon. So you can ship the app with as few as 2 images and add the rest progressively.
