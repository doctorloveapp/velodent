use std::{
    collections::HashMap,
    env, fs,
    path::{Path, PathBuf},
};

fn main() {
    embed_production_environment();
    generate_frontend_assets();
    tauri_build::build();
}

fn embed_production_environment() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".to_owned()));
    let env_path = manifest_dir.join("..").join(".env");
    println!("cargo:rerun-if-changed={}", env_path.display());

    let values = read_dotenv_values(&env_path);
    for (source_key, build_key) in [
        ("GOOGLE_CLIENT_ID", "VELODENT_EMBEDDED_GOOGLE_CLIENT_ID"),
        ("GOOGLE_CLIENT_SECRET", "VELODENT_EMBEDDED_GOOGLE_CLIENT_SECRET"),
        ("GOOGLE_REDIRECT_URI", "VELODENT_EMBEDDED_GOOGLE_REDIRECT_URI"),
        ("RESEND_API_KEY", "VELODENT_EMBEDDED_RESEND_API_KEY"),
        ("RESEND_FROM_EMAIL", "VELODENT_EMBEDDED_RESEND_FROM_EMAIL"),
        ("SUMUP_API_KEY", "VELODENT_EMBEDDED_SUMUP_API_KEY"),
        ("SUMUP_MERCHANT_CODE", "VELODENT_EMBEDDED_SUMUP_MERCHANT_CODE"),
    ] {
        let value = values
            .get(source_key)
            .cloned()
            .or_else(|| env::var(source_key).ok())
            .unwrap_or_default();
        let value = value.trim();
        if !value.is_empty() {
            println!("cargo:rustc-env={build_key}={value}");
        }
    }
}

fn read_dotenv_values(path: &Path) -> HashMap<String, String> {
    let Ok(contents) = fs::read_to_string(path) else {
        return HashMap::new();
    };
    let mut values = HashMap::new();
    for raw_line in contents.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((key, raw_value)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim();
        if key.is_empty() {
            continue;
        }
        values.insert(key.to_owned(), unquote_env_value(raw_value.trim()));
    }
    values
}

fn unquote_env_value(value: &str) -> String {
    let bytes = value.as_bytes();
    if bytes.len() >= 2
        && ((bytes[0] == b'"' && bytes[bytes.len() - 1] == b'"')
            || (bytes[0] == b'\'' && bytes[bytes.len() - 1] == b'\''))
    {
        value[1..value.len() - 1].to_owned()
    } else {
        value.to_owned()
    }
}

fn generate_frontend_assets() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".to_owned()));
    let dist_dir = manifest_dir.join("..").join("dist");
    println!("cargo:rerun-if-changed={}", dist_dir.display());

    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR missing"));
    let generated_path = out_dir.join("frontend_assets.rs");
    let mut output = String::from(
        "pub struct FrontendAsset {\n    pub path: &'static str,\n    pub content_type: &'static str,\n    pub bytes: &'static [u8],\n}\n\npub static FRONTEND_ASSETS: &[FrontendAsset] = &[\n",
    );

    if dist_dir.is_dir() {
        let mut files = Vec::new();
        collect_frontend_files(&dist_dir, &dist_dir, &mut files);
        files.sort();
        for relative in files {
            let absolute = dist_dir.join(&relative);
            println!("cargo:rerun-if-changed={}", absolute.display());
            let public_path = format!("/{}", relative.replace('\\', "/"));
            let content_type = content_type_for(&public_path);
            output.push_str(&format!(
                "    FrontendAsset {{ path: {:?}, content_type: {:?}, bytes: include_bytes!(r#\"{}\"#) }},\n",
                public_path,
                content_type,
                absolute.display()
            ));
        }
    }

    output.push_str("];\n");
    fs::write(generated_path, output).expect("unable to write generated frontend asset map");
}

fn collect_frontend_files(root: &Path, current: &Path, files: &mut Vec<String>) {
    let Ok(entries) = fs::read_dir(current) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();
        if path.is_dir() {
            if file_name.starts_with("tesseract") {
                continue;
            }
            collect_frontend_files(root, &path, files);
            continue;
        }
        if !path.is_file() {
            continue;
        }
        let Ok(relative) = path.strip_prefix(root) else {
            continue;
        };
        files.push(relative.to_string_lossy().replace('\\', "/"));
    }
}

fn content_type_for(path: &str) -> &'static str {
    if path.ends_with(".html") {
        "text/html; charset=utf-8"
    } else if path.ends_with(".js") {
        "text/javascript; charset=utf-8"
    } else if path.ends_with(".css") {
        "text/css; charset=utf-8"
    } else if path.ends_with(".json") || path.ends_with(".webmanifest") {
        "application/manifest+json; charset=utf-8"
    } else if path.ends_with(".png") {
        "image/png"
    } else if path.ends_with(".svg") {
        "image/svg+xml"
    } else {
        "application/octet-stream"
    }
}
