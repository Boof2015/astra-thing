// SPDX-License-Identifier: GPL-3.0-only
// AMLC upload envelope protocol adapted from car-thing-bootloader-tool (MIT).
// Attribution and terms: ../../../LICENSES/car-thing-bootloader-tool-MIT.txt.
use crate::{
    Result, emit,
    usb::{self, SelectedUsb, TIMEOUT, Target},
};
use flashthing::{AmlogicSoC, usb::UsbTransport};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::Path,
};

const PARTS: [(&str, &str); 16] = [
    ("bootloader", "bootloader.dump"),
    ("env", "env.dump"),
    ("fip_a", "fip_a.dump"),
    ("fip_b", "fip_b.dump"),
    ("logo", "logo.dump"),
    ("dtbo_a", "dtbo_a.dump"),
    ("dtbo_b", "dtbo_b.dump"),
    ("vbmeta_a", "vbmeta_a.dump"),
    ("vbmeta_b", "vbmeta_b.dump"),
    ("boot_a", "boot_a.dump"),
    ("boot_b", "boot_b.dump"),
    ("misc", "misc.dump"),
    ("system_a", "system_a.ext2"),
    ("system_b", "system_b.ext2"),
    ("data", "data.ext4"),
    ("settings", "settings.ext4"),
];

pub fn private_file(path: &Path) -> Result<File> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    Ok(options.open(path)?)
}
pub fn file_hash(path: &Path) -> Result<String> {
    let mut file = File::open(path)?;
    let mut hash = Sha256::new();
    let mut buffer = vec![0; 1024 * 1024];
    loop {
        let n = file.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        hash.update(&buffer[..n]);
    }
    Ok(format!("{:x}", hash.finalize()))
}
pub async fn size(device: &AmlogicSoC<SelectedUsb>, name: &str) -> Result<u64> {
    device.write_simple_memory(0x13000000, &[0xff; 8]).await?;
    usb::command(device, &format!("amlmmc size {name} 0x13000000")).await?;
    let bytes = device.read_simple_memory(0x13000000, 8).await?;
    let sectors = u64::from_le_bytes(
        bytes
            .try_into()
            .map_err(|_| "Invalid partition size response")?,
    );
    if sectors == 0 || sectors > 16 * 1024 * 1024 {
        return Err("Unsupported partition size".into());
    }
    Ok(sectors * 512)
}
async fn capture(
    device: &AmlogicSoC<SelectedUsb>,
    part: &str,
    size: u64,
    mut file: Option<&mut File>,
    base: u64,
    total: u64,
    label: &str,
) -> Result<String> {
    usb::command(device, "amlmmc part 1").await?;
    usb::command(device, &format!("upload store {part} normal {size:#x}")).await?;
    let mut received = 0u64;
    let mut hash = Sha256::new();
    let mut buffer = [0; 16384];
    let mut last_percent = 101u64;
    while received < size {
        let mut header = [0; 16];
        let n = device
            .transport()
            .control_in(0x33, 0x1000, 16, &mut header, TIMEOUT)
            .await?;
        if n != 16 || u32::from_le_bytes(header[..4].try_into().unwrap()) != 0xefe8 {
            return Err("Invalid backup upload envelope".into());
        }
        let segment = u32::from_le_bytes(header[4..8].try_into().unwrap()) as u64;
        if segment == 0 || segment > 65536 || segment > size - received {
            return Err("Backup upload exceeded the requested partition bounds".into());
        }
        let mut remaining = segment as usize;
        while remaining > 0 {
            let want = remaining.min(buffer.len());
            let n = device
                .transport()
                .bulk_in(&mut buffer[..want], TIMEOUT)
                .await?;
            if n == 0 || n > want {
                return Err("Incomplete backup transfer".into());
            }
            if let Some(file) = file.as_deref_mut() {
                file.write_all(&buffer[..n])?;
            }
            hash.update(&buffer[..n]);
            remaining -= n;
            received += n as u64;
        }
        let percent = (base + received) * 100 / total;
        if percent != last_percent {
            emit(
                json!({"event":"progress","stage":label,"partition":part,"completed":base+received,"total":total,"percent":percent}),
            );
            last_percent = percent;
        }
    }
    if let Some(file) = file {
        file.sync_all()?;
    }
    Ok(format!("{:x}", hash.finalize()))
}
pub async fn run(target: Target, directory: &Path) -> Result<Value> {
    if directory.exists() {
        return Err("Backup destination already exists; choose a new folder".into());
    }
    let parent = directory.parent().ok_or("Invalid backup destination")?;
    if !parent.is_dir() {
        return Err("Backup parent directory does not exist".into());
    }
    let device = usb::connect(target.clone()).await?;
    let mut sizes = Vec::new();
    for (part, _) in PARTS {
        sizes.push(if part == "bootloader" {
            if size(&device, part).await? != 4 * 1024 * 1024 {
                return Err("Unexpected stock bootloader geometry".into());
            }
            2 * 1024 * 1024
        } else {
            size(&device, part).await?
        });
    }
    let bytes: u64 = sizes.iter().sum();
    if bytes > 8 * 1024 * 1024 * 1024 || fs2::available_space(parent)? < bytes + 128 * 1024 * 1024 {
        return Err("Not enough free space for the stock backup".into());
    }
    fs::create_dir(directory)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(directory, fs::Permissions::from_mode(0o700))?;
    }
    let mut entries = Vec::new();
    let mut base = 0u64;
    for ((part, filename), length) in PARTS.into_iter().zip(sizes.iter()) {
        let path = directory.join(filename);
        let mut file = private_file(&path)?;
        let sha = capture(
            &device,
            part,
            *length,
            Some(&mut file),
            base,
            bytes * 2,
            "Copying original software",
        )
        .await?;
        if file.metadata()?.len() != *length || file_hash(&path)? != sha {
            return Err("Saved backup file did not verify".into());
        }
        entries.push(json!({"partition":part,"file":filename,"bytes":length,"sha256":sha}));
        base += length;
    }
    for (((part, _), length), entry) in PARTS.into_iter().zip(sizes.iter()).zip(entries.iter()) {
        let sha = capture(
            &device,
            part,
            *length,
            None,
            base,
            bytes * 2,
            "Verifying against a second device read",
        )
        .await?;
        if Some(sha.as_str()) != entry["sha256"].as_str() {
            return Err("The two device reads did not match; backup remains incomplete".into());
        }
        base += length;
    }
    let manifest = json!({"schema":1,"kind":"astra-thing-stock-backup","verified":true,"target":target,"bytes":bytes,"partitions":entries,"coverage":"16 readable stock partitions, verified against two device reads. Bootloader is the 2 MiB vendor restore payload. Protected regions, eMMC boot hardware partitions, RPMB and disk gaps are not included. This is not a full-chip clone."});
    let mut file = private_file(&directory.join("backup.json"))?;
    file.write_all(&serde_json::to_vec_pretty(&manifest)?)?;
    file.sync_all()?;
    Ok(json!({"path":directory,"manifest":manifest}))
}

