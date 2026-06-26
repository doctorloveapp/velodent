pub mod lan {
    use crate::{
        agenda,
        db::{AppointmentInput, NewClinicalRecord, NewPatient},
        files,
        state::AppState,
        ts_cns,
    };
    use base64::{engine::general_purpose, Engine as _};
    use mdns_sd::{ServiceDaemon, ServiceInfo};
    use serde::{Deserialize, Serialize};
    use serde_json::{json, Value};
    use std::{
        collections::HashMap,
        io::{Read, Write},
        net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream},
        thread,
        time::Duration,
    };
    use tauri::{AppHandle, Manager};

    pub const LAN_SERVER_PORT: u16 = 1422;
    pub const PWA_FRONTEND_PORT: u16 = 1420;

    #[derive(Debug, Deserialize)]
    struct PairRequest {
        pin: String,
        device_uid: Option<String>,
        label: Option<String>,
    }

    #[derive(Debug, Deserialize)]
    struct PatientOpenRequest {
        patient_id: i64,
    }

    #[derive(Debug, Deserialize)]
    struct PatientCreateRequest {
        first_name: String,
        last_name: String,
        tax_code: String,
        date_of_birth: String,
        phone: Option<String>,
        email: Option<String>,
        address: Option<String>,
    }

    #[derive(Debug, Deserialize)]
    struct AppointmentRequest {
        patient_id: Option<i64>,
        chair_number: i64,
        title: String,
        starts_at: String,
        ends_at: String,
        status: String,
        color_tag: Option<String>,
        notes: Option<String>,
    }

    #[derive(Debug, Deserialize)]
    struct AppointmentStatusRequest {
        appointment_id: i64,
        status: String,
    }

    #[derive(Debug, Deserialize)]
    struct DeleteAppointmentRequest {
        appointment_id: i64,
    }

    #[derive(Debug, Deserialize)]
    struct ClinicalRecordRequest {
        patient_id: i64,
        service_id: Option<i64>,
        tooth_number: Option<i64>,
        tooth_surface: Option<String>,
        pathology_description: Option<String>,
        status: String,
        ready_for_quote: bool,
        notes: Option<String>,
    }

    #[derive(Debug, Deserialize)]
    struct DeleteClinicalRecordRequest {
        record_id: i64,
    }

    #[derive(Debug, Deserialize)]
    struct PatientClinicalQuery {
        patient_id: i64,
    }

    #[derive(Debug, Serialize)]
    struct ApiError {
        error: String,
    }

    pub fn start(app: AppHandle) {
        start_mdns_discovery();
        thread::spawn(move || {
            let listener = match TcpListener::bind(("0.0.0.0", LAN_SERVER_PORT)) {
                Ok(listener) => listener,
                Err(error) => {
                    eprintln!("VeloDent LAN server unavailable: {error}");
                    return;
                }
            };

            for stream in listener.incoming() {
                match stream {
                    Ok(stream) => {
                        let app = app.clone();
                        thread::spawn(move || handle_stream(stream, app));
                    }
                    Err(error) => eprintln!("VeloDent LAN request failed: {error}"),
                }
            }
        });
    }

    fn handle_stream(mut stream: TcpStream, app: AppHandle) {
        let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
        let peer = stream.peer_addr().ok();
        let mut buffer = [0_u8; 16384];
        let read = match stream.read(&mut buffer) {
            Ok(read) if read > 0 => read,
            _ => return,
        };
        let request = String::from_utf8_lossy(&buffer[..read]);
        let response = route_request(&request, peer, &app);
        let _ = stream.write_all(&response);
    }

    fn route_request(request: &str, peer: Option<SocketAddr>, app: &AppHandle) -> Vec<u8> {
        let Some((head, body)) = request.split_once("\r\n\r\n") else {
            return json_response(
                400,
                &ApiError {
                    error: "invalid request".to_owned(),
                },
            );
        };
        let mut lines = head.lines();
        let Some(request_line) = lines.next() else {
            return json_response(
                400,
                &ApiError {
                    error: "invalid request".to_owned(),
                },
            );
        };
        let parts = request_line.split_whitespace().collect::<Vec<_>>();
        if parts.len() < 2 {
            return json_response(
                400,
                &ApiError {
                    error: "invalid request".to_owned(),
                },
            );
        }
        let method = parts[0];
        let target = parts[1];
        let headers = parse_headers(lines);
        if method == "OPTIONS" {
            return empty_response(204);
        }
        let remote_ip = peer
            .map(|addr| addr.ip())
            .unwrap_or(IpAddr::V4(Ipv4Addr::LOCALHOST));
        if !is_lan_ip(remote_ip) {
            return json_response(
                403,
                &ApiError {
                    error: "LAN only".to_owned(),
                },
            );
        }
        let (path, query) = split_target(target);

        match (method, path.as_str()) {
            ("GET", "/health") => json_response(200, &json!({ "status": "ready" })),
            ("POST", "/pair") => handle_pair(body, remote_ip, app),
            ("GET", "/api/me") => {
                with_device_user(&headers, remote_ip, app, |_state, user| Ok(json!(user)))
            }
            ("GET", "/api/patients/search") => {
                with_device_user(&headers, remote_ip, app, |state, _user| {
                    let search_query = query.get("q").cloned().unwrap_or_default();
                    let limit = query
                        .get("limit")
                        .and_then(|value| value.parse::<i64>().ok())
                        .unwrap_or(10)
                        .clamp(1, 50);
                    let patients = state
                        .database()?
                        .search_patients(&search_query, limit)
                        .map_err(|error| error.to_string())?;
                    Ok(json!(patients))
                })
            }
            ("POST", "/api/patients/open") => {
                with_device_user(&headers, remote_ip, app, |state, user| {
                    let request = serde_json::from_str::<PatientOpenRequest>(body.trim())
                        .map_err(|_| "invalid patient open body".to_owned())?;
                    let patient = state
                        .database()?
                        .open_patient_record(user.id, request.patient_id)
                        .map_err(|error| error.to_string())?;
                    Ok(json!(patient))
                })
            }
            ("POST", "/api/patients") => {
                with_device_user(&headers, remote_ip, app, |state, user| {
                    let request = serde_json::from_str::<PatientCreateRequest>(body.trim())
                        .map_err(|_| "invalid patient create body".to_owned())?;
                    let patient = state
                        .database()?
                        .create_patient(
                            user.id,
                            &NewPatient {
                                first_name: &request.first_name,
                                last_name: &request.last_name,
                                tax_code: &request.tax_code,
                                date_of_birth: &request.date_of_birth,
                                phone: request.phone.as_deref(),
                                email: request.email.as_deref(),
                                address: request.address.as_deref(),
                            },
                        )
                        .map_err(|error| error.to_string())?;
                    Ok(json!(patient))
                })
            }
            ("GET", "/api/agenda/appointments") => {
                with_device_user(&headers, remote_ip, app, |state, user| {
                    let starts_from = query.get("from").ok_or_else(|| "missing from".to_owned())?;
                    let starts_to = query.get("to").ok_or_else(|| "missing to".to_owned())?;
                    if query.get("sync").map(String::as_str) == Some("1") {
                        let _ = tauri::async_runtime::block_on(
                            agenda::process_google_calendar_sync(app, user.id),
                        );
                    }
                    let appointments = state
                        .database()?
                        .list_appointments(user.id, starts_from, starts_to)
                        .map_err(|error| error.to_string())?;
                    Ok(json!(appointments))
                })
            }
            ("GET", "/api/agenda/chairs") => {
                with_device_user(&headers, remote_ip, app, |state, user| {
                    let chairs = state
                        .database()?
                        .chair_config(user.id)
                        .map_err(|error| error.to_string())?;
                    Ok(json!(chairs))
                })
            }
            ("POST", "/api/agenda/appointments") => {
                with_device_user(&headers, remote_ip, app, |state, user| {
                    let request = serde_json::from_str::<AppointmentRequest>(body.trim())
                        .map_err(|_| "invalid appointment body".to_owned())?;
                    let appointment = state
                        .database()?
                        .create_appointment(
                            user.id,
                            &AppointmentInput {
                                patient_id: request.patient_id,
                                chair_number: request.chair_number,
                                title: &request.title,
                                starts_at: &request.starts_at,
                                ends_at: &request.ends_at,
                                status: &request.status,
                                color_tag: request.color_tag.as_deref(),
                                notes: request.notes.as_deref(),
                            },
                        )
                        .map_err(|error| error.to_string())?;
                    agenda::trigger_google_calendar_sync(app, user.id);
                    Ok(json!(appointment))
                })
            }
            ("PATCH", "/api/agenda/appointments/status") => {
                with_device_user(&headers, remote_ip, app, |state, user| {
                    let request = serde_json::from_str::<AppointmentStatusRequest>(body.trim())
                        .map_err(|_| "invalid appointment status body".to_owned())?;
                    let appointment = state
                        .database()?
                        .update_appointment_status(user.id, request.appointment_id, &request.status)
                        .map_err(|error| error.to_string())?;
                    agenda::trigger_google_calendar_sync(app, user.id);
                    Ok(json!(appointment))
                })
            }
            ("DELETE", "/api/agenda/appointments") => {
                with_device_user(&headers, remote_ip, app, |state, user| {
                    let request = serde_json::from_str::<DeleteAppointmentRequest>(body.trim())
                        .map_err(|_| "invalid appointment delete body".to_owned())?;
                    let appointment = state
                        .database()?
                        .appointment_for_actor(user.id, request.appointment_id)
                        .map_err(|error| error.to_string())?;
                    tauri::async_runtime::block_on(
                        agenda::delete_google_calendar_events_for_appointment(
                            app,
                            user.id,
                            &appointment,
                        ),
                    )?;
                    let deleted = state
                        .database()?
                        .delete_appointment(user.id, request.appointment_id)
                        .map_err(|error| error.to_string())?;
                    Ok(json!(deleted))
                })
            }
            ("GET", "/api/clinical/services") => {
                with_device_user(&headers, remote_ip, app, |state, user| {
                    let mut services = state
                        .database()?
                        .list_clinical_services(user.id)
                        .map_err(|error| error.to_string())?;
                    if let Some(category) = query.get("category") {
                        services.retain(|service| {
                            service
                                .category
                                .as_deref()
                                .map(|value| value.eq_ignore_ascii_case(category))
                                .unwrap_or(false)
                        });
                    }
                    Ok(json!(services))
                })
            }
            ("GET", "/api/clinical/records") => {
                with_device_user(&headers, remote_ip, app, |state, user| {
                    let request = patient_clinical_query(&query)?;
                    let records = state
                        .database()?
                        .list_clinical_records(
                            user.id,
                            request.patient_id,
                            &crate::db::ClinicalRecordFilters {
                                date_from: None,
                                date_to: None,
                                tooth_number: None,
                                operator_user_id: None,
                            },
                        )
                        .map_err(|error| error.to_string())?;
                    Ok(json!(records))
                })
            }
            ("GET", "/api/clinical/tooth-statuses") => {
                with_device_user(&headers, remote_ip, app, |state, user| {
                    let request = patient_clinical_query(&query)?;
                    let statuses = state
                        .database()?
                        .get_tooth_statuses(user.id, request.patient_id)
                        .map_err(|error| error.to_string())?;
                    Ok(json!(statuses))
                })
            }
            ("POST", "/api/clinical/records") => {
                with_device_user(&headers, remote_ip, app, |state, user| {
                    let request = serde_json::from_str::<ClinicalRecordRequest>(body.trim())
                        .map_err(|_| "invalid clinical record body".to_owned())?;
                    let record = state
                        .database()?
                        .create_clinical_record(
                            user.id,
                            &NewClinicalRecord {
                                patient_id: request.patient_id,
                                service_id: request.service_id,
                                tooth_number: request.tooth_number,
                                tooth_surface: request.tooth_surface.as_deref(),
                                pathology_description: request.pathology_description.as_deref(),
                                status: &request.status,
                                ready_for_quote: request.ready_for_quote,
                                notes: request.notes.as_deref(),
                            },
                        )
                        .map_err(|error| error.to_string())?;
                    Ok(json!(record))
                })
            }
            ("DELETE", "/api/clinical/records") => {
                with_device_user(&headers, remote_ip, app, |state, user| {
                    let request = serde_json::from_str::<DeleteClinicalRecordRequest>(body.trim())
                        .map_err(|_| "invalid clinical record delete body".to_owned())?;
                    state
                        .database()?
                        .delete_clinical_record(user.id, request.record_id)
                        .map_err(|error| error.to_string())?;
                    Ok(json!({ "deleted": true }))
                })
            }
            ("GET", "/api/rx/assets") => {
                with_device_user(&headers, remote_ip, app, |state, user| {
                    let request = patient_clinical_query(&query)?;
                    let assets = state
                        .database()?
                        .list_rx_assets(user.id, request.patient_id)
                        .map_err(|error| error.to_string())?;
                    Ok(json!(assets))
                })
            }
            ("GET", "/api/rx/asset-data") => {
                with_device_user(&headers, remote_ip, app, |state, user| {
                    let file_asset_id = query
                        .get("file_asset_id")
                        .and_then(|value| value.parse::<i64>().ok())
                        .ok_or_else(|| "missing file_asset_id".to_owned())?;
                    let asset = state
                        .database()?
                        .rx_asset_for_access(user.id, file_asset_id)
                        .map_err(|error| error.to_string())?;
                    let mime_type = asset
                        .mime_type
                        .clone()
                        .unwrap_or_else(|| "application/octet-stream".to_owned());
                    if !mime_type.starts_with("image/") {
                        return Err(
                            "clinical file preview is available only for image assets".to_owned()
                        );
                    }
                    let bytes = files::read_patient_file(&asset.relative_path)?;
                    Ok(json!({
                        "file_asset_id": file_asset_id,
                        "mime_type": mime_type,
                        "data_url": format!("data:{};base64,{}", mime_type, general_purpose::STANDARD.encode(bytes)),
                    }))
                })
            }
            ("POST", "/api/ts-cns/read") => {
                with_device_user(&headers, remote_ip, app, |state, actor| {
                    let result = ts_cns::read_ts_cns_from_mobile_nfc();
                    state
                        .database()?
                        .audit_ts_cns_scan(actor.id, result.is_ok())
                        .map_err(|error| error.to_string())?;
                    result
                        .map(|data| json!(data))
                        .map_err(|error| error.to_string())
                })
            }
            _ => json_response(
                404,
                &ApiError {
                    error: "not found".to_owned(),
                },
            ),
        }
    }

    fn start_mdns_discovery() {
        thread::spawn(|| {
            let mdns = match ServiceDaemon::new() {
                Ok(mdns) => mdns,
                Err(error) => {
                    eprintln!("VeloDent mDNS unavailable: {error}");
                    return;
                }
            };
            let properties = [
                ("app", "VeloDent"),
                ("api_port", "1422"),
                ("api_protocol", "http"),
                ("frontend_port", "1420"),
                ("url", "http://velodent.local:1420/"),
                ("path", "/"),
            ];
            let service_info = match ServiceInfo::new(
                "_http._tcp.local.",
                "VeloDent",
                "velodent.local.",
                "",
                PWA_FRONTEND_PORT,
                &properties[..],
            ) {
                Ok(info) => info.enable_addr_auto(),
                Err(error) => {
                    eprintln!("VeloDent mDNS service invalid: {error}");
                    return;
                }
            };
            if let Err(error) = mdns.register(service_info) {
                eprintln!("VeloDent mDNS register failed: {error}");
                return;
            }
            loop {
                thread::park();
            }
        });
    }

    fn patient_clinical_query(
        query: &HashMap<String, String>,
    ) -> Result<PatientClinicalQuery, String> {
        query
            .get("patient_id")
            .and_then(|value| value.parse::<i64>().ok())
            .map(|patient_id| PatientClinicalQuery { patient_id })
            .ok_or_else(|| "missing patient_id".to_owned())
    }

    fn handle_pair(body: &str, remote_ip: IpAddr, app: &AppHandle) -> Vec<u8> {
        let state = app.state::<AppState>();
        let Ok(request) = serde_json::from_str::<PairRequest>(body.trim()) else {
            return json_response(
                400,
                &ApiError {
                    error: "invalid pair body".to_owned(),
                },
            );
        };
        let user_id = match state.consume_pairing_code(&request.pin) {
            Ok(user_id) => user_id,
            Err(error) => {
                return json_response(403, &ApiError { error });
            }
        };
        let label = request.label.as_deref().unwrap_or("VeloDent Mobile");
        let cidr = match remote_ip {
            IpAddr::V4(ip) => Some(ipv4_24_cidr(ip)),
            IpAddr::V6(_) => None,
        };
        match state.database().and_then(|db| {
            db.authorize_paired_device(
                user_id,
                label,
                request.device_uid.as_deref(),
                cidr.as_deref(),
            )
            .map_err(|error| error.to_string())
        }) {
            Ok(authorization) => json_response(200, &authorization),
            Err(error) => json_response(500, &ApiError { error }),
        }
    }

    fn with_device_user<F>(
        headers: &HashMap<String, String>,
        remote_ip: IpAddr,
        app: &AppHandle,
        handler: F,
    ) -> Vec<u8>
    where
        F: FnOnce(&AppState, crate::db::User) -> Result<Value, String>,
    {
        let state = app.state::<AppState>();
        let user = match device_user(headers, remote_ip, &state) {
            Ok(user) => user,
            Err(error) => return json_response(403, &ApiError { error }),
        };
        match handler(&state, user) {
            Ok(value) => json_response(200, &value),
            Err(error) => json_response(500, &ApiError { error }),
        }
    }

    fn device_user(
        headers: &HashMap<String, String>,
        remote_ip: IpAddr,
        state: &AppState,
    ) -> Result<crate::db::User, String> {
        let token = bearer_token(headers).ok_or_else(|| "device token missing".to_owned())?;
        state
            .database()?
            .user_for_device_token(&token, &remote_ip.to_string())
            .map_err(|error| error.to_string())
    }

    fn bearer_token(headers: &HashMap<String, String>) -> Option<String> {
        headers
            .get("authorization")
            .and_then(|value| value.strip_prefix("Bearer "))
            .map(str::to_owned)
            .or_else(|| headers.get("x-velodent-device-token").cloned())
    }

    fn parse_headers<'a>(lines: impl Iterator<Item = &'a str>) -> HashMap<String, String> {
        let mut headers = HashMap::new();
        for line in lines {
            if let Some((key, value)) = line.split_once(':') {
                headers.insert(key.trim().to_ascii_lowercase(), value.trim().to_owned());
            }
        }
        headers
    }

    fn split_target(target: &str) -> (String, HashMap<String, String>) {
        let Some((path, query)) = target.split_once('?') else {
            return (target.to_owned(), HashMap::new());
        };
        let mut params = HashMap::new();
        for pair in query.split('&') {
            if let Some((key, value)) = pair.split_once('=') {
                params.insert(percent_decode(key), percent_decode(value));
            }
        }
        (path.to_owned(), params)
    }

    fn percent_decode(value: &str) -> String {
        let mut output = Vec::with_capacity(value.len());
        let bytes = value.as_bytes();
        let mut index = 0;
        while index < bytes.len() {
            if bytes[index] == b'%' && index + 2 < bytes.len() {
                if let Ok(hex) = u8::from_str_radix(&value[index + 1..index + 3], 16) {
                    output.push(hex);
                    index += 3;
                    continue;
                }
            }
            let byte = if bytes[index] == b'+' {
                b' '
            } else {
                bytes[index]
            };
            output.push(byte);
            index += 1;
        }
        String::from_utf8_lossy(&output).into_owned()
    }

    fn is_lan_ip(ip: IpAddr) -> bool {
        match ip {
            IpAddr::V4(ip) => {
                ip.is_private()
                    || ip.is_loopback()
                    || ip.octets()[0] == 169 && ip.octets()[1] == 254
            }
            IpAddr::V6(ip) => ip.is_loopback(),
        }
    }

    fn ipv4_24_cidr(ip: Ipv4Addr) -> String {
        let [a, b, c, _] = ip.octets();
        format!("{a}.{b}.{c}.0/24")
    }

    fn json_response<T: Serialize>(status: u16, value: &T) -> Vec<u8> {
        let body = serde_json::to_string(value).unwrap_or_else(|_| "{}".to_owned());
        response(status, "application/json", body.as_bytes())
    }

    fn empty_response(status: u16) -> Vec<u8> {
        response(status, "text/plain", b"")
    }

    fn response(status: u16, content_type: &str, body: &[u8]) -> Vec<u8> {
        let reason = match status {
            200 => "OK",
            204 => "No Content",
            400 => "Bad Request",
            403 => "Forbidden",
            404 => "Not Found",
            500 => "Internal Server Error",
            _ => "OK",
        };
        let mut head = format!(
            "HTTP/1.1 {status} {reason}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: Authorization, Content-Type, X-VeloDent-Device-Token\r\nAccess-Control-Allow-Methods: GET, POST, DELETE, OPTIONS\r\nAccess-Control-Allow-Private-Network: true\r\nVary: Origin\r\n",
            body.len()
        );
        head.push_str("Connection: close\r\n\r\n");
        let mut bytes = head.into_bytes();
        bytes.extend_from_slice(body);
        bytes
    }
}

#[cfg(test)]
mod tests {
    use super::lan::LAN_SERVER_PORT;

    #[test]
    fn lan_server_uses_expected_port() {
        assert_eq!(LAN_SERVER_PORT, 1422);
    }
}
