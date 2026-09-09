pub const FLAG_EMPTY: i32 = 0;
pub const FLAG_DATA: i32 = 1;
pub const FLAG_CLOSED: i32 = 2;

pub const OFFSET_FLAG: usize = 0;
pub const OFFSET_WRITE_HEAD: usize = 4;
pub const OFFSET_READ_HEAD: usize = 8;
pub const OFFSET_CAPACITY: usize = 12;
pub const OFFSET_DATA: usize = 16;
pub const DEFAULT_BUFFER_CAPACITY: usize = 65536;

pub struct StdioRingBuffer {
    buffer: Vec<u8>,
    capacity: usize,
}

impl StdioRingBuffer {
    pub fn new(capacity: usize) -> Self {
        let total_size = OFFSET_DATA + capacity;
        let mut buffer = vec![0u8; total_size];

        // write capacity at offset 12
        let cap_bytes = (capacity as u32).to_le_bytes();
        buffer[OFFSET_CAPACITY..OFFSET_CAPACITY + 4].copy_from_slice(&cap_bytes);

        Self { buffer, capacity }
    }

    pub fn write_bytes(&mut self, data: &[u8]) -> usize {
        let write_head = u32::from_le_bytes(
            self.buffer[OFFSET_WRITE_HEAD..OFFSET_WRITE_HEAD + 4]
                .try_into()
                .unwrap(),
        ) as usize;
        let read_head = u32::from_le_bytes(
            self.buffer[OFFSET_READ_HEAD..OFFSET_READ_HEAD + 4]
                .try_into()
                .unwrap(),
        ) as usize;

        let available_space = if write_head >= read_head {
            self.capacity - (write_head - read_head) - 1
        } else {
            read_head - write_head - 1
        };

        let to_write = data.len().min(available_space);
        if to_write == 0 {
            return 0;
        }

        let mut current_write = write_head;
        for &byte in &data[..to_write] {
            self.buffer[OFFSET_DATA + current_write] = byte;
            current_write = (current_write + 1) % self.capacity;
        }

        // update write head
        self.buffer[OFFSET_WRITE_HEAD..OFFSET_WRITE_HEAD + 4]
            .copy_from_slice(&(current_write as u32).to_le_bytes());

        // set flag to FLAG_DATA
        self.buffer[OFFSET_FLAG..OFFSET_FLAG + 4]
            .copy_from_slice(&FLAG_DATA.to_le_bytes());

        to_write
    }

    pub fn read_bytes(&mut self, out: &mut [u8]) -> usize {
        let write_head = u32::from_le_bytes(
            self.buffer[OFFSET_WRITE_HEAD..OFFSET_WRITE_HEAD + 4]
                .try_into()
                .unwrap(),
        ) as usize;
        let read_head = u32::from_le_bytes(
            self.buffer[OFFSET_READ_HEAD..OFFSET_READ_HEAD + 4]
                .try_into()
                .unwrap(),
        ) as usize;

        let available_data = if write_head >= read_head {
            write_head - read_head
        } else {
            self.capacity - (read_head - write_head)
        };

        let to_read = out.len().min(available_data);
        if to_read == 0 {
            return 0;
        }

        let mut current_read = read_head;
        for i in 0..to_read {
            out[i] = self.buffer[OFFSET_DATA + current_read];
            current_read = (current_read + 1) % self.capacity;
        }

        // update read head
        self.buffer[OFFSET_READ_HEAD..OFFSET_READ_HEAD + 4]
            .copy_from_slice(&(current_read as u32).to_le_bytes());

        // if empty, update flag
        if current_read == write_head {
            self.buffer[OFFSET_FLAG..OFFSET_FLAG + 4]
                .copy_from_slice(&FLAG_EMPTY.to_le_bytes());
        }

        to_read
    }

    pub fn close(&mut self) {
        self.buffer[OFFSET_FLAG..OFFSET_FLAG + 4]
            .copy_from_slice(&FLAG_CLOSED.to_le_bytes());
    }

    pub fn as_slice(&self) -> &[u8] {
        &self.buffer
    }

    pub fn as_mut_slice(&mut self) -> &mut [u8] {
        &mut self.buffer
    }
}
