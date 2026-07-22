# Native Packaging Research

Researched on 2026-07-22 against official docs and official source repositories only.

## Executive summary

The strongest current fit for this app shape is [`cargo-packager`](https://docs.crabnebula.dev/packager/configuration/): it is explicitly designed to package multiple binaries plus arbitrary resources, and its supported formats line up with macOS `.dmg`, Windows NSIS `.exe`, Linux `.deb`, Linux `.AppImage`, and Linux `pacman` packages. Its main gaps for this repo are that its Windows WiX output is `.msi`, not a Burn-style `.exe`, and its documented Linux formats do not include `.rpm`. ([CrabNebula config docs](https://docs.crabnebula.dev/packager/configuration/))

If the requirement is strictly "real macOS `.dmg` and Windows `.exe` installers" while also keeping GitHub-hosted runners, the cleanest split is:

- macOS: `cargo-packager` `.dmg` or Apple-native `hdiutil` around a signed `.app`
- Windows: `cargo-packager` NSIS `.exe`, standalone NSIS, or Inno Setup
- Linux: `cargo-packager` `.deb` and `.AppImage`; add native RPM packaging separately if `.rpm` is mandatory

## Best-fit cross-platform option

### `cargo-packager`

Why it fits this repo:

- It supports multiple packaged binaries via `binaries`. ([CrabNebula config docs](https://docs.crabnebula.dev/packager/configuration/))
- It supports additional executables via `externalBinaries`. That is the closest documented fit for shipping a bundled Node runtime alongside the five Rust binaries. ([CrabNebula config docs](https://docs.crabnebula.dev/packager/configuration/))
- It supports arbitrary files and directories via `resources`, with explicit `src` to `target` mapping inside the installed package. That matches `server.mjs`, `dist/`, and minimal `node_modules/`. ([CrabNebula config docs](https://docs.crabnebula.dev/packager/configuration/))
- Its documented package formats are `.app`, `.dmg`, WiX `.msi`, NSIS `.exe`, `.deb`, `.AppImage`, and `pacman`. ([CrabNebula config docs](https://docs.crabnebula.dev/packager/configuration/))
- It exposes macOS signing and notarization inputs directly through `macos.signingIdentity` and `macos.providerShortName`. ([CrabNebula config docs](https://docs.crabnebula.dev/packager/configuration/))

Important limitations:

- There is no documented `.rpm` format in the current package-format list. ([CrabNebula config docs](https://docs.crabnebula.dev/packager/configuration/))
- The WiX path is documented as `.msi`; if you need a Windows bootstrapper `.exe`, that is a separate WiX Burn authoring path. ([CrabNebula config docs](https://docs.crabnebula.dev/packager/configuration/), [WiX Burn bundles](https://docs.firegiant.com/wix/tools/burn/))

## macOS

### Apple-native options

Apple's packaging guidance explicitly covers three distribution outputs: zip archive, disk image, and installer package. The same guidance points to `hdiutil` for disk images and to `pkgbuild`, `productbuild`, and `productsign` for installer packages. ([Packaging Mac software for distribution](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution))

Implications:

- A `.dmg` is a real Apple-native distribution artifact, but it is still fundamentally a container around your signed app payload.
- If you need a guided installer instead of drag-to-Applications distribution, Apple-native `.pkg` is the first-party installer format rather than `.dmg`. ([Packaging Mac software for distribution](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution))

### Signing and notarization boundary

Apple's notarization docs require Developer ID-signed software before distribution, and Apple notes that notarization fails if the bundle is modified after signing. Apple also moved the notarization workflow to `notarytool`. ([Notarizing macOS software before distribution](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution), [Customizing the notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow), [Upcoming Apple notarization requirement change](https://developer.apple.com/news/upcoming-requirements/), [Resolving common notarization issues](https://developer.apple.com/documentation/security/resolving-common-notarization-issues))

For this app, that means:

- every shipped executable payload inside the `.app` bundle has to be in its final location before signing and notarization
- if a Node runtime is bundled, treat it as notarization-relevant executable payload, not as a casual resource

### GitHub-hosted runner support

GitHub-hosted runners are available for macOS, and current macOS 15 images include Node.js 22.23.1, Cargo/Rust 1.97.0, and Xcode Command Line Tools 16.4.0. GitHub also documents that additional software can be installed in the workflow, and that macOS runners have passwordless `sudo`. ([GitHub-hosted runners overview](https://docs.github.com/en/actions/concepts/runners/github-hosted-runners), [GitHub-hosted runners reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), [macOS 15 runner image](https://github.com/actions/runner-images/blob/main/images/macos/macos-15-Readme.md), [Customizing GitHub-hosted runners](https://docs.github.com/en/actions/how-tos/manage-runners/github-hosted-runners/customize-runners))

One runner nuance matters for Apple workflows: GitHub documents that arm64 macOS runners do not have a static UDID, while Intel macOS runners do. ([GitHub-hosted runners reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners))

## Windows

### Option 1: NSIS

NSIS is an official, scriptable Windows installer system that compiles `.nsi` scripts into installer executables. Its `[Files]` section supports installing arbitrary files, directories, and wildcard-matched trees into target directories, so it is a straightforward fit for the app's mixed Rust plus Node payload. ([NSIS manual](https://nsis.sourceforge.io/Docs/Chapter3.html), [[Files] section](https://jrsoftware.org/ishelp/topic_filessection.htm))

This can be reached in two ways:

- via `cargo-packager` NSIS output
- via standalone NSIS authoring if you need tighter control over install layout or custom actions

### Option 2: Inno Setup

Inno Setup is another mature official Windows `.exe` installer path. Its `[Files]` section supports arbitrary file trees and wildcards, and its `[Setup]: SignTool` directive can sign Setup, the uninstaller, and optionally original source files. ([Inno Setup help](https://jrsoftware.org/ishelp/), [[Files] section](https://jrsoftware.org/ishelp/topic_filessection.htm), [[Setup]: SignTool](https://jrsoftware.org/ishelp/topic_setup_signtool.htm), [[Setup]: SignedUninstaller](https://jrsoftware.org/ishelp/topic_setup_signeduninstaller.htm))

Inno is attractive if the only hard Windows requirement is "ship a signed `.exe` installer for an arbitrary directory tree."

### Option 3: WiX Burn

If you need a bootstrapper-style `.exe` that chains packages, WiX Burn is the official WiX path. Burn bundles can chain `ExePackage`, `MsiPackage`, and other package types, and `Payload` elements let you carry embedded or external payload files. ([WiX Burn bundles](https://docs.firegiant.com/wix/tools/burn/), [ExePackage element](https://docs.firegiant.com/wix/schema/wxs/exepackage/), [MsiPackage element](https://docs.firegiant.com/wix3/xsd/wix/msipackage/), [Payload element](https://docs.firegiant.com/wix3/xsd/wix/payload/))

Signing boundary is stricter than a plain `.exe`:

- WiX documents separate signing steps for the Burn engine and the final bundle `.exe`
- MSI signing is also a separate concern

([Signing packages and bundles](https://docs.firegiant.com/wix/tools/signing/))

### Windows signing boundary

Microsoft's official signing tool is `signtool`, provided by the Windows SDK. Microsoft also calls out current digest requirements for `/fd` and `/td`, with SHA-256 recommended. ([Microsoft SignTool docs](https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool))

Practical boundary:

- sign the outer installer at minimum
- if you use WiX Burn, follow WiX's separate engine-plus-bundle signing flow
- if you use Inno Setup, its built-in signing hooks can sign both installer and uninstaller

### GitHub-hosted runner support

Current Windows Server 2025 GitHub-hosted runner images include Node 22.23.1, Cargo/Rust 1.97.0, Inno Setup 6.7.1, and WiX Toolset 3.14.1. GitHub documents that Windows runners run as administrators with UAC disabled, and that workflows may install extra software if needed. ([Windows 2025 runner image](https://github.com/actions/runner-images/blob/main/images/windows/Windows2025-VS2026-Readme.md), [GitHub-hosted runners reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), [Customizing GitHub-hosted runners](https://docs.github.com/en/actions/how-tos/manage-runners/github-hosted-runners/customize-runners))

## Linux

### `.AppImage`

AppImage is the most direct Linux answer for "ship an arbitrary app directory as one downloadable artifact." Official AppImage docs define the input as an `AppDir`, then convert that into an AppImage with `appimagetool`. Official docs also cover embedded signatures, using `appimagetool --sign` with `gpg` or `gpg2`. ([AppImage packaging introduction](https://docs.appimage.org/packaging-guide/introduction.html), [Signing AppImages](https://docs.appimage.org/packaging-guide/optional/signatures.html))

This is a strong fit when:

- you want a single downloadable file
- you do not want distro-specific dependency on Debian or RPM packaging policy

### `.deb`

Debian's official policy defines `.deb` as the required Debian binary package format and documents that a `.deb` contains both install files and metadata files. `cargo-packager` explicitly supports `.deb` and custom file mapping into the package. ([Debian Policy: binary packages](https://www.debian.org/doc/debian-policy/ch-binary.html), [CrabNebula config docs](https://docs.crabnebula.dev/packager/configuration/))

This is the best Linux package-manager fit if Ubuntu and Debian are first-class targets.

### `.rpm`

RPM is an official package format and toolchain, and `rpmsign` is the official signing path for OpenPGP signatures on RPM packages. However, `.rpm` is not in `cargo-packager`'s documented current format list, so RPM support would be a second packaging lane rather than part of the same documented cross-platform lane. ([RPM home](https://rpm.org/), [RPM spec format](https://rpm.org/docs/4.20.x/manual/spec.html), [rpmsign](https://rpm.org/docs/6.0.x/man/rpmsign.1), [Signatures and digests](https://rpm.org/docs/6.1.x/manual/signatures_digests.html), [CrabNebula config docs](https://docs.crabnebula.dev/packager/configuration/))

### GitHub-hosted runner support

Current Ubuntu 24.04 GitHub-hosted runners include Node.js 22.23.1, Cargo/Rust 1.97.0, `dpkg`, `dpkg-dev`, and `fakeroot`. GitHub documents that Linux runners have passwordless `sudo` and that extra software can be installed during the workflow, which covers tools such as `appimagetool` or any RPM build dependencies that are not preinstalled. ([Ubuntu 24.04 runner image](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md), [GitHub-hosted runners reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), [Customizing GitHub-hosted runners](https://docs.github.com/en/actions/how-tos/manage-runners/github-hosted-runners/customize-runners))

## Recommendation

If the goal is the smallest credible packaging system change:

1. Standardize on `cargo-packager` for macOS `.dmg`, Windows NSIS `.exe`, Linux `.deb`, and Linux `.AppImage`.
2. Treat the five Rust binaries as `binaries`.
3. Treat `server.mjs`, `dist/`, and minimal `node_modules/` as `resources`.
4. Treat a bundled Node runtime, if required, as an executable payload rather than a passive asset.
5. Add a separate native RPM lane only if `.rpm` is a release requirement.

If Windows needs a richer installer UX than NSIS through `cargo-packager`, the next best split is:

1. keep `cargo-packager` for macOS and Linux
2. author Windows separately in Inno Setup or WiX Burn

That split preserves one cross-platform packager for most outputs while acknowledging that "real Windows `.exe` bootstrapper" and "Linux `.rpm`" are outside the currently documented `cargo-packager` surface.

## Sources

- [CrabNebula `cargo-packager` configuration docs](https://docs.crabnebula.dev/packager/configuration/)
- [Apple: Packaging Mac software for distribution](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution)
- [Apple: Notarizing macOS software before distribution](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
- [Apple: Customizing the notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)
- [Apple: Resolving common notarization issues](https://developer.apple.com/documentation/security/resolving-common-notarization-issues)
- [Apple: Upcoming notarization requirements](https://developer.apple.com/news/upcoming-requirements/)
- [GitHub-hosted runners overview](https://docs.github.com/en/actions/concepts/runners/github-hosted-runners)
- [GitHub-hosted runners reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
- [GitHub: customizing GitHub-hosted runners](https://docs.github.com/en/actions/how-tos/manage-runners/github-hosted-runners/customize-runners)
- [GitHub `actions/runner-images` macOS 15 image](https://github.com/actions/runner-images/blob/main/images/macos/macos-15-Readme.md)
- [GitHub `actions/runner-images` Windows 2025 image](https://github.com/actions/runner-images/blob/main/images/windows/Windows2025-VS2026-Readme.md)
- [GitHub `actions/runner-images` Ubuntu 24.04 image](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md)
- [NSIS users manual](https://nsis.sourceforge.io/Docs/)
- [Inno Setup help](https://jrsoftware.org/ishelp/)
- [Inno Setup `[Files]` section](https://jrsoftware.org/ishelp/topic_filessection.htm)
- [Inno Setup `[Setup]: SignTool`](https://jrsoftware.org/ishelp/topic_setup_signtool.htm)
- [Inno Setup `[Setup]: SignedUninstaller`](https://jrsoftware.org/ishelp/topic_setup_signeduninstaller.htm)
- [WiX Burn bundles](https://docs.firegiant.com/wix/tools/burn/)
- [WiX signing packages and bundles](https://docs.firegiant.com/wix/tools/signing/)
- [WiX `ExePackage`](https://docs.firegiant.com/wix/schema/wxs/exepackage/)
- [WiX `MsiPackage`](https://docs.firegiant.com/wix3/xsd/wix/msipackage/)
- [WiX `Payload`](https://docs.firegiant.com/wix3/xsd/wix/payload/)
- [Microsoft SignTool](https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool)
- [AppImage packaging introduction](https://docs.appimage.org/packaging-guide/introduction.html)
- [AppImage signatures](https://docs.appimage.org/packaging-guide/optional/signatures.html)
- [Debian policy: binary packages](https://www.debian.org/doc/debian-policy/ch-binary.html)
- [RPM home](https://rpm.org/)
- [RPM spec format](https://rpm.org/docs/4.20.x/manual/spec.html)
- [RPM `rpmsign`](https://rpm.org/docs/6.0.x/man/rpmsign.1)
- [RPM signatures and digests](https://rpm.org/docs/6.1.x/manual/signatures_digests.html)
