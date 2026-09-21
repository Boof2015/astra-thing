// SPDX-License-Identifier: GPL-3.0-only
// The transport interface comes from FlashThing (MIT; vendor/flashthing/LICENSE).
use flashthing::{
    DeviceMode, Error, Result,
    usb::{UsbTarget, UsbTransport},
};
use rusb::{Context, DeviceHandle, Direction, UsbContext};
use serde::{Deserialize, Serialize};
use std::{sync::Mutex, time::Duration};

const WAIT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Target {
    pub bus: u8,
    pub ports: Vec<u8>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub id: String,
    pub target: Target,
    pub mode: String,
    pub vendor_id: u16,
    pub product_id: u16,
    pub product: String,
    pub manufacturer: String,
    pub serial: String,
    pub accessible: bool,
}

fn relevant(vid: u16, pid: u16) -> bool {
    matches!(
        (vid, pid),
        (0x1b8e, 0xc003)
            | (0x18d1, 0x4e40)
            | (0x18d1, 0xfada)
            | (0x1d6b, 0x0104)
            | (0x1d6b, 0x1014)
    )
}

pub fn list() -> Result<Vec<Device>> {
    let context = Context::new()?;
    let mut found = Vec::new();
    for device in context.devices()?.iter() {
        let Ok(desc) = device.device_descriptor() else {
            continue;
        };
        if !relevant(desc.vendor_id(), desc.product_id()) {
            continue;
        }
        let Ok(ports) = device.port_numbers() else {
            continue;
        };
        let bus = device.bus_number();
        let handle = device.open();
        let accessible = handle.is_ok();
        let (product, manufacturer, serial) = if let Ok(handle) = handle {
            (
                handle.read_product_string_ascii(&desc).unwrap_or_default(),
                handle
                    .read_manufacturer_string_ascii(&desc)
                    .unwrap_or_default(),
                handle
                    .read_serial_number_string_ascii(&desc)
                    .unwrap_or_default(),
            )
        } else {
            (String::new(), String::new(), String::new())
        };
        // Linux's generic gadget VID:PID is shared by unrelated devices.
        if desc.vendor_id() == 0x1d6b
            && !["astra", "superbird"].iter().any(|s| {
                format!("{product} {manufacturer}")
                    .to_lowercase()
                    .contains(s)
            })
        {
            continue;
        }
        let mode = match (desc.vendor_id(), desc.product_id()) {
            (0x1b8e, 0xc003) => "recovery",
            (0x18d1, 0xfada) => "fastboot",
            (0x18d1, 0x4e40) => "stock",
            _ => "astra",
        };
        found.push(Device {
            id: format!(
                "{bus}:{}",
                ports
                    .iter()
                    .map(u8::to_string)
                    .collect::<Vec<_>>()
                    .join(".")
            ),
            target: Target { bus, ports },
            mode: mode.into(),
            vendor_id: desc.vendor_id(),
            product_id: desc.product_id(),
            product,
            manufacturer,
            serial,
            accessible,
        });
    }
    Ok(found)
}

