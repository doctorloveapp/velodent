use std::{
    path::{Path, PathBuf},
    sync::OnceLock,
};

static APP_DATA_DIR: OnceLock<PathBuf> = OnceLock::new();

pub fn initialize(app_data_dir: PathBuf) -> Result<(), String> {
    if !app_data_dir.is_absolute() {
        return Err(format!(
            "VeloDent app_data_dir non assoluta: {}",
            app_data_dir.display()
        ));
    }
    std::fs::create_dir_all(&app_data_dir).map_err(|error| {
        format!(
            "impossibile creare la cartella dati VeloDent '{}': {error}",
            app_data_dir.display()
        )
    })?;
    let _ = APP_DATA_DIR.set(app_data_dir);
    Ok(())
}

pub fn app_data_dir() -> Result<PathBuf, String> {
    if let Some(path) = APP_DATA_DIR.get() {
        return Ok(path.clone());
    }

    #[cfg(test)]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            return Ok(PathBuf::from(appdata).join("VeloDent"));
        }
    }

    Err("cartella dati VeloDent non inizializzata dal PathResolver Tauri".to_owned())
}

pub fn database_path() -> Result<PathBuf, String> {
    Ok(app_data_dir()?.join("data").join("velodent.sqlite"))
}

pub fn patients_root() -> Result<PathBuf, String> {
    Ok(app_data_dir()?.join("patients"))
}

pub fn ensure_parent_dir(path: &Path) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("percorso senza cartella padre: {}", path.display()))?;
    std::fs::create_dir_all(parent).map_err(|error| {
        format!(
            "impossibile creare la cartella '{}': {error}",
            parent.display()
        )
    })
}
