use std::collections::HashMap;

#[derive(Clone, Debug, Default)]
pub struct VariableStore {
    pub variables: HashMap<String, String>,
}

impl VariableStore {
    pub fn new() -> Self {
        Self {
            variables: HashMap::new(),
        }
    }

    pub fn set(&mut self, key: &str, value: &str) {
        self.variables.insert(key.to_string(), value.to_string());
    }

    pub fn get(&self, key: &str) -> Option<&str> {
        self.variables.get(key).map(|s| s.as_str())
    }

    pub fn has(&self, key: &str) -> bool {
        self.variables.contains_key(key)
    }

    pub fn remove(&mut self, key: &str) -> Option<String> {
        self.variables.remove(key)
    }

    pub fn clear(&mut self) {
        self.variables.clear();
    }

    pub fn len(&self) -> usize {
        self.variables.len()
    }

    pub fn is_empty(&self) -> bool {
        self.variables.is_empty()
    }

    pub fn list_keys(&self) -> Vec<String> {
        let mut keys: Vec<String> = self.variables.keys().cloned().collect();
        keys.sort();
        keys
    }

    /// Formats persistent variables as a readable Python REPL state preview
    pub fn format_state_summary(&self) -> String {
        if self.variables.is_empty() {
            return "Variables: none".to_string();
        }

        let mut lines = Vec::new();
        lines.push("Current Variables:".to_string());
        for key in self.list_keys() {
            let val = self.variables.get(&key).unwrap();
            let preview = if val.len() > 60 {
                format!("{}... [len={}]", &val[..57], val.len())
            } else {
                val.clone()
            };
            lines.push(format!("  {} = {:?}", key, preview));
        }
        lines.join("\n")
    }
}
