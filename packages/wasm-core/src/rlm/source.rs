use std::fmt::Debug;

/// Abstract byte source for document context.
/// Implemented by MemSource (in-memory, native tests & fallback)
/// and OpfsSource (WASM target with FileSystemSyncAccessHandle).
pub trait ByteSource: Debug + Send + Sync {
    fn len(&self) -> u64;

    fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Reads up to buf.len() bytes starting at offset into buf. Returns bytes read.
    fn read_at(&self, offset: u64, buf: &mut [u8]) -> Result<usize, String>;
}

/// In-memory byte source backed by Vec<u8>.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct MemSource {
    data: Vec<u8>,
}

impl MemSource {
    pub fn new(data: Vec<u8>) -> Self {
        Self { data }
    }

    pub fn from_str(s: &str) -> Self {
        Self {
            data: s.as_bytes().to_vec(),
        }
    }

    pub fn as_bytes(&self) -> &[u8] {
        &self.data
    }
}

impl ByteSource for MemSource {
    fn len(&self) -> u64 {
        self.data.len() as u64
    }

    fn read_at(&self, offset: u64, buf: &mut [u8]) -> Result<usize, String> {
        let total = self.data.len() as u64;
        if offset >= total {
            return Ok(0);
        }
        let available = (total - offset) as usize;
        let to_read = buf.len().min(available);
        let start = offset as usize;
        buf[..to_read].copy_from_slice(&self.data[start..start + to_read]);
        Ok(to_read)
    }
}

#[cfg(target_arch = "wasm32")]
use web_sys::FileSystemSyncAccessHandle;

#[cfg(target_arch = "wasm32")]
pub struct OpfsSource {
    handle: FileSystemSyncAccessHandle,
    size: u64,
}

#[cfg(target_arch = "wasm32")]
impl std::fmt::Debug for OpfsSource {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("OpfsSource").field("size", &self.size).finish()
    }
}

#[cfg(target_arch = "wasm32")]
impl OpfsSource {
    pub fn new(handle: FileSystemSyncAccessHandle) -> Result<Self, String> {
        let size = handle
            .get_size()
            .map_err(|e| format!("Failed to get OPFS file size: {:?}", e))? as u64;
        Ok(Self { handle, size })
    }

    pub fn close(&self) {
        let _ = self.handle.close();
    }
}

#[cfg(target_arch = "wasm32")]
impl ByteSource for OpfsSource {
    fn len(&self) -> u64 {
        self.size
    }

    fn read_at(&self, offset: u64, buf: &mut [u8]) -> Result<usize, String> {
        if offset >= self.size {
            return Ok(0);
        }
        let mut opts = web_sys::FileSystemReadWriteOptions::new();
        opts.set_at(offset as f64);
        let bytes_read = self
            .handle
            .read_with_u8_array_and_options(buf, &opts)
            .map_err(|e| format!("OPFS read error: {:?}", e))?;
        Ok(bytes_read as usize)
    }
}
