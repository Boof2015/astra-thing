// SPDX-License-Identifier: GPL-3.0-only
use crate::{Result, backup, emit};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::{BufReader, Read, Seek, SeekFrom, Write},
    path::Path,
};

fn u32le(b: &[u8], at: usize) -> u32 {
    u32::from_le_bytes(b[at..at + 4].try_into().unwrap())
}
fn u64le(b: &[u8], at: usize) -> u64 {
    u64::from_le_bytes(b[at..at + 8].try_into().unwrap())
}
fn require(ok: bool, message: &str) -> Result<()> {
    if ok { Ok(()) } else { Err(message.into()) }
}
struct Gpt {
    backup: u64,
    first: u64,
    last: u64,
    guid: Vec<u8>,
    table: Vec<u8>,
}
fn gpt(file: &mut File, lba: u64, length: u64) -> Result<Gpt> {
    require(lba < length / 512, "GPT header outside image")?;
    file.seek(SeekFrom::Start(lba * 512))?;
    let mut header = [0; 512];
    file.read_exact(&mut header)?;
    require(&header[..8] == b"EFI PART", "Missing GPT header")?;
    let size = u32le(&header, 12) as usize;
    require(
        u32le(&header, 8) == 0x10000 && (92..=512).contains(&size) && u32le(&header, 20) == 0,
        "Invalid GPT header",
    )?;
    let crc = u32le(&header, 16);
    header[16..20].fill(0);
    require(
        crc32fast::hash(&header[..size]) == crc,
        "GPT header checksum failed",
    )?;
    let count = u32le(&header, 80) as u64;
    let start = u64le(&header, 72).checked_mul(512).ok_or("GPT overflow")?;
    require(
        u64le(&header, 24) == lba
            && count > 0
            && count <= 1024
            && u32le(&header, 84) == 128
            && start
                .checked_add(count * 128)
                .is_some_and(|end| end <= length),
        "Invalid GPT table bounds",
    )?;
    file.seek(SeekFrom::Start(start))?;
    let mut table = vec![0; count as usize * 128];
    file.read_exact(&mut table)?;
    require(
        crc32fast::hash(&table) == u32le(&header, 88),
        "GPT table checksum failed",
    )?;
    Ok(Gpt {
        backup: u64le(&header, 32),
        first: u64le(&header, 40),
        last: u64le(&header, 48),
        guid: header[56..72].to_vec(),
        table,
    })
}