struct Claimed {
    handle: DeviceHandle<Context>,
    interface: u8,
    input: u8,
    output: u8,
}
pub struct SelectedUsb {
    target: Target,
    claimed: Mutex<Option<Claimed>>,
}
impl SelectedUsb {
    pub fn new(target: Target) -> Result<Self> {
        if target.ports.is_empty() || target.ports.len() > 8 {
            return Err(Error::InvalidOperation(
                "Device has no stable USB port path".into(),
            ));
        }
        Ok(Self {
            target,
            claimed: Mutex::new(None),
        })
    }
    fn with<T>(&self, f: impl FnOnce(&Claimed) -> Result<T>) -> Result<T> {
        let guard = self.claimed.lock().unwrap();
        f(guard
            .as_ref()
            .ok_or_else(|| Error::InvalidOperation("USB device is not connected".into()))?)
    }
    fn release(&self) {
        if let Some(c) = self.claimed.lock().unwrap().take() {
            let _ = c.handle.release_interface(c.interface);
        }
    }
    fn open(&self, target: UsbTarget) -> Result<Claimed> {
        let context = Context::new()?;
        let device = context
            .devices()?
            .iter()
            .find(|d| {
                d.bus_number() == self.target.bus
                    && d.port_numbers().ok().as_ref() == Some(&self.target.ports)
            })
            .ok_or(Error::NotFound)?;
        let desc = device.device_descriptor()?;
        if (desc.vendor_id(), desc.product_id()) != target.ids() {
            return Err(Error::WrongMode);
        }
        let handle = device.open()?;
        if handle.active_configuration()? != 1 {
            handle.set_active_configuration(1)?;
        }
        let config = device.active_config_descriptor()?;
        let (interface, input, output) = config
            .interfaces()
            .flat_map(|i| i.descriptors())
            .filter(|d| match target {
                UsbTarget::Maskrom => d.interface_number() == 0,
                UsbTarget::Fastboot => {
                    d.class_code() == 0xff && d.sub_class_code() == 0x42 && d.protocol_code() == 3
                }
            })
            .find_map(|d| {
                let input = d
                    .endpoint_descriptors()
                    .find(|e| e.direction() == Direction::In)?
                    .address();
                let output = d
                    .endpoint_descriptors()
                    .find(|e| e.direction() == Direction::Out)?
                    .address();
                Some((d.interface_number(), input, output))
            })
            .ok_or_else(|| Error::InvalidOperation("Unexpected USB interface".into()))?;
        #[cfg(target_os = "linux")]
        handle.set_auto_detach_kernel_driver(true)?;
        handle.claim_interface(interface)?;
        Ok(Claimed {
            handle,
            interface,
            input,
            output,
        })
    }
}
impl UsbTransport for SelectedUsb {
    async fn control_out(&self, r: u8, v: u16, i: u16, b: &[u8], t: Duration) -> Result<usize> {
        self.with(|c| Ok(c.handle.write_control(0x40, r, v, i, b, t)?))
    }
    async fn control_in(&self, r: u8, v: u16, i: u16, b: &mut [u8], t: Duration) -> Result<usize> {
        self.with(|c| Ok(c.handle.read_control(0xc0, r, v, i, b, t)?))
    }
    async fn bulk_out(&self, b: &[u8], t: Duration) -> Result<usize> {
        self.with(|c| Ok(c.handle.write_bulk(c.output, b, t)?))
    }
    async fn bulk_in(&self, b: &mut [u8], t: Duration) -> Result<usize> {
        self.with(|c| Ok(c.handle.read_bulk(c.input, b, t)?))
    }
    async fn mode(&self) -> DeviceMode {
        match list()
            .ok()
            .and_then(|d| d.into_iter().find(|d| d.target == self.target))
        {
            Some(d) if d.accessible && d.mode == "recovery" && d.product == "GX-CHIP" => {
                DeviceMode::Usb
            }
            Some(d) if d.accessible && d.mode == "recovery" => DeviceMode::UsbBurn,
            Some(d) if d.mode == "fastboot" => DeviceMode::Fastboot,
            Some(_) => DeviceMode::Normal,
            None => DeviceMode::NotFound,
        }
    }
    async fn acquire(&self, target: UsbTarget) -> Result<()> {
        self.release();
        for _ in 0..8 {
            match self.open(target) {
                Ok(c) => {
                    *self.claimed.lock().unwrap() = Some(c);
                    return Ok(());
                }
                Err(Error::NotFound) => std::thread::sleep(Duration::from_secs(1)),
                Err(e) => return Err(e),
            }
        }
        Err(Error::NotFound)
    }
}
impl Drop for SelectedUsb {
    fn drop(&mut self) {
        self.release()
    }
}

pub async fn connect(target: Target) -> Result<flashthing::AmlogicSoC<SelectedUsb>> {
    let usb = SelectedUsb::new(target)?;
    let device =
        flashthing::AmlogicSoC::init(usb, flashthing::BL2_BIN, flashthing::BOOTLOADER_BIN, None)
            .await?;
    // Enumeration can finish before the RAM-loaded vendor command handler is ready.
    for attempt in 0..8 {
        match command(&device, "amlmmc part 1").await {
            Ok(()) => return Ok(device),
            Err(e) if attempt == 7 => return Err(e),
            Err(_) => std::thread::sleep(Duration::from_secs(1)),
        }
    }
    unreachable!()
}

pub async fn command(device: &flashthing::AmlogicSoC<SelectedUsb>, text: &str) -> Result<()> {
    let answer = device.bulkcmd(text).await?;
    if answer.trim() != "success" {
        return Err(Error::InvalidOperation(
            "Unexpected bootloader acknowledgement".into(),
        ));
    }
    Ok(())
}
pub const TIMEOUT: Duration = WAIT;
