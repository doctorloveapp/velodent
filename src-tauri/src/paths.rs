use std::{
    path::{Path, PathBuf},
    sync::OnceLock,
};

static APP_DATA_DIR: OnceLock<PathBuf> = OnceLock::new();

pub fn initialize(app_data_dir: PathBuf, legacy_app_data_dir: Option<PathBuf>) -> Result<(), String> {
    if !app_data_dir.is_absolute() {
        return Err(format!(
            "VeloDent app_data_dir non assoluta: {}",
            app_data_dir.display()
        ));
    }
    migrate_legacy_app_data_dir(&app_data_dir, legacy_app_data_dir.as_ref())?;
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

fn migrate_legacy_app_data_dir(
    app_data_dir: &Path,
    legacy_app_data_dir: Option<&PathBuf>,
) -> Result<(), String> {
    let Some(legacy) = legacy_app_data_dir else {
        return Ok(());
    };
    if legacy == app_data_dir || !legacy.exists() || app_data_dir.exists() {
        return Ok(());
    }
    if let Some(parent) = app_data_dir.parent() {
        std::fs::create_dir_all(parent).map_err(|error| {
            format!(
                "impossibile creare la cartella dati padre '{}': {error}",
                parent.display()
            )
        })?;
    }
    match std::fs::rename(legacy, app_data_dir) {
        Ok(()) => Ok(()),
        Err(_) => copy_dir_recursive(legacy, app_data_dir),
    }
}

fn copy_dir_recursive(source: &Path, destination: &Path) -> Result<(), String> {
    std::fs::create_dir_all(destination).map_err(|error| {
        format!(
            "impossibile creare la cartella dati '{}': {error}",
            destination.display()
        )
    })?;
    for entry in std::fs::read_dir(source).map_err(|error| {
        format!(
            "impossibile leggere la cartella dati legacy '{}': {error}",
            source.display()
        )
    })? {
        let entry = entry.map_err(|error| error.to_string())?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        if source_path.is_dir() {
            copy_dir_recursive(&source_path, &destination_path)?;
        } else if source_path.is_file() {
            std::fs::copy(&source_path, &destination_path).map_err(|error| {
                format!(
                    "impossibile migrare il file dati '{}' in '{}': {error}",
                    source_path.display(),
                    destination_path.display()
                )
            })?;
        }
    }
    Ok(())
}
