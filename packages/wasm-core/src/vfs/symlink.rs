use super::file::INodeKind;
use super::inode::{InodeTable, ROOT_INODE_ID};
use crate::error::{Result, SandboxError};

pub const MAX_SYMLINK_HOPS: usize = 40;

pub fn normalize_path(path: &str) -> Vec<String> {
    let mut parts = Vec::new();
    for seg in path.split('/') {
        if seg.is_empty() || seg == "." {
            continue;
        }
        if seg == ".." {
            parts.pop();
        } else {
            parts.push(seg.to_string());
        }
    }
    parts
}

pub fn resolve_path(table: &InodeTable, path: &str) -> Result<u64> {
    resolve_path_internal(table, path, 0)
}

fn resolve_path_internal(table: &InodeTable, path: &str, hops: usize) -> Result<u64> {
    if hops > MAX_SYMLINK_HOPS {
        return Err(SandboxError::TooManyLinks);
    }

    let parts = normalize_path(path);
    let mut current_id = ROOT_INODE_ID;

    for (idx, part) in parts.iter().enumerate() {
        let node = table.get(current_id)?;
        match &node.kind {
            INodeKind::Directory { children } => {
                current_id = *children
                    .get(part)
                    .ok_or_else(|| SandboxError::NotFound(path.to_string()))?;
            }
            INodeKind::Symlink { target } => {
                let remaining = &parts[idx..];
                let new_path = if target.starts_with('/') {
                    format!("{}/{}", target, remaining.join("/"))
                } else {
                    format!("{}/{}", target, remaining.join("/"))
                };
                return resolve_path_internal(table, &new_path, hops + 1);
            }
            INodeKind::File { .. } => {
                return Err(SandboxError::NotADirectory(part.to_string()));
            }
        }
    }

    // Check if the final node itself is a symlink that should be dereferenced if asked
    let final_node = table.get(current_id)?;
    if let INodeKind::Symlink { target } = &final_node.kind {
        return resolve_path_internal(table, target, hops + 1);
    }

    Ok(current_id)
}
