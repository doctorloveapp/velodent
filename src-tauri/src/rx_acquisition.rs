use std::{
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

pub trait RxAcquisitionAdapter {
    fn acquire(&self, patient_id: i64, tooth_number: Option<i64>) -> Result<PathBuf, String>;
}

pub struct MockRxAdapter;

impl RxAcquisitionAdapter for MockRxAdapter {
    fn acquire(&self, patient_id: i64, tooth_number: Option<i64>) -> Result<PathBuf, String> {
        if patient_id <= 0 {
            return Err("invalid patient id".to_owned());
        }
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| error.to_string())?
            .as_nanos();
        let tooth = tooth_number
            .map(|value| value.to_string())
            .unwrap_or_else(|| "arcata".to_owned());
        let path = std::env::temp_dir().join(format!(
            "velodent-mock-rx-{patient_id}-{tooth}-{suffix}.png"
        ));
        fs::write(&path, MOCK_PNG_BYTES).map_err(|error| error.to_string())?;
        Ok(path)
    }
}

const MOCK_PNG_BYTES: &[u8] = &[
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0,
    0, 0, 144, 119, 83, 222, 0, 0, 0, 12, 73, 68, 65, 84, 8, 215, 99, 248, 207, 192, 0, 0, 3, 1, 1,
    0, 24, 221, 141, 176, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
];

#[cfg(test)]
mod tests {
    use super::{MockRxAdapter, RxAcquisitionAdapter};

    #[test]
    fn mock_adapter_creates_a_png_file() {
        let adapter = MockRxAdapter;
        let path = adapter.acquire(1, Some(16)).expect("mock acquisition");
        assert!(path.is_file());
        assert!(path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .contains("velodent-mock-rx-1-16"));
    }
}
