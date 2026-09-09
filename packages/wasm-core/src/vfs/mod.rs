pub mod file;
pub mod inode;
pub mod symlink;

use self::file::{FileMeta, INodeKind};
use self::inode::{InodeTable, ROOT_INODE_ID};
use self::symlink::{normalize_path, resolve_path};
use crate::error::{Result, SandboxError};

pub struct VirtualFS {
    table: InodeTable,
}

impl VirtualFS {
    pub fn new() -> Self {
        Self {
            table: InodeTable::new(),
        }
    }

    pub fn write_file(&mut self, path: &str, data: &[u8]) -> Result<()> {
        let parts = normalize_path(path);
        if parts.is_empty() {
            return Err(SandboxError::InvalidPath("Cannot write to root".into()));
        }

        let (filename, dir_parts) = parts.split_last().unwrap();
        let dir_id = self.ensure_dir_path(dir_parts)?;

        let existing_inode_id = {
            let dir_node = self.table.get(dir_id)?;
            match &dir_node.kind {
                INodeKind::Directory { children } => children.get(filename).copied(),
                _ => return Err(SandboxError::NotADirectory(format!("{:?}", dir_parts))),
            }
        };

        if let Some(id) = existing_inode_id {
            let node = self.table.get_mut(id)?;
            match &mut node.kind {
                INodeKind::File { data: buf } => {
                    buf.clear();
                    buf.extend_from_slice(data);
                    node.meta.size = data.len() as u64;
                    node.meta.mtime_ms = js_sys::Date::now();
                    return Ok(());
                }
                INodeKind::Directory { .. } => {
                    return Err(SandboxError::IsADirectory(path.to_string()));
                }
                INodeKind::Symlink { .. } => {
                    // Resolve target and write to target
                    let target_id = resolve_path(&self.table, path)?;
                    let target_node = self.table.get_mut(target_id)?;
                    if let INodeKind::File { data: buf } = &mut target_node.kind {
                        buf.clear();
                        buf.extend_from_slice(data);
                        target_node.meta.size = data.len() as u64;
                        target_node.meta.mtime_ms = js_sys::Date::now();
                        return Ok(());
                    } else {
                        return Err(SandboxError::IsADirectory(path.to_string()));
                    }
                }
            }
        }

        let file_id = self.table.allocate_file(data.to_vec(), 0o644);
        let dir_node = self.table.get_mut(dir_id)?;
        if let INodeKind::Directory { children } = &mut dir_node.kind {
            children.insert(filename.clone(), file_id);
            dir_node.meta.mtime_ms = js_sys::Date::now();
        }

        Ok(())
    }

    pub fn read_file(&self, path: &str) -> Result<Vec<u8>> {
        let inode_id = resolve_path(&self.table, path)?;
        let node = self.table.get(inode_id)?;
        match &node.kind {
            INodeKind::File { data } => Ok(data.clone()),
            INodeKind::Directory { .. } => Err(SandboxError::IsADirectory(path.to_string())),
            INodeKind::Symlink { .. } => unreachable!("resolve_path fully resolves symlinks"),
        }
    }

    pub fn mkdir(&mut self, path: &str, recursive: bool) -> Result<()> {
        let parts = normalize_path(path);
        if parts.is_empty() {
            return Ok(());
        }

        if recursive {
            let mut current = ROOT_INODE_ID;
            for part in &parts {
                let next = {
                    let node = self.table.get(current)?;
                    match &node.kind {
                        INodeKind::Directory { children } => children.get(part).copied(),
                        _ => return Err(SandboxError::NotADirectory(part.to_string())),
                    }
                };

                match next {
                    Some(id) => {
                        let node = self.table.get(id)?;
                        if !node.is_dir() {
                            return Err(SandboxError::NotADirectory(part.to_string()));
                        }
                        current = id;
                    }
                    None => {
                        let new_id = self.table.allocate_dir(0o755);
                        let node = self.table.get_mut(current)?;
                        if let INodeKind::Directory { children } = &mut node.kind {
                            children.insert(part.clone(), new_id);
                        }
                        current = new_id;
                    }
                }
            }
            Ok(())
        } else {
            let (dirname, parent_parts) = parts.split_last().unwrap();
            let parent_id = self.resolve_dir_parts(parent_parts)?;

            let node = self.table.get(parent_id)?;
            if let INodeKind::Directory { children } = &node.kind {
                if children.contains_key(dirname) {
                    return Err(SandboxError::AlreadyExists(path.to_string()));
                }
            }

            let new_id = self.table.allocate_dir(0o755);
            let parent_node = self.table.get_mut(parent_id)?;
            if let INodeKind::Directory { children } = &mut parent_node.kind {
                children.insert(dirname.clone(), new_id);
            }
            Ok(())
        }
    }

