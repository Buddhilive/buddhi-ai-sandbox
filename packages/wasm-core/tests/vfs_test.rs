use buddhilive_sandbox_core::vfs::VirtualFS;
use buddhilive_sandbox_core::error::SandboxError;

#[test]
fn test_vfs_write_and_read_file() {
    let mut vfs = VirtualFS::new();
    let data = b"Hello from VirtualFS!";
    vfs.write_file("/workspace/test.txt", data).expect("Failed to write file");

    let read_back = vfs.read_file("/workspace/test.txt").expect("Failed to read file");
    assert_eq!(read_back, data);
}

#[test]
fn test_vfs_overwrite_file() {
    let mut vfs = VirtualFS::new();
    vfs.write_file("/file.txt", b"Version 1").expect("Write initial");
    vfs.write_file("/file.txt", b"Version 2 (updated)").expect("Write overwrite");

    let content = vfs.read_file("/file.txt").expect("Read overwrite");
    assert_eq!(content, b"Version 2 (updated)");

    let stat = vfs.stat("/file.txt").expect("Stat");
    assert_eq!(stat.size, b"Version 2 (updated)".len() as u64);
}

#[test]
fn test_vfs_mkdir_and_readdir() {
    let mut vfs = VirtualFS::new();
    vfs.mkdir("/app/src/components", true).expect("Recursive mkdir");
    vfs.write_file("/app/src/index.js", b"console.log(1);").expect("Write 1");
    vfs.write_file("/app/src/utils.js", b"console.log(2);").expect("Write 2");

    let entries = vfs.readdir("/app/src").expect("Readdir");
    assert!(entries.contains(&"components".to_string()));
    assert!(entries.contains(&"index.js".to_string()));
    assert!(entries.contains(&"utils.js".to_string()));
}

#[test]
fn test_vfs_rm_file_and_recursive_dir() {
    let mut vfs = VirtualFS::new();
    vfs.write_file("/temp/file1.txt", b"1").expect("Write");
    vfs.write_file("/temp/file2.txt", b"2").expect("Write");

    // Non-recursive rm on non-empty dir should fail with DirectoryNotEmpty
    let err = vfs.rm("/temp", false);
    assert!(matches!(err, Err(SandboxError::DirectoryNotEmpty(_))));

    // Recursive rm should succeed
    vfs.rm("/temp", true).expect("Recursive rm");
    let read_err = vfs.read_file("/temp/file1.txt");
    assert!(matches!(read_err, Err(SandboxError::NotFound(_))));
}

#[test]
fn test_vfs_symlink_resolution() {
    let mut vfs = VirtualFS::new();
    vfs.write_file("/target.txt", b"Target content").expect("Write target");
    vfs.symlink("/target.txt", "/link.txt").expect("Create symlink");

    let content = vfs.read_file("/link.txt").expect("Read via symlink");
    assert_eq!(content, b"Target content");
}

#[test]
fn test_vfs_symlink_loop_detection() {
    let mut vfs = VirtualFS::new();
    vfs.symlink("/link_b", "/link_a").expect("Symlink A -> B");
    vfs.symlink("/link_a", "/link_b").expect("Symlink B -> A");

    let err = vfs.read_file("/link_a");
    assert!(matches!(err, Err(SandboxError::TooManyLinks)));
}

#[test]
fn test_vfs_not_found_error() {
    let vfs = VirtualFS::new();
    let err = vfs.read_file("/non_existent_file.txt");
    assert!(matches!(err, Err(SandboxError::NotFound(_))));
}
