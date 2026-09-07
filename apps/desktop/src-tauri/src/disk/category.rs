//! File categories, by extension. Eight buckets the UI colours and sums:
//! the ids are stable (they go through IPC and into snapshots) and the
//! labels live in the frontend (`packages/feature-disk/src/api/types.ts`).

pub const CATS: usize = 8;

pub const CAT_OTHER: u8 = 0;
pub const CAT_VIDEO: u8 = 1;
pub const CAT_AUDIO: u8 = 2;
pub const CAT_IMAGE: u8 = 3;
pub const CAT_DOCUMENT: u8 = 4;
pub const CAT_DEVELOPER: u8 = 5;
pub const CAT_ARCHIVE: u8 = 6;
pub const CAT_APP: u8 = 7;

/// Lower-cased extension (no dot) → category. Unknown → other.
pub fn category_of_ext(ext: &str) -> u8 {
    match ext {
        "mp4" | "mkv" | "mov" | "avi" | "webm" | "m4v" | "wmv" | "flv" | "mpg" | "mpeg"
        | "m2ts" | "mts" | "3gp" | "vob" | "ogv" | "divx" | "rm" | "rmvb" | "asf" => CAT_VIDEO,
        "mp3" | "wav" | "flac" | "m4a" | "aac" | "ogg" | "opus" | "wma" | "aiff" | "aif" | "alac"
        | "ape" | "mid" | "midi" | "amr" | "caf" | "m4b" | "pcm" => CAT_AUDIO,
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "heic" | "heif" | "bmp" | "tif" | "tiff" | "svg"
        | "raw" | "cr2" | "cr3" | "nef" | "arw" | "dng" | "orf" | "rw2" | "psd" | "ai" | "ico"
        | "icns" | "avif" | "jxl" | "eps" | "xcf" | "kra" | "sketch" | "fig" => CAT_IMAGE,
        "pdf" | "doc" | "docx" | "xls" | "xlsx" | "ppt" | "pptx" | "txt" | "md" | "rtf" | "odt"
        | "ods" | "odp" | "csv" | "tsv" | "epub" | "mobi" | "pages" | "numbers" | "key" | "tex"
        | "one" | "onetoc2" | "xps" | "djvu" | "chm" | "log" | "srt" | "vtt" | "ass" => CAT_DOCUMENT,
        "js" | "mjs" | "cjs" | "ts" | "tsx" | "jsx" | "json" | "jsonc" | "map" | "rs" | "go"
        | "py" | "pyc" | "pyd" | "java" | "class" | "jar" | "kt" | "kts" | "c" | "cc" | "cpp"
        | "cxx" | "h" | "hh" | "hpp" | "cs" | "fs" | "vb" | "rb" | "php" | "swift" | "m" | "mm"
        | "html" | "htm" | "css" | "scss" | "sass" | "less" | "vue" | "svelte" | "astro" | "wasm"
        | "o" | "obj" | "a" | "lib" | "pdb" | "ilk" | "exp" | "rlib" | "rmeta" | "d" | "lock"
        | "toml" | "yaml" | "yml" | "xml" | "ini" | "cfg" | "conf" | "sh" | "bash" | "zsh" | "ps1"
        | "bat" | "cmd" | "sql" | "db" | "sqlite" | "sqlite3" | "graphql" | "proto" | "wat"
        | "node" | "tgz" | "whl" | "egg" | "nupkg" | "crate" | "gem" | "pem" | "csproj" | "sln"
        | "vcxproj" | "xcodeproj" | "gradle" | "pack" | "idx" | "rev" | "dart" | "ex" | "exs"
        | "erl" | "hs" | "ml" | "scala" | "clj" | "lua" | "r" | "jl" | "nim" | "zig" | "v" => CAT_DEVELOPER,
        "zip" | "rar" | "7z" | "tar" | "gz" | "bz2" | "xz" | "zst" | "lz4" | "lzma" | "cab" | "arj"
        | "z" | "tbz2" | "txz" | "iso" | "img" | "dmg" | "vhd" | "vhdx" | "vmdk" | "vdi" | "qcow2"
        | "ova" | "ovf" | "wim" | "esd" | "bin" | "cue" | "nrg" | "bak" | "backup" => CAT_ARCHIVE,
        "exe" | "msi" | "msix" | "appx" | "appxbundle" | "msixbundle" | "dll" | "sys" | "drv"
        | "ocx" | "cpl" | "scr" | "com" | "app" | "pkg" | "apk" | "ipa" | "deb" | "rpm" | "appimage"
        | "snap" | "flatpak" | "efi" | "dylib" | "so" | "kext" | "framework" | "mui" | "cat"
        | "inf" | "manifest" | "lnk" | "url" | "ttf" | "otf" | "woff" | "woff2" | "fon" => CAT_APP,
        _ => CAT_OTHER,
    }
}

/// Category for a file name (extension after the last dot, case-insensitive).
/// Dotfiles (`.gitignore`) have no extension and land in "other".
pub fn category_of_name(name: &str) -> u8 {
    let Some(dot) = name.rfind('.') else {
        return CAT_OTHER;
    };
    if dot == 0 || dot + 1 >= name.len() {
        return CAT_OTHER;
    }
    let ext = &name[dot + 1..];
    if ext.len() > 12 || !ext.is_ascii() {
        return CAT_OTHER;
    }
    let mut buf = [0u8; 12];
    for (i, b) in ext.bytes().enumerate() {
        buf[i] = b.to_ascii_lowercase();
    }
    category_of_ext(std::str::from_utf8(&buf[..ext.len()]).unwrap_or(""))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_common_extensions() {
        assert_eq!(category_of_name("movie.MP4"), CAT_VIDEO);
        assert_eq!(category_of_name("song.flac"), CAT_AUDIO);
        assert_eq!(category_of_name("photo.HEIC"), CAT_IMAGE);
        assert_eq!(category_of_name("report.pdf"), CAT_DOCUMENT);
        assert_eq!(category_of_name("index.tsx"), CAT_DEVELOPER);
        assert_eq!(category_of_name("backup.tar.gz"), CAT_ARCHIVE);
        assert_eq!(category_of_name("setup.exe"), CAT_APP);
        assert_eq!(category_of_name("README"), CAT_OTHER);
        assert_eq!(category_of_name(".gitignore"), CAT_OTHER);
        assert_eq!(category_of_name("weird."), CAT_OTHER);
    }
}
