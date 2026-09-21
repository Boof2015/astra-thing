// SPDX-License-Identifier: GPL-3.0-only
mod backup;
mod image;
mod usb;
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    fs::File,
    io::{self, BufReader, Read, Write},
    path::PathBuf,
    sync::Arc,
};
type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;
fn emit(value: Value) {
    let mut out = io::stdout().lock();
    let _ = writeln!(out, "{value}");
    let _ = out.flush();
}
#[derive(Deserialize)]
#[serde(tag = "command", rename_all = "kebab-case", deny_unknown_fields)]
enum Request {
    List,
    Backup {
        target: usb::Target,
        directory: PathBuf,
    },
    VerifyBackup {
        target: usb::Target,
        directory: PathBuf,
    },
    VerifyImage {
        path: PathBuf,
        sha256: String,
        bytes: u64,
        scratch: PathBuf,
    },
    Install {
        target: usb::Target,
        path: PathBuf,
        sha256: String,
        bytes: u64,
        scratch: PathBuf,
        backup: PathBuf,
        confirmation: String,
    },
}
async fn run(request: Request) -> Result<Value> {
    match request {
        Request::List => Ok(serde_json::to_value(usb::list()?)?),
        Request::Backup { target, directory } => backup::run(target, &directory).await,
        Request::VerifyBackup { target, directory } => backup::verify(&directory, &target),
        Request::VerifyImage {
            path,
            sha256,
            bytes,
            scratch,
        } => image::verify(&path, &sha256, bytes, &scratch),
        Request::Install {
            target,
            path,
            sha256,
            bytes,
            scratch,
            backup,
            confirmation,
        } => {
            if confirmation != "install-astra-thing" {
                return Err("Installation was not confirmed".into());
            }
            backup::verify(&backup, &target)?;
            let verified = image::verify(&path, &sha256, bytes, &scratch)?;
            let mut archive = zip::ZipArchive::new(BufReader::new(File::open(&path)?))?;
            let config = flashthing::config::FlashConfig::from_archive(&mut archive)?;
            let device = usb::connect(target).await?;
            let capacity = backup::size(&device, "wholeDev").await?;
            if capacity
                < verified["members"]["superbird.wic"]["bytes"]
                    .as_u64()
                    .unwrap()
                    + 128 * 1024 * 1024
            {
                return Err("Device is too small for this image".into());
            }
            let callback: flashthing::Callback = Arc::new(|event| match event {
                flashthing::Event::Step(step, _) => emit(
                    json!({"event":"step","step":step,"steps":5,"stage":"Installing firmware"}),
                ),
                flashthing::Event::FlashProgress(p) => emit(
                    json!({"event":"progress","stage":"Installing firmware","percent":p.percent,"etaMs":p.eta}),
                ),
                _ => {}
            });
            emit(json!({"event":"write-started"}));
            let mut flasher = flashthing::Flasher::new(
                device,
                flashthing::FlashMode::Archive(archive),
                config,
                Some(callback),
            );
            flasher.flash().await?;
            Ok(json!({"written":true,"bootVerified":false,"next":"normal-power-cycle"}))
        }
    }
}
fn main() {
    let result = (|| -> Result<Value> {
        let mut data = String::new();
        io::stdin().take(16385).read_to_string(&mut data)?;
        if data.len() > 16384 {
            return Err("Oversized worker request".into());
        }
        let request = serde_json::from_str(&data)?;
        pollster::block_on(run(request))
    })();
    match result {
        Ok(data) => emit(json!({"event":"complete","data":data})),
        Err(error) => {
            emit(json!({"event":"error","message":error.to_string()}));
            std::process::exit(1)
        }
    }
}
