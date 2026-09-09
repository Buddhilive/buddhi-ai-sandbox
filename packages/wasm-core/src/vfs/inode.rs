use std::collections::{BTreeMap, HashMap};
use super::file::{FileMeta, INode, INodeKind};
use crate::error::{Result, SandboxError};

pub const ROOT_INODE_ID: u64 = 1;

pub struct InodeTable {
    nodes: HashMap<u64, INode>,
    next_id: u64,
}

impl InodeTable {
    pub fn new() -> Self {
        let mut table = Self {
            nodes: HashMap::new(),
            next_id: 2,
        };

        // Initialize root directory at inode 1
        let root = INode {
            id: ROOT_INODE_ID,
            meta: FileMeta::new_dir(0o755),
            kind: INodeKind::Directory {
                children: BTreeMap::new(),
            },
        };
        table.nodes.insert(ROOT_INODE_ID, root);
        table
    }

    pub fn get(&self, id: u64) -> Result<&INode> {
        self.nodes.get(&id).ok_or(SandboxError::NotFound(format!("inode {}", id)))
    }

    pub fn get_mut(&mut self, id: u64) -> Result<&mut INode> {
        self.nodes.get_mut(&id).ok_or(SandboxError::NotFound(format!("inode {}", id)))
    }

    pub fn allocate_file(&mut self, data: Vec<u8>, mode: u32) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        let mut meta = FileMeta::new_file(mode);
        meta.size = data.len() as u64;

        let node = INode {
            id,
            meta,
            kind: INodeKind::File { data },
        };
        self.nodes.insert(id, node);
        id
    }

    pub fn allocate_dir(&mut self, mode: u32) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        let meta = FileMeta::new_dir(mode);

        let node = INode {
            id,
            meta,
            kind: INodeKind::Directory {
                children: BTreeMap::new(),
            },
        };
        self.nodes.insert(id, node);
        id
    }

    pub fn allocate_symlink(&mut self, target: String) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        let meta = FileMeta::new_symlink();

        let node = INode {
            id,
            meta,
            kind: INodeKind::Symlink { target },
        };
        self.nodes.insert(id, node);
        id
    }

    pub fn remove(&mut self, id: u64) -> Result<INode> {
        if id == ROOT_INODE_ID {
            return Err(SandboxError::InvalidPath("Cannot remove root inode".into()));
        }
        self.nodes.remove(&id).ok_or(SandboxError::NotFound(format!("inode {}", id)))
    }
}
