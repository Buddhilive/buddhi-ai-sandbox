use buddhilive_sandbox_core::process::io::{
    StdioRingBuffer, FLAG_CLOSED, FLAG_DATA, FLAG_EMPTY, OFFSET_FLAG,
};

#[test]
fn test_ring_buffer_write_read_roundtrip() {
    let mut ring = StdioRingBuffer::new(1024);
    let message = b"Hello from Rust WASM ring buffer test!";

    let written = ring.write_bytes(message);
    assert_eq!(written, message.len());

    let slice = ring.as_slice();
    let flag = i32::from_le_bytes(slice[OFFSET_FLAG..OFFSET_FLAG + 4].try_into().unwrap());
    assert_eq!(flag, FLAG_DATA);

    let mut out = [0u8; 128];
    let read = ring.read_bytes(&mut out);
    assert_eq!(read, message.len());
    assert_eq!(&out[..read], message);

    // After draining, flag should reset to empty
    let flag_after = i32::from_le_bytes(ring.as_slice()[OFFSET_FLAG..OFFSET_FLAG + 4].try_into().unwrap());
    assert_eq!(flag_after, FLAG_EMPTY);
}

#[test]
fn test_ring_buffer_wraparound() {
    let capacity = 32;
    let mut ring = StdioRingBuffer::new(capacity);

    // Write 20 bytes
    let part1 = b"01234567890123456789";
    ring.write_bytes(part1);

    // Read 15 bytes
    let mut buf1 = [0u8; 15];
    let r1 = ring.read_bytes(&mut buf1);
    assert_eq!(r1, 15);
    assert_eq!(&buf1, &part1[..15]);

    // Write 20 more bytes (causes circular wraparound)
    let part2 = b"abcdefghijklmnopqrst";
    let w2 = ring.write_bytes(part2);
    assert!(w2 > 0);

    // Drain all remaining
    let mut out = vec![0u8; 64];
    let r2 = ring.read_bytes(&mut out);
    assert!(r2 > 0);
}

#[test]
fn test_ring_buffer_close() {
    let mut ring = StdioRingBuffer::new(512);
    ring.close();

    let flag = i32::from_le_bytes(ring.as_slice()[OFFSET_FLAG..OFFSET_FLAG + 4].try_into().unwrap());
    assert_eq!(flag, FLAG_CLOSED);
}