    pub fn readdir(&self, path: &str) -> Result<Vec<String>> {
        let inode_id = resolve_path(&self.table, path)?;
        let node = self.table.get(inode_id)?;
        match &node.kind {
            INodeKind::Directory { children } => Ok(children.keys().cloned().collect()),
            _ => Err(SandboxError::NotADirectory(path.to_string())),
        }
    }

    pub fn stat(&self, path: &str) -> Result<FileMeta> {
        let inode_id = resolve_path(&self.table, path)?;
        let node = self.table.get(inode_id)?;
        Ok(node.meta.clone())
    }

    pub fn rm(&mut self, path: &str, recursive: bool) -> Result<()> {
        let parts = normalize_path(path);
        if parts.is_empty() {
            return Err(SandboxError::InvalidPath("Cannot delete root directory".into()));
        }

        let (target_name, parent_parts) = parts.split_last().unwrap();
        let parent_id = self.resolve_dir_parts(parent_parts)?;

        let target_id = {
            let parent = self.table.get(parent_id)?;
            match &parent.kind {
                INodeKind::Directory { children } => children
                    .get(target_name)
                    .copied()
                    .ok_or_else(|| SandboxError::NotFound(path.to_string()))?,
                _ => return Err(SandboxError::NotADirectory(path.to_string())),
            }
        };

        {
            let target_node = self.table.get(target_id)?;
            if let INodeKind::Directory { children } = &target_node.kind {
                if !children.is_empty() && !recursive {
                    return Err(SandboxError::DirectoryNotEmpty(path.to_string()));
                }
            }
        }

        if recursive {
            self.remove_recursive(target_id)?;
        } else {
            self.table.remove(target_id)?;
        }

        let parent = self.table.get_mut(parent_id)?;
        if let INodeKind::Directory { children } = &mut parent.kind {
            children.remove(target_name);
        }

        Ok(())
    }

    pub fn symlink(&mut self, target: &str, path: &str) -> Result<()> {
        let parts = normalize_path(path);
        if parts.is_empty() {
            return Err(SandboxError::InvalidPath("Cannot link to root".into()));
        }

        let (link_name, dir_parts) = parts.split_last().unwrap();
        let dir_id = self.ensure_dir_path(dir_parts)?;

        let link_id = self.table.allocate_symlink(target.to_string());
        let dir = self.table.get_mut(dir_id)?;
        if let INodeKind::Directory { children } = &mut dir.kind {
            children.insert(link_name.clone(), link_id);
        }
        Ok(())
    }

    fn remove_recursive(&mut self, id: u64) -> Result<()> {
        let node = self.table.get(id)?;
        if let INodeKind::Directory { children } = &node.kind {
            let child_ids: Vec<u64> = children.values().copied().collect();
            for cid in child_ids {
                self.remove_recursive(cid)?;
            }
        }
        self.table.remove(id)?;
        Ok(())
    }

    fn resolve_dir_parts(&self, parts: &[String]) -> Result<u64> {
        let mut current = ROOT_INODE_ID;
        for part in parts {
            let node = self.table.get(current)?;
            match &node.kind {
                INodeKind::Directory { children } => {
                    current = *children
                        .get(part)
                        .ok_or_else(|| SandboxError::NotFound(part.to_string()))?;
                }
                _ => return Err(SandboxError::NotADirectory(part.to_string())),
            }
        }
        Ok(current)
    }

    fn ensure_dir_path(&mut self, parts: &[String]) -> Result<u64> {
        let mut current = ROOT_INODE_ID;
        for part in parts {
            let next = {
                let node = self.table.get(current)?;
                match &node.kind {
                    INodeKind::Directory { children } => children.get(part).copied(),
                    _ => return Err(SandboxError::NotADirectory(part.to_string())),
                }
            };

            match next {
                Some(id) => current = id,
                None => {
                    let new_id = self.table.allocate_dir(0o755);
                    let node = self.table.get_mut(current)?;
                    if let INodeKind::Directory { children } = &mut node.kind {
                        children.insert(part.clone(), new_id);
                    }
                    current = new_id;
                }
            }
        }
        Ok(current)
    }
}
