# VeloDent

VeloDent e' un gestionale odontoiatrico professionale locale-first. L'app desktop Tauri sul PC principale e' il nodo autorevole per dati clinici, agenda, radiografie, preventivi, fatture, pagamenti e accesso mobile in LAN.

La priorita' architetturale e' la protezione dei dati sanitari: database cifrato, file clinici tracciati su file system, audit log, repository backend Rust e nessun accesso diretto dal frontend a dati sensibili.

## Stack tecnologico

- Desktop: Tauri 2.
- Frontend: React, TypeScript, Vite, Tailwind CSS, shadcn/ui-style primitives.
- Backend: Rust con Tauri commands.
- Database: SQLite tramite `rusqlite` con feature `bundled-sqlcipher`.
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

## Comandi Tauri disponibili

- `health_check`: verifica minima del runtime Tauri.
- `database_status`: restituisce stato apertura DB, cifratura, versione schema, stato foreign key e sorgente chiave.
- `upsert_test_patient`: smoke test repository per inserire o recuperare un paziente tecnico di sviluppo.

## Standard di sicurezza adottati

- Il frontend non accede direttamente a database, file system, segreti o pagamenti.
- Tutte le operazioni sensibili devono passare da servizi Rust e Tauri commands.
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
