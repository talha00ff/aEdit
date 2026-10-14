# aEdit by talha0ff

A free Adobe Premiere Pro panel for fashion / look-book editors: cut long gimbal takes into poses,
put beat markers on your music, auto-edit your looks to the beat and batch-export every finished video.

| Tab | What it does |
|---|---|
| **1 · Pose Cut** *(beta)* | Splits one long take into usable poses: keeps moments where the subject is centred, sharp and the camera moves smoothly. |
| **2 · Beat Marker** | Detects BPM and beats of the selected music clip (follows tempo changes), finds beat 1 and writes coloured markers on the clip. Toggle beats 1–4 on/off, shift the downbeat, ÷2 / ×2 tempo. |
| **3 · Beat Edit** | Lays the selected look clips onto the music's beat markers: random speed range, cuts every 2/4/6 markers, cuts on strong beats, alternates close/wide shots, uses every clip at least once, fills the song from start to end. |
| **4 · Export** | Every block of back-to-back clips on a track becomes its own video and is queued in Adobe Media Encoder (`brand_1`, `brand_2`, …). |

> [!WARNING]
> **Pose Cut is still in development (beta).** It can miss good poses or keep shaky moments.
> For now I recommend picking your poses manually and using aEdit from **Beat Marker** onward –
> Beat Marker, Beat Edit and Export are ready to use. Feedback on Pose Cut is very welcome via [Issues](../../issues).

## Install – Windows

**Option A – zip (simplest)**
1. Download `aEdit_Setup.zip` from [Releases](../../releases) and extract it.
2. Close Premiere Pro, double-click `INSTALL.bat`.
3. Premiere Pro → *Window → Extensions → aEdit*.

The installer enables unsigned CEP panels for your user (`PlayerDebugMode`) and downloads ffmpeg (~80 MB) once.

**Option B – signed .zxp**
Install the `.zxp` from Releases with the free [ZXP Installer](https://aescripts.com/learn/zxp-installer/).
On first start the panel offers to download ffmpeg. If the panel stays blank, start Premiere once as administrator
(known Adobe issue) or use option A.

## Install – macOS

1. Download `aEdit_Setup.zip` from [Releases](../../releases) and double-click it to extract.
2. Quit Premiere Pro. **Right-click** `INSTALL.command` → **Open** → **Open**
   (macOS asks once because the script isn't from the App Store).
3. Premiere Pro → *Window → Extensions → aEdit*.

The installer enables unsigned CEP panels and downloads the right ffmpeg for Apple Silicon or Intel
into `~/Library/Application Support/aEdit`. An ffmpeg installed with Homebrew is used automatically.

Requirements: Windows 10/11 or macOS 11+, Premiere Pro 2020 or newer.

## Workflow

Pose Cut each long take → select the music clip → **Beat Marker** → select the look clips → **Beat Edit** → delete the empty takes between your edits → **Export**.

## Build a signed ZXP yourself

Windows: run `BUILD_ZXP.bat` (downloads Adobe's ZXPSignCmd, creates a self-signed certificate once, signs `aEdit/` into `dist/`).
Never commit `cert/` or your password.

## Credits

- Uses [FFmpeg](https://ffmpeg.org) (downloaded at install time, not bundled; FFmpeg is licensed under LGPL/GPL).
- Beat tracking based on the dynamic-programming method by D. Ellis (2007).

## Support

aEdit is free. If it saves you time, you can support its development:
[GitHub Sponsors](https://github.com/sponsors/talha00ff) · [Patreon](https://www.patreon.com/talha0ff)

## License

[MIT](LICENSE) © talha0ff
