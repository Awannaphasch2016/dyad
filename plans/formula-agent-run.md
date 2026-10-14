# Agent-driven formula run

An agent drives the Discovery page through one successful save and one rejected formula.

## Important points

1. Open `https://formula.anakwannaphaschaiyong.com/formulas/discovery`. The bridge socket stays open. The page does not say the supervisor is missing. Validate and Save are enabled.
2. Doppler project `dyad`, config `preview`, holds `GAS_CITY_SUPERVISOR_URL` and `GAS_CITY_CITY_NAME`. It also holds `GAS_CITY_CITY_WRITE_GRANT` when the city requires a grant. The preview runtime exports those names into the formula task. A formula deploy finishes after they are saved.
3. The agent pastes a discovery formula. The `formula` name is `discovery`. Every step has `id` and `title`. `needs` names only a step in that file.
4. Validate says the formula is acceptable and leaves the GasCity file unchanged.
5. Save says Saved. Reload shows that same text. `<cityRoot>/formulas/discovery.toml` contains it. `implementation.toml` and `delivery.toml` stay unchanged. One new `wewebplus.formula_revisions` row holds that text.
6. The agent stays on Discovery and changes the first line to `formula = "delivery"`. Validate shows the name error. Save does not say Saved. Reload and `discovery.toml` still show `formula = "discovery"` and the text from the successful save.
7. A misspelled key such as `dependson` is ignored, so it is not the failure case.
8. The agent does not cook, sling, or run `gascity-rollout.yml`.
9. This run is not finished. The live page still reports that the GasCity supervisor is not configured, so the save and the rejected formula have not been driven.
