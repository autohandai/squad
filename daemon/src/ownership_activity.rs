//! A drain acknowledgement means all admitted owned writers have finished,
//! including their process cleanup and final receipts. Hidden UI is not idle.
use anyhow::{bail, Result};
use std::sync::{Arc, Mutex};

#[derive(Default)]
struct State {
    operation: Option<String>,
    active: usize,
    uncertain_cleanup: bool,
    stopping: bool,
}

#[derive(Default)]
pub(crate) struct OwnershipActivity(Mutex<State>);

pub(crate) struct OwnedActivity {
    gate: Arc<OwnershipActivity>,
}

impl OwnershipActivity {
    pub(crate) fn begin(
        self: &Arc<Self>,
        authorized: impl FnOnce() -> bool,
    ) -> Option<OwnedActivity> {
        let mut state = self.0.lock().unwrap_or_else(|poison| poison.into_inner());
        if state.operation.is_some() || state.stopping || state.uncertain_cleanup || !authorized() {
            return None;
        }
        state.active += 1;
        Some(OwnedActivity { gate: self.clone() })
    }
    pub(crate) fn drain(&self, operation: &str) -> Result<()> {
        let mut state = self.0.lock().unwrap_or_else(|poison| poison.into_inner());
        if state
            .operation
            .as_deref()
            .is_some_and(|held| held != operation)
        {
            bail!("Another ownership operation holds the native drain");
        }
        state.operation = Some(operation.to_string());
        Ok(())
    }
    pub(crate) fn drained(&self, operation: &str) -> Result<bool> {
        let state = self.0.lock().unwrap_or_else(|poison| poison.into_inner());
        if state.operation.as_deref() != Some(operation) {
            bail!("Native drain ownership changed");
        }
        if state.uncertain_cleanup {
            bail!("Native process cleanup could not be confirmed; restart this service before changing data");
        }
        Ok(state.active == 0)
    }
    pub(crate) fn resume(&self, operation: &str) -> Result<()> {
        let mut state = self.0.lock().unwrap_or_else(|poison| poison.into_inner());
        if state.operation.as_deref() != Some(operation)
            || state.active != 0
            || state.uncertain_cleanup
        {
            bail!("This operation does not own a completed native drain");
        }
        state.operation = None;
        Ok(())
    }
    pub(crate) fn is_paused(&self) -> bool {
        let state = self.0.lock().unwrap_or_else(|poison| poison.into_inner());
        state.operation.is_some() || state.stopping || state.uncertain_cleanup
    }
    pub(crate) fn active(&self) -> usize {
        self.0
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .active
    }
    pub(crate) fn stop(&self) {
        self.0
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .stopping = true;
    }
    pub(crate) fn uncertain_cleanup(&self) {
        self.0
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .uncertain_cleanup = true;
    }
}

impl OwnedActivity {
    pub(crate) fn gate(&self) -> Arc<OwnershipActivity> {
        self.gate.clone()
    }
}
impl Drop for OwnedActivity {
    fn drop(&mut self) {
        let mut state = self
            .gate
            .0
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        state.active -= 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn drain_retains_writers_and_never_reopens_a_different_hold() {
        let gate = Arc::new(OwnershipActivity::default());
        let writer = gate.begin(|| true).unwrap();
        gate.drain("restore").unwrap();
        assert!(gate.begin(|| true).is_none());
        assert!(!gate.drained("restore").unwrap());
        assert!(gate.resume("update").is_err());
        drop(writer);
        assert!(gate.drained("restore").unwrap());
        gate.stop();
        gate.resume("restore").unwrap();
        assert!(gate.begin(|| true).is_none());
    }
    #[test]
    fn failed_cleanup_cannot_acknowledge_idle() {
        let gate = Arc::new(OwnershipActivity::default());
        gate.drain("reset").unwrap();
        gate.uncertain_cleanup();
        assert!(gate.drained("reset").is_err());
        assert!(gate.resume("reset").is_err());
    }
}
