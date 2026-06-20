use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
pub struct DicomMetadata {
    pub acquisition_datetime: Option<String>,
    pub modality: Option<String>,
    pub tooth_number: Option<i64>,
    pub metadata_json: String,
}

impl DicomMetadata {
    pub fn empty() -> Self {
        let metadata_json = serde_json::json!({
            "dicom": false,
        })
        .to_string();

        Self {
            acquisition_datetime: None,
            modality: None,
            tooth_number: None,
            metadata_json,
        }
    }
}

pub fn extract_dicom_metadata(path: &Path) -> Result<DicomMetadata, String> {
    let object = dicom_object::open_file(path).map_err(|error| error.to_string())?;
    let modality = object
        .element_by_name("Modality")
        .ok()
        .and_then(|element| element.to_str().ok())
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty());
    let acquisition_date = first_text(&object, &["AcquisitionDate", "StudyDate", "ContentDate"]);
    let acquisition_time = first_text(&object, &["AcquisitionTime", "StudyTime", "ContentTime"]);
    let acquisition_datetime =
        normalize_dicom_datetime(acquisition_date.as_deref(), acquisition_time.as_deref());
    let tooth_number = first_text(
        &object,
        &[
            "StudyDescription",
            "SeriesDescription",
            "ProtocolName",
            "ImageComments",
            "BodyPartExamined",
        ],
    )
    .and_then(|value| infer_tooth_number(&value));

    let metadata_json = serde_json::json!({
        "dicom": true,
        "acquisition_datetime": acquisition_datetime,
        "modality": modality,
        "tooth_number": tooth_number,
    })
    .to_string();

    Ok(DicomMetadata {
        acquisition_datetime,
        modality,
        tooth_number,
        metadata_json,
    })
}

fn first_text(object: &dicom_object::DefaultDicomObject, names: &[&str]) -> Option<String> {
    names.iter().find_map(|name| {
        object
            .element_by_name(name)
            .ok()
            .and_then(|element| element.to_str().ok())
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty())
    })
}

pub fn normalize_dicom_datetime(date: Option<&str>, time: Option<&str>) -> Option<String> {
    let date = date?.trim();
    if date.len() < 8
        || !date
            .chars()
            .take(8)
            .all(|character| character.is_ascii_digit())
    {
        return None;
    }
    let year = &date[0..4];
    let month = &date[4..6];
    let day = &date[6..8];
    let time = time.unwrap_or("000000").trim();
    let hour = time.get(0..2).unwrap_or("00");
    let minute = time.get(2..4).unwrap_or("00");
    let second = time.get(4..6).unwrap_or("00");
    Some(format!("{year}-{month}-{day}T{hour}:{minute}:{second}"))
}

pub fn infer_tooth_number(value: &str) -> Option<i64> {
    let bytes = value.as_bytes();
    for index in 0..bytes.len().saturating_sub(1) {
        if !bytes[index].is_ascii_digit() || !bytes[index + 1].is_ascii_digit() {
            continue;
        }
        let number = ((bytes[index] - b'0') as i64) * 10 + (bytes[index + 1] - b'0') as i64;
        let quadrant = number / 10;
        let position = number % 10;
        if (1..=4).contains(&quadrant) && (1..=8).contains(&position) {
            return Some(number);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::{infer_tooth_number, normalize_dicom_datetime};

    #[test]
    fn normalizes_dicom_date_and_time() {
        assert_eq!(
            normalize_dicom_datetime(Some("20260620"), Some("091530.000")).as_deref(),
            Some("2026-06-20T09:15:30")
        );
        assert_eq!(
            normalize_dicom_datetime(Some("20260620"), None).as_deref(),
            Some("2026-06-20T00:00:00")
        );
        assert!(normalize_dicom_datetime(Some("2026-06-20"), None).is_none());
    }

    #[test]
    fn infers_iso_fdi_tooth_number_from_text() {
        assert_eq!(infer_tooth_number("RX endorale dente 16"), Some(16));
        assert_eq!(infer_tooth_number("tooth 48 post-op"), Some(48));
        assert_eq!(infer_tooth_number("tooth 99"), None);
    }
}
