use serde::Serialize;

const TS_CNS_AID: &[u8] = &[0xA0, 0x00, 0x00, 0x02, 0x48, 0x00, 0x00];
const EF_DATI_PERSONALI: &[u8] = &[0x2F, 0x00];
const ISO_7816_STATUS_OK: &[u8] = &[0x90, 0x00];

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct TsCnsPatientData {
    pub last_name: String,
    pub first_name: String,
    pub date_of_birth: String,
    pub tax_code: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApduCommand {
    pub label: &'static str,
    pub bytes: Vec<u8>,
}

pub fn ts_cns_apdu_sequence() -> Vec<ApduCommand> {
    vec![
        ApduCommand {
            label: "SELECT_TS_CNS_AID",
            bytes: select_aid_apdu(TS_CNS_AID),
        },
        ApduCommand {
            label: "SELECT_EF_DATI_PERSONALI",
            bytes: select_file_apdu(EF_DATI_PERSONALI),
        },
        ApduCommand {
            label: "READ_BINARY_EF_DATI_PERSONALI",
            bytes: read_binary_apdu(0x0000, 0x00),
        },
    ]
}

pub fn parse_ts_cns_personal_data(payload: &[u8]) -> Result<TsCnsPatientData, String> {
    let values = parse_tlv(payload)?;
    let last_name = required_text(&values, &[0x5F, 0x20], "last name")?;
    let first_name = required_text(&values, &[0x5F, 0x21], "first name")?;
    let date_of_birth =
        normalize_birth_date(&required_text(&values, &[0x5F, 0x24], "birth date")?)?;
    let tax_code = required_text(&values, &[0x5F, 0x25], "tax code")?.to_ascii_uppercase();

    Ok(TsCnsPatientData {
        last_name,
        first_name,
        date_of_birth,
        tax_code,
    })
}

pub fn read_ts_cns_with_transceiver<F>(mut transceive: F) -> Result<TsCnsPatientData, String>
where
    F: FnMut(&ApduCommand) -> Result<Vec<u8>, String>,
{
    let mut personal_data = Vec::new();
    for command in ts_cns_apdu_sequence() {
        let response = transceive(&command)?;
        let payload = split_success_response(&response, command.label)?;
        if command.label == "READ_BINARY_EF_DATI_PERSONALI" {
            personal_data = payload.to_vec();
        }
    }
    if personal_data.is_empty() {
        return Err("TS-CNS personal data response is empty".to_owned());
    }
    parse_ts_cns_personal_data(&personal_data)
}

fn select_aid_apdu(aid: &[u8]) -> Vec<u8> {
    let mut command = vec![0x00, 0xA4, 0x04, 0x00, aid.len() as u8];
    command.extend_from_slice(aid);
    command
}

fn select_file_apdu(file_id: &[u8]) -> Vec<u8> {
    let mut command = vec![0x00, 0xA4, 0x02, 0x0C, file_id.len() as u8];
    command.extend_from_slice(file_id);
    command
}

fn read_binary_apdu(offset: u16, expected_length: u8) -> Vec<u8> {
    vec![
        0x00,
        0xB0,
        ((offset >> 8) & 0x7F) as u8,
        (offset & 0xFF) as u8,
        expected_length,
    ]
}

fn parse_tlv(payload: &[u8]) -> Result<Vec<(Vec<u8>, Vec<u8>)>, String> {
    let mut index = 0_usize;
    let mut values = Vec::new();
    while index < payload.len() {
        if payload[index] == 0x00 || payload[index] == 0xFF {
            index += 1;
            continue;
        }
        let tag_start = index;
        index += 1;
        if payload[tag_start] & 0x1F == 0x1F {
            while index < payload.len() {
                let byte = payload[index];
                index += 1;
                if byte & 0x80 == 0 {
                    break;
                }
            }
        }
        if index > payload.len() {
            return Err("TLV tag is truncated".to_owned());
        }
        let tag = payload[tag_start..index].to_vec();
        if index >= payload.len() {
            return Err("TLV length is missing".to_owned());
        }
        let first_length = payload[index];
        index += 1;
        let length = if first_length & 0x80 == 0 {
            first_length as usize
        } else {
            let length_bytes = (first_length & 0x7F) as usize;
            if length_bytes == 0 || length_bytes > 2 || index + length_bytes > payload.len() {
                return Err("TLV long length is not supported".to_owned());
            }
            let mut value = 0_usize;
            for byte in &payload[index..index + length_bytes] {
                value = (value << 8) | (*byte as usize);
            }
            index += length_bytes;
            value
        };
        if index + length > payload.len() {
            return Err("TLV value is truncated".to_owned());
        }
        values.push((tag, payload[index..index + length].to_vec()));
        index += length;
    }
    Ok(values)
}

fn required_text(values: &[(Vec<u8>, Vec<u8>)], tag: &[u8], label: &str) -> Result<String, String> {
    let value = values
        .iter()
        .find(|(candidate, _)| candidate.as_slice() == tag)
        .map(|(_, value)| value.as_slice())
        .ok_or_else(|| format!("TS-CNS {label} tag is missing"))?;
    let decoded = String::from_utf8_lossy(value).trim().to_owned();
    if decoded.is_empty() {
        Err(format!("TS-CNS {label} tag is empty"))
    } else {
        Ok(decoded)
    }
}

fn normalize_birth_date(value: &str) -> Result<String, String> {
    let digits: String = value.chars().filter(char::is_ascii_digit).collect();
    if digits.len() >= 8 {
        return Ok(format!(
            "{}-{}-{}",
            &digits[0..4],
            &digits[4..6],
            &digits[6..8]
        ));
    }
    if digits.len() == 6 {
        let year_prefix = if &digits[0..2] > "30" { "19" } else { "20" };
        return Ok(format!(
            "{year_prefix}{}-{}-{}",
            &digits[0..2],
            &digits[2..4],
            &digits[4..6]
        ));
    }
    Err("TS-CNS birth date is not valid".to_owned())
}

fn split_success_response<'a>(response: &'a [u8], command_label: &str) -> Result<&'a [u8], String> {
    if response.len() < ISO_7816_STATUS_OK.len() {
        return Err(format!("{command_label} APDU response is truncated"));
    }
    let (payload, status) = response.split_at(response.len() - ISO_7816_STATUS_OK.len());
    if status != ISO_7816_STATUS_OK {
        return Err(format!(
            "{command_label} APDU failed with status {:02X}{:02X}",
            status[0], status[1]
        ));
    }
    Ok(payload)
}

