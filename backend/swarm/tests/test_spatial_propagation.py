from agents.spatial_propagation import SpatialInput, compute_spatial_propagation
from schemas.context import AgentContext


def test_spatial_propagation_increases_with_wind_and_humidity():
    calm_context = AgentContext(zone_id="grid_12", crop_type="Rice")
    storm_context = AgentContext(zone_id="grid_12", crop_type="Rice")
    storm_context.weather.humidity_percent = 92

    calm = compute_spatial_propagation(
        SpatialInput(
            lat=2.0,
            lng=101.0,
            grid_id="grid_12",
            crop_type="Rice",
            disease="Rice Blast",
            severity_score=0.6,
            wind_speed_kmh=5,
            wind_direction="NE",
            humidity_percent=55,
            grid_density=0.4,
            context=calm_context,
        )
    )

    storm = compute_spatial_propagation(
        SpatialInput(
            lat=2.0,
            lng=101.0,
            grid_id="grid_12",
            crop_type="Rice",
            disease="Rice Blast",
            severity_score=0.6,
            wind_speed_kmh=24,
            wind_direction="NE",
            humidity_percent=92,
            grid_density=0.4,
            context=storm_context,
        )
    )

    assert storm.predicted_spread_radius_km > calm.predicted_spread_radius_km
    assert storm.risk_level in {"medium", "high"}
    assert storm.at_risk_zones