pub fn verify(
    path: &Path,
    expected_hash: &str,
    expected_size: u64,
    scratch: &Path,
) -> Result<Value> {
    require(
        expected_hash.len() == 64 && expected_hash.bytes().all(|b| b.is_ascii_hexdigit()),
        "Invalid expected firmware hash",
    )?;
    require(
        fs::metadata(path)?.len() == expected_size && backup::file_hash(path)? == expected_hash,
        "Firmware package hash or size mismatch",
    )?;
    let mut archive = zip::ZipArchive::new(BufReader::new(File::open(path)?))?;
    require(archive.len() == 4, "Unexpected firmware package contents")?;
    let mut names = archive.file_names().collect::<Vec<_>>();
    names.sort_unstable();
    require(
        names
            == [
                "bandaid.ext4",
                "meta.json",
                "superbird-boot.bin",
                "superbird.wic",
            ],
        "Unexpected firmware package members",
    )?;
    let length = archive.by_name("superbird.wic")?.size();
    require(
        length > 0 && length % 512 == 0 && length < 3600 * 1024 * 1024,
        "Unsupported first-install image size",
    )?;
    require(
        fs2::available_space(scratch.parent().ok_or("Invalid verification directory")?)?
            > length + 64 * 1024 * 1024,
        "Not enough disk space to verify firmware",
    )?;
    let mut disk = backup::private_file(scratch)?;
    let result = (|| -> Result<Value> {
        let mut hashes = serde_json::Map::new();
        for name in [
            "meta.json",
            "superbird-boot.bin",
            "superbird.wic",
            "bandaid.ext4",
        ] {
            let mut input = archive.by_name(name)?;
            let limit = match name {
                "meta.json" => 65536,
                "superbird-boot.bin" => 2 * 1024 * 1024,
                "bandaid.ext4" => 1024 * 1024 * 1024,
                _ => length,
            };
            require(
                input.size() > 0 && input.size() <= limit,
                "Firmware member exceeds size limit",
            )?;
            let mut buffer = vec![0; 1024 * 1024];
            let mut hash = Sha256::new();
            let mut nbytes = 0u64;
            loop {
                let n = input.read(&mut buffer)?;
                if n == 0 {
                    break;
                }
                hash.update(&buffer[..n]);
                nbytes += n as u64;
                if name == "superbird.wic" {
                    disk.write_all(&buffer[..n])?;
                    emit(
                        json!({"event":"progress","stage":"Checking firmware package","percent":nbytes*100/length}),
                    );
                }
            }
            require(nbytes == input.size(), "Truncated firmware member")?;
            hashes.insert(
                name.into(),
                json!({"bytes":nbytes,"sha256":format!("{:x}",hash.finalize())}),
            );
        }
        disk.sync_all()?;
        drop(disk);
        let mut disk = File::open(scratch)?;
        disk.seek(SeekFrom::Start(510))?;
        let mut marker = [0; 2];
        disk.read_exact(&mut marker)?;
        require(marker == [0x55, 0xaa], "Missing protective MBR")?;
        let primary = gpt(&mut disk, 1, length)?;
        require(
            primary.backup == length / 512 - 1,
            "Backup GPT outside image end",
        )?;
        let secondary = gpt(&mut disk, primary.backup, length)?;
        require(
            secondary.backup == 1
                && primary.first == secondary.first
                && primary.last == secondary.last
                && primary.guid == secondary.guid
                && primary.table == secondary.table,
            "GPT copies disagree",
        )?;
        require(
            primary.first >= 34 && primary.first <= primary.last && primary.last < primary.backup,
            "Invalid GPT usable range",
        )?;
        let mut parts = Vec::new();
        let mut last = 0;
        for entry in primary
            .table
            .chunks_exact(128)
            .filter(|e| e[..16] != [0; 16])
        {
            let start = u64le(entry, 32);
            let end = u64le(entry, 40);
            require(
                start >= primary.first && start > last && end >= start && end <= primary.last,
                "Invalid or overlapping partitions",
            )?;
            last = end;
            let name = String::from_utf16(
                &entry[56..128]
                    .chunks_exact(2)
                    .map(|s| u16::from_le_bytes([s[0], s[1]]))
                    .take_while(|&n| n != 0)
                    .collect::<Vec<_>>(),
            )?;
            parts.push(json!({"name":name,"start":start,"bytes":(end-start+1)*512}));
        }
        require(
            parts
                .iter()
                .map(|p| p["name"].as_str().unwrap())
                .collect::<Vec<_>>()
                == ["env", "boot_a", "root_a", "boot_b", "root_b", "bandaid"],
            "Unsupported firmware partition layout",
        )?;
        let mut meta = String::new();
        archive.by_name("meta.json")?.read_to_string(&mut meta)?;
        let meta: Value = serde_json::from_str(&meta)?;
        require(
            meta["metadataVersion"] == 2
                && matches!(
                    meta["name"].as_str(),
                    Some("astra-thing-image" | "astra-thing-dev-image")
                ),
            "Wrong firmware model or format",
        )?;
        let expected = json!([
            {"type":"bulkcmd","value":"amlmmc key"},
            {"type":"writeBootPartition","value":{"hwpart":1,"data":{"filePath":"superbird-boot.bin"}}},
            {"type":"writeBootPartition","value":{"hwpart":2,"data":{"filePath":"superbird-boot.bin"}}},
            {"type":"writeUserArea","value":{"lba":0,"data":{"filePath":"superbird.wic"},"sparse":true}},
            {"type":"writeUserArea","value":{"lba":parts[5]["start"],"data":{"filePath":"bandaid.ext4"}}}
        ]);
        require(
            meta["steps"] == expected,
            "Firmware requests unapproved flash operations",
        )?;
        let bandaid = hashes["bandaid.ext4"]["bytes"].as_u64().unwrap();
        require(
            bandaid % 512 == 0
                && bandaid <= parts[5]["bytes"].as_u64().unwrap()
                && hashes["superbird-boot.bin"]["bytes"].as_u64().unwrap() % 512 == 0,
            "Boot or data payload does not fit",
        )?;
        Ok(
            json!({"metadata":meta,"partitions":parts,"members":hashes,"sha256":expected_hash,"bytes":expected_size}),
        )
    })();
    let _ = fs::remove_file(scratch);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_invalid_hash_before_opening_archive() {
        let err = verify(Path::new("missing"), "bad", 10, Path::new("missing.tmp")).unwrap_err();
        assert!(err.to_string().contains("hash"));
    }
    #[test]
    fn rejects_out_of_bounds_gpt() {
        let path = std::env::temp_dir().join(format!("astra-gpt-{}", std::process::id()));
        fs::write(&path, [0; 512]).unwrap();
        let mut f = File::open(&path).unwrap();
        assert!(gpt(&mut f, 2, 512).is_err());
        drop(f);
        fs::remove_file(path).unwrap();
    }
}
