from agents.yield_forecast import YieldForecastInput, compute_yield_forecast
from schemas.context import AgentContext


def test_yield_forecast_reflects_weather_and_inventory_pressure():
    baseline_context = AgentContext(
        zone_id="grid_12",
        crop_type="Rice",
        growth_stage="vegetative",
    )

    stressed_context = AgentContext(
        zone_id="grid_12",
        crop_type="Rice",
        growth_stage="vegetative",
    )
    stressed_context.weather.humidity_percent = 90
    stressed_context.weather.precipitation_probability = 80
    stressed_context.inventory.low_stock = True
    stressed_context.inventory.sufficient_for_treatment = False
    stressed_context.scan.disease = "Rice Blast"
    stressed_context.scan.severity = 0.75

    baseline = compute_yield_forecast(
        YieldForecastInput(
            user_id="user-1",
            crop_type="Rice",
            farm_size_hectares=2.0,
            treatment_plan="fungicide",
            severity_score=0.75,
            growth_stage="vegetative",
            grid_id="grid_12",
            context=baseline_context,
        )
    )

    stressed = compute_yield_forecast(
        YieldForecastInput(
            user_id="user-1",
            crop_type="Rice",
            farm_size_hectares=2.0,
            treatment_plan="fungicide",
            severity_score=0.75,
            growth_stage="vegetative",
            grid_id="grid_12",
            context=stressed_context,
        )
    )

    assert stressed.predicted_yield_kg < baseline.predicted_yield_kg
    assert stressed.yield_loss_percent > baseline.yield_loss_percent


def test_yield_forecast_returns_range_when_context_is_sparse():
    forecast = compute_yield_forecast(
        YieldForecastInput(
            user_id="user-1",
            crop_type="Rice",
            farm_size_hectares=1.5,
            treatment_plan="fungicide",
            severity_score=0.8,
            grid_id="grid_12",
            context=AgentContext(zone_id="grid_12", crop_type="Rice"),
        )
    )

    assert forecast.predicted_yield_kg > 0
    assert forecast.confidence < 0.7
    assert forecast.predicted_yield_range_kg is not None