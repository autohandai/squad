//! Native confirmation guard only. The ownership broker owns durable reset
//! operations and recovers them by owner/dataset, never by a process ID.
use crate::{default_paths, lock, require_native_context, Shell, MAIN_WINDOW};
use std::sync::Arc;
use tauri::{AppHandle, Manager, WebviewWindow};

#[derive(Default, Debug)]
pub struct ResetGuard {
    generation: Option<String>,
    working: bool,
}
impl ResetGuard {
    pub fn blocks_quit(&self) -> bool {
        let current = autohand_squad_runtime::ownership::read_active_context(&default_paths())
            .ok()
            .flatten()
            .map(|context| context.generation);
        self.blocks_for(current.as_deref())
    }
    fn stage(&mut self, stage: &str, generation: &str) -> Result<(), String> {
        match stage {
            "confirm"
                if self.generation.is_none()
                    || self.generation.as_deref() == Some(generation) && !self.working =>
            {
                self.generation = Some(generation.into());
                self.working = false;
            }
            "idle"
                if self.generation.is_none() || self.generation.as_deref() == Some(generation) =>
            {
                *self = Self::default();
            }
            "working" if self.generation.as_deref() == Some(generation) && !self.working => {
                self.working = true;
            }
            _ => return Err("Finish the current reset confirmation first.".into()),
        }
        Ok(())
    }
    fn blocks_for(&self, current: Option<&str>) -> bool {
        self.generation.is_some() && self.generation.as_deref() == current
    }
}
pub fn blocked(app: &AppHandle) -> bool {
    let generation = autohand_squad_runtime::ownership::read_active_context(&default_paths())
        .ok()
        .flatten()
        .map(|context| context.generation);
    app.try_state::<Arc<Shell>>()
        .is_some_and(|shell| lock(&shell.reset).blocks_for(generation.as_deref()))
}
pub fn invalidate(shell: &Shell) {
    let current = autohand_squad_runtime::ownership::read_active_context(&default_paths())
        .ok()
        .flatten()
        .map(|context| context.generation);
    let mut guard = lock(&shell.reset);
    if guard.generation.as_deref() != current.as_deref() {
        *guard = ResetGuard::default();
    }
}

#[tauri::command]
pub fn squad_set_system_reset_stage(
    window: WebviewWindow,
    shell: tauri::State<'_, Arc<Shell>>,
    stage: String,
    context_generation: String,
) -> Result<(), String> {
    let base = lock(&shell.app_url)
        .clone()
        .ok_or("Squad is still starting.")?;
    let expected = reqwest::Url::parse(&base)
        .map_err(|error| error.to_string())?
        .origin();
    if window.label() != MAIN_WINDOW
        || window.url().map_err(|error| error.to_string())?.origin() != expected
    {
        return Err("Reset is only available from Squad's main window.".into());
    }
    require_native_context(&context_generation, true)?;
    lock(&shell.reset).stage(&stage, &context_generation)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn confirmation_is_owned_by_one_generation() {
        let mut guard = ResetGuard::default();
        assert!(!guard.blocks_for(Some("a")));
        guard.stage("confirm", "a").unwrap();
        assert!(guard.blocks_for(Some("a")));
        assert!(!guard.blocks_for(Some("b")));
        assert!(guard.stage("idle", "b").is_err());
        guard.stage("idle", "a").unwrap();
        guard.stage("confirm", "a").unwrap();
        guard.stage("working", "a").unwrap();
        guard.stage("idle", "a").unwrap(); // frontend can cancel an unadmitted/failed request
        assert!(!guard.blocks_for(None)); // broker fenced the old dataset
    }
}