pub fn read_ts_cns_from_mobile_nfc() -> Result<TsCnsPatientData, String> {
    let sequence = ts_cns_apdu_sequence();
    let _engine: fn(
        fn(&ApduCommand) -> Result<Vec<u8>, String>,
    ) -> Result<TsCnsPatientData, String> =
        read_ts_cns_with_transceiver::<fn(&ApduCommand) -> Result<Vec<u8>, String>>;
    let _parser: fn(&[u8]) -> Result<TsCnsPatientData, String> = parse_ts_cns_personal_data;
    Err(format!(
        "NFC ISO-DEP TS-CNS is available only in the Tauri Mobile runtime with a native NFC bridge; APDU engine prepared with {} commands",
        sequence.len()
    ))
}

#[cfg(test)]
mod tests {
    use super::{
        parse_ts_cns_personal_data, read_ts_cns_with_transceiver, ts_cns_apdu_sequence, ApduCommand,
    };

    #[test]
    fn builds_iso_dep_apdu_sequence_for_ts_cns() {
        let sequence = ts_cns_apdu_sequence();
        assert_eq!(
            sequence[0].bytes,
            vec![0x00, 0xA4, 0x04, 0x00, 0x07, 0xA0, 0x00, 0x00, 0x02, 0x48, 0x00, 0x00]
        );
        assert_eq!(
            sequence[1].bytes,
            vec![0x00, 0xA4, 0x02, 0x0C, 0x02, 0x2F, 0x00]
        );
        assert_eq!(sequence[2].bytes, vec![0x00, 0xB0, 0x00, 0x00, 0x00]);
    }

    #[test]
    fn parses_ts_cns_personal_data_tlv() {
        let payload = sample_payload();
        let parsed = parse_ts_cns_personal_data(&payload).expect("parse tlv");
        assert_eq!(parsed.last_name, "ROSSI");
        assert_eq!(parsed.first_name, "MARIO");
        assert_eq!(parsed.date_of_birth, "1985-08-01");
        assert_eq!(parsed.tax_code, "RSSMRA85M01H501Q");
    }

    #[test]
    fn reads_ts_cns_through_iso_dep_transceiver() {
        let parsed = read_ts_cns_with_transceiver(|command: &ApduCommand| {
            if command.label == "READ_BINARY_EF_DATI_PERSONALI" {
                let mut response = sample_payload().to_vec();
                response.extend_from_slice(&[0x90, 0x00]);
                Ok(response)
            } else {
                Ok(vec![0x90, 0x00])
            }
        })
        .expect("read through transceiver");
        assert_eq!(parsed.tax_code, "RSSMRA85M01H501Q");
    }

    fn sample_payload() -> [u8; 46] {
        [
            0x5F, 0x20, 0x05, b'R', b'O', b'S', b'S', b'I', 0x5F, 0x21, 0x05, b'M', b'A', b'R',
            b'I', b'O', 0x5F, 0x24, 0x08, b'1', b'9', b'8', b'5', b'0', b'8', b'0', b'1', 0x5F,
            0x25, 0x10, b'R', b'S', b'S', b'M', b'R', b'A', b'8', b'5', b'M', b'0', b'1', b'H',
            b'5', b'0', b'1', b'Q',
        ]
    }
}
