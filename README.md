# VeloDent

<p align="center">
  <img src="assets/image/logo.png" alt="VeloDent Logo" width="500">
</p>

<h1 align="center">VeloDent</h1>

<p align="center">
  <strong>Dental Management System</strong><br>
  <sub>High-Speed Software for Modern Dental Clinics</sub>
</p>

---
VeloDent e' un gestionale odontoiatrico professionale locale-first. L'app desktop Tauri sul PC principale e' il nodo autorevole per dati clinici, agenda, radiografie, preventivi, fatture, pagamenti e accesso mobile in LAN.

La priorita' architetturale e' la protezione dei dati sanitari: database cifrato, file clinici tracciati su file system, audit log, repository backend Rust e nessun accesso diretto dal frontend a dati sensibili.

## Stack tecnologico

- Desktop: Tauri 2.
- Frontend: React, TypeScript, Vite, Tailwind CSS, shadcn/ui-style primitives.
- Backend: Rust con Tauri commands.
- Database: SQLite tramite `rusqlite` con feature `bundled-sqlcipher-vendored-openssl`.
- PDF fiscali: generazione Rust con `printpdf`.
- Persistenza file: directory dati locale gestita dal backend.
- Test: Vitest per frontend; test Rust per database e repository quando la toolchain Rust e' disponibile.

## Setup ambiente di sviluppo

### Requisiti Node

- Node.js 22.x.
- npm 10.x.

Installazione dipendenze:

```powershell
npm install
```

Avvio frontend Vite:

```powershell
npm run dev
```

Build frontend:

```powershell
npm run build
```

### Requisiti Tauri/Rust su Windows

Per avviare o compilare l'app desktop Tauri servono:

- Rust installato tramite `rustup`.
- `cargo` e `rustc` disponibili nel `PATH`.
- Visual Studio Build Tools 2022 con componenti MSVC C++ e Windows SDK.
- WebView2 Runtime.
- Perl disponibile nel `PATH` se si compila SQLCipher con OpenSSL vendorizzato.

Verifica ambiente:

```powershell
npm run tauri -- info
```

Avvio desktop:

```powershell
npm run tauri:dev
```

### Variabili ambiente database

Il backend richiede una chiave SQLCipher. In sviluppo usare una chiave locale tramite variabile ambiente:

```powershell
$env:VELODENT_DB_PATH = ".\data\velodent.sqlite"
$env:VELODENT_DB_KEY = "una-chiave-di-sviluppo-lunga-e-non-versionata"
npm run tauri:dev
```

`VELODENT_DB_KEY` non deve mai essere versionata, loggata o inserita nel codice. Il backend fallisce chiuso se la chiave manca.

Solo per test locali non sensibili e' disponibile un fallback esplicito:

```powershell
$env:VELODENT_ALLOW_INSECURE_DEV_KEY = "true"
```

Questo fallback non deve essere usato con dati reali.

### Variabili ambiente integrazioni

Google Calendar e SumUp leggono credenziali da `.env` o variabili ambiente locali non versionate.

```powershell
$env:GOOGLE_CLIENT_ID = "..."
$env:GOOGLE_CLIENT_SECRET = "..."
$env:SUMUP_API_KEY = "..."
$env:SUMUP_MERCHANT_CODE = "..."
```

Il frontend non riceve segreti e non invia importi a SumUp: per i pagamenti invia solo l'ID fattura, poi il backend calcola il saldo dal database cifrato.

## Struttura progetto

```text
src/
  frontend/
    app-shell/
    agenda/
    billing/
    clinical/
    patients/
    rx/
    settings/
    shared/
  styles/
src-tauri/
  src/
    auth.rs
    audit.rs
    billing.rs
    clinical.rs
    commands.rs
    db.rs
    files.rs
    health.rs
    integrations.rs
    patients.rs
    server.rs
    state.rs
```

## Layer database sicuro

Il database viene aperto dal backend Rust con SQLCipher:

- `PRAGMA key` applicato prima di qualsiasi lettura.
- `PRAGMA foreign_keys = ON` sempre attivo.
- `PRAGMA cipher_page_size = 4096`.
- `PRAGMA kdf_iter = 256000`.
- HMAC/KDF SHA512.
- Migrazioni idempotenti con `CREATE TABLE IF NOT EXISTS` e `CREATE INDEX IF NOT EXISTS`.
- Versione schema registrata in `schema_migrations`.

Le tabelle iniziali coprono utenti, account Google autorizzati, dispositivi, impostazioni studio, pazienti, consensi, appuntamenti, catalogo prestazioni, diario clinico, file/RX, preventivi, fatture, pagamenti, integrazioni, coda sync, backup e `audit_log`.

Gli importi economici sono sempre `INTEGER` in centesimi. Non usare `REAL` per prezzi, totali, sconti o pagamenti.

