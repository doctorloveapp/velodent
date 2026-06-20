use serde::Serialize;

pub mod repository {}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BridgeUnits {
    pub selected_teeth: Vec<i64>,
    pub included_teeth: Vec<i64>,
    pub unit_count: i64,
}

pub fn calculate_bridge_units(selected_teeth: &[i64]) -> Result<BridgeUnits, String> {
    if selected_teeth.len() < 2 {
        return Err("bridge requires at least two teeth".to_owned());
    }
    let mut selected = selected_teeth.to_vec();
    selected.sort_unstable();
    selected.dedup();
    if selected.len() < 2 {
        return Err("bridge requires at least two unique teeth".to_owned());
    }
    let quadrant = selected[0] / 10;
    if !(1..=4).contains(&quadrant) || selected.iter().any(|tooth| tooth / 10 != quadrant) {
        return Err("bridge teeth must be in the same quadrant".to_owned());
    }
    if selected
        .iter()
        .any(|tooth| !(1..=8).contains(&(tooth % 10)))
    {
        return Err("invalid ISO/FDI tooth number".to_owned());
    }
    let min_position = selected
        .iter()
        .map(|tooth| tooth % 10)
        .min()
        .ok_or_else(|| "bridge selection is empty".to_owned())?;
    let max_position = selected
        .iter()
        .map(|tooth| tooth % 10)
        .max()
        .ok_or_else(|| "bridge selection is empty".to_owned())?;
    let included_teeth = (min_position..=max_position)
        .map(|position| quadrant * 10 + position)
        .collect::<Vec<_>>();

    Ok(BridgeUnits {
        selected_teeth: selected,
        unit_count: included_teeth.len() as i64,
        included_teeth,
    })
}

#[cfg(test)]
mod tests {
    use super::calculate_bridge_units;

    #[test]
    fn bridge_counts_intermediate_units() {
        let bridge = calculate_bridge_units(&[14, 16]).expect("bridge");
        assert_eq!(bridge.included_teeth, vec![14, 15, 16]);
        assert_eq!(bridge.unit_count, 3);
    }

    #[test]
    fn bridge_rejects_cross_quadrant_selection() {
        assert!(calculate_bridge_units(&[14, 24]).is_err());
    }
}