pub fn verify(directory: &Path, target: &Target) -> Result<Value> {
    let record = directory.join("backup.json");
    if fs::symlink_metadata(&record)?.file_type().is_symlink()
        || fs::metadata(&record)?.len() > 65536
    {
        return Err("Oversized backup record".into());
    }
    let bytes = fs::read(record)?;
    let value: Value = serde_json::from_slice(&bytes)?;
    if value["schema"] != 1
        || value["kind"] != "astra-thing-stock-backup"
        || value["verified"] != true
        || value["target"] != serde_json::to_value(target)?
    {
        return Err("Backup is not verified for the selected USB device".into());
    }
    let entries = value["partitions"]
        .as_array()
        .ok_or("Missing backup entries")?;
    if entries.len() != PARTS.len() {
        return Err("Incomplete backup".into());
    }
    for ((part, name), entry) in PARTS.into_iter().zip(entries) {
        let path = directory.join(name);
        if entry["partition"] != part
            || entry["file"] != name
            || fs::symlink_metadata(&path)?.file_type().is_symlink()
            || Some(fs::metadata(&path)?.len()) != entry["bytes"].as_u64()
            || Some(file_hash(&path)?.as_str()) != entry["sha256"].as_str()
        {
            return Err("Backup no longer matches its verification record".into());
        }
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_corrupted_backup_and_wrong_device() {
        let root = std::env::temp_dir().join(format!("astra-backup-check-{}", std::process::id()));
        fs::create_dir(&root).unwrap();
        let target = Target {
            bus: 1,
            ports: vec![2],
        };
        let mut entries = Vec::new();
        for (partition, file) in PARTS {
            let path = root.join(file);
            fs::write(&path, b"test partition bytes").unwrap();
            entries.push(json!({"partition":partition,"file":file,"bytes":20,"sha256":file_hash(&path).unwrap()}));
        }
        let record = json!({"schema":1,"kind":"astra-thing-stock-backup","verified":true,"target":target,"partitions":entries});
        fs::write(
            root.join("backup.json"),
            serde_json::to_vec(&record).unwrap(),
        )
        .unwrap();
        assert!(verify(&root, &target).is_ok());
        assert!(
            verify(
                &root,
                &Target {
                    bus: 1,
                    ports: vec![3]
                }
            )
            .is_err()
        );
        fs::write(root.join("data.ext4"), b"changed data").unwrap();
        assert!(verify(&root, &target).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