## Gestione fiscale ed economica

Il workflow economico core e' backend-trusted:

1. Le prestazioni cliniche `diagnosed` e `ready_for_quote` generano un preventivo tramite comando Tauri.
2. Il preventivo puo' ricevere righe manuali dal catalogo e uno sconto globale, sempre in centesimi.
3. Lo stato del preventivo e' `draft`, `accepted` o `rejected`; dopo accettazione/rifiuto le modifiche sono bloccate.
4. Una fattura puo' nascere solo da preventivo accettato.
5. La numerazione fatture e' transazionale lato SQL (`BEGIN IMMEDIATE`) e vincolata da `UNIQUE(invoice_number, invoice_year)`.
6. PDF preventivo/fattura sono generati in Rust e salvati in `%APPDATA%/VeloDent/patients/{patient_id}/documents/`.
7. Pagamenti contanti/bonifico e checkout SumUp passano dal backend; SumUp riceve importi calcolati leggendo la fattura.

Ogni creazione/modifica economica registra `FINANCIAL_TRANSACTION` in `audit_log`.

## Gestione Dati: Backup e Ripristino

VeloDent permette di creare un archivio cifrato completo dei dati dello studio. Il backup include il database locale e i file clinici collegati ai pazienti, come documenti, consensi, fatture, RX e foto.

### Creare un backup

1. Accedere all'app desktop come amministratore.
2. Aprire `Impostazioni`.
3. Nella sezione `Backup cifrato`, inserire la password amministratore corrente.
4. Premere `Crea backup .vdbk` e scegliere dove salvare il file.

Il file generato usa estensione `.vdbk` ed e' cifrato. La password richiesta per aprirlo e' la password amministratore dello studio valida nel momento in cui il backup viene creato.

### Ripristinare su un nuovo PC

Al primo avvio, se VeloDent non e' ancora configurato, il wizard iniziale mostra due opzioni:

- `Configura un nuovo studio`, per iniziare da zero.
- `Ripristina dati da backup`, per caricare un archivio `.vdbk`.

Per ripristinare:

1. Selezionare `Ripristina dati da backup`.
2. Scegliere il file `.vdbk`.
3. Inserire la password amministratore associata al backup.
4. Avviare il ripristino.
5. Al termine, accedere con le credenziali dello studio ripristinato.

Conservare i file `.vdbk` in una posizione protetta. Senza la password amministratore corretta, il contenuto del backup non puo' essere recuperato.

## Comandi Tauri disponibili

- `health_check`: verifica minima del runtime Tauri.
- `database_status`: restituisce stato apertura DB, cifratura, versione schema, stato foreign key e sorgente chiave.
- `upsert_test_patient`: smoke test repository per inserire o recuperare un paziente tecnico di sviluppo.
- `bootstrap_status`: indica se serve creare il primo admin.
- `create_first_admin`: crea il primo account amministratore locale.
- `login`: verifica credenziali locali e registra audit.
- `create_user` / `list_users`: gestione utenti e ruoli.
- `add_authorized_google_account` / `list_authorized_google_accounts`: allowlist Google.
- `authorize_device` / `revoke_device` / `list_devices`: token dispositivo e revoca.
- `get_studio_settings` / `update_studio_settings`: configurazione studio.
- `create_quote_from_diagnosis` / `add_quote_line` / `update_quote_discount` / `update_quote_status`: workflow preventivi.
- `create_invoice_from_quote` / `list_invoices`: fatturazione con numerazione atomica.
- `generate_quote_pdf` / `generate_invoice_pdf`: produzione PDF fiscali lato Rust.
- `register_payment` / `start_sumup_payment`: pagamenti backend-trusted.

## Standard di sicurezza adottati

- Il frontend non accede direttamente a database, file system, segreti o pagamenti.
- Tutte le operazioni sensibili devono passare da servizi Rust e Tauri commands.
- Le password locali sono hashate con Argon2.
- I token dispositivo sono mostrati una sola volta e salvati solo come hash SHA-256.
- I token, refresh token e chiavi non devono essere salvati in chiaro.
- I dati sanitari non devono comparire nei log tecnici.
- Ogni accesso o modifica clinica/fiscale dovra' generare eventi in `audit_log`.
- Le migrazioni devono poter essere rieseguite senza corrompere o sovrascrivere dati esistenti.
- I file clinici pesanti restano su file system; nel DB vanno solo path relativi, hash, dimensione e metadati.

## Verifiche consigliate

Frontend:

```powershell
npm run typecheck
npm run lint
npm run test
npm run build
```

Backend, dopo installazione Rust/MSVC:

```powershell
cd src-tauri
cargo test
cargo check
```

Questo progetto è rilasciato sotto doppia licenza MIT e Apache 2.0
